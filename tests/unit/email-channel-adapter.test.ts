import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  emailAdapter,
  extractEmailSubject,
  formatEmailHtml,
  normalizeEmailAddress,
} from "@/lib/channels/adapters/email";
import type { OutboundEnvelope, RecipientInput } from "@/lib/channels/types";

vi.mock("@/lib/email/resend", () => ({
  isEmailConfigured: vi.fn(),
  sendEmail: vi.fn(),
}));

import { isEmailConfigured, sendEmail } from "@/lib/email/resend";

describe("EmailChannelAdapter (lib/channels/adapters/email.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveRecipient", () => {
    it("resolve e normaliza e-mail válido", () => {
      const input: RecipientInput = {
        isGroup: false,
        groupChatId: null,
        phoneNumber: null,
        waIdentity: null,
        email: "  Cliente.Teste@Empresa.COM.BR  ",
      };
      expect(emailAdapter.resolveRecipient(input)).toBe("cliente.teste@empresa.com.br");
    });

    it("retorna null se e-mail estiver ausente ou for inválido", () => {
      expect(emailAdapter.resolveRecipient({ isGroup: false, groupChatId: null, phoneNumber: "+551199999999", waIdentity: null })).toBeNull();
      expect(emailAdapter.resolveRecipient({ isGroup: false, groupChatId: null, phoneNumber: null, waIdentity: null, email: "invalido" })).toBeNull();
      expect(emailAdapter.resolveRecipient({ isGroup: false, groupChatId: null, phoneNumber: null, waIdentity: null, email: "" })).toBeNull();
    });
  });

  describe("extractEmailSubject", () => {
    it("usa assunto explícito quando fornecido no envelope", () => {
      const envelope = {
        organizationId: "org-1",
        sessionRef: "session-1",
        to: "dest@teste.com",
        kind: "text",
        subject: "Proposta Comercial 2026",
      } as unknown as OutboundEnvelope;
      expect(extractEmailSubject(envelope)).toBe("Proposta Comercial 2026");
    });

    it("deriva 'Re: Atendimento' quando há replyToExternalId", () => {
      const envelope: OutboundEnvelope = {
        organizationId: "org-1",
        sessionRef: "session-1",
        to: "dest@teste.com",
        kind: "text",
        body: "Obrigado pelo retorno!",
        replyToExternalId: "<msg-123@mail.gmail.com>",
      };
      expect(extractEmailSubject(envelope)).toBe("Re: Atendimento");
    });

    it("deriva preview do corpo quando não há assunto nem reply", () => {
      const envelope: OutboundEnvelope = {
        organizationId: "org-1",
        sessionRef: "session-1",
        to: "dest@teste.com",
        kind: "text",
        body: "Olá, segue em anexo o documento solicitado para assinatura.",
      };
      expect(extractEmailSubject(envelope)).toBe("Olá, segue em anexo o documento solicita...");
    });
  });

  describe("formatEmailHtml", () => {
    it("escapa caracteres especiais e formata quebras de linha em tags <p>", () => {
      const html = formatEmailHtml("Olá <Ana> & Cia!\n\nSegue o resumo.");
      expect(html).toContain("&lt;Ana&gt;");
      expect(html).toContain("&amp; Cia!");
      expect(html).toContain("<p style=\"margin: 0 0 16px 0; line-height: 1.5;\">Olá &lt;Ana&gt; &amp; Cia!</p>");
    });
  });

  describe("isConfigured e codes", () => {
    it("delega isConfigured para isEmailConfigured", () => {
      vi.mocked(isEmailConfigured).mockReturnValue(true);
      expect(emailAdapter.isConfigured()).toBe(true);

      vi.mocked(isEmailConfigured).mockReturnValue(false);
      expect(emailAdapter.isConfigured()).toBe(false);
    });

    it("possui códigos de erro padrão no formato de canal", () => {
      expect(emailAdapter.codes).toEqual({
        notConfigured: "email_not_configured",
        sendFailed: "email_send_failed",
        unknownError: "email_unknown_error",
      });
    });
  });

  describe("checkHealth", () => {
    it("retorna WORKING quando configurado", async () => {
      vi.mocked(isEmailConfigured).mockReturnValue(true);
      const health = await emailAdapter.checkHealth!({ organizationId: "org-1", sessionRef: "default" });
      expect(health).toEqual({
        reachable: true,
        status: "WORKING",
        detail: null,
      });
    });

    it("retorna NOT_CONFIGURED quando sem credenciais", async () => {
      vi.mocked(isEmailConfigured).mockReturnValue(false);
      const health = await emailAdapter.checkHealth!({ organizationId: "org-1", sessionRef: "default" });
      expect(health).toEqual({
        reachable: true,
        status: "NOT_CONFIGURED",
        detail: "email_not_configured",
      });
    });
  });

  describe("send", () => {
    it("envia e-mail com sucesso incluindo headers de threading e retorna externalId", async () => {
      vi.mocked(isEmailConfigured).mockReturnValue(true);
      vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: "email_msg_98765" });

      const envelope: OutboundEnvelope = {
        organizationId: "org-1",
        sessionRef: "atendimento@empresa.com",
        to: "cliente@dominio.com",
        kind: "text",
        body: "Olá, segue resposta.",
        replyToExternalId: "<msg-original-123@gmail.com>",
      };

      const result = await emailAdapter.send(envelope);

      expect(result).toEqual({ externalId: "email_msg_98765" });
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "cliente@dominio.com",
          subject: "Re: Atendimento",
          text: "Olá, segue resposta.",
          headers: {
            "In-Reply-To": "<msg-original-123@gmail.com>",
            "References": "<msg-original-123@gmail.com>",
          },
        }),
      );
    });

    it("inclui anexo de mídia quando presente no envelope", async () => {
      vi.mocked(isEmailConfigured).mockReturnValue(true);
      vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: "email_msg_with_media" });

      const envelope: OutboundEnvelope = {
        organizationId: "org-1",
        sessionRef: "default",
        to: "cliente@dominio.com",
        kind: "document",
        body: "Segue o contrato.",
        media: {
          url: "https://storage.supabase.com/whatsapp-media/contrato.pdf",
          filename: "contrato_assinado.pdf",
          mime: "application/pdf",
        },
      };

      const result = await emailAdapter.send(envelope);

      expect(result).toEqual({ externalId: "email_msg_with_media" });
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            {
              path: "https://storage.supabase.com/whatsapp-media/contrato.pdf",
              filename: "contrato_assinado.pdf",
              contentType: "application/pdf",
            },
          ],
        }),
      );
    });

    it("retorna externalId null quando envio falhar", async () => {
      vi.mocked(isEmailConfigured).mockReturnValue(true);
      vi.mocked(sendEmail).mockResolvedValue({ ok: false, error: "send_failed" });

      const envelope: OutboundEnvelope = {
        organizationId: "org-1",
        sessionRef: "default",
        to: "cliente@dominio.com",
        kind: "text",
        body: "Teste de falha",
      };

      const result = await emailAdapter.send(envelope);
      expect(result).toEqual({ externalId: null });
    });

    it("retorna externalId null se canal não estiver configurado", async () => {
      vi.mocked(isEmailConfigured).mockReturnValue(false);

      const envelope: OutboundEnvelope = {
        organizationId: "org-1",
        sessionRef: "default",
        to: "cliente@dominio.com",
        kind: "text",
        body: "Teste",
      };

      const result = await emailAdapter.send(envelope);
      expect(result).toEqual({ externalId: null });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});
