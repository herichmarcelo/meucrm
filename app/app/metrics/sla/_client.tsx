"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ClockCountdown,
  Heart,
  ArrowsClockwise,
  Warning,
  WarningOctagon,
  CheckCircle,
  Pause,
  ArrowRight,
  ChatCircle,
  Envelope,
  Star,
  Gear,
} from "@/lib/ui/icons";

interface Props {
  canManage: boolean;
}

interface SlaData {
  periodo: { from: string; to: string };
  total_demandas: number;
  primeira_resposta: {
    total_respondidas: number;
    tempo_medio_minutos: number | null;
    taxa_cumprimento_pct: number | null;
  };
  resolucao: {
    total_resolvidas: number;
    tempo_medio_minutos: number | null;
    taxa_cumprimento_pct: number | null;
  };
  radar_risco: {
    em_dia: number;
    em_risco: number;
    violado: number;
    pausado: number;
  };
  demandas_em_risco: Array<{
    id: string;
    assunto: string;
    tipo: string;
    bucket: "em_dia" | "em_risco" | "violado" | "pausado";
    minutos_uteis_decorridos: number;
    minutos_uteis_restantes: number | null;
    porcentagem_consumida: number | null;
    primeira_resposta_pendente: boolean;
    conversation_id: string | null;
    aberta_em: string;
  }>;
  por_tipo: Array<{
    tipo: string;
    total_demandas: number;
    primeira_resposta_media_minutos: number | null;
    primeira_resposta_cumprimento_pct: number | null;
    resolucao_media_minutos: number | null;
    resolucao_cumprimento_pct: number | null;
  }>;
}

interface CsatData {
  periodo: { from: string; to: string };
  total_pesquisas_enviadas: number;
  total_respostas: number;
  taxa_resposta_pct: number | null;
  media_csat: number | null;
  csat_score_pct: number | null;
  distribuicao_notas: Record<string, number>;
  por_canal: Array<{
    canal: "whatsapp" | "email";
    total_enviadas: number;
    total_respostas: number;
    taxa_resposta_pct: number | null;
    media_csat: number | null;
    csat_score_pct: number | null;
  }>;
  ultimos_comentarios: Array<{
    id: string;
    channel: string;
    score: number;
    comment: string;
    responded_at: string;
  }>;
}

function formatarTempo(minutos: number | null | undefined): string {
  if (minutos === null || minutos === undefined) return "—";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const restoMin = minutos % 60;
  if (restoMin === 0) return `${horas}h`;
  return `${horas}h ${restoMin}m`;
}

export function SlaDashboardClient({ canManage }: Props) {
  const [periodo, setPeriodo] = useState<"7d" | "15d" | "30d" | "90d">("30d");
  const [sla, setSla] = useState<SlaData | null>(null);
  const [csat, setCsat] = useState<CsatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, startTransition] = useTransition();

  async function carregarDados(p = periodo) {
    setLoading(true);
    try {
      const [slaRes, csatRes] = await Promise.all([
        fetch(`/api/v1/metrics/sla?period=${p}`).then((r) => r.json()),
        fetch(`/api/v1/metrics/csat?period=${p}`).then((r) => r.json()),
      ]);

      if (slaRes?.data) setSla(slaRes.data);
      if (csatRes?.data) setCsat(csatRes.data);
    } catch {
      // Falha de rede tratada silenciosamente; visual exibe estado de retry
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregarDados(periodo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);

  function handleRefresh() {
    startTransition(() => {
      carregarDados(periodo);
    });
  }

  const demandasEmRisco = sla?.demandas_em_risco ?? [];
  const qtdEmRiscoTotal =
    (sla?.radar_risco?.violado ?? 0) + (sla?.radar_risco?.em_risco ?? 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Controles de Período e Ações */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          {(["7d", "15d", "30d", "90d"] as const).map((p) => (
            <Button
              key={p}
              variant={periodo === p ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs font-medium"
              onClick={() => setPeriodo(p)}
            >
              {p === "7d"
                ? "Últimos 7 dias"
                : p === "15d"
                  ? "15 dias"
                  : p === "30d"
                    ? "30 dias"
                    : "90 dias"}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs">
              <Link href="/app/settings/sla">
                <Gear size={14} aria-hidden />
                Configurar Metas
              </Link>
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading || isRefreshing}
            className="h-8 gap-1.5 text-xs"
          >
            <ArrowsClockwise
              size={14}
              className={loading || isRefreshing ? "animate-spin" : ""}
              aria-hidden
            />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Cards de KPIs Principais */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* SLA Primeira Resposta */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              1ª Resposta no Prazo
            </CardTitle>
            <ClockCountdown size={16} className="text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div>
                <div className="text-2xl font-bold">
                  {sla?.primeira_resposta?.taxa_cumprimento_pct !== null &&
                  sla?.primeira_resposta?.taxa_cumprimento_pct !== undefined
                    ? `${sla.primeira_resposta.taxa_cumprimento_pct}%`
                    : "—"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Média: {formatarTempo(sla?.primeira_resposta?.tempo_medio_minutos)} (
                  {sla?.primeira_resposta?.total_respondidas ?? 0} respondidas)
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SLA Resolução */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Resolução no Prazo
            </CardTitle>
            <CheckCircle size={16} className="text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div>
                <div className="text-2xl font-bold">
                  {sla?.resolucao?.taxa_cumprimento_pct !== null &&
                  sla?.resolucao?.taxa_cumprimento_pct !== undefined
                    ? `${sla.resolucao.taxa_cumprimento_pct}%`
                    : "—"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Média: {formatarTempo(sla?.resolucao?.tempo_medio_minutos)} (
                  {sla?.resolucao?.total_resolvidas ?? 0} concluídas)
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Satisfação CSAT */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Índice CSAT
            </CardTitle>
            <Heart size={16} className="text-rose-500" aria-hidden />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">
                    {csat?.media_csat !== null && csat?.media_csat !== undefined
                      ? csat.media_csat.toFixed(1)
                      : "—"}
                  </span>
                  {csat?.media_csat && (
                    <span className="text-xs text-muted-foreground">/ 5.0</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {csat?.csat_score_pct !== null && csat?.csat_score_pct !== undefined
                    ? `${csat.csat_score_pct}% aprovação (notas 4-5)`
                    : "Sem avaliações no período"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Radar de Risco Atual */}
        <Card className={qtdEmRiscoTotal > 0 ? "border-amber-500/40 bg-amber-500/5" : ""}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Demandas em Risco Agora
            </CardTitle>
            <Warning
              size={16}
              className={qtdEmRiscoTotal > 0 ? "text-amber-500" : "text-muted-foreground"}
              aria-hidden
            />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div>
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {qtdEmRiscoTotal}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                  <span className="text-destructive font-medium">
                    {sla?.radar_risco?.violado ?? 0} violadas
                  </span>
                  <span>•</span>
                  <span>{sla?.radar_risco?.em_risco ?? 0} em atenção</span>
                  <span>•</span>
                  <span>{sla?.radar_risco?.pausado ?? 0} pausadas</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Seções em Abas */}
      <Tabs defaultValue="demandas-risco" className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
          <TabsTrigger value="demandas-risco" className="relative gap-2">
            <span>Demandas em Risco</span>
            {demandasEmRisco.length > 0 && (
              <Badge
                variant="destructive"
                className="h-4 px-1.5 text-[10px] leading-none"
              >
                {demandasEmRisco.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="sla-por-tipo">Metas por Tipo</TabsTrigger>
          <TabsTrigger value="csat-detalhado">Avaliações CSAT</TabsTrigger>
        </TabsList>

        {/* Tab 1: Lista Viva de Demandas em Risco */}
        <TabsContent value="demandas-risco" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Lista Viva de Demandas em Risco
              </CardTitle>
              <CardDescription>
                Demandas com prazo estourado, em risco iminente ou pausadas no expediente comercial.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : demandasEmRisco.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed rounded-lg">
                  <CheckCircle size={36} className="text-emerald-500 mb-2" aria-hidden />
                  <p className="text-sm font-medium">Nenhuma demanda em risco no momento!</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Todas as demandas ativas estão dentro dos prazos estabelecidos de primeira resposta e resolução.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Demanda</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Status SLA</TableHead>
                        <TableHead>Tempo Útil</TableHead>
                        <TableHead>Progresso</TableHead>
                        <TableHead className="text-right">Ação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {demandasEmRisco.map((d) => {
                        const isViolado = d.bucket === "violado";
                        const isPausado = d.bucket === "pausado";
                        const pct = d.porcentagem_consumida ?? 0;

                        return (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium">
                              <div>
                                <span className="text-sm text-foreground">{d.assunto}</span>
                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                  {d.primeira_resposta_pendente
                                    ? "Aguardando 1ª resposta"
                                    : "Em andamento / resolução"}
                                </div>
                              </div>
                            </TableCell>

                            <TableCell>
                              <Badge variant="outline" className="text-xs font-normal">
                                {d.tipo}
                              </Badge>
                            </TableCell>

                            <TableCell>
                              {isViolado ? (
                                <Badge variant="destructive" className="gap-1 font-medium">
                                  <WarningOctagon size={12} weight="fill" aria-hidden />
                                  Violado
                                </Badge>
                              ) : isPausado ? (
                                <Badge variant="secondary" className="gap-1 font-medium">
                                  <Pause size={12} weight="fill" aria-hidden />
                                  Pausado
                                </Badge>
                              ) : (
                                <Badge className="gap-1 bg-amber-500 hover:bg-amber-600 font-medium">
                                  <Warning size={12} weight="fill" aria-hidden />
                                  Em risco (&gt;75%)
                                </Badge>
                              )}
                            </TableCell>

                            <TableCell>
                              <div className="text-xs">
                                <span className="font-medium">
                                  {formatarTempo(d.minutos_uteis_decorridos)}
                                </span>
                                {d.minutos_uteis_restantes !== null && !isViolado && (
                                  <span className="text-muted-foreground ml-1">
                                    (restam {formatarTempo(d.minutos_uteis_restantes)})
                                  </span>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="w-36">
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-24 overflow-hidden rounded-full bg-secondary">
                                  <div
                                    className={`h-full transition-all ${
                                      isViolado
                                        ? "bg-destructive"
                                        : isPausado
                                          ? "bg-muted-foreground"
                                          : pct > 85
                                            ? "bg-amber-500"
                                            : "bg-emerald-500"
                                    }`}
                                    style={{ width: `${Math.min(100, pct)}%` }}
                                  />
                                </div>
                                <span className="text-[11px] font-mono text-muted-foreground">
                                  {pct}%
                                </span>
                              </div>
                            </TableCell>

                            <TableCell className="text-right">
                              {d.conversation_id ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  asChild
                                  className="h-7 px-2 text-xs gap-1"
                                >
                                  <Link href={`/app/inbox?conversation=${d.conversation_id}`}>
                                    Atender
                                    <ArrowRight size={12} aria-hidden />
                                  </Link>
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: SLA Consolidado por Tipo de Atendimento */}
        <TabsContent value="sla-por-tipo" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Cumprimento de Metas por Tipo de Atendimento
              </CardTitle>
              <CardDescription>
                Histórico de tempo de primeira resposta e resolução dentro do expediente útil configurado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : !sla?.por_tipo || sla.por_tipo.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  Nenhuma demanda registrada no período selecionado.
                </p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo de Atendimento</TableHead>
                        <TableHead className="text-center">Total Demandas</TableHead>
                        <TableHead className="text-center">1ª Resposta Média</TableHead>
                        <TableHead className="text-center">% Cumprimento 1ª Resp.</TableHead>
                        <TableHead className="text-center">Resolução Média</TableHead>
                        <TableHead className="text-center">% Cumprimento Resolução</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sla.por_tipo.map((tipo) => (
                        <TableRow key={tipo.tipo}>
                          <TableCell className="font-medium">
                            <Badge variant="outline">{tipo.tipo}</Badge>
                          </TableCell>
                          <TableCell className="text-center font-mono text-xs">
                            {tipo.total_demandas}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {formatarTempo(tipo.primeira_resposta_media_minutos)}
                          </TableCell>
                          <TableCell className="text-center">
                            {tipo.primeira_resposta_cumprimento_pct !== null ? (
                              <Badge
                                variant={
                                  tipo.primeira_resposta_cumprimento_pct >= 90
                                    ? "default"
                                    : tipo.primeira_resposta_cumprimento_pct >= 75
                                      ? "secondary"
                                      : "destructive"
                                }
                              >
                                {tipo.primeira_resposta_cumprimento_pct}%
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {formatarTempo(tipo.resolucao_media_minutos)}
                          </TableCell>
                          <TableCell className="text-center">
                            {tipo.resolucao_cumprimento_pct !== null ? (
                              <Badge
                                variant={
                                  tipo.resolucao_cumprimento_pct >= 90
                                    ? "default"
                                    : tipo.resolucao_cumprimento_pct >= 75
                                      ? "secondary"
                                      : "destructive"
                                }
                              >
                                {tipo.resolucao_cumprimento_pct}%
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Detalhamento CSAT */}
        <TabsContent value="csat-detalhado" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Distribuição de Notas */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  Distribuição das Avaliações (1 a 5)
                </CardTitle>
                <CardDescription>
                  Taxa de resposta de {csat?.taxa_resposta_pct ?? 0}% ({csat?.total_respostas ?? 0} de{" "}
                  {csat?.total_pesquisas_enviadas ?? 0} pesquisas)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[5, 4, 3, 2, 1].map((nota) => {
                  const qtd = csat?.distribuicao_notas?.[String(nota)] ?? 0;
                  const total = csat?.total_respostas || 1;
                  const pct = Math.round((qtd / total) * 100);

                  return (
                    <div key={nota} className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1 w-16">
                        <span className="font-semibold">{nota}</span>
                        <Star size={12} weight="fill" className="text-amber-400" aria-hidden />
                      </div>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={`h-full ${
                            nota >= 4
                              ? "bg-emerald-500"
                              : nota === 3
                                ? "bg-amber-400"
                                : "bg-destructive"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-12 text-right font-mono text-muted-foreground">
                        {qtd} ({pct}%)
                      </span>
                    </div>
                  );
                })}

                {/* Métricas por Canal */}
                <div className="mt-6 pt-4 border-t flex items-center justify-between text-xs">
                  {csat?.por_canal?.map((c) => (
                    <div key={c.canal} className="flex items-center gap-2">
                      {c.canal === "whatsapp" ? (
                        <ChatCircle size={16} className="text-emerald-500" aria-hidden />
                      ) : (
                        <Envelope size={16} className="text-sky-500" aria-hidden />
                      )}
                      <div>
                        <div className="font-medium capitalize">{c.canal}</div>
                        <div className="text-muted-foreground text-[11px]">
                          {c.total_respostas} resp. • Média: {c.media_csat?.toFixed(1) ?? "—"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Comentários Recentes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  Comentários Recentes dos Clientes
                </CardTitle>
                <CardDescription>
                  Depoimentos recebidos ao término das demandas atendidas.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : !csat?.ultimos_comentarios || csat.ultimos_comentarios.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">
                    Nenhum comentário por escrito recebido no período.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {csat.ultimos_comentarios.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-border/80 bg-muted/30 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                size={12}
                                weight={i < item.score ? "fill" : "regular"}
                                className={
                                  i < item.score
                                    ? "text-amber-400"
                                    : "text-muted-foreground/30"
                                }
                                aria-hidden
                              />
                            ))}
                            <span className="font-semibold ml-1">{item.score}.0</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            {item.channel}
                          </span>
                        </div>
                        <p className="text-foreground italic">&ldquo;{item.comment}&rdquo;</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
