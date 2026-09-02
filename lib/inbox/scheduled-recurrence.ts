import { addDays, startOfDay, isAfter } from "date-fns";

export interface RecurrenceOptions {
  /** Dias da semana selecionados (0 = Domingo, 1 = Segunda, ..., 6 = Sábado) */
  diasDaSemana: number[];
  /** Horário no formato "HH:mm" (ex: "09:00", "14:30") */
  horario: string;
  /** Data base inicial (padrão: agora) */
  dataInicio?: Date;
  /** Duração em dias a partir de dataInicio (ex: 7, 14, 30) */
  duracaoDias?: number;
  /** Data limite máxima (alternativa a duracaoDias) */
  dataFim?: Date;
  /** Limite máximo de ocorrências de segurança (padrão: 60) */
  maxOcorrencias?: number;
}

export const DIAS_DA_SEMANA = [
  { id: 0, label: "Dom", fullLabel: "Domingo" },
  { id: 1, label: "Seg", fullLabel: "Segunda-feira" },
  { id: 2, label: "Ter", fullLabel: "Terça-feira" },
  { id: 3, label: "Qua", fullLabel: "Quarta-feira" },
  { id: 4, label: "Qui", fullLabel: "Quinta-feira" },
  { id: 5, label: "Sex", fullLabel: "Sexta-feira" },
  { id: 6, label: "Sáb", fullLabel: "Sábado" },
] as const;

/**
 * Calcula todas as ocorrências de datas/horas futuras para um agendamento recorrente.
 */
export function calcularOcorrenciasRecorrentes(options: RecurrenceOptions): Date[] {
  const {
    diasDaSemana,
    horario,
    dataInicio = new Date(),
    duracaoDias = 14,
    dataFim: customDataFim,
    maxOcorrencias = 60,
  } = options;

  if (!diasDaSemana || diasDaSemana.length === 0) {
    return [];
  }

  const [hoursStr, minutesStr] = horario.split(":");
  const hours = parseInt(hoursStr ?? "9", 10);
  const minutes = parseInt(minutesStr ?? "0", 10);

  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return [];
  }

  const agora = new Date();
  const limiteFim = customDataFim ?? addDays(startOfDay(dataInicio), duracaoDias);
  const ocorrencias: Date[] = [];

  let cursor = startOfDay(dataInicio);

  while (!isAfter(cursor, limiteFim) && ocorrencias.length < maxOcorrencias) {
    const dayOfWeek = cursor.getDay();

    if (diasDaSemana.includes(dayOfWeek)) {
      const scheduledDate = new Date(cursor);
      scheduledDate.setHours(hours, minutes, 0, 0);

      // Apenas adiciona se o horário estiver no futuro
      if (scheduledDate.getTime() > agora.getTime()) {
        ocorrencias.push(scheduledDate);
      }
    }

    cursor = addDays(cursor, 1);
  }

  return ocorrencias;
}
