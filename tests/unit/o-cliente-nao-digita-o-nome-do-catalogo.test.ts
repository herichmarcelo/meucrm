import { describe, expect, it } from "vitest";

import {
  normalizar,
  ordenarPorRelevancia,
  pontuar,
  tokenizar,
  type ProdutoBuscavel,
} from "@/lib/catalogo/busca";

describe("Busca por token no catálogo de produtos", () => {
  it("normaliza acentos, maiúsculas e pontuação", () => {
    expect(normalizar("  iPhone 15 Pro Max — 256GB, Cor: Azul! ")).toBe(
      "iphone 15 pro max 256gb cor azul",
    );
    expect(normalizar("Promoção de Verão / Água mineral 500ml")).toBe(
      "promocao de verao agua mineral 500ml",
    );
  });

  it("separa palavras e números isolando unidades e descartando ruído", () => {
    const tokens = tokenizar("iPhone de 256gb com capa para o modelo 15");
    expect(tokens.palavras).toEqual(["iphone", "capa", "modelo"]);
    expect(tokens.numeros).toEqual(["256", "15"]);
  });

  it("número mencionado pelo cliente que o produto não possui ELIMINA o produto", () => {
    const p128: ProdutoBuscavel = {
      codigo: "IP15-128",
      nome: "Apple iPhone 15 128GB Preto",
      marca: "Apple",
      categoria: "Smartphones",
    };
    const p256: ProdutoBuscavel = {
      codigo: "IP15-256",
      nome: "Apple iPhone 15 256GB Preto",
      marca: "Apple",
      categoria: "Smartphones",
    };

    const tokens = tokenizar("iphone 15 256gb");
    expect(pontuar(p128, tokens)).toBeNull();
    expect(pontuar(p256, tokens)).not.toBeNull();
  });

  it("'ifone' prefere iPhone a Fone Bluetooth", () => {
    const iphone: ProdutoBuscavel = {
      codigo: "IP15",
      nome: "Smartphone Apple iPhone 15",
      marca: "Apple",
    };
    const foneBluetooth: ProdutoBuscavel = {
      codigo: "FONE-BT",
      nome: "Fone Bluetooth JBL Tune",
      marca: "JBL",
    };

    const achados = ordenarPorRelevancia([foneBluetooth, iphone], "ifone");
    expect(achados.length).toBeGreaterThan(0);
    expect(achados[0]?.produto.codigo).toBe("IP15");
  });

  it("número não casa com sufixo ou prefixo numérico maior (ex: 15 não casa com 153ml)", () => {
    const shampoo: ProdutoBuscavel = {
      codigo: "SH-153",
      nome: "Shampoo Hidratante 153ml",
    };
    const tokens = tokenizar("shampoo 15");
    expect(pontuar(shampoo, tokens)).toBeNull();
  });

  it("preserva empate na pontuação entre variantes idênticas", () => {
    const p1: ProdutoBuscavel = {
      codigo: "IP15-P-AZUL",
      nome: "Apple iPhone 15 Pro 128GB Azul Titânio",
    };
    const p2: ProdutoBuscavel = {
      codigo: "IP15-P-PRETO",
      nome: "Apple iPhone 15 Pro 128GB Preto Titânio",
    };

    const achados = ordenarPorRelevancia([p1, p2], "iphone 15 pro 128gb titânio");
    expect(achados).toHaveLength(2);
    expect(achados[0]?.nota).toBe(achados[1]?.nota);
  });

  it("retorna lista vazia para consulta sem tokens", () => {
    const p: ProdutoBuscavel = {
      codigo: "1",
      nome: "Camisa Polo",
    };
    expect(ordenarPorRelevancia([p], "   de do da   ")).toEqual([]);
  });
});
