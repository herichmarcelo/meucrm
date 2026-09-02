import { beforeEach, describe, expect, it, vi } from "vitest";
import { processDueScheduledMessages } from "@/app/api/v1/cron/scheduled-messages-worker/route";
import type { createAdminClient } from "@/lib/supabase/admin";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "33333333-3333-4333-8333-333333333333";
const MSG_ID = "44444444-4444-4444-8444-444444444444";

const sentMessagesList: { conversation_id: string; body: string }[] = [];
const updatedScheduled: { id: string; patch: Record<string, unknown> }[] = [];

vi.mock("@/app/api/v1/messages/_handler", () => ({
  sendMessageHandler: async (_sb: unknown, _ctx: unknown, input: { conversation_id: string; body: string }) => {
    sentMessagesList.push(input);
    return { id: "sent-msg-1", conversation_id: input.conversation_id, body: input.body };
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: async () => {},
}));

describe("scheduled-messages-worker — Processamento de Mensagens Agendadas", () => {
  beforeEach(() => {
    sentMessagesList.length = 0;
    updatedScheduled.length = 0;
  });

  it("processa e envia mensagens pendentes vencidas interpolando placeholders", async () => {
    const fakeMessages = [
      {
        id: MSG_ID,
        organization_id: ORG_ID,
        contact_id: CONTACT_ID,
        conversation_id: CONV_ID,
        template_id: null,
        raw_body: "Olá {nome}, seu lembrete é para {data} às {hora}!",
        scheduled_for: new Date(Date.now() - 60000).toISOString(),
        status: "pending",
        created_by_user_id: "user-1",
        contact: {
          id: CONTACT_ID,
          name: "Roberto Carlos",
          display_name: "Roberto",
          phone_number: "+5511988887777",
          is_anonymized: false,
          is_blocked: false,
        },
      },
    ];

    const mockAdmin = {
      from: (table: string) => {
        if (table === "scheduled_messages") {
          return {
            select: () => ({
              eq: () => ({
                lte: () => ({
                  order: () => ({
                    limit: async () => ({ data: fakeMessages, error: null }),
                  }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              return {
                eq: (col: string, val: string) => {
                  if (col === "id") {
                    updatedScheduled.push({ id: val, patch });
                  }
                  return {
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({ data: { id: val }, error: null }),
                      }),
                    }),
                  };
                },
              };
            },
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { id: CONV_ID }, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      },
    } as unknown as ReturnType<typeof createAdminClient>;

    const result = await processDueScheduledMessages(mockAdmin, new Date(), "req-123");

    expect(result.scanned).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    expect(sentMessagesList).toHaveLength(1);
    expect(sentMessagesList[0]?.conversation_id).toBe(CONV_ID);
    expect(sentMessagesList[0]?.body).toContain("Olá Roberto Carlos");

    const sentUpdate = updatedScheduled.find((u) => u.patch.status === "sent");
    expect(sentUpdate).toBeDefined();
    expect(sentUpdate?.patch.sent_at).toBeDefined();
  });

  it("marca como 'failed' se o contato estiver anonimizado ou bloqueado", async () => {
    const fakeMessages = [
      {
        id: MSG_ID,
        organization_id: ORG_ID,
        contact_id: CONTACT_ID,
        conversation_id: CONV_ID,
        raw_body: "Olá {nome}",
        scheduled_for: new Date(Date.now() - 60000).toISOString(),
        status: "pending",
        contact: {
          id: CONTACT_ID,
          name: "Anônimo",
          is_anonymized: true,
          is_blocked: false,
        },
      },
    ];

    const mockAdmin = {
      from: (table: string) => {
        if (table === "scheduled_messages") {
          return {
            select: () => ({
              eq: () => ({
                lte: () => ({
                  order: () => ({
                    limit: async () => ({ data: fakeMessages, error: null }),
                  }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              return {
                eq: (col: string, val: string) => {
                  if (col === "id") updatedScheduled.push({ id: val, patch });
                  return {
                    eq: () => ({
                      select: () => ({
                        maybeSingle: async () => ({ data: { id: val }, error: null }),
                      }),
                    }),
                  };
                },
              };
            },
          };
        }
        return {};
      },
    } as unknown as ReturnType<typeof createAdminClient>;

    const result = await processDueScheduledMessages(mockAdmin, new Date(), "req-456");

    expect(result.scanned).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(sentMessagesList).toHaveLength(0);

    const failedUpdate = updatedScheduled.find((u) => u.patch.status === "failed");
    expect(failedUpdate?.patch.error_message).toContain("anonimizado");
  });
});
