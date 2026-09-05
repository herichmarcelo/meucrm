/**
 * GET  /api/v1/appointments — Lista agendamentos da organização com filtros
 * POST /api/v1/appointments — Cria novo agendamento e sincroniza funil do CRM
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncAppointmentStage } from "@/lib/appointments/pipeline-sync";

export const dynamic = "force-dynamic";

const appointmentCreateSchema = z.object({
  contact_id: z.string().uuid("ID de contato inválido"),
  lead_id: z.string().uuid().optional().nullable(),
  service_type_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string().datetime({ offset: true }).or(z.string().min(10)),
  duration_minutes: z.number().int().min(5).max(480).optional().default(30),
  status: z.enum(["pending", "confirmed", "attended", "no_show", "canceled"]).optional().default("pending"),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const admin = createAdminClient();

  const url = new URL(req.url);
  const contactId = url.searchParams.get("contact_id");
  const leadId = url.searchParams.get("lead_id");
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);

  let query = admin
    .from("appointments")
    .select(
      "id, organization_id, contact_id, lead_id, service_type_id, scheduled_at, duration_minutes, " +
      "status, notes, created_by_kind, created_at, updated_at, " +
      "contacts:contact_id(id, display_name, name, phone_number, email), " +
      "service_types:service_type_id(id, name, duration_minutes, price_cents)",
    )
    .eq("organization_id", organizationId);

  if (contactId) query = query.eq("contact_id", contactId);
  if (leadId) query = query.eq("lead_id", leadId);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("scheduled_at", from);
  if (to) query = query.lte("scheduled_at", to);

  const { data, error } = await query
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok({ appointments: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const userId = authz.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "JSON inválido no corpo.", 422, { requestId });
  }

  const parsed = appointmentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Dados do agendamento inválidos.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const admin = createAdminClient();

  // Se lead_id não foi passado, tenta descobrir pelo contact_id
  let leadId = parsed.data.lead_id;
  if (!leadId) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("contact_id", parsed.data.contact_id)
      .maybeSingle();

    if (lead) {
      leadId = lead.id;
    }
  }

  const { data, error } = await admin
    .from("appointments")
    .insert({
      organization_id: organizationId,
      contact_id: parsed.data.contact_id,
      lead_id: leadId ?? null,
      service_type_id: parsed.data.service_type_id ?? null,
      scheduled_at: new Date(parsed.data.scheduled_at).toISOString(),
      duration_minutes: parsed.data.duration_minutes,
      status: parsed.data.status,
      notes: parsed.data.notes ?? null,
      created_by_kind: "user",
      created_by_user_id: userId,
    })
    .select(
      "id, organization_id, contact_id, lead_id, service_type_id, scheduled_at, duration_minutes, status, notes, created_by_kind, created_at, updated_at",
    )
    .single();

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  // Sincroniza funil do CRM
  const syncResult = await syncAppointmentStage(
    admin,
    organizationId,
    leadId ?? null,
    parsed.data.status,
  );

  await audit({
    action: "appointment.created",
    organizationId,
    actorUserId: userId,
    resourceType: "appointment",
    resourceId: data.id,
    metadata: {
      contact_id: data.contact_id,
      scheduled_at: data.scheduled_at,
      status: data.status,
      funil_movido: syncResult.moved,
      etapa_destino: syncResult.targetSlug,
    },
  });

  return ok(
    {
      appointment: data,
      funil_atualizado: syncResult.moved,
      etapa_destino: syncResult.targetSlug,
    },
    { status: 201, requestId },
  );
}
