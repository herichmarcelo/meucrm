/**
 * GET /api/v1/metrics/sla — Métricas de SLA por Tipo de Atendimento.
 *
 * Consolida tempo de primeira resposta, tempo de resolução e taxas de cumprimento
 * no expediente útil configurado para a organização.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcularMinutosUteis } from "@/lib/business-hours/calc-business-time";
import { classifySlaRisk, type SlaRiskBucket } from "@/lib/leads/risk-radar";
import { resolverTipoAtendimentoDemanda } from "@/lib/sla/sla-tracking";
import type { BusinessHourSlot, BusinessHoliday } from "@/lib/business-hours/types";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  period: z.enum(["7d", "15d", "30d", "90d"]).optional(),
  tag: z.string().optional(),
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

  const authz = await requireRole("viewer", { requestId, resource: "metrics_sla" });
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

  // 1. Carrega expediente e feriados da organização
  const [slotsRes, holidaysRes] = await Promise.all([
    admin.from("business_hours_slots").select("*").eq("organization_id", activeOrg.orgId),
    admin.from("business_holidays").select("*").eq("organization_id", activeOrg.orgId),
  ]);

  const slots = (slotsRes.data ?? []) as BusinessHourSlot[];
  const holidays = (holidaysRes.data ?? []) as BusinessHoliday[];
  let timezone = slots[0]?.timezone;
  if (!timezone) {
    try {
      const orgQuery = admin.from("organizations").select("timezone").eq("id", activeOrg.orgId);
      const orgRes = typeof orgQuery?.maybeSingle === "function" ? await orgQuery.maybeSingle() : await orgQuery;
      const orgItem = Array.isArray(orgRes?.data) ? orgRes.data[0] : orgRes?.data;
      timezone = (orgItem as { timezone?: string } | null)?.timezone ?? "America/Sao_Paulo";
    } catch {
      timezone = "America/Sao_Paulo";
    }
  }

  // 2. Busca demandas criadas no período
  const { data: demandas, error: demErr } = await admin
    .from("demandas")
    .select(`
      id,
      estado,
      assunto,
      aberta_em,
      criada_em,
      fechada_em,
      primeira_resposta_em,
      sla_paused_at,
      sla_total_paused_seconds
    `)
    .eq("organization_id", activeOrg.orgId)
    .gte("criada_em", from)
    .lte("criada_em", to);

  if (demErr) {
    return fail("internal_error", "Falha ao buscar demandas.", 500, { requestId });
  }

  const listaDemandas = demandas ?? [];

  // 3. Processa cada demanda e agrega métricas
  let somaMinutosPrimeiraResposta = 0;
  let contagemPrimeiraResposta = 0;
  let cumpridoPrimeiraResposta = 0;

  let somaMinutosResolucao = 0;
  let contagemResolucao = 0;
  let cumpridoResolucao = 0;

  const radarBuckets: Record<SlaRiskBucket, number> = {
    em_dia: 0,
    em_risco: 0,
    violado: 0,
    pausado: 0,
  };

  const demandasEmRisco: Array<{
    id: string;
    assunto: string;
    tipo: string;
    bucket: SlaRiskBucket;
    minutos_uteis_decorridos: number;
    minutos_uteis_restantes: number | null;
    porcentagem_consumida: number | null;
    primeira_resposta_pendente: boolean;
    conversation_id: string | null;
    aberta_em: string;
  }> = [];

  const porTipoMap = new Map<
    string,
    {
      tipo: string;
      total: number;
      somaResp: number;
      qtdResp: number;
      cumpridoResp: number;
      somaRes: number;
      qtdRes: number;
      cumpridoRes: number;
    }
  >();

  for (const dem of listaDemandas) {
    const dataAbertura = (dem as unknown as { aberta_em?: string }).aberta_em ?? dem.criada_em;
    const tipo = await resolverTipoAtendimentoDemanda(dem.id, admin);
    const tipoNome = tipo?.tag_name ?? "Não classificado";

    if (parseResult.data.tag && tipoNome !== parseResult.data.tag) {
      continue;
    }

    // Inicializa agregador por tipo
    if (!porTipoMap.has(tipoNome)) {
      porTipoMap.set(tipoNome, {
        tipo: tipoNome,
        total: 0,
        somaResp: 0,
        qtdResp: 0,
        cumpridoResp: 0,
        somaRes: 0,
        qtdRes: 0,
        cumpridoRes: 0,
      });
    }
    const statTipo = porTipoMap.get(tipoNome)!;
    statTipo.total++;

    // 3.1 Primeira Resposta
    if (dem.primeira_resposta_em) {
      const minutos = calcularMinutosUteis(
        new Date(dataAbertura),
        new Date(dem.primeira_resposta_em),
        slots,
        holidays,
        timezone,
      );

      somaMinutosPrimeiraResposta += minutos;
      contagemPrimeiraResposta++;
      statTipo.somaResp += minutos;
      statTipo.qtdResp++;

      if (tipo?.first_response_minutes) {
        if (minutos <= tipo.first_response_minutes) {
          cumpridoPrimeiraResposta++;
          statTipo.cumpridoResp++;
        }
      }
    }

    // 3.2 Resolução
    const isEncerrada = dem.estado === "resolvida" || dem.estado === "encerrada" || Boolean(dem.fechada_em);
    if (isEncerrada && dem.fechada_em) {
      const pausaMinutos = Math.floor((dem.sla_total_paused_seconds ?? 0) / 60);
      const minutosBrutos = calcularMinutosUteis(
        new Date(dataAbertura),
        new Date(dem.fechada_em),
        slots,
        holidays,
        timezone,
      );
      const minutos = Math.max(0, minutosBrutos - pausaMinutos);

      somaMinutosResolucao += minutos;
      contagemResolucao++;
      statTipo.somaRes += minutos;
      statTipo.qtdRes++;

      if (tipo?.resolution_minutes) {
        if (minutos <= tipo.resolution_minutes) {
          cumpridoResolucao++;
          statTipo.cumpridoRes++;
        }
      }
    }

    // 3.3 Radar de Risco
    if (!isEncerrada) {
      const prazoMinutos = !dem.primeira_resposta_em
        ? tipo?.first_response_minutes ?? null
        : tipo?.resolution_minutes ?? null;

      const risk = classifySlaRisk({
        abertaEm: new Date(dataAbertura),
        now: new Date(),
        prazoMinutos,
        isPaused: dem.estado === "aguardando_cliente" || Boolean(dem.sla_paused_at),
        totalPausedSeconds: dem.sla_total_paused_seconds ?? 0,
        pausedAt: dem.sla_paused_at ? new Date(dem.sla_paused_at) : null,
        slots,
        holidays,
        timeZone: timezone,
      });
      radarBuckets[risk.bucket]++;

      if (risk.bucket !== "em_dia") {
        demandasEmRisco.push({
          id: dem.id,
          assunto: (dem as unknown as { assunto?: string }).assunto || "Sem assunto",
          tipo: tipoNome,
          bucket: risk.bucket,
          minutos_uteis_decorridos: risk.minutosUteisDecorridos,
          minutos_uteis_restantes: risk.minutosUteisRestantes,
          porcentagem_consumida: risk.porcentagemConsumida,
          primeira_resposta_pendente: !dem.primeira_resposta_em,
          conversation_id: tipo?.first_conversation_id ?? null,
          aberta_em: dataAbertura,
        });
      }
    }
  }

  // Ordena demandas em risco por severidade: violado primeiro, depois em_risco (maior % consumida), depois pausado
  demandasEmRisco.sort((a, b) => {
    const ordem: Record<SlaRiskBucket, number> = { violado: 1, em_risco: 2, pausado: 3, em_dia: 4 };
    const diffOrdem = ordem[a.bucket] - ordem[b.bucket];
    if (diffOrdem !== 0) return diffOrdem;
    return (b.porcentagem_consumida ?? 0) - (a.porcentagem_consumida ?? 0);
  });

  const mediaResp = contagemPrimeiraResposta > 0 ? Math.round(somaMinutosPrimeiraResposta / contagemPrimeiraResposta) : null;
  const taxaResp = contagemPrimeiraResposta > 0 ? Math.round((cumpridoPrimeiraResposta / contagemPrimeiraResposta) * 100) : null;

  const mediaRes = contagemResolucao > 0 ? Math.round(somaMinutosResolucao / contagemResolucao) : null;
  const taxaRes = contagemResolucao > 0 ? Math.round((cumpridoResolucao / contagemResolucao) * 100) : null;

  const porTipo = Array.from(porTipoMap.values()).map((p) => ({
    tipo: p.tipo,
    total_demandas: p.total,
    primeira_resposta_media_minutos: p.qtdResp > 0 ? Math.round(p.somaResp / p.qtdResp) : null,
    primeira_resposta_cumprimento_pct: p.qtdResp > 0 ? Math.round((p.cumpridoResp / p.qtdResp) * 100) : null,
    resolucao_media_minutos: p.qtdRes > 0 ? Math.round(p.somaRes / p.qtdRes) : null,
    resolucao_cumprimento_pct: p.qtdRes > 0 ? Math.round((p.cumpridoRes / p.qtdRes) * 100) : null,
  }));

  return ok(
    {
      periodo: { from, to },
      total_demandas: listaDemandas.length,
      primeira_resposta: {
        total_respondidas: contagemPrimeiraResposta,
        tempo_medio_minutos: mediaResp,
        taxa_cumprimento_pct: taxaResp,
      },
      resolucao: {
        total_resolvidas: contagemResolucao,
        tempo_medio_minutos: mediaRes,
        taxa_cumprimento_pct: taxaRes,
      },
      radar_risco: radarBuckets,
      demandas_em_risco: demandasEmRisco,
      por_tipo: porTipo,
    },
    { requestId },
  );
}
