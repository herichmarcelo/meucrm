/**
 * GET, POST /api/v1/webhooks/instagram — Webhook dedicado para a Instagram Graph API da Meta.
 *
 * GET: Handshake de verificação hub.challenge (em texto puro, como a Meta exige).
 * POST: Validação de assinatura X-Hub-Signature-256 e ingestão de mensagens diretas no Inbox.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { ingestInstagramMessage } from "@/lib/channels/instagram/ingest";
import {
  parseInstagramWebhook,
  verificationChallenge,
  verifyInstagramSignature,
} from "@/lib/channels/instagram/webhook";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expectedToken =
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ||
    "instagram_verify_token";

  const challenge = verificationChallenge(req.nextUrl.searchParams, expectedToken);

  if (challenge === null) {
    return new NextResponse("forbidden", { status: 403 });
  }

  // Texto puro, sem JSON wrapper — como a Meta exige
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const rawBody = await req.text();

  const appSecret = process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || "";
  if (appSecret) {
    const signature = req.headers.get("x-hub-signature-256");
    if (!verifyInstagramSignature(rawBody, signature, appSecret)) {
      return fail("unauthorized", "invalid_signature", 401, { requestId });
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }

  const messages = parseInstagramWebhook(payload);
  if (messages.length === 0) {
    return ok({ status: "ignored", reason: "no_messages" }, { requestId });
  }

  const admin = createAdminClient();
  const results = [];

  for (const message of messages) {
    // Localiza a sessão do canal correspondente ao recipientId (ID da conta profissional do Instagram)
    const { data: session } = await admin
      .from("channel_sessions")
      .select("id, organization_id, provider, status, archived_at")
      .eq("provider", "instagram")
      .eq("instagram_account_id", message.recipientId)
      .is("archived_at", null)
      .maybeSingle();

    if (!session) {
      logger.warn("[instagram.webhook] sessão não encontrada para o recipientId", {
        recipientId: message.recipientId,
        requestId,
      });
      continue;
    }

    const r = await ingestInstagramMessage(admin, {
      organizationId: session.organization_id,
      channelSessionId: session.id,
      message,
      requestId,
    });
    results.push(r);
  }

  return ok({ status: "processed", count: results.length, results }, { requestId });
}
