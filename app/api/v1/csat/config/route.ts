/**
 * GET /api/v1/csat/config — Consulta configurações de CSAT (espera e frequência máxima).
 * PUT /api/v1/csat/config — Atualiza configurações de CSAT (requireRole manager).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const putCsatConfigSchema = z.object({
  delay_minutes: z.number().int().min(0).max(10080).default(0), // até 7 dias
  max_frequency_days: z.number().int().min(0).max(365).default(30),
  tag_id: z.string().uuid().nullable().optional(),
});

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "csat_config" });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("csat_config")
    .select("id, organization_id, tag_id, delay_minutes, max_frequency_days, updated_at")
    .eq("organization_id", organizationId);

  if (error) {
    return fail("internal_error", "Erro ao consultar configurações de CSAT.", 500, {
      requestId,
    });
  }

  // Se não houver config criada, devolve os padrões da organização
  const configs = data && data.length > 0 ? data : [
    {
      id: null,
      organization_id: organizationId,
      tag_id: null,
      delay_minutes: 0,
      max_frequency_days: 30,
      updated_at: new Date().toISOString(),
    },
  ];

  return ok(configs, { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "csat_config" });
  if (!authz.ok) return authz.response;

  const { user, org } = authz;
  const raw = await req.json().catch(() => null);
  const parsed = putCsatConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Parâmetros inválidos para configuração de CSAT.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const { delay_minutes, max_frequency_days, tag_id } = parsed.data;
  const admin = createAdminClient();

  // Verifica se já existe registro para a org e a tag (ou null)
  let query = admin
    .from("csat_config")
    .select("id")
    .eq("organization_id", org.orgId);

  if (tag_id) {
    query = query.eq("tag_id", tag_id);
  } else {
    query = query.is("tag_id", null);
  }

  const { data: existing } = await query.maybeSingle();

  let savedData;
  if (existing?.id) {
    const { data: updated, error: updateErr } = await admin
      .from("csat_config")
      .update({
        delay_minutes,
        max_frequency_days,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (updateErr) {
      return fail("internal_error", "Erro ao atualizar configuração de CSAT.", 500, {
        requestId,
      });
    }
    savedData = updated;
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from("csat_config")
      .insert({
        organization_id: org.orgId,
        tag_id: tag_id ?? null,
        delay_minutes,
        max_frequency_days,
      })
      .select()
      .single();

    if (insertErr) {
      return fail("internal_error", "Erro ao criar configuração de CSAT.", 500, {
        requestId,
      });
    }
    savedData = inserted;
  }

  void audit({
    action: "csat_config.updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "csat_config",
    resourceId: savedData.id,
    requestId,
    metadata: {
      delay_minutes,
      max_frequency_days,
      tag_id,
    },
  });

  return ok(savedData, { requestId });
}
