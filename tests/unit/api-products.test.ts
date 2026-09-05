import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { GET as listProducts, POST as createProduct } from "@/app/api/v1/products/route";
import {
  GET as getProduct,
  PATCH as patchProduct,
  DELETE as deleteProduct,
} from "@/app/api/v1/products/[id]/route";

const ORG_ID = "org-test-123";
const USER_ID = "user-test-123";
const PROD_ID = "prod-test-123";

let mockProducts: Record<string, unknown>[] = [];
let mockAuditEntries: Record<string, unknown>[] = [];

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async (_role: string) => ({
    ok: true,
    org: { orgId: ORG_ID, role: "manager" },
    user: { id: USER_ID },
  }),
}));

vi.mock("@/lib/audit", () => ({
  audit: async (entry: Record<string, unknown>) => {
    mockAuditEntries.push(entry);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "catalog_products") {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, val: unknown) => ({
              eq: (_col2: string, val2: unknown) => ({
                order: async () => ({
                  data: mockProducts.filter((p) => p.organization_id === val && (val2 === undefined || p.ativo === val2)),
                  error: null,
                }),
                maybeSingle: async () => {
                  const item = mockProducts.find((p) => p.id === val && p.organization_id === val2);
                  return { data: item ?? null, error: null };
                },
              }),
              or: () => ({
                order: async () => ({
                  data: mockProducts.filter((p) => p.organization_id === val),
                  error: null,
                }),
              }),
              order: async () => ({
                data: mockProducts.filter((p) => p.organization_id === val),
                error: null,
              }),
            }),
          }),
          insert: (data: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                if (mockProducts.some((p) => p.organization_id === data.organization_id && p.codigo === data.codigo)) {
                  return { data: null, error: { code: "23505", message: "duplicate key" } };
                }
                const newRow = { id: PROD_ID, ...data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
                mockProducts.push(newRow);
                return { data: newRow, error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: (col1: string, val1: unknown) => ({
              eq: (_col2: string, val2: unknown) => ({
                select: () => ({
                  maybeSingle: async () => {
                    const idx = mockProducts.findIndex((p) => p.id === val1 && p.organization_id === val2);
                    if (idx === -1) return { data: null, error: null };
                    if (patch.codigo && mockProducts.some((p, i) => i !== idx && p.organization_id === val2 && p.codigo === patch.codigo)) {
                      return { data: null, error: { code: "23505", message: "duplicate key" } };
                    }
                    mockProducts[idx] = { ...mockProducts[idx], ...patch, updated_at: new Date().toISOString() };
                    return { data: mockProducts[idx], error: null };
                  },
                }),
              }),
            }),
          }),
          delete: () => ({
            eq: (col1: string, val1: unknown) => ({
              eq: (_col2: string, val2: unknown) => {
                const idx = mockProducts.findIndex((p) => p.id === val1 && p.organization_id === val2);
                if (idx !== -1) mockProducts.splice(idx, 1);
                return { error: null };
              },
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

describe("API v1 Products Route Handlers", () => {
  beforeEach(() => {
    mockProducts = [
      {
        id: PROD_ID,
        organization_id: ORG_ID,
        codigo: "SKU-001",
        nome: "Produto Teste",
        preco_cents: 9990,
        moeda: "BRL",
        controla_estoque: true,
        quantidade: 10,
        ativo: true,
        origem: "manual",
      },
    ];
    mockAuditEntries = [];
  });

  it("GET /api/v1/products lista produtos da organização", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/products");
    const res = await listProducts(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].codigo).toBe("SKU-001");
  });

  it("POST /api/v1/products cria produto e registra auditoria", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/products", {
      method: "POST",
      body: JSON.stringify({
        codigo: "SKU-002",
        nome: "Novo Produto",
        preco_cents: 15000,
        controla_estoque: false,
      }),
    });
    const res = await createProduct(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.nome).toBe("Novo Produto");
    expect(mockAuditEntries.some((a) => a.action === "catalog_product.created")).toBe(true);
  });

  it("POST /api/v1/products retorna 409 em SKU duplicado", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/products", {
      method: "POST",
      body: JSON.stringify({
        codigo: "SKU-001",
        nome: "Produto Duplicado",
        preco_cents: 15000,
      }),
    });
    const res = await createProduct(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("conflict");
  });

  it("GET /api/v1/products/[id] retorna produto específico", async () => {
    const req = new NextRequest(`http://localhost:3000/api/v1/products/${PROD_ID}`);
    const res = await getProduct(req, { params: Promise.resolve({ id: PROD_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(PROD_ID);
  });

  it("PATCH /api/v1/products/[id] atualiza produto", async () => {
    const req = new NextRequest(`http://localhost:3000/api/v1/products/${PROD_ID}`, {
      method: "PATCH",
      body: JSON.stringify({
        preco_cents: 10990,
      }),
    });
    const res = await patchProduct(req, { params: Promise.resolve({ id: PROD_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.preco_cents).toBe(10990);
    expect(mockAuditEntries.some((a) => a.action === "catalog_product.updated")).toBe(true);
  });

  it("DELETE /api/v1/products/[id] remove produto", async () => {
    const req = new NextRequest(`http://localhost:3000/api/v1/products/${PROD_ID}`, {
      method: "DELETE",
    });
    const res = await deleteProduct(req, { params: Promise.resolve({ id: PROD_ID }) });
    expect(res.status).toBe(200);
    expect(mockProducts).toHaveLength(0);
    expect(mockAuditEntries.some((a) => a.action === "catalog_product.deleted")).toBe(true);
  });
});
