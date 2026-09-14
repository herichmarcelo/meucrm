/**
 * lib/csat/csat-responder.ts — Processador de respostas de pesquisa CSAT via WhatsApp.
 *
 * Intercepta mensagens de retorno (seleção de item de lista ou número de 1 a 5)
 * de clientes que possuem pesquisa de satisfação pendente.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";
import { getGowaClient } from "@/lib/gowa/client";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { ProcessCsatReplyInput, ProcessCsatReplyResult } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export function extrairNotaCsat(texto: string): number | null {
  const trimmed = texto.trim();

  // 1. Resposta de linha de lista interativa (ex: "csat_5", "csat_1")
  const matchRow = /^csat_([1-5])$/i.exec(trimmed);
  if (matchRow && matchRow[1]) {
    return parseInt(matchRow[1], 10);
  }

  // 2. Dígito único direto (ex: "5", "4")
  if (/^[1-5]$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // 3. Texto com estrelas ou formato "5 estrelas", "nota 5", "opção 5"
  const matchComposta = /(?:nota|opcao|opção|estrela|estrelas)?\s*([1-5])\s*(?:estrela|estrelas)?/i.exec(trimmed);
  if (matchComposta && matchComposta[1]) {
    return parseInt(matchComposta[1], 10);
  }

  return null;
}

export async function processarRespostaCsat(
  input: ProcessCsatReplyInput,
  adminClient?: Admin,
): Promise<ProcessCsatReplyResult> {
  const admin = adminClient ?? createAdminClient();
  const { organizationId, conversationId, contactId, text } = input;

  const score = extrairNotaCsat(text);
  if (score === null) {
    return { handled: false };
  }

  // Busca pesquisa pendente para esta conversa ou contato
  const { data: survey, error } = await admin
    .from("csat_surveys")
    .select("id, conversation_id, channel, channel_session_id:conversations(channel_session_id)")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !survey) {
    return { handled: false };
  }

  const now = new Date().toISOString();

  // Atualiza pesquisa como concluída
  const { error: updateErr } = await admin
    .from("csat_surveys")
    .update({
      score,
      status: "completed",
      responded_at: now,
      updated_at: now,
    })
    .eq("id", survey.id);

  if (updateErr) {
    logger.error("[csat.responder] falha ao registrar resposta csat", { error: updateErr.message });
    return { handled: false };
  }

  void audit({
    action: "csat.survey_responded",
    actorUserId: null,
    organizationId,
    resourceType: "csat_survey",
    resourceId: survey.id,
    metadata: {
      score,
      channel: survey.channel,
      source: "whatsapp_inbound",
    },
  });

  // Envia mensagem de agradecimento pelo WhatsApp
  try {
    const { data: conv } = await admin
      .from("conversations")
      .select("channel_session_id")
      .eq("id", conversationId)
      .maybeSingle();

    const channelSessionId = conv?.channel_session_id;
    if (channelSessionId) {
      const { data: session } = await admin
        .from("channel_sessions")
        .select("provider, waha_session_name, gowa_device_id")
        .eq("id", channelSessionId)
        .maybeSingle();

      const { data: contact } = await admin
        .from("contacts")
        .select("phone_number")
        .eq("id", contactId)
        .maybeSingle();

      const rawPhone = contact?.phone_number?.replace(/\D/g, "");
      if (rawPhone && session) {
        const mensagemObrigado = "Obrigado pela sua avaliação! Sua opinião nos ajuda a melhorar constantemente nosso atendimento.";
        if (session.provider === "gowa" && session.gowa_device_id) {
          const gowa = getGowaClient();
          if (gowa) {
            await gowa.sendText(session.gowa_device_id, rawPhone, mensagemObrigado);
          }
        } else if (session.waha_session_name) {
          const waha = getWahaClient();
          if (waha) {
            await waha.sendMessage(session.waha_session_name, `${rawPhone}@c.us`, mensagemObrigado);
          }
        }
      }
    }
  } catch (err) {
    logger.warn("[csat.responder] falha ao enviar agradecimento", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    handled: true,
    score,
    surveyId: survey.id,
  };
}
