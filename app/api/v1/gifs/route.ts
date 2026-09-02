/**
 * GET /api/v1/gifs — proxy para busca e trending no Giphy.
 *
 * Query params:
 *   - q: string (termo de busca; se ausente ou vazio, busca trending)
 *   - limit: number (default 24, max 50)
 *   - offset: number (default 0)
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { GiphyFetch } from "@giphy/js-fetch-api";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Chave pública beta do Giphy para fallback caso GIPHY_API_KEY não esteja no .env
const GIPHY_API_KEY =
  process.env.GIPHY_API_KEY || "sXpGFDGZs0Dv1mmNFvYaGUvYwKX0P4W3";

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

  try {
    const gf = new GiphyFetch(GIPHY_API_KEY);

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
      // Prioriza formatos leves para miniatura (fixed_width_downsampled ou fixed_width ou downsized_medium)
      const preview =
        gif.images.fixed_width_downsampled?.url ||
        gif.images.fixed_width?.url ||
        gif.images.downsized_medium?.url ||
        gif.images.original.url;

      // URL de envio de alta qualidade para o WhatsApp
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
      },
    });
  } catch (err) {
    logger.error("[gifs.route] Giphy API search failed", {
      error: err instanceof Error ? err.message : "unknown",
      query: q,
      requestId,
    });
    return fail("giphy_error", "Não foi possível carregar os GIFs do Giphy.", 502, {
      requestId,
    });
  }
}
