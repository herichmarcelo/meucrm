"use client";
import { useMemo } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChatCircle, Users, Storefront, Robot, Gear } from "@/lib/ui/icons";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTimeline } from "@/hooks/contacts/useTimeline";
import type { TimelineItemView as TimelineItem } from "@/lib/types/contacts";
import { activityLabel, actorName, actorShape } from "@/lib/leads/activity-vocabulary";
import { useTempo } from "@/lib/tempo/TempoProvider";

interface Props {
  contactId: string;
  types?: string[];
}

const ICON_MAP: Record<string, PhosphorIcon> = {
  whatsapp: ChatCircle,
  crm: Users,
  nuvemshop: Storefront,
  ai: Robot,
  system: Gear,
};

function dayHeader(d: Date): string {
  if (isToday(d)) return "Hoje";
  if (isYesterday(d)) return "Ontem";
  return format(d, "dd/MM/yyyy", { locale: ptBR });
}

/**
 * Fallback de corpo quando a linha não tem `reason` (histórico anterior ao
 * barramento). Só devolve texto que uma PESSOA escreveu ou leria — nunca
 * `JSON.stringify` do payload.
 */
function summarizePayload(p: Record<string, unknown>): string {
  if (!p) return "";
  for (const campo of ["body", "text", "summary", "reason", "note"]) {
    const v = p[campo];
    if (typeof v === "string" && v.trim() !== "") return v.slice(0, 200);
  }
  return "";
}

function groupTimeline(items: TimelineItem[]) {
  const map = new Map<string, TimelineItem[]>();
  for (const it of items) {
    const d = new Date(it.performed_at);
    const key = format(d, "yyyy-MM-dd");
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => ({ date: new Date(key), key, items }));
}

export function TimelineView({ contactId, types }: Props) {
  const q = useTimeline(contactId, types);
  const { formatarHora } = useTempo();
  
  const grouped = useMemo(() => {
    const items: TimelineItem[] = q.data?.pages.flatMap((p) => p.data) ?? [];
    return groupTimeline(items);
  }, [q.data]);

  if (q.isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <Card className="m-4 p-4 text-center">
        <p className="text-sm text-destructive">Falha ao carregar timeline.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => q.refetch()}>
          Tentar novamente
        </Button>
      </Card>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Nenhuma atividade registrada ainda.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      {grouped.map(({ date, key, items }) => (
        <section key={key} className="space-y-2">
          <h3 className="sticky top-0 z-10 bg-background py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {dayHeader(date)}
          </h3>
          <ul className="space-y-2">
            {items.map((it) => {
              const Icon = ICON_MAP[it.source_module] ?? Gear;
              const label = activityLabel(it.type);
              const corpo = (it.reason ?? "").trim() || summarizePayload(it.payload);
              const forma = actorShape(it.actor_kind ?? null);
              const quem = actorName(it.actor_kind ?? null, {
                agente: it.actor_agent_name,
                usuario: it.actor_user_name,
              });
              const time = formatarHora(it.performed_at);
              return (
                <li
                  key={it.id}
                  className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
                >
                  {/* Marcador por ator: preenchido = humano, anel = agente, quadrado = sistema. */}
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-accent",
                      forma === "filled" && "rounded-full bg-accent-soft",
                      forma === "ring" && "rounded-full border border-accent bg-surface ring-1 ring-inset ring-accent/40",
                      forma === "dashed" && "rounded-full border border-dashed border-border-strong",
                    )}
                    aria-hidden
                  >
                    <Icon size={16} weight="duotone" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {label}
                        {quem && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            · {quem}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{time}</span>
                    </div>
                    {corpo && (
                      <p className="mt-1 truncate text-sm text-muted-foreground" title={corpo}>
                        {corpo}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      )}
    </div>
  );
}
