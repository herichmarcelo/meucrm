# Walkthrough: Reabertura, Reaproveitamento e Lembretes Recorrentes de Mensagens Agendadas

> **Data:** 2026-09-02  
> **Módulo:** Inbox, CRM Side Panel e Mensagens Agendadas  
> **Status:** Concluído e Validado (17/17 testes unitários verdes, typecheck e lint zerados)

---

## 1. Contexto e Necessidade do Usuário

1. **Simplificação de Clique no Card (Ponto 1):**  
   Remoção do botão extra redundante "Reaproveitar". Ao clicar diretamente em qualquer parte do card na barra lateral, a mensagem é imediatamente reaberta para edição (se pendente) ou reaproveitamento/novo agendamento (se enviada, cancelada ou falhada).
2. **Agendamento tipo Lembrete Recorrente (Ponto 2):**  
   Criação de agendamentos recorrentes com seleção flexível de dias da semana (`Dom`, `Seg`, `Ter`, `Qua`, `Qui`, `Sex`, `Sáb`), atalhos de seleção rápida ("Todos os dias", "Segunda a Sexta"), horário fixo de disparo e período de duração (1 semana, 2 semanas, 1 mês, etc.).

---

## 2. O Que Foi Implementado

### A. Limpeza Visual e Clique Direto no Card (`ScheduledMessagesSection`)
* O card agora é limpo e 100% clicável:
  * Ao clicar em um card `Enviada`, `Falhou` ou `Cancelada`: abre o modal no modo de novo agendamento com o texto pré-preenchido.
  * Ao clicar em um card `Pendente`: abre o modal no modo de edição com o texto e horário atual.
  * Para mensagens pendentes, foi mantido apenas um botão discreto de cancelamento rápido (`X`) com parada de propagação do evento.

### B. Motor de Recorrência e Lembretes (`scheduled-recurrence.ts`)
* Função determinística `calcularOcorrenciasRecorrentes()`:
  * Recebe os dias da semana selecionados, horário (`HH:mm`), data inicial e período de repetição;
  * Calcula todas as ocorrências de data e horário futuros válidos;
  * Desconsidera ocorrências no passado caso o horário de hoje já tenha decorrido.

### C. Criação em Lote no Backend (`Batch Create`)
* Endpoint `POST /api/v1/contacts/[id]/scheduled-messages` atualizado para receber tanto um objeto único quanto um array de agendamentos (`CreateScheduledMessagesPayloadSchema`), persistindo todas as ocorrências em um único `insert` atômico no banco de dados.
* Hook `useCreateScheduledMessage` atualizado para suportar `items: [...]`.

### D. Interface Unificada no Composer e na Barra Lateral
* Seletor de Modo:
  * **Envio Único:** Seletor padrão de data e hora pontual com `DateTimePicker`.
  * **Lembrete Recorrente:**
    * Pílulas de seleção dos dias: `[Dom]` `[Seg]` `[Ter]` `[Qua]` `[Qui]` `[Sex]` `[Sáb]`;
    * Atalhos "Todos os dias" e "Seg a Sex";
    * Campo de horário de envio;
    * Seletor de período (7 dias, 14 dias, 30 dias, 8 semanas);
    * Caixa de resumo em tempo real: *"📅 10 disparos calculados às 09:00 para os dias selecionados"*.

---

## 3. Arquivos Modificados e Criados

| Arquivo | Ação | Descrição |
|---|---|---|
| [`lib/inbox/scheduled-recurrence.ts`](file:///c:/Projects/DKCRM/lib/inbox/scheduled-recurrence.ts) | NEW | Cálculo de ocorrências recorrentes por dias da semana e horário |
| [`tests/unit/scheduled-recurrence.test.ts`](file:///c:/Projects/DKCRM/tests/unit/scheduled-recurrence.test.ts) | NEW | Testes unitários do cálculo de recorrência (4/4 testes) |
| [`app/api/v1/contacts/[id]/scheduled-messages/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/contacts/[id]/scheduled-messages/route.ts) | MODIFIED | Suporte a criação em lote (Batch Create) no POST |
| [`hooks/inbox/useScheduledMessages.ts`](file:///c:/Projects/DKCRM/hooks/inbox/useScheduledMessages.ts) | MODIFIED | Suporte a `items: [...]` no `useCreateScheduledMessage` |
| [`components/inbox/ScheduledMessagesSection.tsx`](file:///c:/Projects/DKCRM/components/inbox/ScheduledMessagesSection.tsx) | MODIFIED | Cards com clique direto e modal com modo de lembrete recorrente |
| [`components/inbox/composer/ScheduleMessageDialog.tsx`](file:///c:/Projects/DKCRM/components/inbox/composer/ScheduleMessageDialog.tsx) | MODIFIED | Suporte a lembretes recorrentes no modal do chat |
| [`tests/unit/api-scheduled-messages.test.ts`](file:///c:/Projects/DKCRM/tests/unit/api-scheduled-messages.test.ts) | MODIFIED | Testes do endpoint com criação em lote |
| [`docs/ARQUITETURA_MENSAGENS_AGENDADAS.md`](file:///c:/Projects/DKCRM/docs/ARQUITETURA_MENSAGENS_AGENDADAS.md) | MODIFIED | Documentação de arquitetura atualizada |

---

## 4. Validação e Testes

* `pnpm vitest run tests/unit/api-scheduled-messages.test.ts`: **6/6 testes aprovados**.
* `pnpm vitest run tests/unit/scheduled-recurrence.test.ts`: **4/4 testes aprovados**.
* `pnpm vitest run tests/unit/scheduled-placeholders.test.ts`: **5/5 testes aprovados**.
* `pnpm vitest run tests/unit/scheduled-messages-worker.test.ts`: **2/2 testes aprovados**.
* `pnpm typecheck`: **0 erros**.
* `pnpm lint`: **0 erros**.
