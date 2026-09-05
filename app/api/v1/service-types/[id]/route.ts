/**
 * GET    /api/v1/service-types/[id] — Consulta um tipo de atendimento
 * PATCH  /api/v1/service-types/[id] — Atualiza tipo de atendimento (manager+)
 * DELETE /api/v1/service-types/[id] — Remove tipo de atendimento (manager+)
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const serviceTypeUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  price_cents: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
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
    .from("service_types")
    .select("id, organization_id, name, description, duration_minutes, price_cents, active, created_at, updated_at")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Tipo de atendimento não encontrado.", 404, { requestId });

  return ok({ service_type: data }, { requestId });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId });
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

  const parsed = serviceTypeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("service_types")
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select("id, organization_id, name, description, duration_minutes, price_cents, active, created_at, updated_at")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return fail("conflict", "Já existe um tipo de atendimento com este nome.", 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) return fail("not_found", "Tipo de atendimento não encontrado.", 404, { requestId });

  await audit({
    action: "service_type.updated",
    organizationId,
    actorUserId: userId,
    resourceType: "service_type",
    resourceId: data.id,
    metadata: parsed.data,
  });

  return ok({ service_type: data }, { requestId });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const userId = authz.user.id;
  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("service_types")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", id)
    .select("id, name")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Tipo de atendimento não encontrado.", 404, { requestId });

  await audit({
    action: "service_type.deleted",
    organizationId,
    actorUserId: userId,
    resourceType: "service_type",
    resourceId: data.id,
    metadata: { name: data.name },
  });

  return ok({ deleted: true }, { requestId });
}
