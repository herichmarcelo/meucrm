"use client";
import React, { createContext, useContext, useMemo } from "react";
import {
  formatarHora,
  formatarDataHora,
  formatarData,
  FUSO_PADRAO,
  FORMATO_HORA_PADRAO,
  type FormatoHora,
} from "./formato";

export interface TempoContextValue {
  timezone: string;
  timeFormat: FormatoHora;
  is12h: boolean;
  formatarHora: (data: Date | string | number) => string;
  formatarDataHora: (data: Date | string | number) => string;
  formatarData: (data: Date | string | number) => string;
}

const DEFAULT_VALUE: TempoContextValue = {
  timezone: FUSO_PADRAO,
  timeFormat: FORMATO_HORA_PADRAO,
  is12h: false,
  formatarHora: (d) => formatarHora(d, { timezone: FUSO_PADRAO, timeFormat: FORMATO_HORA_PADRAO }),
  formatarDataHora: (d) => formatarDataHora(d, { timezone: FUSO_PADRAO, timeFormat: FORMATO_HORA_PADRAO }),
  formatarData: (d) => formatarData(d, { timezone: FUSO_PADRAO }),
};

const TempoCtx = createContext<TempoContextValue>(DEFAULT_VALUE);

export function TempoProvider({
  timezone,
  timeFormat,
  children,
}: {
  timezone?: string | null;
  timeFormat?: FormatoHora | string | null;
  children: React.ReactNode;
}) {
  const tz = timezone && timezone.trim() ? timezone.trim() : FUSO_PADRAO;
  const tf: FormatoHora = timeFormat === "12h" ? "12h" : "24h";
  const is12h = tf === "12h";

  const value = useMemo<TempoContextValue>(() => {
    return {
      timezone: tz,
      timeFormat: tf,
      is12h,
      formatarHora: (d) => formatarHora(d, { timezone: tz, timeFormat: tf }),
      formatarDataHora: (d) => formatarDataHora(d, { timezone: tz, timeFormat: tf }),
      formatarData: (d) => formatarData(d, { timezone: tz, timeFormat: tf }),
    };
  }, [tz, tf, is12h]);

  return <TempoCtx.Provider value={value}>{children}</TempoCtx.Provider>;
}

/**
 * Hook universal para acessar fuso e formatadores de data e hora do usuário atual.
 */
export function useTempo(): TempoContextValue {
  return useContext(TempoCtx);
}
