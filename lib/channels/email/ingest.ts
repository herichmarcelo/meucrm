/**
 * Ingestão de mensagens de E-mail de entrada: webhook → contato, conversa, mensagem.
 *
 * Segue a mesma disciplina canônica dos canais existentes:
 * 1. Resolução de Thread por `In-Reply-To` / `References` / `provider_conversation_id`.
 * 2. Resolução determinística de contato por `email` em `contacts`.
 * 3. Abertura/reabertura da conversa 1:1.
 * 4. Idempotência estrita por `(organization_id, external_id)` via captura de `23505`.
 * 5. Disparo da esteira pós-entrada (`aplicarEfeitosPosEntrada`: opt-out, lead, agente de IA).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { aplicarEfeitosPosEntrada } from "../pos-entrada";
import { parseEmailInbound, type EmailInboundMessage } from "./webhook";

export interface EmailIngestInput {
  organizationId: string;
  channelSessionId: string;
  payload: unknown;
  requestId?: string;
}

export interface EmailIngestResult {
  status: "ingested" | "duplicate" | "ignored" | "failed";
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

const OPEN_STATUSES = ["open", "pending", "claimed", "ai_handling"];

/**
 * Tenta localizar uma conversa existente correlacionada pelos cabeçalhos de threading.
 */
async function resolveConversationByThreading(
  admin: SupabaseClient,
  orgId: string,
  msg: EmailInboundMessage,
): Promise<{ conversationId: string; contactId: string } | null> {
  const candidates: string[] = [];
  if (msg.inReplyTo) candidates.push(msg.inReplyTo);
  if (msg.references) {
    const refs = msg.references.split(/\s+/).map((r) => r.trim()).filter(Boolean);
    candidates.push(...refs);
  }

  if (candidates.length === 0) return null;

  // 1. Busca por external_id na tabela messages
  const { data: matchedMessage } = await admin
    .from("messages")
    .select("conversation_id, contact_id")
    .eq("organization_id", orgId)
    .in("external_id", candidates)
    .limit(1)
    .maybeSingle();

  if (matchedMessage?.conversation_id && matchedMessage?.contact_id) {
    return {
      conversationId: matchedMessage.conversation_id,
      contactId: matchedMessage.contact_id,
    };
  }

  // 2. Busca por provider_conversation_id na tabela conversations
  const { data: matchedConv } = await admin
    .from("conversations")
    .select("id, contact_id")
    .eq("organization_id", orgId)
    .in("provider_conversation_id", candidates)
    .limit(1)
    .maybeSingle();

  if (matchedConv?.id && matchedConv?.contact_id) {
    return {
      conversationId: matchedConv.id,
      contactId: matchedConv.contact_id,
    };
  }

  return null;
}

/**
 * Resolve ou cria o contato a partir do endereço de e-mail do remetente.
 */
async function resolveContact(
  admin: SupabaseClient,
  orgId: string,
  fromEmail: string,
  fromName: string | null,
): Promise<string> {
  // 1. Busca contato existente por email (case-insensitive)
  const { data: existing } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .ilike("email", fromEmail)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return existing.id;
  }

  // 2. Cria novo contato para o e-mail
  const displayName = fromName || fromEmail.split("@")[0];
  const { data: created, error } = await admin
    .from("contacts")
    .insert({
      organization_id: orgId,
      email: fromEmail,
      name: displayName,
      wa_identity: `email:${fromEmail}`,
    })
    .select("id")
    .single();

  if (error || !created) {
    // Corrida: outro processo criou o contato simultaneamente
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: winner } = await admin
        .from("contacts")
        .select("id")
        .eq("organization_id", orgId)
        .ilike("email", fromEmail)
        .limit(1)
        .maybeSingle();
      if (winner?.id) return winner.id;
    }
    throw new Error(`contact_creation_failed: ${error?.message ?? "unknown"}`);
  }

  return created.id;
}

/**
 * Resolve ou reabre a conversa 1:1 associada ao contato e sessão de e-mail.
 */
async function resolveConversation(
  admin: SupabaseClient,
  orgId: string,
  contactId: string,
  channelSessionId: string,
  initialSubject?: string,
  threadId?: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("conversations")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .eq("channel_session_id", channelSessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; status: string };
    if (!OPEN_STATUSES.includes(row.status)) {
      await admin
        .from("conversations")
        .update({ status: "open", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("organization_id", orgId);
    }
    return row.id;
  }

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      organization_id: orgId,
      contact_id: contactId,
      channel_session_id: channelSessionId,
      channel: "email",
      status: "open",
      provider_conversation_id: threadId || null,
      metadata: {
        ...(initialSubject ? { subject: initialSubject } : {}),
        created_by: "email_inbound",
      },
    })
    .select("id")
    .single();

  if (error || !created) {
    if ((error as { code?: string } | null)?.code === "23505") {
      const { data: winner } = await admin
        .from("conversations")
        .select("id")
        .eq("organization_id", orgId)
        .eq("contact_id", contactId)
        .eq("channel_session_id", channelSessionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (winner?.id) return winner.id;
    }
    throw new Error(`conversation_creation_failed: ${error?.message ?? "unknown"}`);
  }

  return created.id;
}

/**
 * Ingestão completa de e-mail de entrada.
 */
export async function ingestEmailInbound(
  admin: SupabaseClient,
  input: EmailIngestInput,
): Promise<EmailIngestResult> {
  const msg = parseEmailInbound(input.payload);
  if (!msg) {
    return { status: "ignored", reason: "evento_sem_interesse" };
  }

  try {
    // 1. Threading: tenta resolver conversa existente por In-Reply-To / References
    const threadMatch = await resolveConversationByThreading(admin, input.organizationId, msg);

    let contactId: string;
    let conversationId: string;

    if (threadMatch) {
      contactId = threadMatch.contactId;
      conversationId = threadMatch.conversationId;
    } else {
      contactId = await resolveContact(admin, input.organizationId, msg.fromEmail, msg.fromName);
      conversationId = await resolveConversation(
        admin,
        input.organizationId,
        contactId,
        input.channelSessionId,
        msg.subject,
        msg.messageId,
      );
    }

    // 2. Inserção da mensagem no banco com deduplicação atômica
    const messageBody = msg.bodyText || msg.subject || "[E-mail sem conteúdo de texto]";
    const { data: insertedMsg, error: insertError } = await admin
      .from("messages")
      .insert({
        organization_id: input.organizationId,
        conversation_id: conversationId,
        contact_id: contactId,
        channel_session_id: input.channelSessionId,
        direction: "inbound",
        sender_kind: "contact",
        status: "delivered",
        type: "text",
        body: messageBody,
        external_id: msg.messageId,
        sent_at: msg.receivedAt,
        metadata: {
          subject: msg.subject,
          from: msg.fromEmail,
          from_name: msg.fromName,
          to: msg.toEmail,
          in_reply_to: msg.inReplyTo,
          references: msg.references,
          headers: msg.headers,
          attachments: msg.attachments,
        },
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      // 23505 = external_id duplicado (reentrega do provedor)
      if (insertError.code === "23505") {
        return { status: "duplicate", conversationId };
      }
      logger.error("email-ingest: falha ao inserir mensagem", {
        organization_id: input.organizationId,
        error: insertError.message,
      });
      return { status: "failed", reason: `mensagem: ${insertError.message}` };
    }

    const messageId = insertedMsg?.id;

    // 3. Atualiza sumário da conversa (última mensagem e timestamp)
    const preview = (msg.subject ? `[${msg.subject}] ` : "") + messageBody.slice(0, 100);
    await admin
      .from("conversations")
      .update({
        last_inbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("organization_id", input.organizationId);

    // 4. Dispara a esteira unificada de pós-entrada (Opt-out, Lead, IA)
    const textoEntrada = (msg.subject ? `${msg.subject}\n\n` : "") + messageBody;
    await aplicarEfeitosPosEntrada(admin, {
      organizationId: input.organizationId,
      contactId,
      conversationId,
      messageId: messageId ?? null,
      channelSessionId: input.channelSessionId,
      texto: textoEntrada,
      nomeDoContato: msg.fromName || msg.fromEmail,
      origem: "email",
      requestId: input.requestId,
    });

    return {
      status: "ingested",
      conversationId,
      messageId,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("email-ingest: erro inesperado na ingestão", {
      organization_id: input.organizationId,
      error: errorMsg,
    });
    return { status: "failed", reason: errorMsg };
  }
}
