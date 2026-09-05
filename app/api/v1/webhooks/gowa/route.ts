/**
 * POST /api/v1/webhooks/gowa — global webhook receiver (no path token).
 *
 * Usado quando o GOWA tem um único WHATSAPP_WEBHOOK global configurado no container.
 * Resolve a channel_session por:
 *   1. `body.session_id` ou `body.device_id` (gowa_device_id ou waha_session_name)
 *   2. Digits do telefone do device (ex: 554588206525@s.whatsapp.net -> phone_number)
 *   3. Header `X-Device-Id`
 *   4. Fallback: sessão GOWA ativa da instalação caso haja apenas uma.
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const rawBody = await req.text();

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

  // Extrai identificador da sessão
  const deviceHeader = req.headers.get("x-device-id");
  const deviceId = roteado.device_id || roteado.session_id || deviceHeader || null;

  // Busca channel_session
  let session: {
    id: string;
    organization_id: string;
    gowa_device_id: string | null;
    phone_number: string | null;
    webhook_secret_encrypted: string | null;
    status: string;
  } | null = null;

  if (deviceId) {
    // 1. Busca exata por gowa_device_id ou waha_session_name
    const base = () =>
      admin
        .from("channel_sessions")
        .select("id, organization_id, gowa_device_id, phone_number, webhook_secret_encrypted, status")
        .or(`gowa_device_id.eq.${deviceId},waha_session_name.eq.${deviceId}`);

    const { data } = await queryTolerantToMissingArchived(
      () => base().is(ARCHIVED_AT, null).maybeSingle(),
      () => base().maybeSingle(),
    );
    session = data;

    // 2. Se o deviceId contiver número de telefone (ex: 554588206525@s.whatsapp.net)
    if (!session && deviceId.includes("@")) {
      const digits = deviceId.replace(/@.*$/, "").replace(/\D/g, "");
      if (digits.length >= 8) {
        const phoneFormatted = `+${digits}`;
        const basePhone = () =>
          admin
            .from("channel_sessions")
            .select("id, organization_id, gowa_device_id, phone_number, webhook_secret_encrypted, status")
            .eq("provider", "gowa")
            .eq("phone_number", phoneFormatted);

        const { data: phoneData } = await queryTolerantToMissingArchived(
          () => basePhone().is(ARCHIVED_AT, null).maybeSingle(),
          () => basePhone().maybeSingle(),
        );
        session = phoneData;
      }
    }
  }

  // 3. Fallback: se houver uma única sessão GOWA ativa no banco
  if (!session) {
    const baseFallback = () =>
      admin
        .from("channel_sessions")
        .select("id, organization_id, gowa_device_id, phone_number, webhook_secret_encrypted, status")
        .eq("provider", "gowa");

    const { data: gowaSessions } = await queryTolerantToMissingArchived(
      () => baseFallback().is(ARCHIVED_AT, null),
      () => baseFallback(),
    );

    if (gowaSessions && gowaSessions.length === 1 && gowaSessions[0]) {
      session = gowaSessions[0];
    }
  }

  if (!session) {
    // Sessão não encontrada — retorna 200 accepted: false para evitar retentativas infinitas
    logger.warn("[gowa.webhook] sessão não encontrada para o device", {
      device_id: deviceId,
      request_id: requestId,
    });
    return ok(
      { accepted: false, reason: "session_not_registered", device_id: deviceId },
      { requestId },
    );
  }

  // Autenticação HMAC se configurada
  const sigHeader =
    req.headers.get("x-webhook-signature") ??
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
    return fail("unauthorized", "invalid_signature", 401, { requestId });
  }

  // Arquivamento no log de webhooks
  await admin.from("webhook_events_log").insert({
    organization_id: session.organization_id,
    provider: "gowa",
    event_type: roteado.event ?? "message",
    payload: JSON.parse(rawBody),
    headers: Object.fromEntries(req.headers.entries()),
    status: "received",
  });

  // Estágio 2: Contrato do conteúdo
  const contrato = conferirContratoGowa(roteado);
  if (!contrato.ok) {
    logger.error("[gowa.webhook] payload fora do contrato do canal", {
      request_id: requestId,
      estagio: "contrato",
      campos: contrato.campos,
    });
    return fail("validation_failed", "payload fora do contrato do canal", 400, {
      requestId,
      details: { campos: contrato.campos },
    });
  }

  try {
    const result = await dispatchGowaEvent(
      admin,
      {
        id: session.id,
        organization_id: session.organization_id,
        gowa_device_id: session.gowa_device_id,
      },
      contrato.envelope,
      requestId,
    );

    return ok({ accepted: true, result }, { requestId });
  } catch (err) {
    logger.error("[gowa.webhook] handler failed", {
      request_id: requestId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return fail("internal_error", "Falha ao processar evento.", 500, { requestId });
  }
}
