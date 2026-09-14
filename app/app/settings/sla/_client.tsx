"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { ClockCountdown, Heart, CalendarBlank, Plus, FloppyDisk } from "@/lib/ui/icons";

interface TagItem {
  id: string;
  name: string;
  color?: string | null;
  group_slug?: string | null;
  is_exclusive?: boolean;
  is_csat_enabled?: boolean;
  sla_first_response_minutes?: number | null;
  sla_resolution_minutes?: number | null;
}

interface CsatConfigItem {
  delay_minutes: number;
  max_frequency_days: number;
}

interface BusinessSlot {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_active: boolean;
  timezone: string;
}

const DIAS_DA_SEMANA = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

export function SlaConfigClient() {
  const [loading, setLoading] = useState(true);
  const [savingTag, setSavingTag] = useState<string | null>(null);
  const [savingCsat, setSavingCsat] = useState(false);
  const [savingHours, setSavingHours] = useState(false);

  // Estados de dados
  const [tags, setTags] = useState<TagItem[]>([]);
  const [csatConfig, setCsatConfig] = useState<CsatConfigItem>({
    delay_minutes: 0,
    max_frequency_days: 30,
  });
  const [slots, setSlots] = useState<BusinessSlot[]>([]);

  // Novo tipo de atendimento
  const [novoTipoNome, setNovoTipoNome] = useState("");
  const [novoTipoCor, setNovoTipoCor] = useState("azul");
  const [novoTipoFr, setNovoTipoFr] = useState(60);
  const [novoTipoRes, setNovoTipoRes] = useState(1440);
  const [novoTipoCsat, setNovoTipoCsat] = useState(true);
  const [adicionandoNovo, setAdicionandoNovo] = useState(false);

  useEffect(() => {
    async function carregarTudo() {
      setLoading(true);
      try {
        const [tagsRes, csatRes, hoursRes] = await Promise.all([
          fetch("/api/v1/tags").then((r) => r.json()),
          fetch("/api/v1/csat/config").then((r) => r.json()),
          fetch("/api/v1/business-hours").then((r) => r.json()),
        ]);

        if (tagsRes?.data) {
          const tipos = (tagsRes.data as TagItem[]).filter(
            (t) => t.group_slug === "tipo_atendimento",
          );
          setTags(tipos);
        }

        if (csatRes?.data) {
          const cfg = Array.isArray(csatRes.data) ? csatRes.data[0] : csatRes.data;
          if (cfg) {
            setCsatConfig({
              delay_minutes: Number(cfg.delay_minutes ?? 0),
              max_frequency_days: Number(cfg.max_frequency_days ?? 30),
            });
          }
        }

        if (hoursRes?.data?.slots) {
          setSlots(hoursRes.data.slots as BusinessSlot[]);
        }
      } catch {
        toast.error("Falha ao carregar configurações.");
      } finally {
        setLoading(false);
      }
    }

    void carregarTudo();
  }, []);

  async function salvarTag(tag: TagItem) {
    setSavingTag(tag.name);
    try {
      const res = await fetch("/api/v1/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tag.name,
          color: tag.color || "azul",
          group_slug: "tipo_atendimento",
          is_exclusive: true,
          is_csat_enabled: tag.is_csat_enabled,
          sla_first_response_minutes: tag.sla_first_response_minutes,
          sla_resolution_minutes: tag.sla_resolution_minutes,
        }),
      });

      if (!res.ok) throw new Error("Erro ao salvar tipo de atendimento.");
      toast.success(`Tipo de atendimento "${tag.name}" atualizado!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSavingTag(null);
    }
  }

  async function criarNovoTipo() {
    if (!novoTipoNome.trim()) {
      toast.error("Informe o nome do tipo de atendimento.");
      return;
    }

    setAdicionandoNovo(true);
    try {
      const res = await fetch("/api/v1/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: novoTipoNome.trim().toLowerCase(),
          color: novoTipoCor,
          group_slug: "tipo_atendimento",
          is_exclusive: true,
          is_csat_enabled: novoTipoCsat,
          sla_first_response_minutes: novoTipoFr,
          sla_resolution_minutes: novoTipoRes,
        }),
      });

      if (!res.ok) throw new Error("Erro ao cadastrar novo tipo de atendimento.");
      const json = await res.json();
      setTags((prev) => [...prev, json.data]);
      setNovoTipoNome("");
      toast.success("Novo tipo de atendimento cadastrado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar tipo.");
    } finally {
      setAdicionandoNovo(false);
    }
  }

  async function salvarCsatConfig() {
    setSavingCsat(true);
    try {
      const res = await fetch("/api/v1/csat/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(csatConfig),
      });

      if (!res.ok) throw new Error("Erro ao atualizar regras de CSAT.");
      toast.success("Configuração de CSAT salva com sucesso!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar CSAT.");
    } finally {
      setSavingCsat(false);
    }
  }

  async function salvarHorarios() {
    setSavingHours(true);
    try {
      const res = await fetch("/api/v1/business-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots }),
      });

      if (!res.ok) throw new Error("Erro ao salvar expediente comercial.");
      toast.success("Expediente comercial salvo!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar horários.");
    } finally {
      setSavingHours(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="sla" className="space-y-6">
      <TabsList className="grid w-full max-w-md grid-cols-3">
        <TabsTrigger value="sla" className="flex items-center gap-2">
          <ClockCountdown className="h-4 w-4" />
          <span>Metas de SLA</span>
        </TabsTrigger>
        <TabsTrigger value="csat" className="flex items-center gap-2">
          <Heart className="h-4 w-4" />
          <span>Pesquisa CSAT</span>
        </TabsTrigger>
        <TabsTrigger value="agenda" className="flex items-center gap-2">
          <CalendarBlank className="h-4 w-4" />
          <span>Expediente</span>
        </TabsTrigger>
      </TabsList>

      {/* ABA 1: SLA POR TIPO DE ATENDIMENTO */}
      <TabsContent value="sla" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Metas de SLA por Tipo de Atendimento</CardTitle>
            <CardDescription>
              Defina as metas contratuais de primeira resposta humana e tempo total de resolução.
              O relógio de SLA pausa automaticamente fora do expediente e no estado &apos;aguardando cliente&apos;.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo de Atendimento</TableHead>
                    <TableHead>Meta 1ª Resposta (minutos)</TableHead>
                    <TableHead>Meta Resolução (minutos)</TableHead>
                    <TableHead>Disparar CSAT</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tags.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                        Nenhum tipo de atendimento exclusivo cadastrado ainda.
                      </TableCell>
                    </TableRow>
                  ) : (
                    tags.map((tag) => (
                      <TableRow key={tag.name}>
                        <TableCell className="font-medium flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {tag.name}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              className="w-24"
                              value={tag.sla_first_response_minutes ?? ""}
                              onChange={(e) => {
                                const val = Number.parseInt(e.target.value, 10) || null;
                                setTags((prev) =>
                                  prev.map((t) =>
                                    t.name === tag.name
                                      ? { ...t, sla_first_response_minutes: val }
                                      : t,
                                  ),
                                );
                              }}
                            />
                            <span className="text-xs text-muted-foreground">min</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              className="w-24"
                              value={tag.sla_resolution_minutes ?? ""}
                              onChange={(e) => {
                                const val = Number.parseInt(e.target.value, 10) || null;
                                setTags((prev) =>
                                  prev.map((t) =>
                                    t.name === tag.name
                                      ? { ...t, sla_resolution_minutes: val }
                                      : t,
                                  ),
                                );
                              }}
                            />
                            <span className="text-xs text-muted-foreground">
                              min ({tag.sla_resolution_minutes ? Math.round(tag.sla_resolution_minutes / 60) : 0}h)
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={tag.is_csat_enabled ?? false}
                              onCheckedChange={(checked) => {
                                setTags((prev) =>
                                  prev.map((t) =>
                                    t.name === tag.name ? { ...t, is_csat_enabled: checked } : t,
                                  ),
                                );
                              }}
                            />
                            <span className="text-xs text-muted-foreground">
                              {tag.is_csat_enabled ? "Ativo" : "Inativo"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={savingTag === tag.name}
                            onClick={() => salvarTag(tag)}
                          >
                            <FloppyDisk className="h-4 w-4 mr-1" />
                            {savingTag === tag.name ? "Salvando..." : "Salvar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Criar novo tipo de atendimento */}
            <div className="rounded-lg border p-4 bg-muted/20 space-y-4">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Plus className="h-4 w-4 text-primary" />
                <span>Adicionar Novo Tipo de Atendimento</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Nome do Tipo</label>
                  <Input
                    placeholder="Ex: ouvidoria"
                    value={novoTipoNome}
                    onChange={(e) => setNovoTipoNome(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Meta 1ª Resposta (min)</label>
                  <Input
                    type="number"
                    min={1}
                    value={novoTipoFr}
                    onChange={(e) => setNovoTipoFr(Number.parseInt(e.target.value, 10) || 1)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Meta Resolução (min)</label>
                  <Input
                    type="number"
                    min={1}
                    value={novoTipoRes}
                    onChange={(e) => setNovoTipoRes(Number.parseInt(e.target.value, 10) || 1)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground block">Disparar CSAT</label>
                  <div className="flex items-center gap-2 pt-1">
                    <Switch checked={novoTipoCsat} onCheckedChange={setNovoTipoCsat} />
                    <span className="text-xs">{novoTipoCsat ? "Sim" : "Não"}</span>
                  </div>
                </div>
                <div>
                  <Button
                    className="w-full"
                    disabled={adicionandoNovo}
                    onClick={criarNovoTipo}
                  >
                    {adicionandoNovo ? "Adicionando..." : "Adicionar"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ABA 2: REGRAS DE CSAT */}
      <TabsContent value="csat" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Configurações de Disparo do CSAT</CardTitle>
            <CardDescription>
              A pesquisa de satisfação CSAT é disparada apenas ao concluir uma demanda cujo tipo de atendimento
              está marcado com disparo ativo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Tempo de Espera antes do Envio (Minutos)
                </label>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={csatConfig.delay_minutes}
                  onChange={(e) =>
                    setCsatConfig((prev) => ({
                      ...prev,
                      delay_minutes: Number.parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Tempo de respiro antes de enviar a pesquisa após a conclusão da demanda (0 = envio imediato).
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Limite de Frequência por Contato (Dias)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={csatConfig.max_frequency_days}
                  onChange={(e) =>
                    setCsatConfig((prev) => ({
                      ...prev,
                      max_frequency_days: Number.parseInt(e.target.value, 10) || 30,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Evita sobrecarregar o cliente: se ele já recebeu uma pesquisa no período, novas pesquisas são ignoradas.
                </p>
              </div>
            </div>

            <div className="rounded-lg border p-4 bg-muted/20 space-y-2">
              <h4 className="text-sm font-medium">Canais de Envio Suportados</h4>
              <p className="text-xs text-muted-foreground">
                • <strong>WhatsApp:</strong> Enviado como lista interativa de seleção de 1 a 5 estrelas via WAHA/GOWA,
                com fallback automático para mensagem de texto numerada. Respostas numéricas (1 a 5) do cliente são
                automaticamente computadas.
              </p>
              <p className="text-xs text-muted-foreground">
                • <strong>E-mail:</strong> Enviado com a identidade da empresa e botões diretos com links assinados de 1 a 5 estrelas.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={salvarCsatConfig} disabled={savingCsat}>
                <FloppyDisk className="h-4 w-4 mr-2" />
                {savingCsat ? "Salvando..." : "Salvar Configurações de CSAT"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ABA 3: EXPEDIENTE COMERCIAL (AGENDA) */}
      <TabsContent value="agenda" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Expediente Comercial da Organização</CardTitle>
            <CardDescription>
              O motor de SLA consulta esta grade semanal para pausar a contagem fora do horário comercial e em finais de semana.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia da Semana</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead>Horário de Abertura</TableHead>
                    <TableHead>Horário de Fechamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slots.map((slot) => (
                    <TableRow key={slot.day_of_week}>
                      <TableCell className="font-medium">
                        {DIAS_DA_SEMANA[slot.day_of_week]}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={slot.is_active}
                          onCheckedChange={(checked) => {
                            setSlots((prev) =>
                              prev.map((s) =>
                                s.day_of_week === slot.day_of_week
                                  ? { ...s, is_active: checked }
                                  : s,
                              ),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          disabled={!slot.is_active}
                          className="w-32"
                          value={slot.open_time.slice(0, 5)}
                          onChange={(e) => {
                            setSlots((prev) =>
                              prev.map((s) =>
                                s.day_of_week === slot.day_of_week
                                  ? { ...s, open_time: `${e.target.value}:00` }
                                  : s,
                              ),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          disabled={!slot.is_active}
                          className="w-32"
                          value={slot.close_time.slice(0, 5)}
                          onChange={(e) => {
                            setSlots((prev) =>
                              prev.map((s) =>
                                s.day_of_week === slot.day_of_week
                                  ? { ...s, close_time: `${e.target.value}:00` }
                                  : s,
                              ),
                            );
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <Button onClick={salvarHorarios} disabled={savingHours}>
                <FloppyDisk className="h-4 w-4 mr-2" />
                {savingHours ? "Salvando..." : "Salvar Expediente Comercial"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
