import { describe, expect, it } from "vitest";
import { renderScheduledPlaceholders } from "@/lib/inbox/scheduled-placeholders";

describe("renderScheduledPlaceholders — Interpolação de Mensagens Agendadas", () => {
  it("interpola {nome}, {data}, {hora}, {hoje}, {amanha} corretamente", () => {
    const dataFixa = new Date("2026-09-02T14:30:00.000Z");
    const texto = "Olá {nome}, confirmamos seu agendamento no dia {data} às {hora}. Hoje é {hoje} e amanhã será {amanha}.";

    const resultado = renderScheduledPlaceholders(texto, {
      nome: "Carlos Eduardo",
      dataHoraEnvio: dataFixa,
    });

    expect(resultado).toContain("Olá Carlos Eduardo");
    expect(resultado).toMatch(/\d{2}\/\d{2}\/2026/);
    expect(resultado).toMatch(/\d{2}:\d{2}/);
  });

  it("suporta sintaxe com chaves duplas {{nome}} e {{primeiro_nome}}", () => {
    const dataFixa = new Date("2026-09-02T14:30:00.000Z");
    const texto = "Olá {{primeiro_nome}}, sua consulta está marcada para {{data}}.";

    const resultado = renderScheduledPlaceholders(texto, {
      nome: "Mariana Silva",
      dataHoraEnvio: dataFixa,
    });

    expect(resultado).toContain("Olá Mariana, sua consulta está marcada para");
  });

  it("utiliza fallback 'Cliente' se o nome for nulo ou vazio", () => {
    const texto = "Olá {nome}, seu pedido está pronto.";
    const res1 = renderScheduledPlaceholders(texto, { nome: null });
    const res2 = renderScheduledPlaceholders(texto, { nome: "   " });

    expect(res1).toBe("Olá Cliente, seu pedido está pronto.");
    expect(res2).toBe("Olá Cliente, seu pedido está pronto.");
  });

  it("preserva placeholders desconhecidos sem quebrar o texto", () => {
    const texto = "Olá {nome}, seu código é {codigo_promocional} e seu status é {status_inexistente}.";
    const resultado = renderScheduledPlaceholders(texto, { nome: "Ana" });

    expect(resultado).toBe("Olá Ana, seu código é {codigo_promocional} e seu status é {status_inexistente}.");
  });

  it("retorna string vazia se o corpo for vazio", () => {
    expect(renderScheduledPlaceholders("", { nome: "Ana" })).toBe("");
  });
});
