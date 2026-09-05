/**
 * GET    /api/v1/appointments/[id] — Consulta um agendamento específico
 * PATCH  /api/v1/appointments/[id] — Atualiza agendamento (horário, status, notas)
 * DELETE /api/v1/appointments/[id] — Remove ou cancela agendamento
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

const appointmentUpdateSchema = z.object({
  service_type_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string().datetime({ offset: true }).or(z.string().min(10)).optional(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  status: z.enum(["pending", "confirmed", "attended", "no_show", "canceled"]).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("appointments")
    .select(
      "id, organization_id, contact_id, lead_id, service_type_id, scheduled_at, duration_minutes, " +
      "status, notes, created_by_kind, created_at, updated_at, " +
      "contacts:contact_id(id, display_name, phone_number, email), " +
      "service_types:service_type_id(id, name, duration_minutes, price_cents)",
    )
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Agendamento não encontrado.", 404, { requestId });

  return ok({ appointment: data }, { requestId });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const userId = authz.user.id;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "JSON inválido.", 422, { requestId });
  }

  const parsed = appointmentUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const admin = createAdminClient();

  // 1. Busca estado atual
  const { data: current, error: fetchErr } = await admin
    .from("appointments")
    .select("id, organization_id, lead_id, scheduled_at, status")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !current) {
    return fail("not_found", "Agendamento não encontrado.", 404, { requestId });
  }

  // Validação: falta (no_show) não pode ser marcada em horário futuro
  const scheduledDate = parsed.data.scheduled_at ? new Date(parsed.data.scheduled_at) : new Date(current.scheduled_at);
  if (parsed.data.status === "no_show" && scheduledDate.getTime() > Date.now()) {
    return fail("validation_failed", "Não é possível registrar falta para um agendamento futuro.", 422, { requestId });
  }

  // 2. Monta payload de update
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.service_type_id !== undefined) updatePayload.service_type_id = parsed.data.service_type_id;
  if (parsed.data.scheduled_at !== undefined) updatePayload.scheduled_at = scheduledDate.toISOString();
  if (parsed.data.duration_minutes !== undefined) updatePayload.duration_minutes = parsed.data.duration_minutes;
  if (parsed.data.status !== undefined) updatePayload.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updatePayload.notes = parsed.data.notes;

  const { data: updated, error: updateErr } = await admin
    .from("appointments")
    .update(updatePayload)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select(
      "id, organization_id, contact_id, lead_id, service_type_id, scheduled_at, duration_minutes, status, notes, created_by_kind, created_at, updated_at",
    )
    .maybeSingle();

  if (updateErr || !updated) {
    return fail("internal_error", updateErr?.message || "Erro ao atualizar", 500, { requestId });
  }

  // 3. Se o status mudou, sincroniza funil do CRM
  let funilAtualizado = false;
  let etapaDestino: string | undefined;

  if (parsed.data.status && parsed.data.status !== current.status) {
    const syncResult = await syncAppointmentStage(
      admin,
      organizationId,
      current.lead_id,
      parsed.data.status,
    );
    funilAtualizado = syncResult.moved;
    etapaDestino = syncResult.targetSlug;
  }

  await audit({
    action: parsed.data.status !== current.status ? "appointment.status_changed" : "appointment.updated",
    organizationId,
    actorUserId: userId,
    resourceType: "appointment",
    resourceId: updated.id,
    metadata: {
      status_anterior: current.status,
      status_novo: updated.status,
      funil_movido: funilAtualizado,
      etapa_destino: etapaDestino,
    },
  });

  return ok({
    appointment: updated,
    funil_atualizado: funilAtualizado,
    etapa_destino: etapaDestino,
  }, { requestId });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const userId = authz.user.id;
  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("appointments")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select("id, contact_id, scheduled_at")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Agendamento não encontrado.", 404, { requestId });

  await audit({
    action: "appointment.cancelled",
    organizationId,
    actorUserId: userId,
    resourceType: "appointment",
    resourceId: data.id,
    metadata: { contact_id: data.contact_id, scheduled_at: data.scheduled_at },
  });

  return ok({ deleted: true }, { requestId });
}
