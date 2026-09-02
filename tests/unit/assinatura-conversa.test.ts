import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";
import { profileSchema } from "@/lib/schemas/settings";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const WAHA_BASE = "http://localhost:3030";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: "https://signed.example/a.jpg" },
          error: null,
        }),
      }),
    },
  }),
}));

type Row = Record<string, unknown>;

function fakeSupabase(state: { message?: Row } = {}): SupabaseClient {
  const conversation = {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: false,
    group_chat_id: null,
    bot_silenced_until: null,
    provider_conversation_id: null,
    contacts: {
      phone_number: "+5511999999999",
      wa_identity: null,
      wa_lid: null,
      is_blocked: false,
    },
    channel_sessions: {
      id: SESSION,
      organization_id: ORG,
      session_name: "default",
      status: "WORKING",
      provider: "waha",
    },
  };

  const client = {
    from: (table: string) => {
      if (table === "conversations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: conversation, error: null }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === "messages") {
        return {
          insert: (row: Row) => {
            state.message = {
              id: "msg-1",
              external_id: null,
              ack: null,
              error_code: null,
              error_message: null,
              ...row,
            };
            return {
              select: () => ({
                single: async () => ({ data: { ...state.message }, error: null }),
              }),
            };
          },
          update: (patch: Row) => {
            state.message = { ...state.message, ...patch };
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { ...state.message }, error: null }),
                }),
              }),
            };
          },
          delete: () => {
            const chain: Record<string, unknown> = {
              eq: () => chain,
              in: () => chain,
              neq: () => chain,
              then: (resolve: (v: { error: null }) => unknown) =>
                Promise.resolve({ error: null }).then(resolve),
            };
            return chain;
          },
        };
      }
      if (table === "contacts") {
        const cadeiaContacts: Record<string, unknown> = {
          eq: () => cadeiaContacts,
          then: (resolve: (v: { error: null }) => unknown) =>
            Promise.resolve({ error: null }).then(resolve),
        };
        return { update: () => cadeiaContacts };
      }
      throw new Error(`fake_supabase: tabela inesperada '${table}'`);
    },
    rpc: async () => ({ error: null }),
  };

  return client as unknown as SupabaseClient;
}

function wahaConfigured() {
  vi.stubEnv("WAHA_API_BASE_URL", WAHA_BASE);
  vi.stubEnv("WAHA_API_KEY", "hash123");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("profileSchema - validação de signature (Assinatura na conversa)", () => {
  it("aceita assinatura válida de texto simples", () => {
    const res = profileSchema.safeParse({
      full_name: "Herich Marcelo",
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
      time_format: "24h",
      signature: "Herich M.",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.signature).toBe("Herich M.");
    }
  });

  it("converte string vazia ou apenas espaços em null", () => {
    const res = profileSchema.safeParse({
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
      time_format: "24h",
      signature: "   ",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.signature).toBeNull();
    }
  });

  it("aceita null ou omitido", () => {
    const resNull = profileSchema.safeParse({
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
      time_format: "24h",
      signature: null,
    });
    expect(resNull.success).toBe(true);
    if (resNull.success) {
      expect(resNull.data.signature).toBeNull();
    }

    const resOmitted = profileSchema.safeParse({
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
      time_format: "24h",
    });
    expect(resOmitted.success).toBe(true);
    if (resOmitted.success) {
      expect(resOmitted.data.signature).toBeUndefined();
    }
  });

  it("rejeita assinatura com mais de 100 caracteres", () => {
    const longSig = "A".repeat(101);
    const res = profileSchema.safeParse({
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
      time_format: "24h",
      signature: longSig,
    });
    expect(res.success).toBe(false);
  });
});

describe("sendMessageHandler - injeção de assinatura na conversa", () => {
  it("atendente humano com assinatura configurada: prefixa *{assinatura}:*\\n no corpo salvo e enviado", async () => {
    wahaConfigured();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body.text).toBe("*Herich M.:*\nOlá! Como posso ajudar?");
      return new Response(JSON.stringify({ id: "waha-msg-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const state: { message?: Row } = {};
    const supabase = fakeSupabase(state);
    const ctx: HandlerCtx = {
      organization_id: ORG,
      actor: { type: "user", id: USER, signature: "Herich M." },
      requestId: "req-1",
    };
    const input: SendMessageInput = {
      conversation_id: CONV,
      type: "text",
      body: "Olá! Como posso ajudar?",
    };

    const res = await sendMessageHandler(supabase, ctx, input);

    expect(res.body).toBe("*Herich M.:*\nOlá! Como posso ajudar?");
    expect(state.message?.body).toBe("*Herich M.:*\nOlá! Como posso ajudar?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("atendente humano sem assinatura (null): envia o texto original sem alteração", async () => {
    wahaConfigured();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body.text).toBe("Olá! Sem assinatura.");
      return new Response(JSON.stringify({ id: "waha-msg-456" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const state: { message?: Row } = {};
    const supabase = fakeSupabase(state);
    const ctx: HandlerCtx = {
      organization_id: ORG,
      actor: { type: "user", id: USER, signature: null },
      requestId: "req-2",
    };
    const input: SendMessageInput = {
      conversation_id: CONV,
      type: "text",
      body: "Olá! Sem assinatura.",
    };

    const res = await sendMessageHandler(supabase, ctx, input);

    expect(res.body).toBe("Olá! Sem assinatura.");
    expect(state.message?.body).toBe("Olá! Sem assinatura.");
  });

  it("agente de IA (ai_agent): nunca adiciona assinatura", async () => {
    wahaConfigured();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      expect(body.text).toBe("Mensagem enviada pelo robô.");
      return new Response(JSON.stringify({ id: "waha-msg-789" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const state: { message?: Row } = {};
    const supabase = fakeSupabase(state);
    const ctx: HandlerCtx = {
      organization_id: ORG,
      actor: { type: "ai_agent", id: "ai-1", role: "agent" },
      requestId: "req-3",
    };
    const input: SendMessageInput = {
      conversation_id: CONV,
      type: "text",
      body: "Mensagem enviada pelo robô.",
    };

    const res = await sendMessageHandler(supabase, ctx, input);

    expect(res.body).toBe("Mensagem enviada pelo robô.");
    expect(state.message?.body).toBe("Mensagem enviada pelo robô.");
  });
});
