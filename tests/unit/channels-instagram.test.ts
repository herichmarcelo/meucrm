import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { instagramAdapter } from "@/lib/channels/adapters/instagram";
import { capabilitiesOf } from "@/lib/channels/capabilities";
import {
  parseInstagramWebhook,
  verificationChallenge,
  verifyInstagramSignature,
} from "@/lib/channels/instagram/webhook";
import { channelKindOf } from "@/lib/channels/types";

describe("Instagram Direct Channel Integration", () => {
  describe("Handshake de Verificação (hub.challenge)", () => {
    it("devolve o challenge quando mode=subscribe e verify_token bate", () => {
      const params = new URLSearchParams({
        "hub.mode": "subscribe",
        "hub.verify_token": "meu_token_secreto",
        "hub.challenge": "1158201444",
      });
      const res = verificationChallenge(params, "meu_token_secreto");
      expect(res).toBe("1158201444");
    });

    it("recusa quando o verify_token não bate", () => {
      const params = new URLSearchParams({
        "hub.mode": "subscribe",
        "hub.verify_token": "token_errado",
        "hub.challenge": "1158201444",
      });
      const res = verificationChallenge(params, "meu_token_secreto");
      expect(res).toBeNull();
    });

    it("recusa quando mode não é subscribe", () => {
      const params = new URLSearchParams({
        "hub.mode": "other",
        "hub.verify_token": "meu_token_secreto",
        "hub.challenge": "1158201444",
      });
      const res = verificationChallenge(params, "meu_token_secreto");
      expect(res).toBeNull();
    });
  });

  describe("Validação de Assinatura HMAC SHA-256 (X-Hub-Signature-256)", () => {
    const secret = "app_secret_1234567890";
    const rawBody = JSON.stringify({ object: "instagram", entry: [] });

    it("valida com sucesso assinatura HMAC correta", () => {
      const hmac = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
      const signature = `sha256=${hmac}`;

      const valido = verifyInstagramSignature(rawBody, signature, secret);
      expect(valido).toBe(true);
    });

    it("recusa assinatura adulterada ou incorreta", () => {
      const signature = "sha256=1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const valido = verifyInstagramSignature(rawBody, signature, secret);
      expect(valido).toBe(false);
    });

    it("recusa quando cabeçalho está ausente ou sem secret", () => {
      expect(verifyInstagramSignature(rawBody, null, secret)).toBe(false);
      expect(verifyInstagramSignature(rawBody, "sha256=abc", "")).toBe(false);
    });
  });

  describe("Parser de Webhooks do Instagram Direct", () => {
    it("faz o parse de mensagem de texto direta simples", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "17841400000000000",
            time: 1725450000000,
            messaging: [
              {
                sender: { id: "987654321" },
                recipient: { id: "17841400000000000" },
                timestamp: 1725450000000,
                message: {
                  mid: "mid.123456789",
                  text: "Olá! Gostaria de saber mais sobre o produto.",
                },
              },
            ],
          },
        ],
      };

      const parsed = parseInstagramWebhook(payload);
      expect(parsed).toHaveLength(1);
      const msg = parsed[0]!;
      expect(msg.messageId).toBe("mid.123456789");
      expect(msg.senderId).toBe("987654321");
      expect(msg.recipientId).toBe("17841400000000000");
      expect(msg.text).toBe("Olá! Gostaria de saber mais sobre o produto.");
      expect(msg.isEcho).toBe(false);
      expect(msg.isStoryReply).toBe(false);
    });

    it("faz o parse de anexo de imagem e resposta a Stories", () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "17841400000000000",
            messaging: [
              {
                sender: { id: "987654321" },
                recipient: { id: "17841400000000000" },
                timestamp: 1725450005000,
                message: {
                  mid: "mid.story_987",
                  text: "Que lindo!",
                  story: {
                    url: "https://instagram.com/stories/...",
                  },
                  attachments: [
                    {
                      type: "image",
                      payload: {
                        url: "https://cdn.instagram.com/photo.jpg",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const parsed = parseInstagramWebhook(payload);
      expect(parsed).toHaveLength(1);
      const msg = parsed[0]!;
      expect(msg.messageId).toBe("mid.story_987");
      expect(msg.isStoryReply).toBe(true);
      expect(msg.storyUrl).toBe("https://instagram.com/stories/...");
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0]?.type).toBe("image");
      expect(msg.attachments[0]?.url).toBe("https://cdn.instagram.com/photo.jpg");
    });
  });

  describe("Capacidades e Adapter do Instagram", () => {
    it("resolve channelKindOf como instagram", () => {
      expect(channelKindOf("instagram")).toBe("instagram");
    });

    it("define capacidades oficiais da Meta para Instagram", () => {
      const caps = capabilitiesOf("instagram");
      expect(caps.freeformOutsideWindow).toBe(false); // Janela de 24h
      expect(caps.banRisk).toBe(false); // API Oficial
      expect(caps.requiresTemplates).toBe(false);
    });

    it("resolveRecipient aceita instagramId ou telefone numérico puro", () => {
      expect(
        instagramAdapter.resolveRecipient({
          isGroup: false,
          groupChatId: null,
          phoneNumber: null,
          waIdentity: null,
          instagramId: "9876543210",
        }),
      ).toBe("9876543210");

      expect(
        instagramAdapter.resolveRecipient({
          isGroup: false,
          groupChatId: null,
          phoneNumber: "178414000000000",
          waIdentity: null,
        }),
      ).toBe("178414000000000");

      expect(
        instagramAdapter.resolveRecipient({
          isGroup: false,
          groupChatId: null,
          phoneNumber: null,
          waIdentity: null,
        }),
      ).toBeNull();
    });
  });
});
