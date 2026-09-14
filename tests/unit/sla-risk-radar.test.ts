import { describe, expect, it } from "vitest";
import { classifySlaRisk } from "@/lib/leads/risk-radar";
import type { BusinessHourSlot } from "@/lib/business-hours/types";

const PADRAO_SLOTS: BusinessHourSlot[] = [
  { day_of_week: 0, open_time: "08:00:00", close_time: "18:00:00", is_active: false },
  { day_of_week: 1, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
  { day_of_week: 2, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
  { day_of_week: 3, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
  { day_of_week: 4, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
  { day_of_week: 5, open_time: "08:00:00", close_time: "18:00:00", is_active: true },
  { day_of_week: 6, open_time: "08:00:00", close_time: "18:00:00", is_active: false },
];

const TZ = "America/Sao_Paulo";

describe("lib/leads/risk-radar — classifySlaRisk", () => {
  it("retorna em_dia quando não há meta de prazo", () => {
    const res = classifySlaRisk({
      abertaEm: new Date("2026-09-16T12:00:00Z"),
      now: new Date("2026-09-16T15:00:00Z"),
      prazoMinutos: null,
      isPaused: false,
      totalPausedSeconds: 0,
      slots: PADRAO_SLOTS,
      holidays: [],
      timeZone: TZ,
    });

    expect(res.bucket).toBe("em_dia");
    expect(res.minutosUteisRestantes).toBeNull();
  });

  it("retorna pausado quando demanda está aguardando cliente", () => {
    const res = classifySlaRisk({
      abertaEm: new Date("2026-09-16T12:00:00Z"), // 09:00 BRT
      now: new Date("2026-09-16T16:00:00Z"), // 13:00 BRT (4 horas úteis = 240 min)
      prazoMinutos: 300,
      isPaused: true,
      totalPausedSeconds: 0,
      pausedAt: new Date("2026-09-16T15:00:00Z"), // pausou às 12:00 BRT (1h útil pausada)
      slots: PADRAO_SLOTS,
      holidays: [],
      timeZone: TZ,
    });

    expect(res.bucket).toBe("pausado");
    // 240 min brutos - 60 min pausados = 180 min úteis decorridos
    expect(res.minutosUteisDecorridos).toBe(180);
    expect(res.minutosUteisRestantes).toBe(120);
  });

  it("classifica como em_dia quando tempo consumido < 75%", () => {
    // Aberta 09:00 BRT, agora 10:00 BRT (60 min decorridos). Meta: 120 min.
    // Consumido: 50% (< 75%)
    const res = classifySlaRisk({
      abertaEm: new Date("2026-09-16T12:00:00Z"),
      now: new Date("2026-09-16T13:00:00Z"),
      prazoMinutos: 120,
      isPaused: false,
      totalPausedSeconds: 0,
      slots: PADRAO_SLOTS,
      holidays: [],
      timeZone: TZ,
    });

    expect(res.bucket).toBe("em_dia");
    expect(res.minutosUteisDecorridos).toBe(60);
    expect(res.minutosUteisRestantes).toBe(60);
    expect(res.porcentagemConsumida).toBe(50);
  });

  it("classifica como em_risco quando tempo consumido >= 75% e < 100%", () => {
    // Aberta 09:00 BRT, agora 10:35 BRT (95 min decorridos). Meta: 120 min.
    // Consumido: ~79% (>= 75%)
    const res = classifySlaRisk({
      abertaEm: new Date("2026-09-16T12:00:00Z"),
      now: new Date("2026-09-16T13:35:00Z"),
      prazoMinutos: 120,
      isPaused: false,
      totalPausedSeconds: 0,
      slots: PADRAO_SLOTS,
      holidays: [],
      timeZone: TZ,
    });

    expect(res.bucket).toBe("em_risco");
    expect(res.minutosUteisDecorridos).toBe(95);
    expect(res.minutosUteisRestantes).toBe(25);
    expect(res.porcentagemConsumida).toBe(79);
  });

  it("classifica como violado quando tempo consumido >= 100%", () => {
    // Aberta 09:00 BRT, agora 11:10 BRT (130 min decorridos). Meta: 120 min.
    const res = classifySlaRisk({
      abertaEm: new Date("2026-09-16T12:00:00Z"),
      now: new Date("2026-09-16T14:10:00Z"),
      prazoMinutos: 120,
      isPaused: false,
      totalPausedSeconds: 0,
      slots: PADRAO_SLOTS,
      holidays: [],
      timeZone: TZ,
    });

    expect(res.bucket).toBe("violado");
    expect(res.minutosUteisDecorridos).toBe(130);
    expect(res.minutosUteisRestantes).toBe(0);
    expect(res.porcentagemConsumida).toBe(100);
  });
});
