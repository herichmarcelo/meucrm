/**
 * GET    /api/v1/products/[id] — Retorna detalhes de um produto.
 * PATCH  /api/v1/products/[id] — Atualiza produto (role manager+).
 * DELETE /api/v1/products/[id] — Remove produto do catálogo (role manager+).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import type { PostgrestError } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  COLUNAS_DO_PRODUTO,
  produtoPatchSchema,
  type CatalogProductRow,
} from "@/lib/schemas/produtos";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", {
    requestId,
    resource: "catalog_products",
  });
  if (!authz.ok) return authz.response;
  const { org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = (await supabase
    .from("catalog_products" as unknown as "orders")
    .select(COLUNAS_DO_PRODUTO)
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle()) as unknown as { data: CatalogProductRow | null; error: PostgrestError | null };

  if (error || !data) {
    return fail("not_found", "Produto não encontrado.", 404, { requestId });
  }

  return ok(data, { requestId });
}

export async function PATCH(
  req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "catalog_products",
  });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = produtoPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const { data, error } = (await supabase
    .from("catalog_products" as unknown as "orders")
    .update(parsed.data as unknown as Record<string, unknown>)
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select(COLUNAS_DO_PRODUTO)
    .maybeSingle()) as unknown as { data: CatalogProductRow | null; error: PostgrestError | null };

  if (error) {
    if (error.code === "23505") {
      return fail(
        "conflict",
        "Já existe um produto com este código nesta organização.",
        409,
        { requestId },
      );
    }
    return fail("internal_error", "Erro ao atualizar produto.", 500, {
      requestId,
    });
  }

  if (!data) {
    return fail("not_found", "Produto não encontrado.", 404, { requestId });
  }

  await audit({
    action: "catalog_product.updated",
    organizationId: org.orgId,
    actorUserId: user.id,
    resourceType: "catalog_product",
    resourceId: data.id,
    requestId,
    metadata: {
      campos: Object.keys(parsed.data),
    },
  });

  return ok(data, { requestId });
}

export async function DELETE(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "catalog_products",
  });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  const { data: existing } = (await supabase
    .from("catalog_products" as unknown as "orders")
    .select("id, codigo, nome")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle()) as unknown as { data: { id: string; codigo: string; nome: string } | null; error: PostgrestError | null };

  if (!existing) {
    return fail("not_found", "Produto não encontrado.", 404, { requestId });
  }

  const { error } = await supabase
    .from("catalog_products" as unknown as "orders")
    .delete()
    .eq("id", id)
    .eq("organization_id", org.orgId);

  if (error) {
    return fail("internal_error", "Erro ao excluir produto.", 500, {
      requestId,
    });
  }

  await audit({
    action: "catalog_product.deleted",
    organizationId: org.orgId,
    actorUserId: user.id,
    resourceType: "catalog_product",
    resourceId: id,
    requestId,
    metadata: {
      codigo: existing.codigo,
      nome: existing.nome,
    },
  });

  return ok({ id, deleted: true }, { requestId });
}
