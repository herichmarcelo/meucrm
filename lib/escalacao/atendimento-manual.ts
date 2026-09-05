/**
 * ATENDIMENTO MANUAL PELO CANAL — o dono pegou o celular e respondeu o cliente
 * direto no WhatsApp (ou por outra plataforma ligada à mesma conta). A IA para
 * NESSA conversa, para não responder junto — e volta sozinha quando o prazo
 * vence.
 *
 * Silêncio expira sozinho em 60 minutos (PRAZO_DO_SILENCIO_MS).
 * Cada nova mensagem humana pelo canal renova a janela de 60 minutos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/**
 * Quanto tempo a IA fica calada depois de uma resposta manual pelo canal.
 */
export const PRAZO_DO_SILENCIO_MS = 60 * 60 * 1000;

const MOTIVO = "Atendimento manual pelo canal (resposta fora do CRM)";

export function normalizarInstante(v: Date | string | number | null | undefined): Date | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return v;
  if (v === "infinity") return Number.POSITIVE_INFINITY;
  if (v === "-infinity") return Number.NEGATIVE_INFINITY;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface PausaPorAtendimentoManualInput {
  organizationId: string;
  conversationId: string;
  /** Rótulo da origem do evento, só para log (o adapter que chamou se identifica). */
  canal?: string;
  /**
   * O instante da fala humana. INJETADO para o teste não depender do relógio
   * real. Default = agora.
   */
  agora?: Date;
}

/**
 * Pausa a IA numa conversa porque uma pessoa respondeu por fora do CRM, por
 * `PRAZO_DO_SILENCIO_MS` a contar de `agora`. Devolve `true` se gravou (pausa
 * nova ou prazo renovado), `false` se havia silêncio mais longo em vigor ou se
 * falhou.
 */
export async function pausarIaPorAtendimentoManual(
  admin: SupabaseClient,
  input: PausaPorAtendimentoManualInput,
): Promise<boolean> {
  const agora = input.agora ?? new Date();
  const proposto = new Date(agora.getTime() + PRAZO_DO_SILENCIO_MS);

  try {
    const { data: atual, error: readErr } = await admin
      .from("conversations")
      .select("bot_silenced_until")
      .eq("organization_id", input.organizationId)
      .eq("id", input.conversationId)
      .maybeSingle();

    if (readErr) {
      logger.warn("[atendimento-manual] leitura da conversa falhou — IA não pausada", {
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        detail: readErr.message.slice(0, 160),
      });
      return false;
    }
    if (atual == null) return false;

    // NUNCA encurta um silêncio maior já em vigor. `Infinity` (handoff formal)
    // vence qualquer prazo finito; uma janela mais longa que a nossa também.
    const silenciadaAte = normalizarInstante(
      (atual as { bot_silenced_until: string | null }).bot_silenced_until,
    );
    const atualMs =
      silenciadaAte === null
        ? Number.NEGATIVE_INFINITY
        : silenciadaAte instanceof Date
          ? silenciadaAte.getTime()
          : silenciadaAte;
    if (atualMs >= proposto.getTime()) return false;

    const { error: updErr } = await admin
      .from("conversations")
      .update({
        bot_silenced_until: proposto.toISOString(),
        last_handoff_at: agora.toISOString(),
        last_handoff_reason: MOTIVO,
      })
      .eq("organization_id", input.organizationId)
      .eq("id", input.conversationId);

    if (updErr) {
      logger.warn("[atendimento-manual] pausa da IA não gravada", {
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        detail: updErr.message.slice(0, 160),
      });
      return false;
    }

    logger.info("[atendimento-manual] IA pausada — pessoa respondeu pelo canal", {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      canal: input.canal ?? "desconhecido",
      silenciada_ate: proposto.toISOString(),
    });
    return true;
  } catch (err) {
    logger.warn("[atendimento-manual] pausa da IA lançou", {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      detail: err instanceof Error ? err.message.slice(0, 160) : "erro",
    });
    return false;
  }
}
