/**
 * Capacidades de COMÉRCIO — o que o cliente já comprou e o que existe à venda.
 *
 * Ficou de fora do épico até ser cobrado, e era a lacuna mais direta do pilar 1:
 * um agente de vendas que não enxerga o catálogo nem o histórico de pedidos
 * negocia no escuro — promete o que não existe, ou repete uma oferta que o
 * cliente já comprou.
 *
 * Service role bypassa RLS: TODA query filtra `organization_id` manualmente, e a
 * fonte é sempre `ctx.organizationId` (token/cookie), NUNCA o input.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";

import { ordenarPorRelevancia } from "@/lib/catalogo/busca";
import type { McpToolDefinition } from "../types";

// ---------------------------------------------------------------------------
// pedidos de um cliente
// ---------------------------------------------------------------------------

const pedidosInputShape = {
  contact_id: z.string().uuid().describe("O cliente cujos pedidos se quer ver."),
  limite: z.number().int().min(1).max(20).optional().default(10),
};

export const crmListContactOrders: McpToolDefinition<typeof pedidosInputShape> = {
  name: "crm_list_contact_orders",
  description:
    "Lista os pedidos de um contato, do mais recente para o mais antigo, com status, valor, " +
    "forma de pagamento, situação de entrega e código de rastreio. Use antes de prometer prazo " +
    "ou repetir oferta: o cliente pode já ter comprado.",
  inputSchema: pedidosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("orders")
      .select(
        "id, external_id, external_provider, status, total_cents, currency, payment_method, fulfillment_status, tracking_code, ordered_at, is_anonymized",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", input.contact_id)
      .order("ordered_at", { ascending: false, nullsFirst: false })
      .limit(input.limite);

    if (error) throw new Error(`listar_pedidos_falhou: ${error.message}`);

    return {
      pedidos: (data ?? []).map((p) => ({
        ...p,
        // Pedido anonimizado por LGPD continua contando para histórico, mas o
        // conteúdo não volta: dizer isso é melhor que devolver campos vazios e
        // deixar o modelo concluir que o cliente nunca comprou.
        ...(p.is_anonymized ? { aviso: "pedido anonimizado a pedido do titular" } : {}),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// buscar no catálogo
// ---------------------------------------------------------------------------

const produtosInputShape = {
  termo: z.string().trim().min(1).describe("Nome, código/SKU, marca, modelo ou especificações do produto."),
  limite: z.number().int().min(1).max(20).optional().default(10),
  somente_disponiveis: z.boolean().optional().default(true),
};

export const crmSearchProducts: McpToolDefinition<typeof produtosInputShape> = {
  name: "crm_search_products",
  description:
    "Busca produtos no catálogo oficial da organização. Devolve preço exato (preco_cents), " +
    "código, estoque e detalhes. O preço retornado é o valor exato — NUNCA estime de memória. " +
    "Se houver empate entre variantes, pergunte ao cliente qual ele prefere.",
  inputSchema: produtosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = (await ctx.supabase
      .from("catalog_products" as unknown as "orders")
      .select(
        "id, codigo, nome, descricao, marca, categoria, preco_cents, moeda, custo_cents, " +
        "controla_estoque, quantidade, ativo, imagem_url",
      )
      .eq("organization_id", ctx.organizationId)
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

    if (error) throw new Error(`buscar_produtos_falhou: ${error.message}`);

    let lista = data ?? [];

    if (input.somente_disponiveis) {
      // Exclui apenas produtos com controla_estoque = true e quantidade = 0.
      // Produtos com controla_estoque = false sempre aparecem.
      lista = lista.filter((p) => !p.controla_estoque || p.quantidade > 0);
    }

    const ranqueados = ordenarPorRelevancia(lista, input.termo);

    if (ranqueados.length === 0) {
      return {
        produtos: [],
        instrucao:
          "Nenhum produto correspondente foi encontrado no catálogo. NUNCA invente preços ou itens. " +
          "Informe cordialmente ao cliente que não localizou o produto ou pergunte por mais especificações.",
      };
    }

    const topNota = ranqueados[0]?.nota ?? 0;
    const empatados = ranqueados.filter((r) => r.nota === topNota);
    const empate = empatados.length > 1;

    const limite = input.limite ?? 10;
    const produtos = ranqueados.slice(0, limite).map((r) => ({
      ...r.produto,
      relevancia: Number(r.nota.toFixed(2)),
    }));

    return {
      produtos,
      empate,
      instrucao: empate
        ? "Existem múltiplos produtos compatíveis com a mesma relevância máxima. " +
          "NUNCA escolha sozinho: pergunte ao cliente qual variante/modelo específico ele deseja."
        : "O preço retornado é o valor exato — nunca invente descontos ou estime valores de memória.",
    };
  },
};

