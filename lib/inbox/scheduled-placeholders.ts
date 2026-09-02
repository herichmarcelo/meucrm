/**
 * lib/inbox/scheduled-placeholders.ts — Resolver puro de placeholders dinâmicos em mensagens agendadas.
 *
 * Suporta tags no formato {tag} e {{tag}}:
 * - {nome} / {{nome}}: Nome do contato (ou "Cliente" como fallback quando nulo/vazio)
 * - {primeiro_nome} / {{primeiro_nome}}: Primeiro nome do contato
 * - {data} / {{data}}: Data do envio no formato dd/MM/yyyy
 * - {hora} / {{hora}}: Hora do envio no formato HH:mm
 * - {hoje} / {{hoje}}: Data de hoje no formato dd/MM/yyyy
 * - {amanha} / {{amanha}}: Data de amanhã no formato dd/MM/yyyy
 *
 * Tags desconhecidas são preservadas exatamente como escritas para não corromper o texto da mensagem.
 */
import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";

export interface ScheduledPlaceholderContext {
  nome?: string | null;
  dataHoraEnvio?: Date | string | null;
}

export function renderScheduledPlaceholders(body: string, ctx: ScheduledPlaceholderContext): string {
  if (!body) return "";

  const sendDate = ctx.dataHoraEnvio
    ? typeof ctx.dataHoraEnvio === "string"
      ? new Date(ctx.dataHoraEnvio)
      : ctx.dataHoraEnvio
    : new Date();

  // Validar se a data é válida, fallback para now
  const validSendDate = isNaN(sendDate.getTime()) ? new Date() : sendDate;

  const nomeCompleto = (ctx.nome ?? "").trim();
  const nomeExibicao = nomeCompleto !== "" ? nomeCompleto : "Cliente";
  const primeiroNome = nomeCompleto.split(/\s+/)[0] || "Cliente";

  const dataFormatada = format(validSendDate, "dd/MM/yyyy", { locale: ptBR });
  const horaFormatada = format(validSendDate, "HH:mm", { locale: ptBR });
  const hojeFormatado = format(validSendDate, "dd/MM/yyyy", { locale: ptBR });
  const amanhaFormatado = format(addDays(validSendDate, 1), "dd/MM/yyyy", { locale: ptBR });

  // Substitui tanto {var} quanto {{var}}
  return body.replace(/\{\{?\s*([a-zA-Z_0-9]+)\s*\}?\}/g, (match, rawTag: string) => {
    const tag = rawTag.toLowerCase();
    switch (tag) {
      case "nome":
        return nomeExibicao;
      case "primeiro_nome":
        return primeiroNome;
      case "data":
        return dataFormatada;
      case "hora":
        return horaFormatada;
      case "hoje":
        return hojeFormatado;
      case "amanha":
      case "amanhã":
        return amanhaFormatado;
      default:
        // Mantém a tag desconhecida como está
        return match;
    }
  });
}
