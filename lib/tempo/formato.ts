/**
 * Funções puras de formatação de data e hora para todo o sistema.
 *
 * Utiliza `Intl.DateTimeFormat` nativo do runtime para conversão precisa de fuso
 * horário IANA (incluindo America/Campo_Grande, America/Sao_Paulo, etc.) e suporte
 * a formato 24 horas ("14:30") ou 12 horas AM/PM ("02:30 PM").
 */
import { format } from "date-fns";

export type FormatoHora = "24h" | "12h";

export interface OpcoesFormatacaoTempo {
  timezone?: string | null;
  timeFormat?: FormatoHora | null;
  locale?: string | null;
}

export const FUSO_PADRAO = "America/Sao_Paulo";
export const FORMATO_HORA_PADRAO: FormatoHora = "24h";

/**
 * Formata apenas o horário: "14:30" (24h) ou "02:30 PM" (12h) no fuso especificado.
 */
export function formatarHora(
  data: Date | string | number,
  opcoes?: OpcoesFormatacaoTempo,
): string {
  const d = typeof data === "string" || typeof data === "number" ? new Date(data) : data;
  if (!d || isNaN(d.getTime())) return "";

  const tz = opcoes?.timezone || FUSO_PADRAO;
  const is12h = opcoes?.timeFormat === "12h";
  const loc = opcoes?.locale || "pt-BR";

  try {
    const dtf = new Intl.DateTimeFormat(loc, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: is12h,
    });
    return dtf.format(d);
  } catch {
    return format(d, is12h ? "hh:mm a" : "HH:mm");
  }
}

/**
 * Formata data e hora: "02/09/2026 14:30" (24h) ou "02/09/2026 02:30 PM" (12h).
 */
export function formatarDataHora(
  data: Date | string | number,
  opcoes?: OpcoesFormatacaoTempo,
): string {
  const d = typeof data === "string" || typeof data === "number" ? new Date(data) : data;
  if (!d || isNaN(d.getTime())) return "";

  const tz = opcoes?.timezone || FUSO_PADRAO;
  const is12h = opcoes?.timeFormat === "12h";
  const loc = opcoes?.locale || "pt-BR";

  try {
    const dtf = new Intl.DateTimeFormat(loc, {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: is12h,
    });
    return dtf.format(d);
  } catch {
    return format(d, is12h ? "dd/MM/yyyy hh:mm a" : "dd/MM/yyyy HH:mm");
  }
}

/**
 * Formata apenas a data no fuso especificado: "02/09/2026".
 */
export function formatarData(
  data: Date | string | number,
  opcoes?: OpcoesFormatacaoTempo,
): string {
  const d = typeof data === "string" || typeof data === "number" ? new Date(data) : data;
  if (!d || isNaN(d.getTime())) return "";

  const tz = opcoes?.timezone || FUSO_PADRAO;
  const loc = opcoes?.locale || "pt-BR";

  try {
    const dtf = new Intl.DateTimeFormat(loc, {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return dtf.format(d);
  } catch {
    return format(d, "dd/MM/yyyy");
  }
}
