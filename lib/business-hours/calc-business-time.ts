/**
 * lib/business-hours/calc-business-time.ts
 *
 * Funções puras para cálculo de expediente comercial e horas úteis.
 * Respeita slots por dia da semana (0-6), feriados e fuso horário IANA.
 */

import type { BusinessHoliday, BusinessHourSlot } from "./types";

const DOW_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface ZonedDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  dayOfWeek: number; // 0-6
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  dateStr: string; // YYYY-MM-DD
  timeMinutes: number; // hour * 60 + minute
  timeSeconds: number; // hour * 3600 + minute * 60 + second
}

/**
 * Decompõe uma data UTC nos componentes do fuso horário especificado.
 */
export function getZonedDateParts(date: Date, timeZone = "America/Sao_Paulo"): ZonedDateParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = dtf.formatToParts(date);
  let year = 1970;
  let month = 1;
  let day = 1;
  let dow = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const p of parts) {
    if (p.type === "year") year = Number.parseInt(p.value, 10);
    else if (p.type === "month") month = Number.parseInt(p.value, 10);
    else if (p.type === "day") day = Number.parseInt(p.value, 10);
    else if (p.type === "weekday") dow = DOW_MAP[p.value] ?? 0;
    else if (p.type === "hour") hour = Number.parseInt(p.value, 10);
    else if (p.type === "minute") minute = Number.parseInt(p.value, 10);
    else if (p.type === "second") second = Number.parseInt(p.value, 10);
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const dateStr = `${year}-${mm}-${dd}`;
  const timeMinutes = hour * 60 + minute;
  const timeSeconds = hour * 3600 + minute * 60 + second;

  return {
    year,
    month,
    day,
    dayOfWeek: dow,
    hour,
    minute,
    second,
    dateStr,
    timeMinutes,
    timeSeconds,
  };
}

/**
 * Converte string "HH:mm" ou "HH:mm:ss" em segundos desde o início do dia.
 */
export function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.split(":").map((v) => Number.parseInt(v, 10) || 0);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  return h * 3600 + m * 60 + s;
}

/**
 * Normaliza lista de feriados para um Set de strings "YYYY-MM-DD".
 */
export function normalizeHolidaysSet(holidays: (string | BusinessHoliday)[] = []): Set<string> {
  const set = new Set<string>();
  for (const h of holidays) {
    if (typeof h === "string") {
      set.add(h.trim().slice(0, 10));
    } else if (h && typeof h.holiday_date === "string") {
      set.add(h.holiday_date.trim().slice(0, 10));
    }
  }
  return set;
}

/**
 * Mapeia slots por dia da semana (0-6).
 */
export function indexSlotsByDay(slots: BusinessHourSlot[]): Map<number, BusinessHourSlot> {
  const map = new Map<number, BusinessHourSlot>();
  for (const slot of slots) {
    map.set(slot.day_of_week, slot);
  }
  return map;
}

/**
 * Verifica se a data informada está dentro do expediente comercial ativo.
 */
export function isExpedienteAtivo(
  date: Date,
  slots: BusinessHourSlot[],
  holidays: (string | BusinessHoliday)[] = [],
  timeZone = "America/Sao_Paulo",
): boolean {
  const parts = getZonedDateParts(date, timeZone);
  const holidaySet = normalizeHolidaysSet(holidays);

  if (holidaySet.has(parts.dateStr)) {
    return false;
  }

  const slotMap = indexSlotsByDay(slots);
  const slot = slotMap.get(parts.dayOfWeek);
  if (!slot || !slot.is_active) {
    return false;
  }

  const openSec = timeStringToSeconds(slot.open_time);
  const closeSec = timeStringToSeconds(slot.close_time);

  return parts.timeSeconds >= openSec && parts.timeSeconds < closeSec;
}

/**
 * Calcula os segundos úteis decorridos entre duas datas considerando o expediente.
 */
export function calcularSegundosUteis(
  inicio: Date,
  fim: Date,
  slots: BusinessHourSlot[],
  holidays: (string | BusinessHoliday)[] = [],
  timeZone = "America/Sao_Paulo",
): number {
  if (fim.getTime() <= inicio.getTime()) {
    return 0;
  }

  const holidaySet = normalizeHolidaysSet(holidays);
  const slotMap = indexSlotsByDay(slots);

  const startParts = getZonedDateParts(inicio, timeZone);
  const endParts = getZonedDateParts(fim, timeZone);

  // Se for no mesmo dia civil no fuso especificado:
  if (startParts.dateStr === endParts.dateStr) {
    if (holidaySet.has(startParts.dateStr)) return 0;
    const slot = slotMap.get(startParts.dayOfWeek);
    if (!slot || !slot.is_active) return 0;

    const openSec = timeStringToSeconds(slot.open_time);
    const closeSec = timeStringToSeconds(slot.close_time);

    const windowStart = Math.max(openSec, startParts.timeSeconds);
    const windowEnd = Math.min(closeSec, endParts.timeSeconds);

    return Math.max(0, windowEnd - windowStart);
  }

  // Se cruzar múltiplos dias civis:
  let totalSeconds = 0;

  // 1. Primeiro dia (a partir de startParts.timeSeconds até o fechamento do dia)
  if (!holidaySet.has(startParts.dateStr)) {
    const slot = slotMap.get(startParts.dayOfWeek);
    if (slot?.is_active) {
      const openSec = timeStringToSeconds(slot.open_time);
      const closeSec = timeStringToSeconds(slot.close_time);
      const windowStart = Math.max(openSec, startParts.timeSeconds);
      if (windowStart < closeSec) {
        totalSeconds += closeSec - windowStart;
      }
    }
  }

  // 2. Dias intermediários completos
  // Avança dia a dia a partir do dia seguinte a inicio às 00:00 UTC relativo
  // usando timestamps para iterar de forma estável
  let cursor = new Date(inicio.getTime() + 24 * 3600 * 1000);
  let cursorParts = getZonedDateParts(cursor, timeZone);

  // Enquanto cursor estiver antes do dia final (comparando dateStr)
  while (cursorParts.dateStr < endParts.dateStr) {
    if (!holidaySet.has(cursorParts.dateStr)) {
      const slot = slotMap.get(cursorParts.dayOfWeek);
      if (slot?.is_active) {
        const openSec = timeStringToSeconds(slot.open_time);
        const closeSec = timeStringToSeconds(slot.close_time);
        if (closeSec > openSec) {
          totalSeconds += closeSec - openSec;
        }
      }
    }

    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
    cursorParts = getZonedDateParts(cursor, timeZone);
  }

  // 3. Último dia (da abertura até endParts.timeSeconds)
  if (!holidaySet.has(endParts.dateStr)) {
    const slot = slotMap.get(endParts.dayOfWeek);
    if (slot?.is_active) {
      const openSec = timeStringToSeconds(slot.open_time);
      const closeSec = timeStringToSeconds(slot.close_time);
      const windowEnd = Math.min(closeSec, endParts.timeSeconds);
      if (windowEnd > openSec) {
        totalSeconds += windowEnd - openSec;
      }
    }
  }

  return totalSeconds;
}

/**
 * Calcula os minutos úteis decorridos entre duas datas (arredondado para baixo).
 */
export function calcularMinutosUteis(
  inicio: Date,
  fim: Date,
  slots: BusinessHourSlot[],
  holidays: (string | BusinessHoliday)[] = [],
  timeZone = "America/Sao_Paulo",
): number {
  return Math.floor(calcularSegundosUteis(inicio, fim, slots, holidays, timeZone) / 60);
}

/**
 * Converte componentes de data civil e segundos do dia de volta para Date UTC no fuso horário informado.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone = "America/Sao_Paulo",
): Date {
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const invParts = getZonedDateParts(utcDate, timeZone);
  const asLocalInUtc = Date.UTC(
    invParts.year,
    invParts.month - 1,
    invParts.day,
    invParts.hour,
    invParts.minute,
    invParts.second,
  );
  const offsetMs = asLocalInUtc - utcDate.getTime();
  return new Date(utcDate.getTime() - offsetMs);
}

function makeZonedDate(year: number, month: number, day: number, secondsInDay: number, timeZone: string): Date {
  const h = Math.floor(secondsInDay / 3600);
  const m = Math.floor((secondsInDay % 3600) / 60);
  const s = secondsInDay % 60;
  return zonedTimeToUtc(year, month, day, h, m, s, timeZone);
}

/**
 * Adiciona minutos úteis a uma data, projetando o prazo final no futuro considerando expediente.
 */
export function adicionarMinutosUteis(
  inicio: Date,
  minutosUteis: number,
  slots: BusinessHourSlot[],
  holidays: (string | BusinessHoliday)[] = [],
  timeZone = "America/Sao_Paulo",
): Date {
  if (minutosUteis <= 0) {
    return new Date(inicio.getTime());
  }

  let segundosRestantes = minutosUteis * 60;
  const holidaySet = normalizeHolidaysSet(holidays);
  const slotMap = indexSlotsByDay(slots);

  let currentParts = getZonedDateParts(inicio, timeZone);
  let currentDate = new Date(inicio.getTime());

  // Limite defensivo para evitar loops infinitos (ex: 365 dias)
  const maxDays = 365;
  let daysCount = 0;

  while (segundosRestantes > 0 && daysCount < maxDays) {
    daysCount++;
    const isHoliday = holidaySet.has(currentParts.dateStr);
    const slot = slotMap.get(currentParts.dayOfWeek);

    if (!isHoliday && slot?.is_active) {
      const openSec = timeStringToSeconds(slot.open_time);
      const closeSec = timeStringToSeconds(slot.close_time);

      // Ponto de início neste dia
      const startSec = Math.max(openSec, currentParts.timeSeconds);

      if (startSec < closeSec) {
        const segundosDisponiveisHoje = closeSec - startSec;

        if (segundosRestantes <= segundosDisponiveisHoje) {
          const finalSec = startSec + segundosRestantes;
          return makeZonedDate(
            currentParts.year,
            currentParts.month,
            currentParts.day,
            finalSec,
            timeZone,
          );
        }

        segundosRestantes -= segundosDisponiveisHoje;
      }
    }

    // Avança para o início do próximo dia civil
    const nextDayApproximation = new Date(currentDate.getTime() + 24 * 3600 * 1000);
    const nextParts = getZonedDateParts(nextDayApproximation, timeZone);
    const nextSlot = slotMap.get(nextParts.dayOfWeek);
    const nextOpenSec = nextSlot?.is_active ? timeStringToSeconds(nextSlot.open_time) : 0;

    currentDate = makeZonedDate(nextParts.year, nextParts.month, nextParts.day, nextOpenSec, timeZone);
    currentParts = getZonedDateParts(currentDate, timeZone);
  }

  return currentDate;
}
