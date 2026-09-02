import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authenticateGowaWebhook, verifyHmacSha256 } from "@/lib/gowa/webhook-auth";

describe("verifyHmacSha256", () => {
  const secret = "super_secret_webhook_key_123";
  const body = JSON.stringify({ event: "message", payload: { id: "123" } });

  it("retorna true para assinatura sha256=<hex> válida", () => {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const ok = verifyHmacSha256(body, `sha256=${signature}`, secret);
    expect(ok).toBe(true);
  });

  it("retorna true para assinatura em hex direto", () => {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const ok = verifyHmacSha256(body, signature, secret);
    expect(ok).toBe(true);
  });

  it("retorna false para assinatura incorreta ou adulterada", () => {
    const ok = verifyHmacSha256(body, "sha256=badsignature00000000000000000000000000000000000000000000000000", secret);
    expect(ok).toBe(false);
  });
});

describe("authenticateGowaWebhook", () => {
  const secret = "super_secret_webhook_key_123";
  const body = JSON.stringify({ event: "message", payload: { id: "123" } });

  it("aprova requisição com assinatura válida informada via sessionSecret", () => {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const res = authenticateGowaWebhook({
      rawBody: body,
      signatureHeader: `sha256=${signature}`,
      sessionSecret: secret,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.signatureVerified).toBe(true);
    }
  });

  it("rejeita assinatura adulterada", () => {
    const res = authenticateGowaWebhook({
      rawBody: body,
      signatureHeader: "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      sessionSecret: secret,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("bad_signature");
    }
  });
});
