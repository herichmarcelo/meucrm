/**
 * Sincronização automática de estágios do funil quando um agendamento é criado ou atualizado.
 *
 * Regras de negócio da v1.11.0:
 * - Agendamento 'pending' (solicitado/pendente de confirmação) -> move para etapa com slug 'agendamento-solicitado' (se existir).
 * - Agendamento 'confirmed' (confirmado) -> move para etapa com slug 'agendado' (se existir).
 * - Cancelamento, falta ('no_show') ou comparecimento ('attended') NÃO movem o lead automaticamente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SyncAppointmentResult {
  moved: boolean;
  targetStageId?: string;
  targetSlug?: string;
  reason?: string;
}

export async function syncAppointmentStage(
  admin: SupabaseClient,
  organizationId: string,
  leadId: string | null,
  status: "pending" | "confirmed" | "attended" | "no_show" | "canceled",
): Promise<SyncAppointmentResult> {
  if (!leadId) {
    return { moved: false, reason: "lead_id_nulo" };
  }

  let targetSlug: string | null = null;
  if (status === "pending") {
    targetSlug = "agendamento-solicitado";
  } else if (status === "confirmed") {
    targetSlug = "agendado";
  }

  if (!targetSlug) {
    return { moved: false, reason: "status_nao_move_funil" };
  }

  // 1. Busca o lead e sua etapa atual
  const { data: lead, error: leadErr } = await admin
    .from("crm_leads")
    .select("id, stage_id, organization_id")
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr || !lead) {
    return { moved: false, reason: "lead_nao_encontrado" };
  }

  // 2. Descobre o pipeline_id através da etapa atual ou do funil padrão
  let pipelineId: string | null = null;
  if (lead.stage_id) {
    const { data: currentStage } = await admin
      .from("crm_stages")
      .select("pipeline_id, slug")
      .eq("id", lead.stage_id)
      .maybeSingle();

    if (currentStage) {
      if (currentStage.slug === targetSlug) {
        return { moved: false, reason: "lead_ja_esta_na_etapa" };
      }
      pipelineId = currentStage.pipeline_id;
    }
  }

  if (!pipelineId) {
    const { data: defaultPipe } = await admin
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle();

    pipelineId = defaultPipe?.id ?? null;
  }

  if (!pipelineId) {
    return { moved: false, reason: "funil_nao_encontrado" };
  }

  // 3. Procura a etapa com o slug desejado no funil
  const { data: targetStage, error: stageErr } = await admin
    .from("crm_stages")
    .select("id, name, slug")
    .eq("pipeline_id", pipelineId)
    .eq("slug", targetSlug)
    .maybeSingle();

  if (stageErr || !targetStage) {
    return { moved: false, reason: `etapa_${targetSlug}_nao_existe_no_funil` };
  }

  // 4. Move o lead para a nova etapa
  const fromStageId = lead.stage_id;
  const { error: updateErr } = await admin
    .from("crm_leads")
    .update({
      stage_id: targetStage.id,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", leadId);

  if (updateErr) {
    return { moved: false, reason: updateErr.message };
  }

  // 5. Registra a atividade no lead
  await admin.from("crm_lead_activities").insert({
    organization_id: organizationId,
    lead_id: leadId,
    type: "stage_changed",
    title: `Lead movido para ${targetStage.name} (agendamento ${status})`,
    payload: {
      from_stage_id: fromStageId,
      to_stage_id: targetStage.id,
      slug: targetSlug,
      reason: "appointment_sync",
      status,
    },
  });

  return {
    moved: true,
    targetStageId: targetStage.id,
    targetSlug,
  };
}
