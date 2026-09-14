/**
 * GET  /api/v1/tags — Lista tags e suas cores na organização ativa
 * POST /api/v1/tags — Cria ou atualiza uma tag e sua cor/metas associadas (upsert)
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const upsertTagSchema = z.object({
  name: z.string().trim().toLowerCase().min(1).max(40),
  color: z.string().trim().toLowerCase().max(30).nullable().optional(),
  // Colunas da migration 0177 — aceitas no schema Zod mas só enviadas ao banco
  // se a migration já foi aplicada. Sem a migration elas retornam 42703 e
  // quebram TODO o sistema de cores. Mantemos aqui para não mudar a API pública.
  group_slug: z.string().trim().toLowerCase().max(50).nullable().optional(),
  is_exclusive: z.boolean().optional(),
  is_csat_enabled: z.boolean().optional(),
  sla_first_response_minutes: z.number().int().positive().nullable().optional(),
  sla_resolution_minutes: z.number().int().positive().nullable().optional(),
});

// ATENÇÃO: só colunas que existem na migration baseline atual.
// As colunas group_slug, is_exclusive, is_csat_enabled, sla_*
// fazem parte da migration 0177 que ainda não foi aplicada no Supabase.
// Quando a migration for aplicada, adicionar as colunas aqui.
const TAG_SELECT_COLS = "id, organization_id, name, color, created_at, updated_at";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tags")
    .select(TAG_SELECT_COLS)
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const body = await req.json().catch(() => null);
  const parsed = upsertTagSchema.safeParse(body);

  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos para a tag.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const { name, color } = parsed.data;
  // group_slug, is_exclusive, is_csat_enabled, sla_* são ignorados até a
  // migration 0177 ser aplicada no Supabase (colunas não existem ainda).

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const upsertData: Record<string, unknown> = {
    organization_id: organizationId,
    name,
    color: color ?? null,
    updated_at: now,
  };

  const { data, error } = await admin
    .from("tags")
    .upsert(upsertData, { onConflict: "organization_id,name" })
    .select(TAG_SELECT_COLS)
    .single();

  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "tag.upserted",
    organizationId,
    actorUserId: authz.user.id,
    resourceType: "tag",
    resourceId: data.id,
    metadata: {
      name,
      color: color ?? null,
    },
  });

  return ok(data, { requestId, status: 200 });
}
