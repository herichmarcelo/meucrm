/**
 * GET  /api/v1/products — Lista produtos do catálogo da organização (filtro simples).
 * POST /api/v1/products — Cria produto no catálogo (role manager+).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import type { PostgrestError } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  COLUNAS_DO_PRODUTO,
  produtoCreateSchema,
  type CatalogProductRow,
} from "@/lib/schemas/produtos";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", {
    requestId,
    resource: "catalog_products",
  });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const url = new URL(req.url);
  const busca = (url.searchParams.get("busca") || url.searchParams.get("query") || url.searchParams.get("q") || "").trim();
  const ativoStr = url.searchParams.get("ativo");

  const supabase = await createClient();
  let q = supabase
    .from("catalog_products" as unknown as "orders")
    .select(COLUNAS_DO_PRODUTO)
    .eq("organization_id", org.orgId);

  if (ativoStr !== null && ativoStr !== "") {
    q = q.eq("ativo", ativoStr === "true");
  }

  if (busca) {
    q = q.or(`nome.ilike.%${busca}%,codigo.ilike.%${busca}%,marca.ilike.%${busca}%,categoria.ilike.%${busca}%`);
  }

  q = q.order("nome", { ascending: true });

  const { data, error } = (await q) as unknown as { data: CatalogProductRow[] | null; error: PostgrestError | null };
  if (error) {
    return fail("internal_error", "Erro ao listar produtos do catálogo.", 500, {
      requestId,
    });
  }

  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "catalog_products",
  });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const raw = await req.json().catch(() => null);
  const parsed = produtoCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const { data, error } = (await supabase
    .from("catalog_products" as unknown as "orders")
    .insert({
      ...parsed.data,
      organization_id: org.orgId,
      origem: "manual",
    } as unknown as Record<string, unknown>)
    .select(COLUNAS_DO_PRODUTO)
    .single()) as unknown as { data: CatalogProductRow | null; error: PostgrestError | null };

  if (error) {
    if (error.code === "23505") {
      return fail(
        "conflict",
        "Já existe um produto com este código nesta organização.",
        409,
        { requestId },
      );
    }
    return fail("internal_error", "Erro ao criar produto.", 500, {
      requestId,
    });
  }

  if (!data) {
    return fail("internal_error", "Erro ao criar produto.", 500, {
      requestId,
    });
  }

  await audit({
    action: "catalog_product.created",
    organizationId: org.orgId,
    actorUserId: user.id,
    resourceType: "catalog_product",
    resourceId: data.id,
    requestId,
    metadata: {
      codigo: data.codigo,
      nome: data.nome,
      preco_cents: data.preco_cents,
    },
  });

  return ok(data, { status: 201, requestId });
}
