/**
 * GET /api/v1/catalog/search — Busca produtos no catálogo da organização.
 *
 * Usa a MESMA função de relevância (ordenarPorRelevancia / pontuar) que a IA
 * utiliza via MCP tool crm_search_products.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import type { PostgrestError } from "@supabase/supabase-js";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { formatarPrecoCents, ordenarPorRelevancia } from "@/lib/catalogo/busca";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().optional().default(""),
  limite: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export interface CatalogSearchItem {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  marca: string | null;
  categoria: string | null;
  preco_cents: number;
  preco_formatado: string;
  moeda: string;
  controla_estoque: boolean;
  quantidade: number;
  disponivel: boolean;
  imagem_url: string | null;
  relevancia?: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", {
    requestId,
    resource: "catalog_search",
  });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const url = new URL(req.url);
  const rawQ =
    url.searchParams.get("q") ??
    url.searchParams.get("termo") ??
    url.searchParams.get("busca") ??
    "";
  const rawLimite =
    url.searchParams.get("limite") ??
    url.searchParams.get("limit") ??
    "10";

  const parsed = querySchema.safeParse({ q: rawQ, limite: rawLimite });
  if (!parsed.success) {
    return fail("validation_failed", "Parâmetros de busca inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const { q, limite } = parsed.data;
  const termo = q.trim();

  const supabase = await createClient();
  const { data, error } = (await supabase
    .from("catalog_products" as unknown as "orders")
    .select(
      "id, codigo, nome, descricao, marca, categoria, preco_cents, moeda, custo_cents, " +
      "controla_estoque, quantidade, ativo, imagem_url",
    )
    .eq("organization_id", org.orgId)
    .eq("ativo", true)) as unknown as {
    data: Array<{
      id: string;
      codigo: string;
      nome: string;
      descricao: string | null;
      marca: string | null;
      categoria: string | null;
      preco_cents: number;
      moeda: string;
      custo_cents: number | null;
      controla_estoque: boolean;
      quantidade: number;
      ativo: boolean;
      imagem_url: string | null;
    }> | null;
    error: PostgrestError | null;
  };

  if (error) {
    return fail("internal_error", "Erro ao buscar produtos do catálogo.", 500, {
      requestId,
    });
  }

  const produtos = data ?? [];

  if (termo.length > 0) {
    const ranqueados = ordenarPorRelevancia(produtos, termo);
    const items: CatalogSearchItem[] = ranqueados.slice(0, limite).map((r) => ({
      ...r.produto,
      preco_formatado: formatarPrecoCents(r.produto.preco_cents, r.produto.moeda),
      disponivel: !r.produto.controla_estoque || r.produto.quantidade > 0,
      relevancia: Number(r.nota.toFixed(2)),
    }));
    return ok(items, { requestId });
  }

  // Se o termo for vazio, retorna os primeiros N produtos por nome
  const ordenados = [...produtos].sort((a, b) => a.nome.localeCompare(b.nome));
  const items: CatalogSearchItem[] = ordenados.slice(0, limite).map((p) => ({
    ...p,
    preco_formatado: formatarPrecoCents(p.preco_cents, p.moeda),
    disponivel: !p.controla_estoque || p.quantidade > 0,
  }));

  return ok(items, { requestId });
}
