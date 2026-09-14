/**
 * GET /api/v1/metrics/csat — Métricas e Indicadores de CSAT (Pesquisa de Satisfação).
 *
 * Consolida média geral, distribuição de notas (1 a 5), taxa de resposta,
 * métricas segmentadas por canal (WhatsApp x E-mail) e comentários recentes.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  period: z.enum(["7d", "15d", "30d", "90d"]).optional(),
  channel: z.enum(["all", "whatsapp", "email"]).optional(),
});

function calcularPeriodo(parsed: z.infer<typeof querySchema>): { from: string; to: string } {
  const agora = new Date();
  const to = parsed.to ?? agora.toISOString();

  if (parsed.from) {
    return { from: parsed.from, to };
  }

  const dias = parsed.period === "7d" ? 7 : parsed.period === "15d" ? 15 : parsed.period === "90d" ? 90 : 30;
  const dataFrom = new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
  return { from: dataFrom.toISOString(), to };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("viewer", { requestId, resource: "metrics_csat" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const url = new URL(req.url);
  const parseResult = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parseResult.success) {
    return fail("validation_failed", "Parâmetros de consulta inválidos.", 422, {
      requestId,
      details: { errors: parseResult.error.issues.map((i) => i.message) },
    });
  }

  const { from, to } = calcularPeriodo(parseResult.data);
  const admin = createAdminClient();

  let query = admin
    .from("csat_surveys")
    .select("id, channel, score, comment, status, sent_at, responded_at")
    .eq("organization_id", activeOrg.orgId)
    .gte("sent_at", from)
    .lte("sent_at", to);

  if (parseResult.data.channel && parseResult.data.channel !== "all") {
    query = query.eq("channel", parseResult.data.channel);
  }

  const { data: surveys, error } = await query;
  if (error) {
    return fail("internal_error", "Falha ao buscar pesquisas CSAT.", 500, { requestId });
  }

  const lista = surveys ?? [];
  const totalEnviadas = lista.length;

  let somaNotas = 0;
  let totalRespostas = 0;
  let promotores = 0; // notas 4 e 5

  const distribuicao: Record<number, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };

  const canalStats: Record<
    "whatsapp" | "email",
    { enviadas: number; respostas: number; somaNotas: number; promotores: number }
  > = {
    whatsapp: { enviadas: 0, respostas: 0, somaNotas: 0, promotores: 0 },
    email: { enviadas: 0, respostas: 0, somaNotas: 0, promotores: 0 },
  };

  const comentarios: Array<{
    id: string;
    channel: string;
    score: number;
    comment: string;
    responded_at: string;
  }> = [];

  for (const s of lista) {
    const canal = (s.channel as "whatsapp" | "email") || "whatsapp";
    if (canalStats[canal]) {
      canalStats[canal].enviadas++;
    }

    if (s.status === "completed" && s.score) {
      totalRespostas++;
      somaNotas += s.score;
      if (s.score in distribuicao) {
        distribuicao[s.score] = (distribuicao[s.score] ?? 0) + 1;
      }
      if (s.score >= 4) {
        promotores++;
      }

      if (canalStats[canal]) {
        canalStats[canal].respostas++;
        canalStats[canal].somaNotas += s.score;
        if (s.score >= 4) {
          canalStats[canal].promotores++;
        }
      }

      if (s.comment?.trim()) {
        comentarios.push({
          id: s.id,
          channel: s.channel,
          score: s.score,
          comment: s.comment.trim(),
          responded_at: s.responded_at ?? s.sent_at,
        });
      }
    }
  }

  const mediaGeral = totalRespostas > 0 ? Number((somaNotas / totalRespostas).toFixed(2)) : null;
  const taxaRespostaGeral = totalEnviadas > 0 ? Math.round((totalRespostas / totalEnviadas) * 100) : null;
  const csatScorePct = totalRespostas > 0 ? Math.round((promotores / totalRespostas) * 100) : null;

  const porCanal = (["whatsapp", "email"] as const).map((c) => {
    const st = canalStats[c];
    return {
      canal: c,
      total_enviadas: st.enviadas,
      total_respostas: st.respostas,
      taxa_resposta_pct: st.enviadas > 0 ? Math.round((st.respostas / st.enviadas) * 100) : null,
      media_csat: st.respostas > 0 ? Number((st.somaNotas / st.respostas).toFixed(2)) : null,
      csat_score_pct: st.respostas > 0 ? Math.round((st.promotores / st.respostas) * 100) : null,
    };
  });

  // Ordena comentários pelos mais recentes
  comentarios.sort((a, b) => new Date(b.responded_at).getTime() - new Date(a.responded_at).getTime());

  return ok(
    {
      periodo: { from, to },
      total_pesquisas_enviadas: totalEnviadas,
      total_respostas: totalRespostas,
      taxa_resposta_pct: taxaRespostaGeral,
      media_csat: mediaGeral,
      csat_score_pct: csatScorePct,
      distribuicao_notas: distribuicao,
      por_canal: porCanal,
      ultimos_comentarios: comentarios.slice(0, 20),
    },
    { requestId },
  );
}
