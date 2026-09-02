"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { addMinutes, format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Clock, ClockCounterClockwise, X, PencilSimple, Sparkle, Calendar } from "@/lib/ui/icons";
import {
  useScheduledMessages,
  useCancelScheduledMessage,
  useUpdateScheduledMessage,
  useCreateScheduledMessage,
  type ScheduledMessage,
  type ScheduledMessageStatus,
} from "@/hooks/inbox/useScheduledMessages";
import { renderScheduledPlaceholders } from "@/lib/inbox/scheduled-placeholders";
import {
  calcularOcorrenciasRecorrentes,
  DIAS_DA_SEMANA,
} from "@/lib/inbox/scheduled-recurrence";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTempo } from "@/lib/tempo/TempoProvider";

interface Props {
  contactId: string;
  conversationId?: string | null;
  contactName?: string | null;
  onScheduledCountChange?: (count: number) => void;
}

const STATUS_CONFIG: Record<
  ScheduledMessageStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }
> = {
  pending: {
    label: "Pendente",
    variant: "outline",
    className: "border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10",
  },
  sent: {
    label: "Enviada",
    variant: "outline",
    className: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
  },
  failed: {
    label: "Falhou",
    variant: "destructive",
    className: "",
  },
  cancelled: {
    label: "Cancelada",
    variant: "secondary",
    className: "text-muted-foreground opacity-70",
  },
};

const QUICK_TAGS = [
  { label: "{nome}", tag: "{nome}", desc: "Nome completo do contato" },
  { label: "{data}", tag: "{data}", desc: "Data do envio (dd/mm/aaaa)" },
  { label: "{hora}", tag: "{hora}", desc: "Hora do envio (hh:mm)" },
  { label: "{hoje}", tag: "{hoje}", desc: "Data de hoje" },
  { label: "{amanha}", tag: "{amanha}", desc: "Data de amanhã" },
];

function ScheduledMessageModal({
  message,
  open,
  onOpenChange,
  contactId,
  conversationId,
  contactName,
}: {
  message: ScheduledMessage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  conversationId?: string | null;
  contactName?: string | null;
}) {
  const isPending = message?.status === "pending";

  const [body, setBody] = useState("");
  const [scheduledMode, setScheduledMode] = useState<"single" | "recurring">("single");
  const [scheduledFor, setScheduledFor] = useState("");

  // Estados de Recorrência / Lembrete
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // Seg a Sex default
  const [recurringTime, setRecurringTime] = useState("09:00");
  const [durationWeeks, setDurationWeeks] = useState<number>(2); // 2 semanas default

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const updateMutation = useUpdateScheduledMessage();
  const createMutation = useCreateScheduledMessage();
  const cancelMutation = useCancelScheduledMessage();

  useEffect(() => {
    if (message && open) {
      setBody(message.raw_body);
      setScheduledMode("single");
      if (message.status === "pending") {
        const d = new Date(message.scheduled_for);
        setScheduledFor(
          !isNaN(d.getTime())
            ? format(d, "yyyy-MM-dd'T'HH:mm")
            : format(addMinutes(new Date(), 10), "yyyy-MM-dd'T'HH:mm"),
        );
      } else {
        setScheduledFor(format(addMinutes(new Date(), 10), "yyyy-MM-dd'T'HH:mm"));
      }
    }
  }, [message, open]);

  // Cálculo das ocorrências recorrentes
  const calculatedOccurrences = useMemo(() => {
    if (scheduledMode !== "recurring") return [];
    return calcularOcorrenciasRecorrentes({
      diasDaSemana: selectedDays,
      horario: recurringTime,
      duracaoDias: durationWeeks * 7,
    });
  }, [scheduledMode, selectedDays, recurringTime, durationWeeks]);

  // Preview dinâmico em tempo real
  const previewText = useMemo(() => {
    let sendDate = new Date();
    if (scheduledMode === "single" && scheduledFor) {
      const parsed = new Date(scheduledFor);
      if (!isNaN(parsed.getTime())) sendDate = parsed;
    } else if (scheduledMode === "recurring" && calculatedOccurrences.length > 0 && calculatedOccurrences[0]) {
      sendDate = calculatedOccurrences[0];
    }

    return renderScheduledPlaceholders(body, {
      nome: contactName,
      dataHoraEnvio: sendDate,
    });
  }, [body, contactName, scheduledMode, scheduledFor, calculatedOccurrences]);

  if (!message) return null;

  const toggleDay = (dayId: number) => {
    setSelectedDays((prev) =>
      prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId].sort((a, b) => a - b),
    );
  };

  const insertTagAtCursor = (tag: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBody((prev) => prev + tag);
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentText = body;
    const updated = currentText.substring(0, start) + tag + currentText.substring(end);
    setBody(updated);

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  const handleSaveOrReschedule = async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      toast.error("Por favor, informe o texto da mensagem.");
      return;
    }

    if (isPending) {
      // Edição de agendamento pendente
      const sendDate = new Date(scheduledFor);
      if (isNaN(sendDate.getTime()) || sendDate.getTime() <= Date.now()) {
        toast.error("Por favor, selecione uma data e horário no futuro.");
        return;
      }

      await updateMutation.mutateAsync({
        id: message.id,
        contact_id: contactId,
        raw_body: trimmedBody,
        scheduled_for: sendDate.toISOString(),
      });
    } else {
      // Reaproveitamento (cria novo agendamento ou lembrete recorrente)
      if (scheduledMode === "single") {
        const sendDate = new Date(scheduledFor);
        if (isNaN(sendDate.getTime()) || sendDate.getTime() <= Date.now()) {
          toast.error("Por favor, selecione uma data e horário no futuro.");
          return;
        }

        await createMutation.mutateAsync({
          contact_id: contactId,
          conversation_id: conversationId ?? message.conversation_id,
          template_id: message.template_id,
          raw_body: trimmedBody,
          scheduled_for: sendDate.toISOString(),
        });
      } else {
        // Modo recorrente
        if (calculatedOccurrences.length === 0) {
          toast.error("Nenhuma data futura encontrada com os dias e horário selecionados.");
          return;
        }

        const items = calculatedOccurrences.map((date) => ({
          conversation_id: conversationId ?? message.conversation_id,
          template_id: message.template_id,
          raw_body: trimmedBody,
          scheduled_for: date.toISOString(),
        }));

        await createMutation.mutateAsync({
          contact_id: contactId,
          items,
        });
      }
    }

    onOpenChange(false);
  };

  const handleCancel = async () => {
    if (confirm("Tem certeza que deseja cancelar esta mensagem agendada?")) {
      await cancelMutation.mutateAsync({ id: message.id, contact_id: contactId });
      onOpenChange(false);
    }
  };

  const isSaving = updateMutation.isPending || createMutation.isPending || cancelMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            {isPending ? (
              <>
                <PencilSimple size={18} className="text-primary" weight="duotone" />
                Editar Mensagem Agendada
              </>
            ) : (
              <>
                <ClockCounterClockwise size={18} className="text-primary" weight="duotone" />
                Reaproveitar Mensagem Agendada
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isPending
              ? "Altere o texto, adicione tags dinâmicas ou modifique a data e hora do envio."
              : "Reutilize o texto desta mensagem para um novo agendamento único ou lembrete recorrente."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5 py-2">
          {/* Mensagem e tags */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="scheduled-edit-body" className="text-xs font-medium">
                Corpo da Mensagem
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Clique nas tags para inserir
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_TAGS.map((q) => (
                <button
                  key={q.tag}
                  type="button"
                  title={q.desc}
                  onClick={() => insertTagAtCursor(q.tag)}
                  className="rounded border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-mono font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>

            <Textarea
              id="scheduled-edit-body"
              ref={textareaRef}
              rows={3}
              placeholder="Digite o texto da mensagem..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="resize-y text-xs font-sans leading-relaxed"
            />
          </div>

          {/* Prévia dinâmica */}
          {body.trim() && (
            <div className="rounded-md border border-border/70 bg-muted/40 p-2.5 text-xs text-foreground">
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                <Sparkle size={12} className="text-primary" />
                Prévia com dados preenchidos:
              </div>
              <p className="whitespace-pre-wrap break-words leading-relaxed text-xs">
                {previewText || "(vazio)"}
              </p>
            </div>
          )}

          {/* Se for criação/reaproveitamento, exibe abas: Único vs Recorrente */}
          {!isPending ? (
            <div className="space-y-2.5 rounded-lg border border-border/80 bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={scheduledMode === "single" ? "default" : "outline"}
                  className="h-7 text-xs font-medium"
                  onClick={() => setScheduledMode("single")}
                >
                  <Clock size={13} className="mr-1.5" />
                  Envio Único
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={scheduledMode === "recurring" ? "default" : "outline"}
                  className="h-7 text-xs font-medium"
                  onClick={() => setScheduledMode("recurring")}
                >
                  <Calendar size={13} className="mr-1.5" />
                  Lembrete Recorrente
                </Button>
              </div>

              {scheduledMode === "single" ? (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="scheduled-single-datetime" className="text-xs font-medium">
                    Data e Horário de Envio
                  </Label>
                  <DateTimePicker
                    id="scheduled-single-datetime"
                    value={scheduledFor}
                    onChange={setScheduledFor}
                  />
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  {/* Seleção de dias da semana */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Dias da Semana</Label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="text-[11px] text-primary hover:underline"
                          onClick={() => setSelectedDays([0, 1, 2, 3, 4, 5, 6])}
                        >
                          Todos os dias
                        </button>
                        <span className="text-[10px] text-muted-foreground">•</span>
                        <button
                          type="button"
                          className="text-[11px] text-primary hover:underline"
                          onClick={() => setSelectedDays([1, 2, 3, 4, 5])}
                        >
                          Seg a Sex
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {DIAS_DA_SEMANA.map((dia) => {
                        const isSelected = selectedDays.includes(dia.id);
                        return (
                          <button
                            key={dia.id}
                            type="button"
                            onClick={() => toggleDay(dia.id)}
                            className={cn(
                              "h-7 min-w-[38px] rounded-md border px-2 text-xs font-semibold transition-all",
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                          >
                            {dia.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Horário e Período */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="rec-time" className="text-xs font-medium">
                        Horário do Lembrete
                      </Label>
                      <Input
                        id="rec-time"
                        type="time"
                        value={recurringTime}
                        onChange={(e) => setRecurringTime(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="rec-dur" className="text-xs font-medium">
                        Período
                      </Label>
                      <select
                        id="rec-dur"
                        value={durationWeeks}
                        onChange={(e) => setDurationWeeks(Number(e.target.value))}
                        className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value={1}>Próximos 7 dias (1 semana)</option>
                        <option value={2}>Próximos 14 dias (2 semanas)</option>
                        <option value={4}>Próximos 30 dias (1 mês)</option>
                        <option value={8}>Próximas 8 semanas (2 meses)</option>
                      </select>
                    </div>
                  </div>

                  {/* Resumo de disparos */}
                  <div className="rounded border border-primary/20 bg-primary/5 p-2 text-[11px] text-foreground">
                    📅{" "}
                    <span className="font-semibold text-primary">
                      {calculatedOccurrences.length} disparo(s)
                    </span>{" "}
                    calculado(s) às <span className="font-semibold">{recurringTime}</span> para os
                    dias selecionados.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="scheduled-edit-datetime" className="text-xs font-medium">
                Data e Horário de Envio
              </Label>
              <DateTimePicker
                id="scheduled-edit-datetime"
                value={scheduledFor}
                onChange={setScheduledFor}
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2">
          {isPending ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={isSaving}
              onClick={handleCancel}
            >
              <X size={13} className="mr-1" />
              Cancelar Agendamento
            </Button>
          ) : (
            <div />
          )}

          <div className="flex w-full sm:w-auto items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              size="sm"
              className="text-xs"
              disabled={isSaving}
              onClick={handleSaveOrReschedule}
            >
              {isPending ? (
                <>
                  <PencilSimple size={13} className="mr-1.5" />
                  {isSaving ? "Salvando..." : "Salvar Alterações"}
                </>
              ) : (
                <>
                  <Clock size={13} className="mr-1.5" />
                  {isSaving
                    ? "Agendando..."
                    : scheduledMode === "recurring"
                      ? `Agendar ${calculatedOccurrences.length} Lembrete(s)`
                      : "Agendar Mensagem"}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScheduledMessagesSection({
  contactId,
  conversationId,
  contactName,
  onScheduledCountChange,
}: Props) {
  const { data: rawMessages, isLoading, error } = useScheduledMessages(contactId);
  const messages: ScheduledMessage[] = Array.isArray(rawMessages) ? rawMessages : [];
  const cancelMutation = useCancelScheduledMessage();
  const { formatarDataHora } = useTempo();
  const [selectedMessage, setSelectedMessage] = useState<ScheduledMessage | null>(null);

  const pendingCount = messages.filter((m) => m.status === "pending").length;

  useEffect(() => {
    onScheduledCountChange?.(pendingCount);
  }, [pendingCount, onScheduledCountChange]);

  if (isLoading) {
    return (
      <section data-testid="inbox-mensagens-agendadas" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Mensagens Agendadas
        </h3>
        <Skeleton className="h-16 w-full" />
      </section>
    );
  }

  if (error || !messages) {
    return null;
  }

  const handleQuickCancel = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Tem certeza que deseja cancelar esta mensagem agendada?")) {
      await cancelMutation.mutateAsync({ id, contact_id: contactId });
    }
  };

  return (
    <section data-testid="inbox-mensagens-agendadas">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Mensagens Agendadas
        </h3>
        {messages.length > 0 && (
          <span className="text-[11px] font-medium text-muted-foreground">
            {pendingCount} pendente(s)
          </span>
        )}
      </div>

      {messages.length === 0 ? (
        <p className="mt-2 text-xs italic text-muted-foreground">
          Nenhuma mensagem agendada para este contato.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {messages.map((m) => {
            const cfg = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.pending;
            const scheduledDate = new Date(m.scheduled_for);
            const formattedDate = !isNaN(scheduledDate.getTime())
              ? formatarDataHora(scheduledDate)
              : m.scheduled_for;

            return (
              <li
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedMessage(m)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedMessage(m);
                  }
                }}
                className="group relative cursor-pointer rounded-md border border-border bg-card p-2.5 text-xs shadow-sm transition-all hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Clock size={13} className="text-muted-foreground shrink-0" />
                    <span>{formattedDate}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge
                      variant={cfg.variant}
                      className={cn("h-4 px-1.5 text-[10px] font-semibold", cfg.className)}
                    >
                      {cfg.label}
                    </Badge>
                    {m.status === "pending" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Cancelar agendamento"
                        className="h-5 w-5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        disabled={cancelMutation.isPending}
                        onClick={(e) => handleQuickCancel(e, m.id)}
                      >
                        <X size={12} />
                      </Button>
                    )}
                  </div>
                </div>

                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                  {m.raw_body}
                </p>

                {m.template && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="font-semibold">Modelo:</span> {m.template.title}
                  </div>
                )}

                {m.status === "failed" && m.error_message && (
                  <div className="mt-1.5 rounded bg-destructive/10 p-1.5 text-[11px] text-destructive">
                    {m.error_message}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selectedMessage && (
        <ScheduledMessageModal
          message={selectedMessage}
          open={!!selectedMessage}
          onOpenChange={(open) => !open && setSelectedMessage(null)}
          contactId={contactId}
          conversationId={conversationId}
          contactName={contactName}
        />
      )}
    </section>
  );
}
