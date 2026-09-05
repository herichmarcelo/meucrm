/**
 * lib/channels/adapters/email.ts — Adapter do canal de E-mail (EmailChannelAdapter).
 *
 * Tradutor de formato puro: mapeia OutboundEnvelope para o wrapper
 * transacional de e-mail (Resend) em lib/email/resend.ts.
 *
 * Não consulta banco nem decide se pode enviar (janela/throttle/cap são da cadeia before_send).
 */
import { isEmailConfigured, sendEmail, type SendArgs } from "@/lib/email/resend";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelTenantScope,
  OutboundEnvelope,
  RecipientInput,
} from "../types";

/** Normaliza e valida um endereço de e-mail básico. Devolve null se inválido. */
export function normalizeEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  // Validação simples e robusta de formato de e-mail
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

/** Extrai ou deriva o assunto do envelope de forma segura. */
export function extractEmailSubject(envelope: OutboundEnvelope): string {
  const metadata = envelope as { subject?: string; metadata?: { subject?: string } };
  const customSubject = metadata.subject ?? metadata.metadata?.subject;
  if (customSubject && typeof customSubject === "string" && customSubject.trim().length > 0) {
    return customSubject.trim();
  }

  // Se for uma resposta com thread identificada
  if (envelope.replyToExternalId) {
    return "Re: Atendimento";
  }

  // Fallback para assunto da mensagem
  if (envelope.body && envelope.body.trim().length > 0) {
    const preview = envelope.body.trim().slice(0, 40).replace(/[\r\n]+/g, " ");
    return preview.length >= 40 ? `${preview}...` : preview;
  }

  return "Nova mensagem de atendimento";
}

/** Converte quebras de linha em parágrafos e tags HTML seguras. */
export function formatEmailHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin: 0 0 16px 0; line-height: 1.5;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #1f2937;">${paragraphs}</div>`;
}

export const emailAdapter: ChannelAdapter = {
  provider: "email",

  resolveRecipient(input: RecipientInput): string | null {
    return normalizeEmailAddress(input.email);
  },

  isConfigured(): boolean {
    return isEmailConfigured();
  },

  codes: {
    notConfigured: "email_not_configured",
    sendFailed: "email_send_failed",
    unknownError: "email_unknown_error",
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const to = normalizeEmailAddress(envelope.to);
    if (!to) return { externalId: null };

    if (!isEmailConfigured()) {
      return { externalId: null };
    }

    const subject = extractEmailSubject(envelope);
    const bodyText = envelope.body ?? "";
    const bodyHtml = formatEmailHtml(bodyText || (envelope.media?.caption ?? ""));

    // Monta cabeçalhos para suporte a threading de e-mail
    const headers: Record<string, string> = {};
    if (envelope.replyToExternalId) {
      headers["In-Reply-To"] = envelope.replyToExternalId;
      headers["References"] = envelope.replyToExternalId;
    } else if (envelope.providerConversationId) {
      headers["References"] = envelope.providerConversationId;
    }

    // Anexos de mídia ou vcard de contato quando fornecidos
    const attachments: SendArgs["attachments"] = [];
    if (envelope.media?.url) {
      attachments.push({
        path: envelope.media.url,
        filename: envelope.media.filename || "anexo",
        contentType: envelope.media.mime,
      });
    }

    if (envelope.contact?.vcard) {
      attachments.push({
        content: envelope.contact.vcard,
        filename: `${envelope.contact.fullName || "contato"}.vcf`,
        contentType: "text/vcard",
      });
    }

    const payload: SendArgs = {
      to,
      subject,
      text: bodyText,
      html: bodyHtml,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    };

    const res = await sendEmail(payload);

    if (!res.ok || !res.id) {
      return { externalId: null };
    }

    return { externalId: res.id };
  },

  async checkHealth(_input: ChannelTenantScope & { sessionRef: string }): Promise<ChannelHealth> {
    const configured = isEmailConfigured();
    return {
      reachable: true,
      status: configured ? "WORKING" : "NOT_CONFIGURED",
      detail: configured ? null : "email_not_configured",
    };
  },
};
