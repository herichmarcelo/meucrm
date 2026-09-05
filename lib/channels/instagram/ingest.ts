/**
 * Ingestão de mensagens de Instagram Direct (Meta Graph API) de entrada:
 * webhook → contato, conversa, mensagem na Caixa de Entrada (Inbox).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { aplicarEfeitosPosEntrada } from "../pos-entrada";
import type { InstagramInboundMessage } from "./webhook";

export interface InstagramIngestInput {
  organizationId: string;
  channelSessionId: string;
  message: InstagramInboundMessage;
  requestId?: string;
}

export interface InstagramIngestResult {
  status: "ingested" | "duplicate" | "ignored" | "failed";
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

const OPEN_STATUSES = ["open", "pending", "claimed", "ai_handling"];

/**
 * Resolve ou cria o contato a partir do ID do usuário do Instagram (IGSID).
 */
async function resolveContact(
  admin: SupabaseClient,
  orgId: string,
  senderId: string,
): Promise<string> {
  // 1. Busca contato existente por instagram_id ou wa_identity
  const { data: existing } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .or(`instagram_id.eq.${senderId},wa_identity.eq.instagram:${senderId}`)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return existing.id;
  }

  // 2. Cria novo contato para o usuário do Instagram
  const shortId = senderId.length > 4 ? senderId.slice(-4) : senderId;
  const displayName = `Instagram @${shortId}`;

  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      organization_id: orgId,
      instagram_id: senderId,
      name: displayName,
      wa_identity: `instagram:${senderId}`,
    })
    .select("id")
    .single();

  if (error || !created) {
    // Corrida: outro webhook paralelo já criou o contato
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: winner } = await admin
        .from("contacts")
        .select("id")
        .eq("organization_id", orgId)
        .or(`instagram_id.eq.${senderId},wa_identity.eq.instagram:${senderId}`)
        .limit(1)
        .maybeSingle();
      if (winner?.id) return winner.id;
    }
    throw new Error(`contact_creation_failed: ${error?.message ?? "unknown"}`);
  }

  return created.id;
}

/**
 * Resolve ou reabre a conversa 1:1 associada ao contato e canal de Instagram.
 */
async function resolveConversation(
  admin: SupabaseClient,
  orgId: string,
  contactId: string,
  channelSessionId: string,
): Promise<string> {
  const { data: activeConv } = await admin
    .from("conversations")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .eq("channel_session_id", channelSessionId)
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeConv?.id) {
    return activeConv.id;
  }

  const { data: lastConv } = await admin
    .from("conversations")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .eq("channel_session_id", channelSessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastConv?.id) {
    await admin
      .from("conversations")
      .update({
        status: "open",
        updated_at: new Date().toISOString(),
      })
      .eq("id", lastConv.id);
    return lastConv.id;
  }

  const { data: newConv, error } = await admin
    .from("conversations")
    .insert({
      organization_id: orgId,
      contact_id: contactId,
      channel_session_id: channelSessionId,
      status: "open",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !newConv) {
    throw new Error(`conversation_creation_failed: ${error?.message ?? "unknown"}`);
  }

  return newConv.id;
}

/**
 * Ingestão de mensagem do Instagram Direct.
 */
export async function ingestInstagramMessage(
  admin: SupabaseClient,
  input: InstagramIngestInput,
): Promise<InstagramIngestResult> {
  const { organizationId, channelSessionId, message, requestId } = input;

  if (message.isEcho) {
    return { status: "ignored", reason: "is_echo" };
  }

  const contactId = await resolveContact(admin, organizationId, message.senderId);
  const conversationId = await resolveConversation(
    admin,
    organizationId,
    contactId,
    channelSessionId,
  );

  let body = message.text;
  if (!body && message.attachments.length > 0) {
    const firstType = message.attachments[0]?.type ?? "anexo";
    body = `[${firstType.toUpperCase()}]`;
  }
  if (message.isStoryReply) {
    body = `[Story Reply]: ${body}`;
  }

  const now = new Date(message.timestamp || Date.now()).toISOString();

  // Deduplicação estrita de external_id no banco
  const { data: insertedMsg, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      contact_id: contactId,
      channel_session_id: channelSessionId,
      sender_type: "contact",
      direction: "inbound",
      body: body || "(sem texto)",
      external_id: message.messageId,
      created_at: now,
      metadata: {
        attachments: message.attachments,
        is_story_reply: message.isStoryReply,
        story_url: message.storyUrl,
        reply_to_message_id: message.replyToMessageId,
      },
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    if ((insertErr as { code?: string }).code === "23505") {
      return {
        status: "duplicate",
        conversationId,
        reason: "message_already_ingested",
      };
    }
    logger.error("[instagram.ingest] falha ao inserir mensagem", {
      error: insertErr.message,
      requestId,
    });
    return { status: "failed", conversationId, reason: insertErr.message };
  }

  // Atualiza conversa
  await admin
    .from("conversations")
    .update({
      last_message_at: now,
      last_message_preview: (body || "").slice(0, 120),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  // Efeitos pós-entrada (IA, SLA, gatilhos)
  await aplicarEfeitosPosEntrada(admin, {
    organizationId,
    conversationId,
    contactId,
    messageId: insertedMsg?.id ?? message.messageId,
    channelSessionId,
    texto: body || "",
    nomeDoContato: null,
    origem: "instagram",
    requestId,
  }).catch((err) => {
    logger.warn("[instagram.ingest] erro não-fatal em efeitos pós-entrada", {
      error: err instanceof Error ? err.message : "desconhecido",
      requestId,
    });
  });

  return {
    status: "ingested",
    conversationId,
    messageId: insertedMsg?.id,
  };
}

