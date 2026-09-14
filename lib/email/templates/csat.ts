/**
 * lib/email/templates/csat.ts — Template de e-mail para pesquisa de satisfação CSAT.
 */
import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";

export interface CsatEmailOptions {
  clientName?: string | null;
  surveyBaseUrl: string;
  marca: MarcaDeSaida;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildCsatEmail(opts: CsatEmailOptions): {
  subject: string;
  html: string;
  text: string;
} {
  const marcaNome = opts.marca.nome;
  const subject = `Pesquisa de Satisfação: Como foi seu atendimento? - ${marcaNome}`;
  const saudacao = opts.clientName?.trim()
    ? `Olá, ${escapeHtml(opts.clientName.trim())}!`
    : "Olá!";

  const logo = opts.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapeHtml(opts.marca.logoUrl)}" alt="${escapeHtml(marcaNome)}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";

  const starScores = [
    { score: 1, label: "⭐ Péssimo" },
    { score: 2, label: "⭐⭐ Ruim" },
    { score: 3, label: "⭐⭐⭐ Regular" },
    { score: 4, label: "⭐⭐⭐⭐ Bom" },
    { score: 5, label: "⭐⭐⭐⭐⭐ Excelente" },
  ];

  const starButtonsHtml = starScores
    .map(
      (s) => `
      <a href="${escapeHtml(`${opts.surveyBaseUrl}?score=${s.score}`)}" 
         style="display: inline-block; margin: 4px 6px; padding: 10px 16px; background-color: ${opts.marca.accent}; color: ${opts.marca.accentFg}; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
        ${s.label}
      </a>
    `,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px 0;background-color:${NEUTROS_DE_SAIDA.fundo};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${NEUTROS_DE_SAIDA.texto};">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid ${NEUTROS_DE_SAIDA.linha};border-radius:8px;padding:32px;margin:0 16px;" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td>
              ${logo}
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${NEUTROS_DE_SAIDA.texto};">${saudacao}</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:${NEUTROS_DE_SAIDA.texto};">
                Seu atendimento recente na <strong>${escapeHtml(marcaNome)}</strong> foi finalizado. Gostaríamos de saber como foi sua experiência para continuar aprimorando nosso suporte.
              </p>
              <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${NEUTROS_DE_SAIDA.texto};text-align:center;">
                Como você avalia o atendimento recebido?
              </p>
              <div style="text-align: center; margin: 24px 0 32px;">
                ${starButtonsHtml}
              </div>
              <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${NEUTROS_DE_SAIDA.linha};font-size:12px;line-height:1.4;color:${NEUTROS_DE_SAIDA.suave};text-align:center;">
                Leva menos de 1 minuto e sua opinião é essencial para nossa equipe.<br>
                ${escapeHtml(marcaNome)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const starButtonsText = starScores
    .map((s) => `${s.label}: ${opts.surveyBaseUrl}?score=${s.score}`)
    .join("\n");

  const text = `${saudacao}

Seu atendimento recente na ${marcaNome} foi finalizado.
Como você avalia o atendimento recebido?

${starButtonsText}

Leva menos de 1 minuto e sua opinião é essencial para nossa equipe.
${marcaNome}`;

  return { subject, html, text };
}
