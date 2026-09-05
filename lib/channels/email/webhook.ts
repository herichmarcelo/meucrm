/**
 * Parser puro e verificação de assinatura para webhooks de entrada de E-mail.
 *
 * Suporta payloads padronizados de provedores de e-mail (Resend inbound webhooks,
 * eventos `email.received`, ou payloads de webhook de e-mail estruturados).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeEmailAddress } from "../adapters/email";

export interface EmailInboundAttachment {
  filename: string;
  contentType: string;
  sizeBytes?: number;
  url?: string;
  content?: string;
}

export interface EmailInboundMessage {
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  inReplyTo: string | null;
  references: string | null;
  headers: Record<string, string>;
  attachments: EmailInboundAttachment[];
  receivedAt: string;
}

/**
 * Extrai nome e e-mail de strings no formato `Nome Sobrenome <email@dominio.com>`
 * ou simplesmente `email@dominio.com`.
 */
export function parseEmailAddress(raw: string): { email: string; name: string | null } {
  if (!raw || typeof raw !== "string") {
    return { email: "", name: null };
  }

  const match = raw.match(/^(?:["']?([^"']+)["']?\s+)?<?([^\s<>@]+@[^\s<>@]+)>?$/);
  if (match) {
    const name = match[1]?.trim() || null;
    const email = normalizeEmailAddress(match[2] || "") ?? "";
    return { email, name };
  }

  return {
    email: normalizeEmailAddress(raw.trim()) ?? "",
    name: null,
  };
}

/**
 * Converte HTML básico em texto simples limpo quando apenas HTML é fornecido.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*[\/]?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Faz parse de um payload cru de webhook de entrada para o formato normalizado `EmailInboundMessage`.
 */
export function parseEmailInbound(payload: unknown): EmailInboundMessage | null {
  if (!payload || typeof payload !== "object") return null;

  const data = payload as Record<string, unknown>;

  // Resend webhook wrapper: `{ type: "email.received", data: { ... } }`
  const emailData =
    data.type === "email.received" && data.data && typeof data.data === "object"
      ? (data.data as Record<string, unknown>)
      : data;

  // Extração do remetente
  const rawFrom =
    typeof emailData.from === "string"
      ? emailData.from
      : typeof emailData.sender === "string"
        ? emailData.sender
        : "";

  const { email: fromEmail, name: fromName } = parseEmailAddress(rawFrom);
  if (!fromEmail) return null;

  // Extração do destinatário
  let toEmail = "";
  if (typeof emailData.to === "string") {
    toEmail = parseEmailAddress(emailData.to).email;
  } else if (Array.isArray(emailData.to) && emailData.to.length > 0) {
    toEmail = parseEmailAddress(String(emailData.to[0])).email;
  } else if (typeof emailData.recipient === "string") {
    toEmail = parseEmailAddress(emailData.recipient).email;
  }

  // Assunto
  const subject =
    typeof emailData.subject === "string" ? emailData.subject.trim() : "Sem assunto";

  // Corpo de texto e HTML
  const bodyHtml = typeof emailData.html === "string" ? emailData.html : null;
  let bodyText = typeof emailData.text === "string" ? emailData.text.trim() : "";

  if (!bodyText && bodyHtml) {
    bodyText = htmlToPlainText(bodyHtml);
  }

  // Headers e Threading (Message-ID, In-Reply-To, References)
  const headers: Record<string, string> = {};
  if (emailData.headers && typeof emailData.headers === "object") {
    for (const [k, v] of Object.entries(emailData.headers as Record<string, unknown>)) {
      if (typeof v === "string") {
        headers[k.toLowerCase()] = v;
      }
    }
  }

  const messageId =
    (typeof emailData.email_id === "string" && emailData.email_id) ||
    (typeof emailData.id === "string" && emailData.id) ||
    (typeof emailData.message_id === "string" && emailData.message_id) ||
    headers["message-id"] ||
    `email_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const inReplyTo =
    (typeof emailData.in_reply_to === "string" && emailData.in_reply_to) ||
    headers["in-reply-to"] ||
    null;

  const references =
    (typeof emailData.references === "string" && emailData.references) ||
    headers["references"] ||
    null;

  // Anexos
  const attachments: EmailInboundAttachment[] = [];
  if (Array.isArray(emailData.attachments)) {
    for (const att of emailData.attachments) {
      if (att && typeof att === "object") {
        const a = att as Record<string, unknown>;
        attachments.push({
          filename: typeof a.filename === "string" ? a.filename : "anexo",
          contentType:
            typeof a.content_type === "string"
              ? a.content_type
              : typeof a.contentType === "string"
                ? a.contentType
                : "application/octet-stream",
          sizeBytes: typeof a.size === "number" ? a.size : undefined,
          url: typeof a.url === "string" ? a.url : undefined,
          content: typeof a.content === "string" ? a.content : undefined,
        });
      }
    }
  }

  const receivedAt =
    typeof emailData.created_at === "string"
      ? new Date(emailData.created_at).toISOString()
      : typeof emailData.received_at === "string"
        ? new Date(emailData.received_at).toISOString()
        : new Date().toISOString();

  return {
    messageId,
    fromEmail,
    fromName,
    toEmail,
    subject,
    bodyText,
    bodyHtml,
    inReplyTo,
    references,
    headers,
    attachments,
    receivedAt,
  };
}

/**
 * Validação de assinatura de webhook de e-mail (Svix / HMAC SHA-256 ou Bearer token).
 */
export function verifyEmailWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string | null,
): boolean {
  if (!secret) {
    // Se nenhum segredo foi configurado para a sessão, permite a ingestão direta
    return true;
  }

  // 1. Verificação por Header Authorization Bearer
  const authHeader = headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.length === secret.length && timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
      return true;
    }
  }

  // 2. Verificação por Svix (padrão Resend Webhooks: svix-id, svix-timestamp, svix-signature)
  const svixSignature = headers.get("svix-signature");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixId = headers.get("svix-id");

  if (svixSignature && svixTimestamp && svixId) {
    // Secret Svix pode vir no formato "whsec_..."
    const cleanSecret = secret.startsWith("whsec_")
      ? Buffer.from(secret.slice(6), "base64")
      : Buffer.from(secret);

    const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
    const expectedSig = createHmac("sha256", cleanSecret).update(signedPayload).digest("base64");

    // svix-signature pode conter múltiplas assinaturas separadas por espaço (ex: "v1,g0h... v1,abc...")
    const signatures = svixSignature.split(" ");
    for (const sig of signatures) {
      const parts = sig.split(",");
      const sigValue = parts.length > 1 ? parts[1] : parts[0];
      if (
        sigValue &&
        sigValue.length === expectedSig.length &&
        timingSafeEqual(Buffer.from(sigValue), Buffer.from(expectedSig))
      ) {
        return true;
      }
    }
  }

  // 3. Verificação por header HMAC customizado (ex: x-signature / x-webhook-signature)
  const customSignature =
    headers.get("x-signature") ||
    headers.get("x-resend-signature") ||
    headers.get("x-webhook-signature");

  if (customSignature) {
    const expectedHmac = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (
      customSignature.length === expectedHmac.length &&
      timingSafeEqual(Buffer.from(customSignature), Buffer.from(expectedHmac))
    ) {
      return true;
    }
  }

  return false;
}
