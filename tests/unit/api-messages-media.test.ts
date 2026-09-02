import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/messages/[id]/media/route";

const MSG_ID = "msg-1111-2222";
const ORG_ID = "org-3333-4444";
const CONV_ID = "conv-5555-6666";

let mockMessageData: Record<string, unknown> | null = null;
let uploadCalls: Array<{ path: string; buffer: Buffer; contentType: string }> = [];
let updateCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(async () => ({ id: "user-123", email: "user@test.com" })),
  resolveActiveOrg: vi.fn(async () => ({ orgId: ORG_ID })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-123" } },
        error: null,
      })),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: mockMessageData,
              error: null,
            }),
          }),
        }),
      }),
    }),
  })),
}));

vi.mock("@/lib/channels", () => ({
  CHANNEL_SESSION_REF_COLUMNS: "id, provider, waha_session_name",
  DEFAULT_CHANNEL_PROVIDER: "waha",
  resolveSessionRef: vi.fn(() => "session-ref-default"),
  getAdapter: vi.fn(() => ({
    fetchInboundMedia: vi.fn(async () => ({
      buffer: Buffer.from("fake-image-binary-bytes"),
      mime: "image/jpeg",
    })),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/signed/${path}?token=valid` },
          error: null,
        }),
        upload: async (path: string, buffer: Buffer, opts: { contentType: string }) => {
          uploadCalls.push({ path, buffer, contentType: opts.contentType });
          return { error: null };
        },
      }),
    },
    from: (table: string) => {
      if (table === "channel_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { provider: "waha", waha_session_name: "sess-1" },
                }),
              }),
            }),
          }),
        };
      }
      return {
        update: (payload: Record<string, unknown>) => {
          updateCalls.push(payload);
          return {
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        },
      };
    },
  }),
}));

beforeEach(() => {
  uploadCalls = [];
  updateCalls = [];
  mockMessageData = {
    id: MSG_ID,
    conversation_id: CONV_ID,
    media_url: "http://waha:3000/api/files/inbound-123.jpg",
    media_mime: "image/jpeg",
    media_storage_path: null,
    channel_session_id: "sess-1",
    metadata: null,
  };
});

describe("GET /api/v1/messages/[id]/media", () => {
  it("redireciona para URL assinada quando a mídia já está persistida no bucket", async () => {
    mockMessageData = {
      id: MSG_ID,
      conversation_id: CONV_ID,
      media_url: null,
      media_mime: "image/jpeg",
      media_storage_path: `${ORG_ID}/${CONV_ID}/${MSG_ID}.jpg`,
      channel_session_id: "sess-1",
      metadata: { media_status: "stored" },
    };

    const req = new Request(`http://localhost/api/v1/messages/${MSG_ID}/media`);
    const res = await GET(req as never, { params: Promise.resolve({ id: MSG_ID }) });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("https://storage.test/signed/");
    expect(uploadCalls.length).toBe(0);
  });

  it("baixa server-side, persiste no bucket whatsapp-media e transmite bytes quando media_storage_path é null", async () => {
    const req = new Request(`http://localhost/api/v1/messages/${MSG_ID}/media`);
    const res = await GET(req as never, { params: Promise.resolve({ id: MSG_ID }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");

    // Verifica que fez upload para o bucket whatsapp-media
    expect(uploadCalls.length).toBe(1);
    expect(uploadCalls[0]?.path).toBe(`${ORG_ID}/${CONV_ID}/${MSG_ID}.jpg`);
    expect(uploadCalls[0]?.contentType).toBe("image/jpeg");

    // Verifica que atualizou a tabela messages com o media_storage_path
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]?.media_storage_path).toBe(`${ORG_ID}/${CONV_ID}/${MSG_ID}.jpg`);
    expect(updateCalls[0]?.media_size_bytes).toBe(Buffer.from("fake-image-binary-bytes").byteLength);
  });

  it("retorna 404 quando a mensagem não existe ou não tem mídia", async () => {
    mockMessageData = null;

    const req = new Request(`http://localhost/api/v1/messages/${MSG_ID}/media`);
    const res = await GET(req as never, { params: Promise.resolve({ id: MSG_ID }) });

    expect(res.status).toBe(404);
  });
});
