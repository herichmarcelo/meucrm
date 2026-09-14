/**
 * PATCH /api/v1/demandas/[id] — marca o PRÓXIMO PASSO ou altera o ESTADO de uma demanda.
 *
 * Suporta transição de estado com controle automático de pausa de SLA em 'aguardando_cliente'.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { atualizarPausaDemanda, registrarResolucaoDemanda } from "@/lib/sla/sla-tracking";
import { dispararPesquisaCsat } from "@/lib/csat/csat-dispatcher";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    proximo_passo: z.string().trim().min(3).max(500).optional(),
    /** ISO 8601 absoluto. Ausente é legítimo: nem todo passo tem hora marcada. */
    proximo_passo_em: z.string().datetime({ offset: true }).nullish(),
    estado: z.enum(["aberta", "em_atendimento", "aguardando_cliente", "resolvida", "encerrada"]).optional(),
  })
  .refine((d) => d.proximo_passo !== undefined || d.estado !== undefined, {
    message: "Informe ao menos 'proximo_passo' ou 'estado'.",
  });

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "demandas" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg, user } = authz;

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", "Corpo inválido.", 422, { requestId });
  }
  const parsed = patchSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail(
      "validation_failed",
      "Dados inválidos para a demanda.",
      422,
      { details: parsed.error.flatten().fieldErrors as Record<string, unknown>, requestId },
    );
  }

  const admin = createAdminClient();

  // Consulta estado atual para gerenciar pausa de SLA se estado mudar
  const { data: atual } = await admin
    .from("demandas")
    .select("id, estado, fechada_em")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  if (!atual || atual.fechada_em) {
    return fail("not_found", "Demanda não encontrada, ou já encerrada.", 404, { requestId });
  }

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.proximo_passo !== undefined) {
    updateData.proximo_passo = parsed.data.proximo_passo;
    updateData.proximo_passo_em = parsed.data.proximo_passo_em ?? null;
  }

  if (parsed.data.estado !== undefined) {
    updateData.estado = parsed.data.estado;
    if (parsed.data.estado === "resolvida" || parsed.data.estado === "encerrada") {
      updateData.fechada_em = new Date().toISOString();
    }
    await atualizarPausaDemanda(id, parsed.data.estado, atual.estado, admin);
  }

  const { data, error } = await admin
    .from("demandas")
    .update(updateData)
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .is("fechada_em", null)
    .select("id, estado, proximo_passo, proximo_passo_em, sla_paused_at, sla_total_paused_seconds")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) {
    return fail("not_found", "Demanda não encontrada, ou já encerrada.", 404, { requestId });
  }

  if (parsed.data.estado === "resolvida" || parsed.data.estado === "encerrada") {
    await registrarResolucaoDemanda(id, admin);
  }

  void audit({
    action: parsed.data.estado ? "demanda.estado_alterado" : "demanda.proximo_passo_definido",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "demanda",
    resourceId: id,
    requestId,
    metadata: {
      proximo_passo: parsed.data.proximo_passo,
      proximo_passo_em: parsed.data.proximo_passo_em ?? null,
      estado: parsed.data.estado,
    },
  });

  if (parsed.data.estado === "resolvida" || parsed.data.estado === "encerrada") {
    void admin
      .from("demanda_conversas")
      .select("conversation_id")
      .eq("demanda_id", id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data: dc }) => {
        if (dc?.conversation_id) {
          void dispararPesquisaCsat({
            organizationId: activeOrg.orgId,
            conversationId: dc.conversation_id,
            demandaId: id,
            actorUserId: user.id,
          });
        }
      });
  }

  return ok(data, { requestId });
}
