import { describe, expect, it } from "vitest";
import { formatarHora, formatarDataHora, formatarData } from "@/lib/tempo/formato";
import { profileSchema } from "@/lib/schemas/settings";

describe("formatarHora - funções puras de formatação de hora", () => {
  it("formata 24h no fuso padrão (America/Sao_Paulo)", () => {
    // 2026-09-02T17:30:00Z em UTC = 14:30 em UTC-3
    const utcDate = new Date("2026-09-02T17:30:00Z");
    const hora = formatarHora(utcDate, { timezone: "America/Sao_Paulo", timeFormat: "24h" });
    expect(hora).toBe("14:30");
  });

  it("formata fuso America/Campo_Grande (UTC-4)", () => {
    // 2026-09-02T17:30:00Z em UTC = 13:30 em Campo Grande (UTC-4)
    const utcDate = new Date("2026-09-02T17:30:00Z");
    const hora = formatarHora(utcDate, { timezone: "America/Campo_Grande", timeFormat: "24h" });
    expect(hora).toBe("13:30");
  });

  it("formata 12h com sufixo AM/PM em America/Sao_Paulo", () => {
    // 2026-09-02T17:30:00Z em UTC = 02:30 PM em UTC-3
    const utcDate = new Date("2026-09-02T17:30:00Z");
    const hora = formatarHora(utcDate, { timezone: "America/Sao_Paulo", timeFormat: "12h" });
    // Em pt-BR ou en-US com 12h, inclui PM ou p.m.
    expect(hora.toLowerCase()).toMatch(/02:30|2:30/);
    expect(hora.toLowerCase()).toMatch(/pm|p\.m\./);
  });

  it("formata 12h pela manhã (AM)", () => {
    // 2026-09-02T12:15:00Z em UTC = 09:15 AM em UTC-3
    const utcDate = new Date("2026-09-02T12:15:00Z");
    const hora = formatarHora(utcDate, { timezone: "America/Sao_Paulo", timeFormat: "12h" });
    expect(hora.toLowerCase()).toMatch(/09:15|9:15/);
    expect(hora.toLowerCase()).toMatch(/am|a\.m\./);
  });

  it("devolve string vazia para data inválida sem quebrar", () => {
    expect(formatarHora("data-invalida")).toBe("");
    expect(formatarHora(NaN)).toBe("");
  });
});

describe("formatarDataHora - data e hora combinadas", () => {
  it("formata data e hora em 24h", () => {
    const utcDate = new Date("2026-09-02T17:30:00Z");
    const res = formatarDataHora(utcDate, { timezone: "America/Sao_Paulo", timeFormat: "24h" });
    expect(res).toContain("02/09/2026");
    expect(res).toContain("14:30");
  });

  it("formata data e hora em 12h", () => {
    const utcDate = new Date("2026-09-02T17:30:00Z");
    const res = formatarDataHora(utcDate, { timezone: "America/Sao_Paulo", timeFormat: "12h" });
    expect(res).toContain("02/09/2026");
    expect(res.toLowerCase()).toMatch(/pm|p\.m\./);
  });
});

describe("formatarData - data pura", () => {
  it("formata data no formato brasileiro dd/MM/yyyy", () => {
    const utcDate = new Date("2026-09-02T17:30:00Z");
    const res = formatarData(utcDate, { timezone: "America/Sao_Paulo" });
    expect(res).toBe("02/09/2026");
  });
});

describe("profileSchema - validação de time_format", () => {
  it("aceita 24h e 12h", () => {
    const r24 = profileSchema.safeParse({
      locale: "pt-BR",
      timezone: "America/Campo_Grande",
      time_format: "24h",
    });
    expect(r24.success).toBe(true);
    if (r24.success) {
      expect(r24.data.time_format).toBe("24h");
      expect(r24.data.timezone).toBe("America/Campo_Grande");
    }

    const r12 = profileSchema.safeParse({
      locale: "pt-BR",
      timezone: "America/Campo_Grande",
      time_format: "12h",
    });
    expect(r12.success).toBe(true);
    if (r12.success) {
      expect(r12.data.time_format).toBe("12h");
    }
  });

  it("cai no padrão 24h se omitido", () => {
    const r = profileSchema.safeParse({
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.time_format).toBe("24h");
    }
  });

  it("rejeita formatos de hora desconhecidos", () => {
    const r = profileSchema.safeParse({
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
      time_format: "48h",
    });
    expect(r.success).toBe(false);
  });
});
