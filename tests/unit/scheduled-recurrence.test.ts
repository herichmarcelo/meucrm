import { describe, it, expect } from "vitest";
import { addDays } from "date-fns";
import { calcularOcorrenciasRecorrentes } from "@/lib/inbox/scheduled-recurrence";

describe("calcularOcorrenciasRecorrentes", () => {
  it("retorna array vazio se nenhum dia for selecionado", () => {
    const res = calcularOcorrenciasRecorrentes({
      diasDaSemana: [],
      horario: "09:00",
    });
    expect(res).toEqual([]);
  });

  it("calcula ocorrências para 'todos os dias' nos próximos 7 dias", () => {
    // Começando de amanhã para garantir que todos os horários estão no futuro
    const amanha = addDays(new Date(), 1);
    const res = calcularOcorrenciasRecorrentes({
      diasDaSemana: [0, 1, 2, 3, 4, 5, 6],
      horario: "10:00",
      dataInicio: amanha,
      duracaoDias: 6, // 7 dias no total (amanhã até amanhã + 6)
    });

    expect(res.length).toBe(7);
    for (const d of res) {
      expect(d.getHours()).toBe(10);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it("calcula apenas dias úteis (Segunda a Sexta)", () => {
    const amanha = addDays(new Date(), 1);
    const res = calcularOcorrenciasRecorrentes({
      diasDaSemana: [1, 2, 3, 4, 5], // Seg a Sex
      horario: "14:30",
      dataInicio: amanha,
      duracaoDias: 14,
    });

    for (const d of res) {
      const day = d.getDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
      expect(d.getHours()).toBe(14);
      expect(d.getMinutes()).toBe(30);
    }
  });

  it("não inclui horários que já passaram no dia de hoje", () => {
    // Horário das 00:01 de hoje certamente já passou
    const hoje = new Date();
    const res = calcularOcorrenciasRecorrentes({
      diasDaSemana: [hoje.getDay()],
      horario: "00:01",
      dataInicio: hoje,
      duracaoDias: 0, // Apenas hoje
    });

    expect(res.length).toBe(0);
  });
});
