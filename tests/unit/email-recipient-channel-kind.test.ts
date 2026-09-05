import { describe, expect, it } from "vitest";
import {
  CHANNEL_KIND,
  channelKindOf,
  type ChannelKind,
  type ChannelProvider,
  type RecipientInput,
} from "@/lib/channels";
import { normalizeEmailAddress } from "@/lib/channels/adapters/email";

describe("Etapa 1 · Generalização de destinatário e ChannelKind", () => {
  it("CHANNEL_KIND mapeia todos os provedores para o kind correspondente", () => {
    const providers: ChannelProvider[] = ["waha", "meta_cloud", "zernio", "gowa", "email"];
    for (const p of providers) {
      expect(CHANNEL_KIND).toHaveProperty(p);
    }
    expect(CHANNEL_KIND.waha).toBe("whatsapp");
    expect(CHANNEL_KIND.meta_cloud).toBe("whatsapp");
    expect(CHANNEL_KIND.zernio).toBe("whatsapp");
    expect(CHANNEL_KIND.gowa).toBe("whatsapp");
    expect(CHANNEL_KIND.email).toBe("email");
  });

  it("channelKindOf retorna 'whatsapp' por default para null/undefined/desconhecido", () => {
    expect(channelKindOf(null)).toBe("whatsapp");
    expect(channelKindOf(undefined)).toBe("whatsapp");
    expect(channelKindOf("waha")).toBe("whatsapp");
    expect(channelKindOf("meta_cloud")).toBe("whatsapp");
    expect(channelKindOf("zernio")).toBe("whatsapp");
    expect(channelKindOf("gowa")).toBe("whatsapp");
    expect(channelKindOf("email")).toBe("email");
  });

  it("RecipientInput aceita email opcional de forma retrocompatível com campos de WhatsApp", () => {
    const waInput: RecipientInput = {
      isGroup: false,
      groupChatId: null,
      phoneNumber: "+5511999999999",
      waIdentity: "phone:+5511999999999",
      waLid: null,
    };
    expect(waInput.phoneNumber).toBe("+5511999999999");
    expect(waInput.email).toBeUndefined();

    const emailInput: RecipientInput = {
      isGroup: false,
      groupChatId: null,
      phoneNumber: null,
      waIdentity: null,
      email: "cliente@exemplo.com.br",
    };
    expect(emailInput.email).toBe("cliente@exemplo.com.br");
  });

  it("normalizeEmailAddress valida e normaliza e-mails corretamente", () => {
    expect(normalizeEmailAddress("  contato@empresa.com.br  ")).toBe("contato@empresa.com.br");
    expect(normalizeEmailAddress("USER@DOMINIO.COM")).toBe("user@dominio.com");
    expect(normalizeEmailAddress("invalido")).toBeNull();
    expect(normalizeEmailAddress("")).toBeNull();
    expect(normalizeEmailAddress(null)).toBeNull();
    expect(normalizeEmailAddress(undefined)).toBeNull();
    expect(normalizeEmailAddress("sem_arroba.com")).toBeNull();
    expect(normalizeEmailAddress("@sem_usuario.com")).toBeNull();
  });
});
