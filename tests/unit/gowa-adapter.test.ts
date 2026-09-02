import { describe, expect, it, vi, beforeEach } from "vitest";
import { gowaAdapter } from "@/lib/channels/adapters/gowa";
import * as gowaClientModule from "@/lib/gowa/client";

describe("gowaAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolveRecipient formata número para @s.whatsapp.net", () => {
    expect(
      gowaAdapter.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: "5511999999999",
        waIdentity: "phone:+5511999999999",
      }),
    ).toBe("5511999999999@s.whatsapp.net");
  });

  it("echoExternalIds gera par com bare e raw id", () => {
    if (!gowaAdapter.echoExternalIds) {
      throw new Error("echoExternalIds must be defined on gowaAdapter");
    }

    const ids = gowaAdapter.echoExternalIds({
      externalId: "true_5511999999999@s.whatsapp.net_3EB0123",
      recipient: "5511999999999@s.whatsapp.net",
    });

    expect(ids).toContain("true_5511999999999@s.whatsapp.net_3EB0123");
    expect(ids).toContain("3EB0123");
  });

  it("send envia texto com sucesso", async () => {
    const mockSendText = vi.fn().mockResolvedValue({
      externalId: "MSG_GOWA_123",
      raw: { message_id: "MSG_GOWA_123" },
    });

    vi.spyOn(gowaClientModule, "getGowaClient").mockReturnValue({
      sendText: mockSendText,
    } as unknown as gowaClientModule.GowaClient);

    const res = await gowaAdapter.send({
      organizationId: "org_1",
      sessionRef: "device_org_1",
      to: "5511999999999@s.whatsapp.net",
      kind: "text",
      body: "Olá do GOWA",
    });

    expect(res.externalId).toBe("MSG_GOWA_123");
    expect(mockSendText).toHaveBeenCalledWith(
      "device_org_1",
      "5511999999999@s.whatsapp.net",
      "Olá do GOWA",
      undefined,
    );
  });

  it("checkHealth mapeia status WORKING quando conectado e logado", async () => {
    if (!gowaAdapter.checkHealth) {
      throw new Error("checkHealth must be defined on gowaAdapter");
    }

    const mockGetStatus = vi.fn().mockResolvedValue({
      isConnected: true,
      isLoggedIn: true,
      jid: "5511999999999@s.whatsapp.net",
    });

    vi.spyOn(gowaClientModule, "getGowaClient").mockReturnValue({
      getDeviceStatus: mockGetStatus,
    } as unknown as gowaClientModule.GowaClient);

    const health = await gowaAdapter.checkHealth({
      organizationId: "org_1",
      sessionRef: "device_org_1",
    });

    expect(health.reachable).toBe(true);
    expect(health.status).toBe("WORKING");
    expect(health.detail).toBeNull();
  });
});
