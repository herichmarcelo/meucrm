import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/webhooks/gowa/route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => ({
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
});
