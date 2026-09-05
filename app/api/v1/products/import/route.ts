/**
 * POST /api/v1/products/import — importa e atualiza produtos do catálogo via CSV.
 *
 * Formato aceito: CSV RFC 4180 com cabeçalho (delimitador auto-detectado: , ; ou tab).
 * Colunas mínimas obrigatórias: codigo, nome, preco.
 * Upsert determinístico por (organization_id, codigo).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import type { PostgrestError } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  CSV_MAX_BYTES,
  CSV_MAX_DATA_ROWS,
  mapearColunas,
  parseCsv,
  parseLinhaProduto,
  type ColunaProduto,
} from "@/lib/catalogo/csv";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface LinhaErro {
  linha: number;
  motivo: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "catalog_products",
  });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  let file: File;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) throw new Error("sem arquivo");
    file = f;
  } catch {
    return fail("validation_failed", "Envie o arquivo como multipart/form-data no campo 'file'.", 422, {
      requestId,
    });
  }

  const nome = file.name ?? "";
  const tipoOk =
    nome.toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel";
  if (!tipoOk) {
    return fail(
      "validation_failed",
      "Formato não suportado — envie um arquivo .csv. No Excel use 'Salvar como' → 'CSV UTF-8'.",
      422,
      { requestId },
    );
  }

  if (file.size > CSV_MAX_BYTES) {
    return fail(
      "validation_failed",
      `Arquivo maior que ${Math.floor(CSV_MAX_BYTES / 1024 / 1024)}MB.`,
      413,
      { requestId },
    );
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return fail("validation_failed", "CSV vazio ou sem linhas de dados.", 422, {
      requestId,
    });
  }

  const header = rows[0] ?? [];
  const colunas = mapearColunas(header);

  if (!colunas.has("codigo") || !colunas.has("nome") || !colunas.has("preco")) {
    const obrigatorias: ColunaProduto[] = ["codigo", "nome", "preco"];
    return fail(
      "validation_failed",
      "O cabeçalho do CSV precisa conter pelo menos as colunas: 'codigo', 'nome' e 'preco'.",
      422,
      {
        requestId,
        details: {
          encontradas: header,
          faltando: obrigatorias.filter((c) => !colunas.has(c)),
        },
      },
    );
  }

  const dataRows = rows.slice(1, CSV_MAX_DATA_ROWS + 1);
  const erros: LinhaErro[] = [];
  let criados = 0;
  let atualizados = 0;

  const supabase = await createClient();

  for (let idx = 0; idx < dataRows.length; idx += 1) {
    const numeroLinha = idx + 2; // Linha 1 é cabeçalho
    const row = dataRows[idx];
    if (!row || (row.length === 1 && row[0] === "")) continue;

    const res = parseLinhaProduto(row, colunas);
    if (!res.sucesso || !res.dados) {
      erros.push({ linha: numeroLinha, motivo: res.erro ?? "Dados inválidos." });
      continue;
    }

    const { dados } = res;

    // Confere se o produto já existe nesta organização para diferenciar criação de atualização
    const { data: existing } = (await supabase
      .from("catalog_products" as unknown as "orders")
      .select("id")
      .eq("organization_id", org.orgId)
      .eq("codigo", dados.codigo)
      .maybeSingle()) as unknown as { data: { id: string } | null; error: PostgrestError | null };

    if (existing) {
      const { error: updErr } = await supabase
        .from("catalog_products" as unknown as "orders")
        .update({
          nome: dados.nome,
          descricao: dados.descricao,
          marca: dados.marca,
          categoria: dados.categoria,
          preco_cents: dados.preco_cents,
          custo_cents: dados.custo_cents,
          controla_estoque: dados.controla_estoque,
          quantidade: dados.quantidade,
          ativo: dados.ativo,
          imagem_url: dados.imagem_url,
        } as unknown as Record<string, unknown>)
        .eq("id", existing.id)
        .eq("organization_id", org.orgId);

      if (updErr) {
        erros.push({
          linha: numeroLinha,
          motivo: `Erro ao atualizar produto: ${updErr.message}`,
        });
      } else {
        atualizados += 1;
      }
    } else {
      const { error: insErr } = await supabase
        .from("catalog_products" as unknown as "orders")
        .insert({
          organization_id: org.orgId,
          codigo: dados.codigo,
          nome: dados.nome,
          descricao: dados.descricao,
          marca: dados.marca,
          categoria: dados.categoria,
          preco_cents: dados.preco_cents,
          moeda: "BRL",
          custo_cents: dados.custo_cents,
          controla_estoque: dados.controla_estoque,
          quantidade: dados.quantidade,
          ativo: dados.ativo,
          origem: "planilha",
          imagem_url: dados.imagem_url,
        } as unknown as Record<string, unknown>);

      if (insErr) {
        erros.push({
          linha: numeroLinha,
          motivo: `Erro ao cadastrar produto: ${insErr.message}`,
        });
      } else {
        criados += 1;
      }
    }
  }

  await audit({
    action: "catalog_product.imported",
    organizationId: org.orgId,
    actorUserId: user.id,
    resourceType: "catalog_products",
    requestId,
    metadata: {
      total_linhas: dataRows.length,
      criados,
      atualizados,
      erros_count: erros.length,
    },
  });

  return ok(
    {
      total_linhas: dataRows.length,
      criados,
      atualizados,
      erros,
    },
    { requestId },
  );
}
