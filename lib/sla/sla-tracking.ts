/**
 * lib/sla/sla-tracking.ts
 *
 * Módulo para gerenciamento de SLA por tipo de atendimento (da 1ª conversa vinculada),
 * controle de pausa do relógio em 'aguardando_cliente' e registro de 1ª resposta outbound.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularMinutosUteis, calcularSegundosUteis } from "@/lib/business-hours/calc-business-time";
import type { BusinessHoliday, BusinessHourSlot } from "@/lib/business-hours/types";

export interface TipoAtendimentoInfo {
  tag_name: string;
  first_response_minutes: number | null;
  resolution_minutes: number | null;
  is_csat_enabled: boolean;
  first_conversation_id: string;
}

/**
 * Localiza o tipo de atendimento da demanda a partir da PRIMEIRA conversa vinculada.
 * A 1ª conversa vinculada define o SLA e se o CSAT é disparado.
 */
export async function resolverTipoAtendimentoDemanda(
  demandaId: string,
  client: SupabaseClient,
): Promise<TipoAtendimentoInfo | null> {
  const { data: vinculos, error: vError } = await client
    .from("demanda_conversas")
    .select("conversation_id, created_at, conversations(id, organization_id, tags)")
    .eq("demanda_id", demandaId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (vError || !vinculos || vinculos.length === 0) {
    return null;
  }

  const firstVinculo = vinculos[0] as unknown as {
    conversation_id: string;
    conversations?: { id: string; organization_id: string; tags: string[] } | null;
  };

  const conv = firstVinculo?.conversations;
  if (!conv || !conv.tags || conv.tags.length === 0) {
    return null;
  }

  const { data: tagDefs } = await client
    .from("tags")
    .select(
      "name, group_slug, is_exclusive, is_csat_enabled, sla_first_response_minutes, sla_resolution_minutes",
    )
    .eq("organization_id", conv.organization_id)
    .eq("group_slug", "tipo_atendimento")
    .in("name", conv.tags);

  const matchedTag = tagDefs?.[0];
  if (!matchedTag) return null;

  return {
    tag_name: matchedTag.name,
    first_response_minutes: matchedTag.sla_first_response_minutes,
    resolution_minutes: matchedTag.sla_resolution_minutes,
    is_csat_enabled: matchedTag.is_csat_enabled,
    first_conversation_id: conv.id,
  };
}

/**
 * Gerencia a pausa do relógio do SLA quando a demanda entra ou sai de 'aguardando_cliente'.
 */
export async function atualizarPausaDemanda(
  demandaId: string,
  novoEstado: string,
  estadoAnterior: string,
  client: SupabaseClient,
): Promise<void> {
  if (novoEstado === estadoAnterior) return;

  const now = new Date();

  // Entrou em 'aguardando_cliente' -> Inicia pausa
  if (novoEstado === "aguardando_cliente" && estadoAnterior !== "aguardando_cliente") {
    await client
      .from("demandas")
      .update({ sla_paused_at: now.toISOString() })
      .eq("id", demandaId);
    return;
  }

  // Saiu de 'aguardando_cliente' -> Finaliza pausa e acumula segundos úteis
  if (estadoAnterior === "aguardando_cliente" && novoEstado !== "aguardando_cliente") {
    const { data: demanda } = await client
      .from("demandas")
      .select("id, organization_id, sla_paused_at, sla_total_paused_seconds")
      .eq("id", demandaId)
      .single();

    if (!demanda || !demanda.sla_paused_at) return;

    // Busca expediente da organização
    const [slotsRes, holidaysRes] = await Promise.all([
      client
        .from("business_hours_slots")
        .select("day_of_week, open_time, close_time, is_active, timezone")
        .eq("organization_id", demanda.organization_id),
      client
        .from("business_holidays")
        .select("holiday_date, description")
        .eq("organization_id", demanda.organization_id),
    ]);

    const slots = (slotsRes.data as BusinessHourSlot[]) ?? [];
    const holidays = (holidaysRes.data as BusinessHoliday[]) ?? [];
    const tz = slots[0]?.timezone ?? "America/Sao_Paulo";

    const segundosPausados = calcularSegundosUteis(
      new Date(demanda.sla_paused_at),
      now,
      slots,
      holidays,
      tz,
    );

    const novoTotal = (demanda.sla_total_paused_seconds || 0) + segundosPausados;

    await client
      .from("demandas")
      .update({
        sla_total_paused_seconds: novoTotal,
        sla_paused_at: null,
      })
      .eq("id", demandaId);
  }
}

/**
 * Registra a 1ª resposta humana ou de IA em demandas vinculadas à conversa, verificando estouro de SLA.
 */
export async function registrarPrimeiraRespostaOutbound(
  conversaId: string,
  sentVia: "user" | "ai",
  client: SupabaseClient,
): Promise<void> {
  // Ignora mensagens de sistema puro (automações/notificações internas)
  if (sentVia !== "user" && sentVia !== "ai") return;

  const { data: vinculos } = await client
    .from("demanda_conversas")
    .select("demanda_id, demandas(id, organization_id, aberta_em, primeira_resposta_em, sla_first_response_target_minutes, sla_total_paused_seconds, sla_paused_at)")
    .eq("conversation_id", conversaId);

  if (!vinculos || vinculos.length === 0) return;

  const now = new Date();

  for (const v of vinculos) {
    const d = (v as unknown as { demandas: Record<string, unknown> | null })?.demandas;
    if (!d || d.primeira_resposta_em) continue;

    const abertaEm = new Date(String(d.aberta_em));
    const targetMinutes = d.sla_first_response_target_minutes as number | null;
    let breached = false;

    if (targetMinutes && targetMinutes > 0) {
      // Busca expediente para calcular tempo útil
      const [slotsRes, holidaysRes] = await Promise.all([
        client
          .from("business_hours_slots")
          .select("day_of_week, open_time, close_time, is_active, timezone")
          .eq("organization_id", d.organization_id),
        client
          .from("business_holidays")
          .select("holiday_date, description")
          .eq("organization_id", d.organization_id),
      ]);

      const slots = (slotsRes.data as BusinessHourSlot[]) ?? [];
      const holidays = (holidaysRes.data as BusinessHoliday[]) ?? [];
      let tz = slots[0]?.timezone;
      if (!tz) {
        try {
          const orgQuery = client.from("organizations").select("timezone").eq("id", d.organization_id);
          const orgRes = typeof orgQuery?.maybeSingle === "function" ? await orgQuery.maybeSingle() : await orgQuery;
          const orgItem = Array.isArray(orgRes?.data) ? orgRes.data[0] : orgRes?.data;
          tz = (orgItem as { timezone?: string } | null)?.timezone ?? "America/Sao_Paulo";
        } catch {
          tz = "America/Sao_Paulo";
        }
      }

      const minutosDecorridos = calcularMinutosUteis(abertaEm, now, slots, holidays, tz);
      const minutosPausados = Math.floor(Number(d.sla_total_paused_seconds || 0) / 60);
      const minutosEfetivos = Math.max(0, minutosDecorridos - minutosPausados);

      if (minutosEfetivos > targetMinutes) {
        breached = true;
      }
    }

    await client
      .from("demandas")
      .update({
        primeira_resposta_em: now.toISOString(),
        sla_first_response_breached: breached,
      })
      .eq("id", d.id);
  }
}
