import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/webhooks/gowa/route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((_table: string) => ({
      select: vi.fn(() => ({
        or: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: "sess-123",
                organization_id: "org-123",
                gowa_device_id: "dev-123",
                phone_number: "+5511999999999",
                webhook_secret_encrypted: null,
                status: "WORKING",
              },
              error: null,
            })),
          })),
        })),
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: "sess-123",
                organization_id: "org-123",
                gowa_device_id: "dev-123",
                phone_number: "+5511999999999",
                webhook_secret_encrypted: null,
                status: "WORKING",
              },
              error: null,
            })),
          })),
        })),
      })),
      insert: vi.fn(async () => ({ data: null, error: null })),
    })),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  })),
}));

vi.mock("@/lib/gowa/ingest", () => ({
  dispatchGowaEvent: vi.fn(async () => ({ processed: true })),
}));

describe("POST /api/v1/webhooks/gowa", () => {
  it("aceita webhook global e despacha para a sessão correspondente", async () => {
    const payload = {
      event: "message",
      device_id: "dev-123",
      payload: {
        id: "msg-001",
        from: "5511988887777@s.whatsapp.net",
        body: "Olá, suporte!",
      },
    };

    const req = new NextRequest("http://localhost:3000/api/v1/webhooks/gowa", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.accepted).toBe(true);
  });

  it("retorna 400 para JSON inválido", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/webhooks/gowa", {
      method: "POST",
      body: "{ bad json",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("aceita webhook assinado com header X-Webhook-Signature oficial do GOWA", async () => {
    const secret = "a3fb8a95-da13-4577-8f9d-3f84854eac89";
    vi.stubEnv("GOWA_WEBHOOK_SECRET", secret);

    const payload = {
      event: "message.ack",
      device_id: "dev-123",
      payload: {
        id: "msg-ack-100",
        status: "DELIVERED",
      },
    };
    const bodyStr = JSON.stringify(payload);
    const crypto = await import("node:crypto");
    const signature = crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");

    const req = new NextRequest("http://localhost:3000/api/v1/webhooks/gowa", {
      method: "POST",
      body: bodyStr,
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.accepted).toBe(true);
  });

  it("rejeita com 401 quando header X-Webhook-Signature do GOWA é adulterado", async () => {
    const secret = "a3fb8a95-da13-4577-8f9d-3f84854eac89";
    vi.stubEnv("GOWA_WEBHOOK_SECRET", secret);

    const payload = {
      event: "message.ack",
      device_id: "dev-123",
      payload: {
        id: "msg-ack-101",
        status: "READ",
      },
    };
    const bodyStr = JSON.stringify(payload);

    const req = new NextRequest("http://localhost:3000/api/v1/webhooks/gowa", {
      method: "POST",
      body: bodyStr,
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": "deadbeef00000000000000000000000000000000000000000000000000000000",
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("unauthorized");
  });
});

