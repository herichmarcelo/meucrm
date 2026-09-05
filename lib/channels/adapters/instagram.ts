/**
 * Adapter do canal oficial do Instagram Direct (Meta Graph API).
 */
import { resolveInstagramCreds } from "../instagram/credentials";
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelTenantScope,
  OutboundEnvelope,
  RecipientInput,
} from "../types";

export const instagramAdapter: ChannelAdapter = {
  provider: "instagram",

  resolveRecipient(input: RecipientInput): string | null {
    if (input.instagramId && input.instagramId.trim().length > 0) {
      return input.instagramId.trim();
    }
    if (input.phoneNumber && /^\d{8,25}$/.test(input.phoneNumber.trim())) {
      return input.phoneNumber.trim();
    }
    return null;
  },

  isConfigured(): boolean {
    return Boolean(process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_SYSTEM_USER_TOKEN);
  },

  codes: {
    notConfigured: "instagram_not_configured",
    sendFailed: "instagram_send_failed",
    unknownError: "instagram_unknown_error",
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const creds = await resolveInstagramCreds(envelope.organizationId, envelope.sessionRef);
    if (!creds || !creds.token) {
      return { externalId: null };
    }

    const version = process.env.META_GRAPH_VERSION ?? "v22.0";
    const endpoint = `https://graph.facebook.com/${version}/me/messages`;

    let messagePayload: Record<string, unknown>;

    if (envelope.media?.url) {
      let attType = "file";
      if (envelope.kind === "image") attType = "image";
      else if (envelope.kind === "video") attType = "video";
      else if (envelope.kind === "audio") attType = "audio";

      messagePayload = {
        attachment: {
          type: attType,
          payload: {
            url: envelope.media.url,
            is_reusable: true,
          },
        },
      };
    } else {
      messagePayload = {
        text: envelope.body ?? "",
      };
    }

    const body = {
      recipient: { id: envelope.to },
      messaging_type: "RESPONSE",
      message: messagePayload,
    };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as {
        message_id?: string;
        recipient_id?: string;
        error?: { message?: string };
      };

      if (!res.ok || !data.message_id) {
        return { externalId: null };
      }

      return { externalId: data.message_id };
    } catch {
      return { externalId: null };
    }
  },

  async checkHealth(input: ChannelTenantScope & { sessionRef: string }): Promise<ChannelHealth> {
    const creds = await resolveInstagramCreds(input.organizationId, input.sessionRef);
    if (!creds || !creds.token) {
      return {
        reachable: false,
        status: "NOT_CONFIGURED",
        detail: "instagram_not_configured",
      };
    }

    return {
      reachable: true,
      status: "WORKING",
      detail: null,
    };
  },
};
