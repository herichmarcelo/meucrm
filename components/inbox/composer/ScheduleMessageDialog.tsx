"use client";
import { useMemo, useRef, useState } from "react";
import { addMinutes, format } from "date-fns";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Clock, Sparkle, Calendar } from "@/lib/ui/icons";
import { useMessageTemplates } from "@/hooks/inbox/useMessageTemplates";
import { useCreateScheduledMessage } from "@/hooks/inbox/useScheduledMessages";
import { renderScheduledPlaceholders } from "@/lib/inbox/scheduled-placeholders";
import {
  calcularOcorrenciasRecorrentes,
  DIAS_DA_SEMANA,
} from "@/lib/inbox/scheduled-recurrence";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  conversationId?: string | null;
  contactName?: string | null;
}

const QUICK_TAGS = [
  { label: "{nome}", tag: "{nome}", desc: "Nome completo do contato" },
  { label: "{data}", tag: "{data}", desc: "Data do envio (dd/mm/aaaa)" },
  { label: "{hora}", tag: "{hora}", desc: "Hora do envio (hh:mm)" },
  { label: "{hoje}", tag: "{hoje}", desc: "Data de hoje" },
  { label: "{amanha}", tag: "{amanha}", desc: "Data de amanhã" },
];

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  contactId,
  conversationId,
  contactName,
}: Props) {
  const [body, setBody] = useState("");
  const [scheduledMode, setScheduledMode] = useState<"single" | "recurring">("single");

  // Data inicial default: 10 minutos no futuro
  const [scheduledFor, setScheduledFor] = useState(() => {
    return format(addMinutes(new Date(), 10), "yyyy-MM-dd'T'HH:mm");
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Estados de Lembrete Recorrente
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // Seg a Sex
  const [recurringTime, setRecurringTime] = useState("09:00");
  const [durationWeeks, setDurationWeeks] = useState<number>(2);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const templates = useMessageTemplates();
  const createScheduled = useCreateScheduledMessage();

  // Cálculo de ocorrências recorrentes
  const calculatedOccurrences = useMemo(() => {
    if (scheduledMode !== "recurring") return [];
    return calcularOcorrenciasRecorrentes({
      diasDaSemana: selectedDays,
      horario: recurringTime,
      duracaoDias: durationWeeks * 7,
    });
  }, [scheduledMode, selectedDays, recurringTime, durationWeeks]);

  // Interpolação para o preview ao vivo
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

  const toggleDay = (dayId: number) => {
    setSelectedDays((prev) =>
      prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId].sort((a, b) => a - b),
    );
  };

  // Inserção da tag na posição atual do cursor na textarea
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

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId || templateId === "none") return;
    const found = templates.data?.find((t) => t.id === templateId);
    if (found) {
      setBody(found.body);
    }
  };

  const handleConfirm = async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      toast.error("Por favor, digite o texto da mensagem.");
      return;
    }

    const templateId = selectedTemplateId && selectedTemplateId !== "none" ? selectedTemplateId : null;

    if (scheduledMode === "single") {
      const sendDate = new Date(scheduledFor);
      if (isNaN(sendDate.getTime()) || sendDate.getTime() <= Date.now()) {
        toast.error("Por favor, selecione uma data e horário no futuro.");
        return;
      }

      await createScheduled.mutateAsync({
        contact_id: contactId,
        conversation_id: conversationId,
        template_id: templateId,
        raw_body: trimmedBody,
        scheduled_for: sendDate.toISOString(),
      });
    } else {
      if (calculatedOccurrences.length === 0) {
        toast.error("Nenhuma data futura encontrada com os dias e horário selecionados.");
        return;
      }

      const items = calculatedOccurrences.map((date) => ({
        conversation_id: conversationId,
        template_id: templateId,
        raw_body: trimmedBody,
        scheduled_for: date.toISOString(),
      }));

      await createScheduled.mutateAsync({
        contact_id: contactId,
        items,
      });
    }

    onOpenChange(false);
    setBody("");
    setSelectedTemplateId("");
    setScheduledMode("single");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Clock size={20} className="text-primary" weight="duotone" />
            Agendar Mensagem
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            A mensagem será enviada automaticamente na data e hora selecionadas.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5 py-2">
          {/* Seletor opcional de Template */}
          {templates.data && templates.data.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs font-medium">Usar modelo salvo (opcional)</Label>
              <Select value={selectedTemplateId} onValueChange={handleTemplateSelect}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione um modelo de mensagem..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">
                    Nenhum (escrever do zero)
                  </SelectItem>
                  {templates.data.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Textarea do corpo da mensagem */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="scheduled-body" className="text-xs font-medium">
                Corpo da Mensagem
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Clique nas tags para inserir
              </span>
            </div>

            {/* Barra de inserção rápida de tags */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TAGS.map((q) => (
                <button
                  key={q.tag}
                  type="button"
                  onClick={() => insertTagAtCursor(q.tag)}
                  title={q.desc}
                  className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-mono font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  <Sparkle size={10} weight="duotone" />
                  {q.label}
                </button>
              ))}
            </div>

            <Textarea
              id="scheduled-body"
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Digite a mensagem ou selecione um modelo acima..."
              rows={3}
              className="resize-y text-xs font-sans leading-relaxed"
            />
          </div>

          {/* Prévia ao vivo */}
          {body.trim() && (
            <div className="space-y-1 rounded-md border border-border/70 bg-muted/40 p-2.5">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <Sparkle size={12} className="text-primary" />
                Prévia com dados preenchidos:
              </div>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                {previewText}
              </p>
            </div>
          )}

          {/* Seletor de Modo: Envio Único vs Lembrete Recorrente */}
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
                <Label htmlFor="scheduled-date" className="text-xs font-medium">
                  Data e Hora do Disparo
                </Label>
                <DateTimePicker
                  id="scheduled-date"
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
                    <Label htmlFor="rec-dialog-time" className="text-xs font-medium">
                      Horário do Lembrete
                    </Label>
                    <Input
                      id="rec-dialog-time"
                      type="time"
                      value={recurringTime}
                      onChange={(e) => setRecurringTime(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="rec-dialog-dur" className="text-xs font-medium">
                      Período
                    </Label>
                    <select
                      id="rec-dialog-dur"
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
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            className="text-xs"
            disabled={createScheduled.isPending || !body.trim()}
            onClick={handleConfirm}
          >
            {createScheduled.isPending
              ? "Agendando..."
              : scheduledMode === "recurring"
                ? `Agendar ${calculatedOccurrences.length} Lembrete(s)`
                : "Confirmar Agendamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
