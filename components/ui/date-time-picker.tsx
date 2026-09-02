"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  format,
  isValid,
  addMinutes,
  addHours,
  addDays,
  setHours,
  setMinutes,
  nextMonday,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Clock, Sparkle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { useTempo } from "@/lib/tempo/TempoProvider";

export interface DateTimePickerProps {
  id?: string;
  value?: string; // Formato ISO ou "YYYY-MM-DDTHH:mm"
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  minDate?: Date;
}

const COMMON_HOURS_24 = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
  "11:00", "11:30", "12:00", "13:00", "13:30", "14:00",
  "14:30", "15:00", "15:30", "16:00", "16:30", "17:00",
  "17:30", "18:00", "19:00", "20:00", "21:00", "22:00",
];

function TimePickerInput({
  value,
  onChange,
  disabled = false,
  is12h = false,
}: {
  value: string; // "HH:mm" (sempre 24h)
  onChange: (val24: string) => void;
  disabled?: boolean;
  is12h?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Extrai horas e minutos da string "HH:mm"
  const [h24Str, mStr] = useMemo(() => {
    const parts = (value || "09:00").split(":");
    const h = parseInt(parts[0] || "9", 10);
    const m = parseInt(parts[1] || "0", 10);
    const validH = isNaN(h) || h < 0 || h > 23 ? 9 : h;
    const validM = isNaN(m) || m < 0 || m > 59 ? 0 : m;
    return [
      String(validH).padStart(2, "0"),
      String(validM).padStart(2, "0"),
    ];
  }, [value]);

  const h24 = parseInt(h24Str, 10);
  const isPM = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const h12Str = String(h12).padStart(2, "0");

  const [textVal, setTextVal] = useState(is12h ? `${h12Str}:${mStr}` : `${h24Str}:${mStr}`);

  // Sincroniza quando o valor externo mudar
  useEffect(() => {
    setTextVal(is12h ? `${h12Str}:${mStr}` : `${h24Str}:${mStr}`);
  }, [h12Str, h24Str, mStr, is12h]);

  const handleBlur = () => {
    // Normaliza digitação
    const clean = textVal.trim().replace(/[^0-9:]/g, "");
    const parts = clean.split(":");
    const newH = parseInt(parts[0] || "0", 10);
    const newM = parseInt(parts[1] || "0", 10);
    const validM = Math.min(59, Math.max(0, isNaN(newM) ? 0 : newM));

    if (is12h) {
      const validH12 = Math.min(12, Math.max(1, isNaN(newH) ? 12 : newH));
      let finalH24 = validH12 % 12;
      if (isPM) finalH24 += 12;
      const finalStr = `${String(finalH24).padStart(2, "0")}:${String(validM).padStart(2, "0")}`;
      onChange(finalStr);
    } else {
      const validH24 = Math.min(23, Math.max(0, isNaN(newH) ? 0 : newH));
      const finalStr = `${String(validH24).padStart(2, "0")}:${String(validM).padStart(2, "0")}`;
      onChange(finalStr);
    }
  };

  const toggleAmPm = (targetIsPM: boolean) => {
    if (targetIsPM === isPM) return;
    let newH24 = h24;
    if (targetIsPM) {
      newH24 = (h24 % 12) + 12;
    } else {
      newH24 = h24 % 12;
    }
    onChange(`${String(newH24).padStart(2, "0")}:${mStr}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative flex items-center w-full">
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="absolute left-2.5 z-10 text-muted-foreground hover:text-foreground transition"
            aria-label="Selecionar horário"
          >
            <Clock size={14} aria-hidden />
          </button>
        </PopoverTrigger>

        <Input
          type="text"
          value={textVal}
          disabled={disabled}
          onChange={(e) => setTextVal(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleBlur();
              setOpen(false);
            }
          }}
          placeholder={is12h ? "hh:mm" : "HH:mm"}
          maxLength={5}
          className={cn(
            "h-9 pl-8 font-mono text-xs",
            is12h ? "pr-14" : "pr-2",
          )}
        />

        {is12h && (
          <div className="absolute right-1 flex items-center gap-0.5 rounded border border-border bg-muted/50 p-0.5 text-[10px] font-semibold">
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggleAmPm(false)}
              className={cn(
                "rounded px-1 py-0.5 transition",
                !isPM
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              AM
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => toggleAmPm(true)}
              className={cn(
                "rounded px-1 py-0.5 transition",
                isPM
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              PM
            </button>
          </div>
        )}
      </div>

      <PopoverContent className="w-56 p-2" align="end">
        <div className="text-[11px] font-semibold text-muted-foreground mb-1.5 px-1">
          Horários sugeridos ({is12h ? "12h AM/PM" : "24 horas"}):
        </div>
        <div className="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto pr-1">
          {COMMON_HOURS_24.map((time24) => {
            const [th24 = "0", tm = "00"] = time24.split(":");
            const numH = parseInt(th24, 10);
            let label = time24;
            if (is12h) {
              const th12 = numH % 12 === 0 ? 12 : numH % 12;
              const period = numH >= 12 ? "PM" : "AM";
              label = `${String(th12).padStart(2, "0")}:${tm} ${period}`;
            }

            const isSelected = value === time24;

            return (
              <button
                key={time24}
                type="button"
                onClick={() => {
                  onChange(time24);
                  setOpen(false);
                }}
                className={cn(
                  "rounded px-1.5 py-1 text-[11px] font-mono text-center transition",
                  isSelected
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {is12h ? label.replace(" ", "") : label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DateTimePicker({
  id,
  value = "",
  onChange,
  disabled = false,
  className,
}: DateTimePickerProps) {
  const { is12h, formatarHora } = useTempo();

  // Parsing seguro do valor
  const currentDate = useMemo(() => {
    if (!value) return null;
    const d = new Date(value);
    return isValid(d) ? d : null;
  }, [value]);

  const dateStr = useMemo(() => {
    return currentDate ? format(currentDate, "yyyy-MM-dd") : "";
  }, [currentDate]);

  const timeStr = useMemo(() => {
    return currentDate ? format(currentDate, "HH:mm") : "09:00";
  }, [currentDate]);

  const handleDateChange = (newDateStr: string) => {
    if (!newDateStr) {
      onChange?.("");
      return;
    }
    const combined = `${newDateStr}T${timeStr || "09:00"}`;
    onChange?.(combined);
  };

  const handleTimeChange = (newTime24: string) => {
    const baseDate = dateStr || format(new Date(), "yyyy-MM-dd");
    const combined = `${baseDate}T${newTime24 || "00:00"}`;
    onChange?.(combined);
  };

  const applyPreset = (date: Date) => {
    onChange?.(format(date, "yyyy-MM-dd'T'HH:mm"));
  };

  // Presets inteligentes
  const presets = useMemo(() => {
    const now = new Date();
    const presetsList = [
      {
        label: "+15 min",
        fn: () => addMinutes(now, 15),
      },
      {
        label: "+1 hora",
        fn: () => addHours(now, 1),
      },
      {
        label: "Hoje às 18h",
        fn: () => setMinutes(setHours(now, 18), 0),
      },
      {
        label: "Amanhã às 09h",
        fn: () => setMinutes(setHours(addDays(now, 1), 9), 0),
      },
      {
        label: "Amanhã às 14h",
        fn: () => setMinutes(setHours(addDays(now, 1), 14), 0),
      },
      {
        label: "Segunda às 09h",
        fn: () => setMinutes(setHours(nextMonday(now), 9), 0),
      },
    ];
    return presetsList;
  }, []);

  // Formatação legível em português do momento selecionado
  const readableSummary = useMemo(() => {
    if (!currentDate) return null;
    const dataExtenso = format(currentDate, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR });
    return `${dataExtenso} às ${formatarHora(currentDate)}`;
  }, [currentDate, formatarHora]);

  return (
    <div className={cn("space-y-2", className)} id={id}>
      {/* Linha com DatePicker do sistema e TimePicker integrado */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-2">
          <DatePicker
            value={dateStr}
            onChange={handleDateChange}
            disabled={disabled}
            placeholder="Selecione a data..."
            className="h-9 text-xs"
          />
        </div>
        <div className="flex items-center">
          <TimePickerInput
            value={timeStr}
            onChange={handleTimeChange}
            disabled={disabled}
            is12h={is12h}
          />
        </div>
      </div>

      {/* Botões de atalho rápido */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="text-[10px] uppercase font-semibold text-muted-foreground mr-1 flex items-center gap-1">
          <Sparkle size={10} weight="duotone" />
          Atalhos:
        </span>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={disabled}
            onClick={() => applyPreset(p.fn())}
            className="inline-flex items-center rounded border border-border bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Resumo formatado em português */}
      {readableSummary && (
        <div className="text-[11px] text-muted-foreground/90 capitalize-first flex items-center gap-1.5 pt-0.5">
          <span className="font-medium text-foreground">Programado para:</span>
          <span>{readableSummary}</span>
        </div>
      )}
    </div>
  );
}
