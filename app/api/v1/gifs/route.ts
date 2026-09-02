/**
 * GET /api/v1/gifs — proxy para busca e trending no Giphy com fallback curado.
 *
 * Query params:
 *   - q: string (termo de busca; se ausente ou vazio, busca trending)
 *   - limit: number (default 24, max 50)
 *   - offset: number (default 0)
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { GiphyFetch } from "@giphy/js-fetch-api";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { searchCuratedGifs } from "./curated";

export const dynamic = "force-dynamic";

export interface GiphyGifItem {
  id: string;
  title: string;
  preview_url: string; // Miniatura otimizada para a grade
  url: string;         // URL original do GIF para envio no WhatsApp
  width: number;
  height: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  // Autenticação: apenas usuários autenticados com role 'agent'+ podem pesquisar GIFs
  const authz = await requireRole("agent", { requestId, resource: "gifs" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "24", 10) || 24, 1), 50);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  const giphyApiKey = env.GIPHY_API_KEY || process.env.GIPHY_API_KEY;

  // Se houver chave configurada, usa a API oficial do GIPHY
  if (giphyApiKey) {
    try {
      const gf = new GiphyFetch(giphyApiKey);

      let result;
      if (q) {
        result = await gf.search(q, {
          limit,
          offset,
          lang: "pt",
          rating: "g",
          sort: "relevant",
        });
      } else {
        result = await gf.trending({
          limit,
          offset,
          rating: "g",
        });
      }

      const items: GiphyGifItem[] = (result.data || []).map((gif) => {
        const preview =
          gif.images.fixed_width_downsampled?.url ||
          gif.images.fixed_width?.url ||
          gif.images.downsized_medium?.url ||
          gif.images.original.url;

        const sendUrl =
          gif.images.original.url ||
          gif.images.downsized_large?.url ||
          gif.images.downsized?.url ||
          preview;

        return {
          id: String(gif.id),
          title: gif.title || "GIF",
          preview_url: preview,
          url: sendUrl,
          width: gif.images.fixed_width?.width || 200,
          height: gif.images.fixed_width?.height || 200,
        };
      });

      return ok(items, {
        requestId,
        meta: {
          total_count: result.pagination?.total_count ?? items.length,
          count: result.pagination?.count ?? items.length,
          offset: result.pagination?.offset ?? offset,
          is_fallback: false,
        },
      });
    } catch (err) {
      logger.warn("[gifs.route] Giphy API search failed, falling back to curated list", {
        error: err instanceof Error ? err.message : "unknown",
        query: q,
      });
    }
  }

  // Fallback curado: coleção offline de alta resolução direto do CDN
  const fallbackItems = searchCuratedGifs(q, limit);
  return ok(fallbackItems, {
    requestId,
    meta: {
      total_count: fallbackItems.length,
      count: fallbackItems.length,
      offset: 0,
      is_fallback: true,
    },
  });
}
