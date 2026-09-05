/**
 * Parser e utilitários de segurança do Webhook do Instagram Direct (Meta Graph API).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface InstagramInboundAttachment {
  type: "image" | "audio" | "video" | "file" | "story_mention" | "share" | "fallback";
  url?: string;
  title?: string;
}

export interface InstagramInboundMessage {
  messageId: string;
  senderId: string;
  recipientId: string;
  timestamp: number;
  text: string;
  replyToMessageId: string | null;
  attachments: InstagramInboundAttachment[];
  isEcho: boolean;
  isStoryReply: boolean;
  storyUrl?: string;
}

/**
 * Responde ao handshake de verificação `hub.challenge` exigido pela Meta no GET.
 */
export function verificationChallenge(
  query: URLSearchParams,
  expectedToken: string,
): string | null {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");

  if (mode === "subscribe" && token && expectedToken && token === expectedToken && challenge) {
    return challenge;
  }
  return null;
}

/**
 * Valida a assinatura HMAC SHA-256 da Meta (`X-Hub-Signature-256`).
 */
export function verifyInstagramSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret || appSecret.length < 4) {
    return false;
  }

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return false;
  }

  const signature = parts[1] ?? "";
  const hmac = createHmac("sha256", appSecret);
  hmac.update(rawBody, "utf8");
  const expected = hmac.digest("hex");

  try {
    const a = Buffer.from(signature, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Faz o parse dos eventos de mensagens do Instagram Direct.
 */
export function parseInstagramWebhook(payload: unknown): InstagramInboundMessage[] {
  if (!payload || typeof payload !== "object") return [];

  const data = payload as {
    object?: string;
    entry?: Array<{
      id?: string;
      time?: number;
      messaging?: Array<{
        sender?: { id?: string };
        recipient?: { id?: string };
        timestamp?: number;
        message?: {
          mid?: string;
          text?: string;
          is_echo?: boolean;
          reply_to?: { mid?: string };
          attachments?: Array<{
            type?: string;
            payload?: {
              url?: string;
              title?: string;
            };
          }>;
          story?: {
            url?: string;
          };
        };
      }>;
    }>;
  };

  const results: InstagramInboundMessage[] = [];

  for (const entry of data.entry ?? []) {
    for (const msg of entry.messaging ?? []) {
      if (!msg.message || !msg.sender?.id || !msg.recipient?.id) {
        continue;
      }

      const messageId = msg.message.mid || `ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const senderId = msg.sender.id;
      const recipientId = msg.recipient.id;
      const timestamp = msg.timestamp || entry.time || Date.now();
      const text = msg.message.text || "";
      const isEcho = Boolean(msg.message.is_echo);
      const replyToMessageId = msg.message.reply_to?.mid || null;
      const isStoryReply = Boolean(msg.message.story?.url);
      const storyUrl = msg.message.story?.url;

      const attachments: InstagramInboundAttachment[] = [];
      for (const att of msg.message.attachments ?? []) {
        const type = (att.type as InstagramInboundAttachment["type"]) || "fallback";
        attachments.push({
          type,
          url: att.payload?.url,
          title: att.payload?.title,
        });
      }

      results.push({
        messageId,
        senderId,
        recipientId,
        timestamp,
        text,
        replyToMessageId,
        attachments,
        isEcho,
        isStoryReply,
        storyUrl,
      });
    }
  }

  return results;
}
