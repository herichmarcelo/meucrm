import { describe, expect, it, vi, beforeEach } from "vitest";
import { emailAdapter } from "@/lib/channels/adapters/email";
import { ingestEmailInbound } from "@/lib/channels/email/ingest";
import { sendEmail, isEmailConfigured } from "@/lib/email/resend";
import * as posEntrada from "@/lib/channels/pos-entrada";
import type { OutboundEnvelope } from "@/lib/channels/types";

vi.mock("@/lib/email/resend", () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(),
}));

describe("Email Channel — Ciclo Completo de Threading Bidirecional", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(isEmailConfigured).mockReturnValue(true);
  });

  it("garante ciclo Inbound -> Outbound -> Inbound mantendo a mesma thread", async () => {
    vi.spyOn(posEntrada, "aplicarEfeitosPosEntrada").mockResolvedValue(undefined);
    vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: "resend_outbound_msg_1" });

    // 1. Inbound inicial do cliente
    const inboundPayload1 = {
      id: "msg_inbound_initial",
      from: "Carlos Vendas <carlos@empresa.com>",
      to: "atendimento@nosso-crm.com",
      subject: "Proposta Comercial #1020",
      text: "Olá, gostaria de receber a proposta atualizada.",
      headers: {
        "message-id": "<msg_inbound_initial@empresa.com>",
      },
    };

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "messages") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockImplementation((col: string, values: string[]) => {
              // Se buscar pela mensagem enviada anteriormente, acha na conversa 1
              if (values.includes("resend_outbound_msg_1")) {
                return {
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { conversation_id: "conv-thread-1", contact_id: "contact-carlos-1" },
                    }),
                  }),
                };
              }
              return {
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              };
            }),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "msg-db-1" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "contacts") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            ilike: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "contact-carlos-1" } }),
          };
        }
        if (table === "conversations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "conv-thread-1", status: "open", contact_id: "contact-carlos-1" },
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
            }),
          };
        }
        return {};
      }),
    } as unknown as Parameters<typeof ingestEmailInbound>[0];

    const resInbound1 = await ingestEmailInbound(mockSupabase, {
      organizationId: "org-1",
      channelSessionId: "session-email-1",
      payload: inboundPayload1,
    });

    expect(resInbound1.status).toBe("ingested");
    expect(resInbound1.conversationId).toBe("conv-thread-1");

    // 2. Resposta do atendente/agente (Outbound)
    const outboundEnvelope: OutboundEnvelope = {
      organizationId: "org-1",
      sessionRef: "atendimento@nosso-crm.com",
      to: "carlos@empresa.com",
      providerConversationId: "<msg_inbound_initial@empresa.com>",
      replyToExternalId: "msg_inbound_initial",
      kind: "text",
      body: "Olá Carlos! Segue em anexo a proposta atualizada com as condições solicitadas.",
    };

    const resOutbound = await emailAdapter.send(outboundEnvelope);
    expect(resOutbound.externalId).toBe("resend_outbound_msg_1");

    // Verifica que os cabeçalhos In-Reply-To e References foram enviados
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "carlos@empresa.com",
        headers: {
          "In-Reply-To": "msg_inbound_initial",
          References: "msg_inbound_initial",
        },
      }),
    );

    // 3. Resposta de volta do cliente (Inbound Reply) citando o ID de saída
    const inboundPayload2 = {
      id: "msg_inbound_reply_2",
      from: "carlos@empresa.com",
      to: "atendimento@nosso-crm.com",
      subject: "Re: Proposta Comercial #1020",
      text: "Recebido e aprovado! Como procedemos para assinatura?",
      headers: {
        "message-id": "<msg_inbound_reply_2@empresa.com>",
        "in-reply-to": "resend_outbound_msg_1",
        references: "<msg_inbound_initial@empresa.com> resend_outbound_msg_1",
      },
    };

    const resInbound2 = await ingestEmailInbound(mockSupabase, {
      organizationId: "org-1",
      channelSessionId: "session-email-1",
      payload: inboundPayload2,
    });

    expect(resInbound2.status).toBe("ingested");
    // Garante que a mensagem foi direcionada para a MESMA conversa através do In-Reply-To
    expect(resInbound2.conversationId).toBe("conv-thread-1");
  });
});
