/**
 * lib/csat/csat-dispatcher.ts — Disparador de pesquisa de satisfação CSAT segmentada.
 *
 * Dispara automaticamente ao fechar uma conversa/demanda quando a tag do tipo
 * de atendimento possui `is_csat_enabled = true`.
 *
 * Suporta canais WhatsApp (WAHA e GOWA via listas interativas) e E-mail (via Resend com links assinados).
 */
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";
import { getGowaClient } from "@/lib/gowa/client";
import { sendEmail } from "@/lib/email/resend";
import { buildCsatEmail } from "@/lib/email/templates/csat";
import { marcaDaSaida } from "@/lib/branding/saida";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import type { DispatchCsatInput, DispatchCsatResult } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export async function dispararPesquisaCsat(
  input: DispatchCsatInput,
  adminClient?: Admin,
): Promise<DispatchCsatResult> {
  const admin = adminClient ?? createAdminClient();
  const { organizationId, conversationId, demandaId, actorUserId } = input;

  // 1. Busca dados da conversa (tags, canal e contato)
  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .select("id, tags, channel_session_id, contact_id, status")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (convErr || !conv) {
    return { dispatched: false, reason: "conversation_not_found" };
  }

  const tags = (conv.tags as string[]) ?? [];
  if (tags.length === 0) {
    return { dispatched: false, reason: "no_tags" };
  }

  // 2. Verifica se alguma tag possui CSAT habilitado
  const tagTable = typeof admin.from("tags")?.select === "function" ? "tags" : "tags_definitions";
  const { data: tagData } = await admin
    .from(tagTable)
    .select("id, name, is_csat_enabled")
    .eq("organization_id", organizationId)
    .eq("is_csat_enabled", true)
    .in("name", tags)
    .limit(1)
    .maybeSingle();

  const csatTag = tagData as { id: string; name: string; is_csat_enabled: boolean } | null;
  if (!csatTag) {
    return { dispatched: false, reason: "csat_not_enabled_for_tag" };
  }

  // 2b. Consulta configuração de CSAT (espera e frequência máxima por contato)
  let maxFrequencyDays = 30;
  let delayMinutes = 0;

  try {
    const { data: configs } = await admin
      .from("csat_config")
      .select("tag_id, delay_minutes, max_frequency_days")
      .eq("organization_id", organizationId);

    if (configs && Array.isArray(configs) && configs.length > 0) {
      const tagConfig = configs.find((c: { tag_id: string | null }) => c.tag_id === csatTag?.id);
      const defaultConfig = configs.find((c: { tag_id: string | null }) => !c.tag_id);
      const activeConfig = tagConfig ?? defaultConfig;
      if (activeConfig) {
        maxFrequencyDays = Number(activeConfig.max_frequency_days ?? 30);
        delayMinutes = Number(activeConfig.delay_minutes ?? 0);
      }
    }
  } catch {
    // Mantém defaults seguros
  }

  // 3. Previne duplicatas de pesquisa para a mesma conversa
  const { data: existingSurvey } = await admin
    .from("csat_surveys")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (existingSurvey) {
    return { dispatched: false, reason: "survey_already_dispatched" };
  }

  // 3b. Previne envio se o contato já recebeu pesquisa nos últimos max_frequency_days dias
  if (maxFrequencyDays > 0) {
    const cutoffDate = new Date(Date.now() - maxFrequencyDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentSurvey } = await admin
      .from("csat_surveys")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("contact_id", conv.contact_id)
      .gte("sent_at", cutoffDate)
      .limit(1)
      .maybeSingle();

    if (recentSurvey) {
      return { dispatched: false, reason: "contact_frequency_limit_exceeded" };
    }
  }

  // 4. Carrega informações do contato
  const { data: contact, error: contactErr } = await admin
    .from("contacts")
    .select("id, full_name, phone_number, email")
    .eq("id", conv.contact_id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (contactErr || !contact) {
    return { dispatched: false, reason: "contact_not_found" };
  }

  // 5. Carrega informações da sessão de canal
  let channelSession: {
    id: string;
    provider: string;
    phone_number: string | null;
    waha_session_name?: string | null;
    gowa_device_id?: string | null;
  } | null = null;

  if (conv.channel_session_id) {
    const { data: s } = await admin
      .from("channel_sessions")
      .select("id, provider, phone_number, waha_session_name, gowa_device_id")
      .eq("id", conv.channel_session_id)
      .maybeSingle();
    channelSession = s;
  }

  // Resolve canal: WhatsApp se tiver sessão WAHA/GOWA/Meta ou telefone; senão E-mail se tiver email
  const isEmailSession = channelSession?.provider === "email";
  let channelType: "whatsapp" | "email" = "whatsapp";

  if (isEmailSession) {
    channelType = "email";
  } else if (!contact.phone_number && contact.email) {
    channelType = "email";
  } else if (contact.phone_number) {
    channelType = "whatsapp";
  } else {
    return { dispatched: false, reason: "no_valid_contact_channel" };
  }

  const token = randomUUID();
  const now = new Date().toISOString();

  // 6. Insere registro de CSAT pendente
  const { data: survey, error: insertErr } = await admin
    .from("csat_surveys")
    .insert({
      organization_id: organizationId,
      demanda_id: demandaId ?? null,
      conversation_id: conversationId,
      contact_id: contact.id,
      channel: channelType,
      token,
      status: "pending",
      sent_at: now,
    })
    .select("id")
    .single();

  if (insertErr || !survey) {
    logger.error("[csat.dispatcher] falha ao inserir pesquisa csat", { error: insertErr?.message });
    return { dispatched: false, reason: "insert_failed" };
  }

  const marca = await marcaDaSaida(organizationId);

  // 7. Dispara no canal apropriado
  if (channelType === "whatsapp") {
    const recipientPhone = contact.phone_number?.replace(/\D/g, "") ?? "";
    const listPayload = {
      title: "Pesquisa de Satisfação",
      description: "Como você avalia o atendimento que acabou de receber?",
      buttonText: "Avaliar",
      footer: marca.nome,
      sections: [
        {
          title: "Sua avaliação",
          rows: [
            { rowId: "csat_5", title: "⭐⭐⭐⭐⭐ Excelente", description: "Atendimento exemplar" },
            { rowId: "csat_4", title: "⭐⭐⭐⭐ Bom", description: "Atendimento positivo" },
            { rowId: "csat_3", title: "⭐⭐⭐ Regular", description: "Atendeu ao esperado" },
            { rowId: "csat_2", title: "⭐⭐ Ruim", description: "Abaixo do esperado" },
            { rowId: "csat_1", title: "⭐ Péssimo", description: "Muito insatisfeito" },
          ],
        },
      ],
    };

    try {
      if (channelSession?.provider === "gowa") {
        const gowa = getGowaClient();
        if (gowa && channelSession.gowa_device_id) {
          await gowa.sendList(channelSession.gowa_device_id, recipientPhone, listPayload);
        }
      } else {
        const waha = getWahaClient();
        const sessionName = channelSession?.waha_session_name || "default";
        if (waha) {
          const chatId = `${recipientPhone}@c.us`;
          await waha.sendList(sessionName, chatId, listPayload);
        }
      }
    } catch (err) {
      logger.warn("[csat.dispatcher] falha no envio da lista whatsapp", {
        surveyId: survey.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (channelType === "email" && contact.email) {
    try {
      const baseUrl = (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
      const surveyBaseUrl = `${baseUrl}/csat/v/${token}`;
      const emailContent = buildCsatEmail({
        clientName: contact.full_name,
        surveyBaseUrl,
        marca,
      });

      await sendEmail({
        to: contact.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        fromName: marca.nome,
        tags: [
          { name: "kind", value: "csat_survey" },
          { name: "org", value: organizationId },
        ],
      });
    } catch (err) {
      logger.warn("[csat.dispatcher] falha no envio do email csat", {
        surveyId: survey.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  void audit({
    action: "csat.survey_dispatched",
    actorUserId: actorUserId ?? null,
    organizationId,
    resourceType: "csat_survey",
    resourceId: survey.id,
    metadata: {
      conversation_id: conversationId,
      channel: channelType,
      tag_name: csatTag.name,
    },
  });

  return {
    dispatched: true,
    surveyId: survey.id,
    channel: channelType,
  };
}
