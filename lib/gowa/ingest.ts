/**
 * lib/gowa/ingest.ts — Pipeline de ingestão de eventos do GOWA.
 *
 * Processa mensagens recebidas, acks de entrega e sincronização de estado
 * de conexão com o banco de dados do CRM.
 */
import { ackToStatus } from "@/lib/types/messaging";
import { sincronizarSaudeDaConexao } from "@/lib/channels/health";
import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import { logger } from "@/lib/logger";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { GowaEnvelope, GowaPayload } from "./envelope";

type Admin = ReturnType<typeof createAdminClient>;

export interface GowaSessionScope {
  id: string;
  organization_id: string;
  gowa_device_id?: string | null;
}

export type ChatIdentity =
  | { kind: "phone"; phone: string; lid: null }
  | { kind: "lid"; phone: null; lid: string }
  | { kind: "group"; phone: null; lid: null }
  | { kind: "unknown"; phone: null; lid: null };

function semSufixoDeChat(chatId: string): string {
  const arroba = chatId.indexOf("@");
  return arroba === -1 ? chatId : chatId.slice(0, arroba);
}

export function parseChatIdGowa(chatId: string, fromLid?: string | null): ChatIdentity {
  if (!chatId) return { kind: "unknown", phone: null, lid: null };

  if (chatId.endsWith("@g.us")) {
    return { kind: "group", phone: null, lid: null };
  }

  if (chatId.endsWith("@lid") || (fromLid && fromLid.endsWith("@lid"))) {
    const rawLid = fromLid && fromLid.endsWith("@lid") ? fromLid : chatId;
    return { kind: "lid", phone: null, lid: semSufixoDeChat(rawLid) };
  }

  if (chatId.endsWith("@s.whatsapp.net") || chatId.endsWith("@c.us")) {
    const digits = semSufixoDeChat(chatId).replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15) {
      return { kind: "phone", phone: `+${digits}`, lid: null };
    }
  }

  return { kind: "unknown", phone: null, lid: null };
}

function ehEnderecavel(parsed: ChatIdentity): boolean {
  return parsed.kind === "phone" || parsed.kind === "lid";
}

async function upsertContact(
  admin: Admin,
  orgId: string,
  parsed: ChatIdentity,
  chatId: string,
  notifyName: string | null,
): Promise<string | null> {
  if (!ehEnderecavel(parsed)) return null;

  const { data, error } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: orgId,
    p_kind: parsed.kind,
    p_phone: parsed.kind === "phone" ? parsed.phone : null,
    p_lid: parsed.kind === "lid" ? parsed.lid : null,
    p_chat_id: chatId,
    p_notify: notifyName,
  } as never);

  if (error) {
    logger.error("[gowa.ingest] fn_upsert_wa_contact failed", { error: error.message, orgId });
    return null;
  }
  return (data as string) ?? null;
}

async function upsertConversation(
  admin: Admin,
  orgId: string,
  contactId: string,
  sessionId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation" as never, {
    p_org: orgId,
    p_contact: contactId,
    p_session: sessionId,
  } as never);

  if (error) {
    logger.error("[gowa.ingest] fn_upsert_wa_conversation failed", { error: error.message, orgId });
    return null;
  }
  return (data as string) ?? null;
}

async function markConversation(
  admin: Admin,
  convId: string,
  direction: "inbound" | "outbound",
  preview: string,
  at: string,
): Promise<void> {
  await admin.rpc("fn_mark_conversation_message" as never, {
    p_conv: convId,
    p_direction: direction,
    p_preview: preview,
    p_at: at,
  } as never);
}

function resolveGowaMessageType(p: GowaPayload): string {
  if (p.has_media) {
    if (p.image_url || p.mime_type?.startsWith("image/")) return "image";
    if (p.audio_url || p.mime_type?.startsWith("audio/")) return "audio";
    if (p.file_url || p.mime_type?.startsWith("video/")) return "video";
    return "document";
  }
  return "text";
}

function mediaUrlOf(p: GowaPayload): string | null {
  return p.media_url ?? p.image_url ?? p.audio_url ?? p.file_url ?? null;
}

/**
 * Pipeline principal de ingestão de evento do GOWA.
 */
export async function dispatchGowaEvent(
  admin: Admin,
  session: GowaSessionScope,
  envelope: GowaEnvelope,
  requestId: string,
): Promise<{ processed: boolean; reason?: string }> {
  const event = envelope.event ?? "message";
  const rawObj = ((envelope.payload ?? (envelope as Record<string, unknown>).data ?? envelope) as Record<string, unknown>) || {};

  const rawId = (rawObj.id as string) ?? (rawObj.key as Record<string, unknown>)?.id as string ?? (envelope as Record<string, unknown>).id as string ?? null;
  const rawAck = typeof rawObj.ack === "number" ? rawObj.ack : (typeof (envelope as Record<string, unknown>).ack === "number" ? (envelope as Record<string, unknown>).ack as number : null);
  const rawStatus = (rawObj.status as string) ?? (envelope as Record<string, unknown>).status as string ?? null;
  const isFromMe = Boolean(rawObj.is_from_me ?? rawObj.fromMe ?? (rawObj.key as Record<string, unknown>)?.fromMe ?? false);

  // 1. Processamento de ACKs (confirmação de leitura / entrega)
  if (event === "message.ack" || (typeof rawAck === "number" && rawId)) {
    const status = ackToStatus(rawAck ?? 1);
    if (rawId) {
      await admin
        .from("messages")
        .update({ status })
        .eq("organization_id", session.organization_id)
        .eq("external_id", rawId);
    }
    return { processed: true };
  }

  // 2. Mudança de status de conexão
  if (event === "connection.update" || event === "state.change") {
    const statusStr = (rawStatus ?? "").toUpperCase();
    const isWorking = statusStr === "CONNECTED" || statusStr === "WORKING" || statusStr === "OPEN";
    await sincronizarSaudeDaConexao(
      admin,
      { id: session.id, organization_id: session.organization_id, status: isWorking ? "WORKING" : "STOPPED" },
      { reachable: true, status: isWorking ? "WORKING" : "STOPPED", detail: null },
      session.gowa_device_id ?? "GOWA",
      "empurrao",
    );
    return { processed: true };
  }

  // 3. Ignora mensagens enviadas por nós mesmos (eco outbound)
  if (isFromMe) {
    return { processed: true, reason: "from_me_echo_ignored" };
  }

  // 4. Mensagem Inbound
  const chatId = String(
    rawObj.from ??
    rawObj.chat_id ??
    rawObj.sender ??
    (rawObj.key as Record<string, unknown>)?.remoteJid ??
    rawObj.remoteJid ??
    (envelope as Record<string, unknown>).from ??
    "",
  );
  const fromLid = (rawObj.from_lid as string) ?? ((rawObj.key as Record<string, unknown>)?.participant as string) ?? null;
  const parsed = parseChatIdGowa(chatId, fromLid);

  if (parsed.kind === "group") {
    return { processed: false, reason: "group_message_ignored" };
  }

  if (!ehEnderecavel(parsed)) {
    return { processed: false, reason: "unaddressable_chat_id" };
  }

  const msgObj = rawObj.message as Record<string, unknown> | undefined;
  const messageText = String(
    rawObj.body ??
    rawObj.caption ??
    rawObj.text ??
    msgObj?.conversation ??
    (msgObj?.extendedTextMessage as Record<string, unknown>)?.text ??
    (msgObj?.imageMessage as Record<string, unknown>)?.caption ??
    (msgObj?.videoMessage as Record<string, unknown>)?.caption ??
    (msgObj?.documentMessage as Record<string, unknown>)?.caption ??
    (typeof rawObj.message === "string" ? rawObj.message : "") ??
    "",
  ).trim();

  const mediaUrl =
    (rawObj.media_url as string) ??
    (rawObj.image_url as string) ??
    (rawObj.audio_url as string) ??
    (rawObj.file_url as string) ??
    (rawObj.url as string) ??
    null;

  const hasMedia = Boolean(
    rawObj.has_media ??
    mediaUrl ??
    msgObj?.imageMessage ??
    msgObj?.audioMessage ??
    msgObj?.videoMessage ??
    msgObj?.documentMessage,
  );

  if (!messageText && !mediaUrl && !hasMedia) {
    return { processed: false, reason: "empty_message_content" };
  }

  const notifyName = (rawObj.from_name ?? rawObj.sender_display_name ?? rawObj.pushName ?? rawObj.pushname ?? rawObj.name ?? null) as string | null;
  const contactId = await upsertContact(admin, session.organization_id, parsed, chatId, notifyName);
  if (!contactId) {
    return { processed: false, reason: "contact_upsert_failed" };
  }

  const conversationId = await upsertConversation(admin, session.organization_id, contactId, session.id);
  if (!conversationId) {
    return { processed: false, reason: "conversation_upsert_failed" };
  }

  // Resolução de reply/citação caso a mensagem cite outra existente
  let replyToMessageId: string | null = null;
  const quotedExternalId = (rawObj.replied_to_id ?? rawObj.reply_message_id) as string | undefined;
  if (quotedExternalId) {
    const { data: quotedMsg } = await admin
      .from("messages")
      .select("id")
      .eq("organization_id", session.organization_id)
      .eq("external_id", quotedExternalId)
      .maybeSingle();
    if (quotedMsg) {
      replyToMessageId = quotedMsg.id;
    }
  }

  const mimeType = (rawObj.mime_type as string) ?? null;
  const msgType = resolveGowaMessageType({
    has_media: hasMedia,
    mime_type: mimeType,
    media_url: mediaUrl,
  } as unknown as GowaPayload);
  const now = new Date().toISOString();

  // Inserção da mensagem no CRM
  const { data: insertedMsg, error: msgErr } = await admin
    .from("messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversationId,
      channel_session_id: session.id,
      direction: "inbound",
      type: msgType,
      body: messageText,
      media_url: mediaUrl,
      external_id: rawId,
      reply_to_message_id: replyToMessageId,
      status: "delivered",
      created_at: now,
      metadata: {
        raw_event: event,
        mime_type: mimeType,
        quoted_body: (rawObj.quoted_body as string) ?? null,
      },
    })
    .select("id")
    .maybeSingle();

  if (msgErr) {
    // 23505 = idempotência de mensagem já inserida
    if (msgErr.code === "23505") {
      return { processed: true, reason: "duplicate_message_ignored" };
    }
    logger.error("[gowa.ingest] falha ao inserir mensagem", { error: msgErr.message, orgId: session.organization_id });
    return { processed: false, reason: "message_insert_failed" };
  }

  const preview = messageText.slice(0, 280) || (msgType !== "text" ? `[${msgType}]` : "");
  await markConversation(admin, conversationId, "inbound", preview, now);

  // Gatilhos de automação pós-entrada (LGPD opt-out, Leads e IA)
  await aplicarEfeitosPosEntrada(admin, {
    organizationId: session.organization_id,
    conversationId,
    contactId,
    channelSessionId: session.id,
    messageId: insertedMsg?.id ?? null,
    texto: messageText,
    nomeDoContato: notifyName,
    origem: "gowa",
    requestId,
  });

  return { processed: true };
}
