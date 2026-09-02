import { describe, expect, it } from "vitest";
import {
  capabilitiesOf,
  CHANNEL_PROVIDER_GOWA,
  CHANNEL_PROVIDER_WAHA,
} from "@/lib/channels/capabilities";

describe("capabilitiesOf - GOWA", () => {
  it("retorna capacidades corretas para provider gowa", () => {
    const caps = capabilitiesOf(CHANNEL_PROVIDER_GOWA);

    expect(caps.freeformOutsideWindow).toBe(true);
    expect(caps.requiresTemplates).toBe(false);
    expect(caps.canManageTemplates).toBe(false);
    expect(caps.banRisk).toBe(true);
    expect(caps.minIntervalMs).toBeNull();
    expect(caps.voiceNote).toBe("server-convert");
    expect(caps.groups).toBe("full");
    expect(caps.costPerMessage).toBe(false);
  });

  it("gowa e waha compartilham natureza de sessão não oficial", () => {
    const gowaCaps = capabilitiesOf(CHANNEL_PROVIDER_GOWA);
    const wahaCaps = capabilitiesOf(CHANNEL_PROVIDER_WAHA);

    expect(gowaCaps.freeformOutsideWindow).toBe(wahaCaps.freeformOutsideWindow);
    expect(gowaCaps.requiresTemplates).toBe(wahaCaps.requiresTemplates);
    expect(gowaCaps.banRisk).toBe(wahaCaps.banRisk);
    expect(gowaCaps.voiceNote).toBe(wahaCaps.voiceNote);
    expect(gowaCaps.groups).toBe(wahaCaps.groups);
    expect(gowaCaps.costPerMessage).toBe(wahaCaps.costPerMessage);
  });
});
