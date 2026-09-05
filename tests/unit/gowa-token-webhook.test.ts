import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/webhooks/gowa/[token]/route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((_table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: "sess-token-123",
                organization_id: "org-token-123",
                gowa_device_id: "dev-token-123",
                webhook_secret_encrypted: "encrypted_secret_val",
                status: "WORKING",
              },
              error: null,
            })),
          })),
        })),
      })),
      insert: vi.fn(async () => ({ data: null, error: null })),
    })),
    rpc: vi.fn(async (fnName: string, _args: { ciphertext: string }) => {
      if (fnName === "fn_decrypt_oauth") {
        return { data: "token_secret_1234567890", error: null };
      }
      return { data: null, error: null };
    }),
  })),
}));

vi.mock("@/lib/gowa/ingest", () => ({
  dispatchGowaEvent: vi.fn(async () => ({ processed: true })),
}));

describe("POST /api/v1/webhooks/gowa/[token]", () => {
  const secret = "token_secret_1234567890";
  const token = "valid_gowa_session_token_123";

  it("aceita webhook assinado com header X-Webhook-Signature", async () => {
    const payload = {
      event: "message.ack",
      device_id: "dev-token-123",
      payload: {
        id: "msg-ack-200",
        status: "DELIVERED",
      },
    };
    const bodyStr = JSON.stringify(payload);
    const signature = createHmac("sha256", secret).update(bodyStr).digest("hex");

    const req = new NextRequest(`http://localhost:3000/api/v1/webhooks/gowa/${token}`, {
      method: "POST",
      body: bodyStr,
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
      },
    });

    const res = await POST(req, { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.accepted).toBe(true);
  });

  it("rejeita com 401 quando X-Webhook-Signature possui assinatura inválida", async () => {
    const payload = {
      event: "message.ack",
      device_id: "dev-token-123",
      payload: {
        id: "msg-ack-201",
        status: "DELIVERED",
      },
    };
    const bodyStr = JSON.stringify(payload);

    const req = new NextRequest(`http://localhost:3000/api/v1/webhooks/gowa/${token}`, {
      method: "POST",
      body: bodyStr,
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": "adulterated_signature_0000000000000000000000000000000000000000",
      },
    });

    const res = await POST(req, { params: Promise.resolve({ token }) });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("unauthenticated");
  });
});
