"use client";

import React, { useState, useEffect } from "react";
import {
  format,
  parse,
  isValid,
  addMonths,
  subMonths,
  setMonth,
  setYear,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar, CaretLeft, CaretRight, X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

export interface DatePickerProps {
  id?: string;
  name?: string;
  value?: string; // Formato ISO: YYYY-MM-DD
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  className?: string;
}

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const DIAS_DA_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function DatePicker({
  id,
  name,
  value = "",
  onChange,
  placeholder = "dd/mm/aaaa",
  disabled = false,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  // Data selecionada válida
  const selectedDate = React.useMemo(() => {
    if (!value) return null;
    const parsed = parse(value, "yyyy-MM-dd", new Date());
    return isValid(parsed) ? parsed : null;
  }, [value]);

  // Mês e ano atualmente visualizados no calendário
  const [currentMonth, setCurrentMonth] = useState<Date>(() => selectedDate || new Date());

  useEffect(() => {
    if (selectedDate) {
      setCurrentMonth(selectedDate);
    }
  }, [selectedDate]);

  const handleSelectDay = (day: Date) => {
    const formatted = format(day, "yyyy-MM-dd");
    onChange?.(formatted);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.("");
  };

  const handleToday = () => {
    const today = new Date();
    const formatted = format(today, "yyyy-MM-dd");
    onChange?.(formatted);
    setCurrentMonth(today);
    setOpen(false);
  };

  // Geração da grade de dias (sempre alinhada ao calendário brasileiro)
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { locale: ptBR });
  const endDate = endOfWeek(monthEnd, { locale: ptBR });

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  // Lista de anos para seleção rápida (10 anos atrás a 10 anos à frente)
  const currentYear = currentMonth.getFullYear();
  const years = Array.from({ length: 21 }, (_, i) => currentYear - 10 + i);

  // Formatação amigável em português: dd/mm/aaaa
  const displayText = selectedDate ? format(selectedDate, "dd/MM/yyyy") : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          name={name}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 text-left font-normal transition-colors",
            !displayText && "text-muted-foreground",
            className,
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <Calendar size={16} className="text-muted-foreground shrink-0" aria-hidden />
            <span>{displayText || placeholder}</span>
          </div>
          {displayText && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange?.("");
                }
              }}
              className="ml-1 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Limpar data"
            >
              <X size={14} aria-hidden />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3 shadow-lg rounded-lg border bg-popover text-popover-foreground z-50" align="start">
        {/* Navegação de Mês e Ano */}
        <div className="flex items-center justify-between gap-1 pb-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            aria-label="Mês anterior"
          >
            <CaretLeft size={16} />
          </Button>

          <div className="flex items-center gap-1.5 font-medium text-sm">
            <select
              value={currentMonth.getMonth()}
              onChange={(e) => setCurrentMonth(setMonth(currentMonth, parseInt(e.target.value, 10)))}
              className="h-7 rounded border border-border bg-background px-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
            >
              {MESES.map((nome, idx) => (
                <option key={nome} value={idx}>
                  {nome}
                </option>
              ))}
            </select>

            <select
              value={currentMonth.getFullYear()}
              onChange={(e) => setCurrentMonth(setYear(currentMonth, parseInt(e.target.value, 10)))}
              className="h-7 rounded border border-border bg-background px-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            aria-label="Próximo mês"
          >
            <CaretRight size={16} />
          </Button>
        </div>

        {/* Cabeçalho dos Dias da Semana */}
        <div className="grid grid-cols-7 gap-1 text-center mb-1">
          {DIAS_DA_SEMANA.map((dia) => (
            <div key={dia} className="text-[11px] font-semibold text-muted-foreground h-7 flex items-center justify-center">
              {dia}
            </div>
          ))}
        </div>

        {/* Grade de Dias */}
        <div className="grid grid-cols-7 gap-1 text-center">
          {days.map((day, idx) => {
            const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
            const isCurrentMonth = isSameMonth(day, currentMonth);
            const isDayToday = isToday(day);

            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectDay(day)}
                className={cn(
                  "h-8 w-8 rounded-md text-xs font-medium transition-all flex items-center justify-center",
                  isCurrentMonth ? "text-foreground" : "text-muted-foreground/40",
                  "hover:bg-accent hover:text-accent-foreground",
                  isDayToday && !isSelected && "border border-primary font-bold text-primary",
                  isSelected && "bg-primary text-primary-foreground font-bold hover:bg-primary hover:text-primary-foreground shadow-sm",
                )}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>

        {/* Rodapé: Limpar e Hoje */}
        <div className="flex items-center justify-between border-t border-border mt-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange?.("");
              setOpen(false);
            }}
          >
            Limpar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs font-medium"
            onClick={handleToday}
          >
            Hoje
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
