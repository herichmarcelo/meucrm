/**
 * GET  /api/v1/service-types — Lista os tipos de atendimento da organização
 * POST /api/v1/service-types — Cria um novo tipo de atendimento (requer manager+)
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const serviceTypeCreateSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  duration_minutes: z.number().int().min(5).max(480).optional().default(30),
  price_cents: z.number().int().min(0).optional().default(0),
  active: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const admin = createAdminClient();

  const url = new URL(req.url);
  const activeOnly = url.searchParams.get("active") === "true";

  let query = admin
    .from("service_types")
    .select("id, organization_id, name, description, duration_minutes, price_cents, active, created_at, updated_at")
    .eq("organization_id", organizationId);

  if (activeOnly) {
    query = query.eq("active", true);
  }

  const { data, error } = await query.order("name", { ascending: true });
  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok({ service_types: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const userId = authz.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "JSON inválido no corpo da requisição.", 422, { requestId });
  }

  const parsed = serviceTypeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("service_types")
    .insert({
      organization_id: organizationId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      duration_minutes: parsed.data.duration_minutes,
      price_cents: parsed.data.price_cents,
      active: parsed.data.active,
    })
    .select("id, organization_id, name, description, duration_minutes, price_cents, active, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return fail("conflict", "Já existe um tipo de atendimento com este nome.", 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "service_type.created",
    organizationId,
    actorUserId: userId,
    resourceType: "service_type",
    resourceId: data.id,
    metadata: { name: data.name, price_cents: data.price_cents, duration_minutes: data.duration_minutes },
  });

  return ok({ service_type: data }, { status: 201, requestId });
}
