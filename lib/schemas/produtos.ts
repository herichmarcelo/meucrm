import { z } from "zod";

export const ORIGENS_DO_PRODUTO = ["manual", "planilha", "nuvemshop"] as const;
export type OrigemDoProduto = (typeof ORIGENS_DO_PRODUTO)[number];

/**
 * Preço em texto livre → centavos. Regra: o ÚLTIMO separador manda.
 * Exatamente dois dígitos depois dele = centavos; qualquer outra coisa = milhar.
 * RECUSA (retorna null) o que não dá para ler, em vez de chutar.
 *
 * Rejeita células com observações ou texto misturado a números
 * (ex.: "R$ 5.499,00 (promo até 10)") para evitar concatenação incorreta de dígitos.
 */
export function precoParaCentavos(entrada: string): number | null {
  if (!entrada || typeof entrada !== "string") return null;
  const t = entrada.trim();
  if (t === "" || t.includes("-")) return null;

  // Remove apenas prefixos válidos de moeda no início
  const semMoeda = t.replace(/^\s*(r\$|brl|\$|usd|eur|€)\s*/i, "").trim();

  // Se ainda contiver letras ou caracteres como parênteses, é texto misturado/sujo
  if (/[a-zA-Z\u00C0-\u024F()]/.test(semMoeda)) {
    return null;
  }

  const limpo = semMoeda.replace(/[^\d.,]/g, "").trim();
  if (limpo === "") return null;

  const ultimoPonto = limpo.lastIndexOf(".");
  const ultimaVirgula = limpo.lastIndexOf(",");
  const corte = Math.max(ultimoPonto, ultimaVirgula);
  let inteiros = limpo;
  let decimais = "";
  if (corte !== -1) {
    const depois = limpo.slice(corte + 1);
    if (depois.length === 2 && /^\d{2}$/.test(depois)) {
      inteiros = limpo.slice(0, corte);
      decimais = depois;
    }
  }
  const so = inteiros.replace(/[.,]/g, "");
  if (so === "" || !/^\d+$/.test(so)) return null;
  return Number(so) * 100 + Number(decimais.padEnd(2, "0") || 0);
}

const codigo = z.string().trim().min(1).max(60).transform((v) => v.replace(/\s+/g, " "));
const nome = z.string().trim().min(2).max(200);

export const produtoCreateSchema = z.object({
  codigo,
  nome,
  descricao: z.string().trim().max(2000).optional(),
  marca: z.string().trim().max(80).optional(),
  categoria: z.string().trim().max(80).optional(),
  preco_cents: z.number().int().min(0),
  moeda: z.string().trim().length(3).toUpperCase().default("BRL"),
  custo_cents: z.number().int().min(0).nullable().optional(),
  controla_estoque: z.boolean().default(true),
  quantidade: z.number().int().min(0).default(0),
  ativo: z.boolean().default(true),
  imagem_url: z.string().trim().url().max(2000).optional(),
});

export const produtoPatchSchema = produtoCreateSchema.partial();
export type ProdutoCreate = z.infer<typeof produtoCreateSchema>;
export type ProdutoPatch = z.infer<typeof produtoPatchSchema>;

export const COLUNAS_DO_PRODUTO =
  "id, codigo, nome, descricao, marca, categoria, preco_cents, moeda, custo_cents, " +
  "controla_estoque, quantidade, ativo, origem, imagem_url, updated_at";

export interface CatalogProductRow {
  id: string;
  organization_id: string;
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
  origem: OrigemDoProduto | string;
  imagem_url: string | null;
  created_at: string;
  updated_at: string;
}
