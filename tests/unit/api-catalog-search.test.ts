import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { GET as searchCatalog } from "@/app/api/v1/catalog/search/route";

const ORG_ID = "org-test-123";

let mockProducts: Record<string, unknown>[] = [];
let mockRoleOk = true;

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async (_role: string) => {
    if (!mockRoleOk) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ code: "forbidden" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      };
    }
    return {
      ok: true,
      org: { orgId: ORG_ID, role: "agent" },
      user: { id: "user-123" },
    };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "catalog_products") {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, val: unknown) => ({
              eq: (_col2: string, val2: unknown) =>
                Promise.resolve({
                  data: mockProducts.filter(
                    (p) =>
                      p.organization_id === val &&
                      (val2 === undefined || p.ativo === val2),
                  ),
                  error: null,
                }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

describe("GET /api/v1/catalog/search", () => {
  beforeEach(() => {
    mockRoleOk = true;
    mockProducts = [
      {
        id: "prod-1",
        organization_id: ORG_ID,
        codigo: "IP15-128",
        nome: "Apple iPhone 15 128GB Preto",
        descricao: "Smartphone top de linha",
        marca: "Apple",
        categoria: "Smartphones",
        preco_cents: 499900,
        moeda: "BRL",
        custo_cents: 300000,
        controla_estoque: true,
        quantidade: 10,
        ativo: true,
        imagem_url: "https://example.com/ip15-128.jpg",
      },
      {
        id: "prod-2",
        organization_id: ORG_ID,
        codigo: "IP15-256",
        nome: "Apple iPhone 15 256GB Preto",
        descricao: "Smartphone top de linha 256GB",
        marca: "Apple",
        categoria: "Smartphones",
        preco_cents: 579900,
        moeda: "BRL",
        custo_cents: 350000,
        controla_estoque: true,
        quantidade: 0, // sem estoque
        ativo: true,
        imagem_url: "https://example.com/ip15-256.jpg",
      },
      {
        id: "prod-3",
        organization_id: ORG_ID,
        codigo: "FONE-BT",
        nome: "Fone Bluetooth JBL Tune",
        descricao: "Fone sem fio",
        marca: "JBL",
        categoria: "Audio",
        preco_cents: 29900,
        moeda: "BRL",
        custo_cents: 15000,
        controla_estoque: false,
        quantidade: 0, // controla_estoque = false, então disponível!
        ativo: true,
        imagem_url: null,
      },
      {
        id: "prod-inativo",
        organization_id: ORG_ID,
        codigo: "OLD",
        nome: "Produto Inativo",
        descricao: null,
        marca: null,
        categoria: null,
        preco_cents: 1000,
        moeda: "BRL",
        custo_cents: null,
        controla_estoque: false,
        quantidade: 0,
        ativo: false,
        imagem_url: null,
      },
    ];
  });

  it("retorna produtos ativos com preco_formatado e flag disponivel quando sem consulta", async () => {
    const req = new NextRequest("http://localhost/api/v1/catalog/search");
    const res = await searchCatalog(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toBeDefined();
    // Deve excluir inativo
    expect(json.data.length).toBe(3);

    const p128 = json.data.find((p: { codigo: string }) => p.codigo === "IP15-128");
    expect(p128.disponivel).toBe(true);
    expect(p128.preco_formatado).toContain("4.999,00");

    const p256 = json.data.find((p: { codigo: string }) => p.codigo === "IP15-256");
    expect(p256.disponivel).toBe(false); // controla_estoque: true e quantidade: 0
    expect(p256.preco_formatado).toContain("5.799,00");

    const fone = json.data.find((p: { codigo: string }) => p.codigo === "FONE-BT");
    expect(fone.disponivel).toBe(true); // controla_estoque: false
  });

  it("reaproveita a MESMA regra da IA: número elimina variante incompatível ('iphone 15 256gb')", async () => {
    const req = new NextRequest("http://localhost/api/v1/catalog/search?q=iphone+15+256gb");
    const res = await searchCatalog(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].codigo).toBe("IP15-256");
    expect(json.data[0].relevancia).toBeGreaterThan(0);
  });

  it("tolera digitação imprecisa do atendente ('ifone')", async () => {
    const req = new NextRequest("http://localhost/api/v1/catalog/search?q=ifone");
    const res = await searchCatalog(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    // Os iPhones devem ter score maior que Fone Bluetooth
    expect(json.data[0].codigo).toMatch(/^IP15/);
  });

  it("retorna lista vazia quando nenhum produto casa", async () => {
    const req = new NextRequest("http://localhost/api/v1/catalog/search?q=geladeira+inverter");
    const res = await searchCatalog(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toEqual([]);
  });

  it("respeita o parâmetro limite", async () => {
    const req = new NextRequest("http://localhost/api/v1/catalog/search?limite=1");
    const res = await searchCatalog(req);
    const json = await res.json();
    expect(json.data.length).toBe(1);
  });

  it("retorna 403 se a autorização falhar", async () => {
    mockRoleOk = false;
    const req = new NextRequest("http://localhost/api/v1/catalog/search");
    const res = await searchCatalog(req);
    expect(res.status).toBe(403);
  });
});
