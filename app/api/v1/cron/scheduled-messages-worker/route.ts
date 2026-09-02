/**
 * GET/POST /api/v1/cron/scheduled-messages-worker
 *
 * Worker periódico (executado a cada minuto pelo scheduler) que busca mensagens agendadas
 * pendentes cujo horário de disparo já chegou (scheduled_for <= now()).
 *
 * Fluxo por mensagem:
 * 1. Carrega contato e resolve placeholders com os dados no momento exato do disparo;
 * 2. Resolve a conversa ativa (ou cria uma conversa vinculada à sessão de WhatsApp ativa);
 * 3. Envia a mensagem através do sendMessageHandler nativo do CRM;
 * 4. Atualiza o status para 'sent' (com sent_at) ou 'failed' (com error_message);
 * 5. Se o servidor esteve fora do ar, mensagens em atraso são processadas na primeira rodada sem perda de agendamento.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET | INTERNAL_SECRET.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { renderScheduledPlaceholders } from "@/lib/inbox/scheduled-placeholders";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BATCH_LIMIT = 50;

export interface ScheduledWorkerResult {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function processDueScheduledMessages(
  admin: ReturnType<typeof createAdminClient>,
  now: Date,
  requestId: string,
): Promise<ScheduledWorkerResult> {
  const nowIso = now.toISOString();

  // 1. Busca mensagens pendentes cujo horário já chegou
  const { data: dueRows, error: fetchErr } = await admin
    .from("scheduled_messages")
    .select("*, contact:contact_id(id, name, display_name, phone_number, is_anonymized, is_blocked)")
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_LIMIT);

  if (fetchErr) {
    logger.error("[scheduled-messages-worker] falha ao buscar mensagens pendentes", {
      error: fetchErr.message,
      requestId,
    });
    throw new Error(`query_failed: ${fetchErr.message}`);
  }

  const messages = dueRows ?? [];
  if (messages.length === 0) {
    return { scanned: 0, sent: 0, failed: 0, skipped: 0 };
  }

  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const msg of messages) {
    // 2. Lock atômico por linha: marca como 'processing' / garante que outra rodada não pegue
    // No Postgres, atualizamos `status = 'pending'` com `updated_at` para verificar se ainda está pendente
    const { data: locked, error: lockErr } = await admin
      .from("scheduled_messages")
      .update({ updated_at: nowIso })
      .eq("id", msg.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (lockErr || !locked) {
      // Outro worker já assumiu
      skippedCount++;
      continue;
    }

    const contact = msg.contact as {
      id: string;
      name?: string | null;
      display_name?: string | null;
      phone_number?: string | null;
      is_anonymized?: boolean;
      is_blocked?: boolean;
    } | null;

    // 3. Valida se o contato está bloqueado ou anonimizado
    if (!contact || contact.is_anonymized || contact.is_blocked) {
      await admin
        .from("scheduled_messages")
        .update({
          status: "failed",
          error_message: !contact
            ? "Contato não encontrado."
            : contact.is_anonymized
              ? "Contato foi anonimizado (LGPD)."
              : "Contato bloqueado.",
          updated_at: nowIso,
        })
        .eq("id", msg.id);

      failedCount++;
      continue;
    }

    try {
      // 4. Resolve ou cria conversa para o envio
      let conversationId = msg.conversation_id;
      if (!conversationId) {
        const { data: conv } = await admin
          .from("conversations")
          .select("id")
          .eq("contact_id", msg.contact_id)
          .eq("organization_id", msg.organization_id)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        conversationId = conv?.id ?? null;
      }

      if (!conversationId) {
        // Busca sessão ativa para criar a conversa
        const { data: session } = await admin
          .from("channel_sessions")
          .select("id")
          .eq("organization_id", msg.organization_id)
          .eq("status", "WORKING")
          .limit(1)
          .maybeSingle();

        if (!session) {
          throw new Error("Nenhuma conexão do WhatsApp ativa para envio da mensagem agendada.");
        }

        const { data: newConv, error: newConvErr } = await admin
          .from("conversations")
          .insert({
            organization_id: msg.organization_id,
            contact_id: msg.contact_id,
            channel_session_id: session.id,
            status: "open",
          })
          .select("id")
          .single();

        if (newConvErr || !newConv) {
          throw new Error(`Falha ao criar conversa para envio: ${newConvErr?.message}`);
        }
        conversationId = newConv.id;
      }

      // 5. Interpola os placeholders no momento real do envio
      const contactDisplayName = contact.name || contact.display_name || null;
      const renderedBody = renderScheduledPlaceholders(msg.raw_body, {
        nome: contactDisplayName,
        dataHoraEnvio: now,
      });

      // 6. Monta contexto do ator e despacha via sendMessageHandler
      const ctx: HandlerCtx = {
        organization_id: msg.organization_id,
        actor: msg.created_by_user_id
          ? { type: "user", id: msg.created_by_user_id, role: "agent" }
          : { type: "user", id: "system", role: "system" },
        requestId,
      };

      await sendMessageHandler(admin, ctx, {
        conversation_id: conversationId,
        type: "text",
        body: renderedBody,
      });

      // 7. Marca como enviada com sucesso
      await admin
        .from("scheduled_messages")
        .update({
          status: "sent",
          sent_at: nowIso,
          error_message: null,
          conversation_id: conversationId,
          updated_at: nowIso,
        })
        .eq("id", msg.id);

      sentCount++;

      // Auditoria
      if (msg.id) {
        await audit({
          organizationId: msg.organization_id,
          actorUserId: msg.created_by_user_id ?? null,
          action: "scheduled_message.sent",
          resourceType: "scheduled_messages",
          resourceId: msg.id,
          requestId,
          metadata: {
            contact_id: msg.contact_id,
            conversation_id: conversationId,
            scheduled_for: msg.scheduled_for,
            sent_at: nowIso,
          },
        });
      }
    } catch (sendErr) {
      const errDetail = sendErr instanceof Error ? sendErr.message : String(sendErr);
      logger.error("[scheduled-messages-worker] erro ao enviar mensagem agendada", {
        scheduled_message_id: msg.id,
        error: errDetail,
        requestId,
      });

      await admin
        .from("scheduled_messages")
        .update({
          status: "failed",
          error_message: errDetail.slice(0, 500),
          updated_at: nowIso,
        })
        .eq("id", msg.id);

      failedCount++;
    }
  }

  return { scanned: messages.length, sent: sentCount, failed: failedCount, skipped: skippedCount };
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const result = await processDueScheduledMessages(createAdminClient(), new Date(), requestId);
    return ok(result, { requestId });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error("[scheduled-messages-worker] falha geral", { error: detail, requestId });
    return fail("internal_error", "Falha na execução do worker de mensagens agendadas.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
