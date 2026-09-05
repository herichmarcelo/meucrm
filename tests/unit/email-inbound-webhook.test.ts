import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  parseEmailAddress,
  htmlToPlainText,
  parseEmailInbound,
  verifyEmailWebhookSignature,
} from "@/lib/channels/email/webhook";
import { ingestEmailInbound } from "@/lib/channels/email/ingest";
import { handleInboundWebhook, acceptsInboundWebhook } from "@/lib/channels/inbound";
import * as posEntrada from "@/lib/channels/pos-entrada";
import { createHmac } from "node:crypto";

describe("Email Inbound Webhook — Parser & Signature", () => {
  it("parseEmailAddress extrai corretamente nome e email normalizado", () => {
    expect(parseEmailAddress("Fulano de Tal <Fulano@Dominio.COM>")).toEqual({
      name: "Fulano de Tal",
      email: "fulano@dominio.com",
    });

    expect(parseEmailAddress('"Empresa XPTO" <contato@xpto.com.br>')).toEqual({
      name: "Empresa XPTO",
      email: "contato@xpto.com.br",
    });

    expect(parseEmailAddress("simples@teste.com")).toEqual({
      name: null,
      email: "simples@teste.com",
    });
  });

  it("htmlToPlainText converte tags HTML em texto legível", () => {
    const html = "<p>Olá <b>Mundo</b>!</p><p>Como vai?<br>Tudo bem.</p>";
    const text = htmlToPlainText(html);
    expect(text).toContain("Olá Mundo!");
    expect(text).toContain("Como vai?\nTudo bem.");
  });

  it("parseEmailInbound faz parse de payload Resend email.received", () => {
    const payload = {
      type: "email.received",
      data: {
        id: "resend_msg_123",
        from: "Cliente <cliente@teste.com>",
        to: ["atendimento@empresa.com.br"],
        subject: "Dúvida sobre plano",
        html: "<p>Gostaria de saber mais sobre o plano Pro.</p>",
        headers: {
          "message-id": "<msg-id-456@teste.com>",
          "in-reply-to": "<ref-id-789@empresa.com.br>",
        },
        attachments: [
          {
            filename: "documento.pdf",
            content_type: "application/pdf",
            size: 2048,
          },
        ],
      },
    };

    const parsed = parseEmailInbound(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.fromEmail).toBe("cliente@teste.com");
    expect(parsed?.fromName).toBe("Cliente");
    expect(parsed?.toEmail).toBe("atendimento@empresa.com.br");
    expect(parsed?.subject).toBe("Dúvida sobre plano");
    expect(parsed?.bodyText).toContain("Gostaria de saber mais sobre o plano Pro.");
    expect(parsed?.messageId).toBe("resend_msg_123");
    expect(parsed?.inReplyTo).toBe("<ref-id-789@empresa.com.br>");
    expect(parsed?.attachments).toHaveLength(1);
    expect(parsed?.attachments?.[0]?.filename).toBe("documento.pdf");
  });

  it("verifyEmailWebhookSignature aceita payload sem segredo ou com Bearer válido", () => {
    const rawBody = JSON.stringify({ test: true });

    // Sem segredo -> true
    expect(verifyEmailWebhookSignature(rawBody, new Headers(), null)).toBe(true);

    // Com Bearer token correto -> true
    const validHeaders = new Headers({ authorization: "Bearer meu_segredo_super_secreto_123" });
    expect(
      verifyEmailWebhookSignature(rawBody, validHeaders, "meu_segredo_super_secreto_123"),
    ).toBe(true);

    // Com Bearer token incorreto -> false
    const invalidHeaders = new Headers({ authorization: "Bearer segredo_errado_invalido_456" });
    expect(
      verifyEmailWebhookSignature(rawBody, invalidHeaders, "meu_segredo_super_secreto_123"),
    ).toBe(false);
  });

  it("verifyEmailWebhookSignature valida assinatura Svix (Resend webhooks)", () => {
    const secret = "whsec_5vixS3cr3tK3yB4s364T3st1234567890=";
    const cleanSecret = Buffer.from(secret.slice(6), "base64");
    const rawBody = JSON.stringify({ event: "email.received" });
    const svixId = "msg_svix_123";
    const svixTimestamp = Math.floor(Date.now() / 1000).toString();

    const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
    const signature = createHmac("sha256", cleanSecret).update(signedPayload).digest("base64");

    const headers = new Headers({
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": `v1,${signature}`,
    });

    expect(verifyEmailWebhookSignature(rawBody, headers, secret)).toBe(true);
  });
});

describe("Email Inbound Webhook — Ingestão e Pós-Entrada", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("acceptsInboundWebhook aceita canal email", () => {
    expect(acceptsInboundWebhook("email")).toBe(true);
    expect(acceptsInboundWebhook("zernio")).toBe(true);
    expect(acceptsInboundWebhook("waha")).toBe(false);
  });

  it("ingere email criando novo contato, conversa, mensagem e disparando pos-entrada", async () => {
    const aplicarEfeitosSpy = vi
      .spyOn(posEntrada, "aplicarEfeitosPosEntrada")
      .mockResolvedValue(undefined);

    // Mock do Supabase Client
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "messages") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "msg-uuid-1" },
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
            maybeSingle: vi.fn().mockResolvedValue({ data: null }), // Novo contato
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "contact-uuid-1" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "conversations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }), // Nova conversa
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "conv-uuid-1" },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
            }),
          };
        }
        return {};
      }),
    } as unknown as Parameters<typeof ingestEmailInbound>[0];

    const payload = {
      id: "resend_inbound_999",
      from: "Maria Silva <maria@dominio.com>",
      to: "suporte@meucrm.com",
      subject: "Orçamento de consultoria",
      text: "Gostaria de agendar uma reunião sobre o serviço.",
    };

    const result = await ingestEmailInbound(mockSupabase, {
      organizationId: "org-1",
      channelSessionId: "session-email-1",
      payload,
      requestId: "req-123",
    });

    expect(result.status).toBe("ingested");
    expect(result.conversationId).toBe("conv-uuid-1");
    expect(result.messageId).toBe("msg-uuid-1");

    // Verifica que pós-entrada foi invocado com canal e origem 'email'
    expect(aplicarEfeitosSpy).toHaveBeenCalledTimes(1);
    expect(aplicarEfeitosSpy).toHaveBeenCalledWith(
      mockSupabase,
      expect.objectContaining({
        organizationId: "org-1",
        contactId: "contact-uuid-1",
        conversationId: "conv-uuid-1",
        messageId: "msg-uuid-1",
        channelSessionId: "session-email-1",
        origem: "email",
        nomeDoContato: "Maria Silva",
      }),
    );
  });

  it("trata duplicatas de forma idempotente retornando status duplicate", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "messages") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "23505", message: "duplicate external_id" },
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
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "contact-uuid-1" } }),
          };
        }
        if (table === "conversations") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "conv-uuid-1", status: "open" } }),
          };
        }
        return {};
      }),
    } as unknown as Parameters<typeof ingestEmailInbound>[0];

    const payload = {
      id: "resend_inbound_duplicate",
      from: "maria@dominio.com",
      to: "suporte@meucrm.com",
      subject: "Mensagem reenviada",
      text: "Mensagem já processada.",
    };

    const result = await ingestEmailInbound(mockSupabase, {
      organizationId: "org-1",
      channelSessionId: "session-email-1",
      payload,
    });

    expect(result.status).toBe("duplicate");
    expect(result.conversationId).toBe("conv-uuid-1");
  });

  it("handleInboundWebhook despacha para emailInbound e responde corretamente", async () => {
    vi.spyOn(posEntrada, "aplicarEfeitosPosEntrada").mockResolvedValue(undefined);

    const mockSupabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(
          table === "contacts"
            ? { data: { id: "contact-1" } }
            : table === "conversations"
              ? { data: { id: "conv-1", status: "open" } }
              : { data: null },
        ),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "msg-1" }, error: null }),
            single: vi.fn().mockResolvedValue({ data: { id: "row-1" }, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
        }),
      })),
    } as unknown as Parameters<typeof ingestEmailInbound>[0];

    const input = {
      session: {
        id: "sess-email-1",
        organization_id: "org-1",
        provider: "email",
      },
      rawBody: JSON.stringify({
        id: "email_hook_1",
        from: "lead@teste.com",
        to: "comercial@empresa.com",
        subject: "Interesse",
        text: "Quero contratar",
      }),
      headers: new Headers(),
      secret: null,
    };

    const outcome = await handleInboundWebhook(mockSupabase, input);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.body.status).toBe("ingested");
      expect(outcome.body.conversationId).toBe("conv-1");
      expect(outcome.body.messageId).toBe("msg-1");
    }
  });
});
