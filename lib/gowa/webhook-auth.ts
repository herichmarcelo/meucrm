/**
 * lib/gowa/webhook-auth.ts — Autenticação dos webhooks do GOWA (HMAC-SHA256).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

const MIN_SECRET_LEN = 16;

export type GowaWebhookAuth =
  | { ok: true; signatureVerified: boolean }
  | { ok: false; reason: "bad_signature" | "signature_required" };

export interface GowaWebhookAuthInput {
  rawBody: string;
  signatureHeader: string | null;
  /** Segredo por sessão já decifrado (null quando não há/não decifrou). */
  sessionSecret: string | null;
}

export function verifyHmacSha256(rawBody: string, signatureHeader: string, secret: string): boolean {
  try {
    let cleanSignature = signatureHeader.trim();
    if (cleanSignature.startsWith("sha256=")) {
      cleanSignature = cleanSignature.slice(7);
    }

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const sigBuf = Buffer.from(cleanSignature, "hex");
    const expBuf = Buffer.from(expected, "hex");

    if (sigBuf.length !== expBuf.length || sigBuf.length === 0) {
      return false;
    }

    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export function authenticateGowaWebhook(input: GowaWebhookAuthInput): GowaWebhookAuth {
  const { rawBody, signatureHeader, sessionSecret } = input;

  const envSecret = (env.GOWA_WEBHOOK_SECRET ?? "").trim();
  const secret =
    sessionSecret && sessionSecret.length >= MIN_SECRET_LEN
      ? sessionSecret
      : envSecret.length >= MIN_SECRET_LEN
        ? envSecret
        : null;

  const required = env.GOWA_WEBHOOK_REQUIRE_SIGNATURE === "true";

  if (signatureHeader) {
    if (!secret) return { ok: false, reason: "bad_signature" };
    return verifyHmacSha256(rawBody, signatureHeader, secret)
      ? { ok: true, signatureVerified: true }
      : { ok: false, reason: "bad_signature" };
  }

  if (required) return { ok: false, reason: "signature_required" };
  return { ok: true, signatureVerified: false };
}
