import { describe, expect, it } from "vitest";
import {
  adicionarMinutosUteis,
  calcularMinutosUteis,
  isExpedienteAtivo,
} from "@/lib/business-hours/calc-business-time";
import type { BusinessHourSlot } from "@/lib/business-hours/types";

// Segunda a Sexta das 08:00 às 18:00 (10 horas / 600 minutos por dia útil)
// Sábado (6) e Domingo (0) inativos
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

describe("lib/business-hours/calc-business-time", () => {
  describe("isExpedienteAtivo", () => {
    it("deve retornar true em horário comercial de dia útil", () => {
      // 2026-09-16 é Quarta-feira, 10:00 no Brasil (13:00 UTC)
      const data = new Date("2026-09-16T13:00:00Z");
      expect(isExpedienteAtivo(data, PADRAO_SLOTS, [], TZ)).toBe(true);
    });

    it("deve retornar false antes do início do expediente", () => {
      // Quarta-feira 07:30 no Brasil (10:30 UTC)
      const data = new Date("2026-09-16T10:30:00Z");
      expect(isExpedienteAtivo(data, PADRAO_SLOTS, [], TZ)).toBe(false);
    });

    it("deve retornar false após o fim do expediente", () => {
      // Quarta-feira 18:30 no Brasil (21:30 UTC)
      const data = new Date("2026-09-16T21:30:00Z");
      expect(isExpedienteAtivo(data, PADRAO_SLOTS, [], TZ)).toBe(false);
    });

    it("deve retornar false em final de semana", () => {
      // 2026-09-19 é Sábado, 12:00 no Brasil (15:00 UTC)
      const data = new Date("2026-09-19T15:00:00Z");
      expect(isExpedienteAtivo(data, PADRAO_SLOTS, [], TZ)).toBe(false);
    });

    it("deve retornar false em feriado mesmo em dia e hora comercial", () => {
      // Quarta-feira 10:00 no Brasil (13:00 UTC), mas marcado como feriado
      const data = new Date("2026-09-16T13:00:00Z");
      expect(isExpedienteAtivo(data, PADRAO_SLOTS, ["2026-09-16"], TZ)).toBe(false);
    });
  });

  describe("calcularMinutosUteis", () => {
    it("deve retornar 0 se fim <= inicio", () => {
      const d1 = new Date("2026-09-16T13:00:00Z");
      const d2 = new Date("2026-09-16T12:00:00Z");
      expect(calcularMinutosUteis(d1, d2, PADRAO_SLOTS, [], TZ)).toBe(0);
      expect(calcularMinutosUteis(d1, d1, PADRAO_SLOTS, [], TZ)).toBe(0);
    });

    it("calcula minutos dentro do mesmo dia", () => {
      // Quarta-feira das 09:00 às 11:30 no Brasil (150 minutos úteis)
      const inicio = new Date("2026-09-16T12:00:00Z"); // 09:00 BRT
      const fim = new Date("2026-09-16T14:30:00Z"); // 11:30 BRT
      expect(calcularMinutosUteis(inicio, fim, PADRAO_SLOTS, [], TZ)).toBe(150);
    });

    it("corta horário antes da abertura e após o fechamento", () => {
      // Quarta-feira das 06:00 às 20:00 no Brasil (expediente é 08:00 às 18:00 = 600 min)
      const inicio = new Date("2026-09-16T09:00:00Z"); // 06:00 BRT
      const fim = new Date("2026-09-16T23:00:00Z"); // 20:00 BRT
      expect(calcularMinutosUteis(inicio, fim, PADRAO_SLOTS, [], TZ)).toBe(600);
    });

    it("calcula minutos cruzando a noite entre dias úteis consecutivos", () => {
      // Quarta 16:00 BRT até Quinta 10:00 BRT
      // Quarta: 16:00 às 18:00 = 120 min
      // Quinta: 08:00 às 10:00 = 120 min
      // Total = 240 minutos úteis
      const inicio = new Date("2026-09-16T19:00:00Z"); // Qua 16:00 BRT
      const fim = new Date("2026-09-17T13:00:00Z"); // Qui 10:00 BRT
      expect(calcularMinutosUteis(inicio, fim, PADRAO_SLOTS, [], TZ)).toBe(240);
    });

    it("ignora completamente o fim de semana", () => {
      // Sexta 16:00 BRT até Segunda 10:00 BRT
      // Sexta: 16:00 às 18:00 = 120 min
      // Sábado + Domingo: 0 min
      // Segunda: 08:00 às 10:00 = 120 min
      // Total = 240 minutos úteis (4h úteis)
      const inicio = new Date("2026-09-18T19:00:00Z"); // Sex 16:00 BRT
      const fim = new Date("2026-09-21T13:00:00Z"); // Seg 10:00 BRT
      expect(calcularMinutosUteis(inicio, fim, PADRAO_SLOTS, [], TZ)).toBe(240);
    });

    it("calcula corretamente na virada de sexta 17h50 até segunda 08h30 (descontando fim de semana)", () => {
      // Sexta 17:50 BRT (20:50 UTC) até Segunda 08:30 BRT (11:30 UTC)
      // Sexta: 17:50 às 18:00 = 10 min
      // Sábado + Domingo: 0 min
      // Segunda: 08:00 às 08:30 = 30 min
      // Total útil = 40 minutos (enquanto corrido são 3760 minutos / ~62.6 horas)
      const inicio = new Date("2026-09-18T20:50:00Z"); // Sex 17:50 BRT
      const fim = new Date("2026-09-21T11:30:00Z"); // Seg 08:30 BRT
      expect(calcularMinutosUteis(inicio, fim, PADRAO_SLOTS, [], TZ)).toBe(40);
    });

    it("ignora dias marcados como feriado", () => {
      // Quarta 16:00 BRT até Sexta 10:00 BRT, com Quinta (2026-09-17) sendo feriado
      // Quarta: 120 min
      // Quinta (feriado): 0 min
      // Sexta: 120 min
      // Total = 240 minutos úteis
      const inicio = new Date("2026-09-16T19:00:00Z"); // Qua 16:00 BRT
      const fim = new Date("2026-09-18T13:00:00Z"); // Sex 10:00 BRT
      const feriados = ["2026-09-17"];
      expect(calcularMinutosUteis(inicio, fim, PADRAO_SLOTS, feriados, TZ)).toBe(240);
    });
  });

  describe("adicionarMinutosUteis", () => {
    it("adiciona tempo no mesmo dia útil", () => {
      // Quarta 09:00 BRT + 120 min -> Quarta 11:00 BRT
      const inicio = new Date("2026-09-16T12:00:00Z"); // 09:00 BRT
      const resultado = adicionarMinutosUteis(inicio, 120, PADRAO_SLOTS, [], TZ);
      expect(resultado.toISOString()).toBe("2026-09-16T14:00:00.000Z"); // 11:00 BRT
    });

    it("projeta prazo pulando a noite para o dia seguinte", () => {
      // Quarta 16:00 BRT + 180 min (3 horas úteis)
      // Quarta consome 2 horas (até 18:00). Resta 1 hora.
      // Quinta abre 08:00 + 1 hora -> Quinta 09:00 BRT
      const inicio = new Date("2026-09-16T19:00:00Z"); // Qua 16:00 BRT
      const resultado = adicionarMinutosUteis(inicio, 180, PADRAO_SLOTS, [], TZ);
      expect(resultado.toISOString()).toBe("2026-09-17T12:00:00.000Z"); // Qui 09:00 BRT
    });

    it("projeta prazo pulando final de semana", () => {
      // Sexta 16:00 BRT + 240 min (4 horas úteis)
      // Sexta consome 2 horas (até 18:00). Restam 2 horas.
      // Sábado e Domingo pulados.
      // Segunda abre 08:00 + 2 horas -> Segunda 10:00 BRT
      const inicio = new Date("2026-09-18T19:00:00Z"); // Sex 16:00 BRT
      const resultado = adicionarMinutosUteis(inicio, 240, PADRAO_SLOTS, [], TZ);
      expect(resultado.toISOString()).toBe("2026-09-21T13:00:00.000Z"); // Seg 10:00 BRT
    });

    it("inicia contagem no início do expediente se data inicial for no fim de semana", () => {
      // Domingo 20:00 BRT + 120 min (2 horas úteis)
      // Inicia Segunda às 08:00 + 2h -> Segunda 10:00 BRT
      const inicio = new Date("2026-09-20T23:00:00Z"); // Dom 20:00 BRT
      const resultado = adicionarMinutosUteis(inicio, 120, PADRAO_SLOTS, [], TZ);
      expect(resultado.toISOString()).toBe("2026-09-21T13:00:00.000Z"); // Seg 10:00 BRT
    });
  });
});
