import { describe, expect, it } from "vitest";

import { crmSearchProducts } from "@/lib/mcp/tools/comercio";
import type { McpContext } from "@/lib/mcp/types";

describe("MCP Tool crm_search_products", () => {
  const mockProducts = [
    {
      id: "prod-1",
      codigo: "IP15-128",
      nome: "Apple iPhone 15 128GB Azul",
      marca: "Apple",
      categoria: "Smartphones",
      preco_cents: 499900,
      moeda: "BRL",
      custo_cents: 350000,
      controla_estoque: true,
      quantidade: 5,
      ativo: true,
      imagem_url: null,
    },
    {
      id: "prod-2",
      codigo: "IP15-256",
      nome: "Apple iPhone 15 256GB Azul",
      marca: "Apple",
      categoria: "Smartphones",
      preco_cents: 579900,
      moeda: "BRL",
      custo_cents: 420000,
      controla_estoque: true,
      quantidade: 0, // Sem estoque
      ativo: true,
      imagem_url: null,
    },
    {
      id: "prod-3",
      codigo: "SERV-GARANTIA",
      nome: "Garantia Estendida iPhone 15",
      marca: "Apple",
      categoria: "Serviços",
      preco_cents: 39900,
      moeda: "BRL",
      custo_cents: null,
      controla_estoque: false, // Não controla estoque
      quantidade: 0,
      ativo: true,
      imagem_url: null,
    },
  ];

  const createMockContext = (products = mockProducts): McpContext => ({
    organizationId: "org-test-123",
    role: "agent",
    actor: {
      type: "user",
      id: "user-123",
      role: "agent",
    },
    apiTokenId: "",
    requestId: "req-123",
    supabase: {
      from: (_table: string) => ({
        select: (_cols: string) => ({
          eq: (_col1: string, _val1: unknown) => ({
            eq: (_col2: string, _val2: unknown) => Promise.resolve({
              data: products,
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as McpContext["supabase"],
  });

  it("exclui item com controla_estoque = true e quantidade = 0 quando somente_disponiveis = true", async () => {
    const ctx = createMockContext();
    const res = (await crmSearchProducts.handler(
      { termo: "iphone 15", somente_disponiveis: true, limite: 10 },
      ctx,
    )) as { produtos: Array<{ codigo: string }>; empate?: boolean; instrucao?: string };

    const codigos = res.produtos.map((p) => p.codigo);
    expect(codigos).toContain("IP15-128");
    expect(codigos).not.toContain("IP15-256"); // sem estoque
    expect(codigos).toContain("SERV-GARANTIA"); // controla_estoque = false deve aparecer
  });

  it("identifica empate entre duas variantes com a mesma nota e instrui perguntar ao cliente", async () => {
    const variantes = [
      {
        id: "prod-azul",
        codigo: "IP15-AZUL",
        nome: "Apple iPhone 15 128GB Azul Titânio",
        marca: "Apple",
        categoria: "Smartphones",
        preco_cents: 499900,
        moeda: "BRL",
        custo_cents: null,
        controla_estoque: true,
        quantidade: 3,
        ativo: true,
        imagem_url: null,
      },
      {
        id: "prod-preto",
        codigo: "IP15-PRETO",
        nome: "Apple iPhone 15 128GB Preto Titânio",
        marca: "Apple",
        categoria: "Smartphones",
        preco_cents: 499900,
        moeda: "BRL",
        custo_cents: null,
        controla_estoque: true,
        quantidade: 2,
        ativo: true,
        imagem_url: null,
      },
    ];

    const ctx = createMockContext(variantes);
    const res = (await crmSearchProducts.handler(
      { termo: "iphone 15 128gb titânio", somente_disponiveis: true, limite: 10 },
      ctx,
    )) as { produtos: Array<{ codigo: string }>; empate?: boolean; instrucao?: string };

    expect(res.empate).toBe(true);
    expect(res.instrucao).toContain("NUNCA escolha sozinho");
  });

  it("retorna instrução explícita de não inventar preço quando nada for encontrado", async () => {
    const ctx = createMockContext();
    const res = (await crmSearchProducts.handler(
      { termo: "geladeira frost free", somente_disponiveis: true, limite: 10 },
      ctx,
    )) as { produtos: Array<{ codigo: string }>; empate?: boolean; instrucao?: string };

    expect(res.produtos).toHaveLength(0);
    expect(res.instrucao).toContain("invente preços");
  });
});
