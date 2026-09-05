/**
 * lib/channels/adapters/gowa.ts — Adapter do canal GOWA (Go WhatsApp Web MultiDevice).
 *
 * Tradutor de formato puro: mapeia OutboundEnvelope para os endpoints e
 * formatos HTTP do GOWA sem incluir lógica de negócios de alto nível.
 */
import { getGowaClient } from "@/lib/gowa/client";
import { resolveGowaChatId } from "@/lib/gowa/send";
import { bareGowaMessageId } from "@/lib/gowa/message-id";
import type { FetchedMedia } from "@/lib/messaging/media/types";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelTenantScope,
  OutboundEnvelope,
  RecipientInput,
} from "../types";

export const gowaAdapter: ChannelAdapter = {
  provider: "gowa",

  resolveRecipient(input: RecipientInput): string | null {
    return resolveGowaChatId(input);
  },

  echoExternalIds(input: { externalId: string; recipient: string }): string[] {
    const bare = bareGowaMessageId(input.externalId);
    return [...new Set([input.externalId, bare])];
  },

  isConfigured(): boolean {
    return getGowaClient() !== null;
  },

  codes: {
    notConfigured: "gowa_not_configured",
    sendFailed: "gowa_error",
    unknownError: "gowa_unknown",
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const client = getGowaClient();
    if (!client) return { externalId: null };

    const deviceId = envelope.sessionRef;
    const recipient = envelope.to;

    if (envelope.kind === "text") {
      const res = await client.sendText(
        deviceId,
        recipient,
        envelope.body ?? "",
        envelope.replyToExternalId,
      );
      return { externalId: res.externalId };
    }

    if (envelope.media) {
      // GIF animado do Giphy: enviado como vídeo MP4 com gif_playback=true.
      // /send/sticker extrai só o primeiro frame — não usar para GIF animado.
      if (envelope.media.gifPlayback === true) {
        const res = await client.sendVideo(
          deviceId,
          recipient,
          envelope.media.url,
          { gifPlayback: true },
        );
        return { externalId: res.externalId };
      }

      const isGif =
        envelope.kind === "sticker" ||
        envelope.media.mime === "image/gif" ||
        (envelope.media.filename && envelope.media.filename.toLowerCase().endsWith(".gif")) ||
        envelope.media.url.toLowerCase().includes(".gif");
      const mediaKind =
        isGif
          ? "sticker"
          : envelope.kind === "image"
            ? "image"
            : envelope.kind === "audio"
              ? "audio"
              : "file";
      const res = await client.sendMedia(
        deviceId,
        mediaKind,
        recipient,
        envelope.media.url,
        envelope.media.caption ?? envelope.body,
        envelope.media.filename ?? undefined,
        envelope.media.mime ?? undefined,
      );
      return { externalId: res.externalId };
    }

    // Fallback texto

    const res = await client.sendText(
      deviceId,
      recipient,
      envelope.body ?? "",
      envelope.replyToExternalId,
    );
    return { externalId: res.externalId };
  },

  async checkHealth(input: ChannelTenantScope & { sessionRef: string }): Promise<ChannelHealth> {
    const client = getGowaClient();
    if (!client) {
      return { reachable: false, status: null, detail: "gowa_not_configured" };
    }

    try {
      const st = await client.getDeviceStatus(input.sessionRef);
      const isWorking = st.isConnected && st.isLoggedIn;
      return {
        reachable: true,
        status: isWorking ? "WORKING" : "STOPPED",
        detail: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown_error";
      if (msg.includes("404")) {
        return { reachable: true, status: "STOPPED", detail: "device_not_found" };
      }
      return { reachable: false, status: null, detail: msg };
    }
  },

  async fetchProfilePictureUrl(
    input: ChannelTenantScope & { sessionRef: string; recipient: string },
  ): Promise<string | null> {
    const client = getGowaClient();
    if (!client) return null;
    return client.fetchProfilePictureUrl(input.sessionRef, input.recipient);
  },

  async fetchInboundMedia(
    input: ChannelTenantScope & { sessionRef: string; url: string; hintMime?: string | null },
  ): Promise<FetchedMedia> {
    const client = getGowaClient();
    if (!client) {
      throw new Error("gowa_not_configured");
    }

    const { buffer, contentType } = await client.fetchInboundMedia(input.url, input.sessionRef);
    return {
      buffer: Buffer.from(buffer),
      mime: input.hintMime ?? contentType ?? "application/octet-stream",
    };
  },
};
