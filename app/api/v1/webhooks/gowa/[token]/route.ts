/**
 * POST /api/v1/webhooks/gowa/[token]
 *
 * Rota per-tenant dedicada para webhooks do GOWA.
 * Pipeline: lookup por token -> verifica HMAC SHA-256 -> arquiva em webhook_events_log -> dispatchGowaEvent.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { conferirContratoGowa, lerRoteamentoGowa } from "@/lib/gowa/envelope";
import { dispatchGowaEvent } from "@/lib/gowa/ingest";
import { authenticateGowaWebhook } from "@/lib/gowa/webhook-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;

  if (!token || token.length < 8) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  const rawBody = await req.text();

  // Estágio 1: Esquema mínimo para identificação da sessão e roteamento
  const roteamento = lerRoteamentoGowa(rawBody);
  if (!roteamento.ok) {
    if (roteamento.motivo === "json_invalido") {
      return fail("invalid_request", "invalid_json", 400, { requestId });
    }
    logger.error("[gowa.webhook] payload fora do contrato do canal", {
      request_id: requestId,
      estagio: "roteamento",
      campos: roteamento.campos,
    });
    return fail("validation_failed", "payload fora do contrato do canal", 400, {
      requestId,
      details: { campos: roteamento.campos },
    });
  }

  const roteado = roteamento.envelope;
  const admin = createAdminClient();

  const base = () =>
    admin
      .from("channel_sessions")
      .select("id, organization_id, gowa_device_id, webhook_secret_encrypted, status")
      .eq("webhook_path_token", token);

  const { data: session, error: sessErr } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );

  if (sessErr) {
    return fail("internal_error", sessErr.message, 500, { requestId });
  }
  if (!session) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  // Autenticação fail-closed HMAC-SHA256
  const sigHeader =
    req.headers.get("x-hub-signature-256") ??
    req.headers.get("x-hub-signature") ??
    req.headers.get("x-signature-256");

  let sessionSecret: string | null = null;
  try {
    const dec = await admin.rpc("fn_decrypt_oauth", {
      ciphertext: session.webhook_secret_encrypted,
    });
    if (!dec.error && typeof dec.data === "string") sessionSecret = dec.data;
  } catch {
    sessionSecret = null;
  }

  const auth = authenticateGowaWebhook({ rawBody, signatureHeader: sigHeader, sessionSecret });
  if (!auth.ok) {
    await audit({
      action: "webhook.hmac_invalid",
      organizationId: session.organization_id,
      metadata: {
        provider: "gowa",
        session: session.gowa_device_id,
        event: roteado.event,
        reason: auth.reason,
        had_signature: Boolean(sigHeader),
      },
    });
    return fail("unauthenticated", auth.reason, 401, { requestId });
  }
  const validSignature = auth.signatureVerified;

  const eventType = roteado.event ?? "unknown";
  const externalId = roteado.payload?.id ?? null;

  const headersJson: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith("authorization")) return;
    if (key.toLowerCase() === "cookie") return;
    headersJson[key] = value;
  });

  await admin.from("webhook_events_log").insert({
    organization_id: session.organization_id,
    channel_session_id: session.id,
    provider: "gowa",
    webhook_path_token: token,
    http_method: "POST",
    headers: headersJson,
    raw_body: rawBody,
    payload_parsed: roteado as unknown as Record<string, unknown>,
    signature_header: sigHeader ?? null,
    valid_signature: validSignature,
    event_type: eventType,
    external_id: externalId,
    status: "received",
    attempts: 0,
  });

  // Estágio 2: Validação do contrato completo
  const contrato = conferirContratoGowa(roteado);
  if (!contrato.ok) {
    logger.error("[gowa.webhook] payload fora do contrato do canal", {
      request_id: requestId,
      estagio: "conteudo",
      campos: contrato.campos,
    });
    return fail("validation_failed", "payload fora do contrato do canal", 400, {
      requestId,
      details: { campos: contrato.campos },
    });
  }

  try {
    await dispatchGowaEvent(admin, session, contrato.envelope, requestId);
  } catch (err) {
    logger.error("[gowa.webhook] handler failed", {
      request_id: requestId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }

  return ok({ accepted: true }, { requestId });
}
