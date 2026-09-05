import { describe, expect, it } from "vitest";

import { precoParaCentavos } from "@/lib/schemas/produtos";

describe("precoParaCentavos (parser de preço em planilha suja)", () => {
  it("converte formatos válidos com vírgula e ponto para centavos", () => {
    expect(precoParaCentavos("5.499,00")).toBe(549900);
    expect(precoParaCentavos("R$ 5.499,00")).toBe(549900);
    expect(precoParaCentavos("  r$  120,50  ")).toBe(12050);
    expect(precoParaCentavos("BRL 99,90")).toBe(9990);
    expect(precoParaCentavos("USD 100.50")).toBe(10050);
    expect(precoParaCentavos("5499.00")).toBe(549900);
    expect(precoParaCentavos("5499")).toBe(549900);
    expect(precoParaCentavos("1.234.567,89")).toBe(123456789);
    expect(precoParaCentavos("0,50")).toBe(50);
    expect(precoParaCentavos("0.99")).toBe(99);
  });

  it("rejeita observações coladas a números para evitar concatenação indevida", () => {
    // "R$ 5.499,00 (promo até 10)" não deve virar 54990010
    expect(precoParaCentavos("R$ 5.499,00 (promo até 10)")).toBeNull();
    expect(precoParaCentavos("10,00 un")).toBeNull();
    expect(precoParaCentavos("15,00 cada")).toBeNull();
    expect(precoParaCentavos("50 a 100")).toBeNull();
    expect(precoParaCentavos("R$ 200,00 - à vista")).toBeNull();
  });

  it("recusa entradas vazias, negativas ou inválidas", () => {
    expect(precoParaCentavos("")).toBeNull();
    expect(precoParaCentavos("   ")).toBeNull();
    expect(precoParaCentavos("-50,00")).toBeNull();
    expect(precoParaCentavos("abc")).toBeNull();
    expect(precoParaCentavos("R$")).toBeNull();
    expect(precoParaCentavos(null as unknown as string)).toBeNull();
    expect(precoParaCentavos(undefined as unknown as string)).toBeNull();
  });
});
