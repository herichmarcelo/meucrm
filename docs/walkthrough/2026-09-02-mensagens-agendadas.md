# Walkthrough: Mensagens Agendadas no DeskcommCRM

> **Data:** 2026-09-02  
> **Módulo:** Mensagens Agendadas (Scheduled Messages)  
> **Status:** Concluído e Validado (15/15 testes unitários e de governança verdes)

---

## 1. Contexto e Objetivo

Permitir que operadores e atendentes programem mensagens no WhatsApp para serem disparadas automaticamente no futuro.
A funcionalidade inclui:
1. Interpolação dinâmica de placeholders (`{nome}`, `{data}`, `{hora}`, `{hoje}`, `{amanha}`);
2. Opção de usar modelos de mensagens salvos (`message_templates`);
3. Modal de agendamento integrado ao menu `+` do composer de mensagens;
4. Seção dedicada no painel lateral do contato (`CRMSidePanel`) para acompanhamento de status (`Pendente`, `Enviada`, `Falhou`, `Cancelada`), reagendamento e cancelamento;
5. Worker em background executado periodicamente a cada minuto pelo scheduler, com resiliência a reinicializações do servidor.

---

## 2. O Que Foi Implementado

### A. Banco de Dados & Schema (Migration `0170`)
* Criada a migration [`supabase/migrations/20260902140000_0170_scheduled_messages.sql`](file:///c:/Projects/DKCRM/supabase/migrations/20260902140000_0170_scheduled_messages.sql):
  * Tabela `scheduled_messages` com `id`, `organization_id`, `contact_id`, `conversation_id`, `template_id`, `raw_body`, `scheduled_for`, `status` (`pending`, `sent`, `failed`, `cancelled`), `sent_at`, `cancelled_at`, `error_message`, `created_by_user_id`, `created_at`, `updated_at`;
  * Índice parcial de alto desempenho: `idx_scheduled_messages_pending` em `(scheduled_for) where status = 'pending'`;
  * Políticas de Row Level Security (RLS) com isolamento por organização e permissão para papel `agent+`.
* Adicionado apêndice idempotente em [`supabase/baseline.sql`](file:///c:/Projects/DKCRM/supabase/baseline.sql) e registrado no [`supabase/migrations/MANIFEST.md`](file:///c:/Projects/DKCRM/supabase/migrations/MANIFEST.md).

### B. Resolver de Placeholders (`lib/inbox/scheduled-placeholders.ts`)
* Função pura [`renderScheduledPlaceholders`](file:///c:/Projects/DKCRM/lib/inbox/scheduled-placeholders.ts) que interpola:
  * `{nome}` / `{{nome}}`: Nome completo (fallback "Cliente");
  * `{primeiro_nome}` / `{{primeiro_nome}}`: Primeiro nome;
  * `{data}` / `{{data}}`: Data do envio formatada em pt-BR (`dd/MM/yyyy`);
  * `{hora}` / `{{hora}}`: Hora do envio (`HH:mm`);
  * `{hoje}` / `{{hoje}}`: Data atual formatada;
  * `{amanha}` / `{{amanha}}`: Data do dia seguinte formatada.
* Placeholders desconhecidos são preservados intactos no texto.

### C. Endpoints REST da API (`app/api/v1/`)
* [`app/api/v1/contacts/[id]/scheduled-messages/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/contacts/%5Bid%5D/scheduled-messages/route.ts):
  * `GET`: Lista mensagens agendadas do contato;
  * `POST`: Cria agendamento validado com Zod (exige `scheduled_for` no futuro e contato não bloqueado/anonimizado);
* [`app/api/v1/scheduled-messages/[id]/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/scheduled-messages/%5Bid%5D/route.ts):
  * `PATCH`: Reagendamento de data/hora ou atualização de texto para mensagens com status `pending`;
  * `DELETE`: Cancelamento lógico (`status = 'cancelled'`).

### D. Motor de Disparo em Background (`scheduled-messages-worker`)
* [`app/api/v1/cron/scheduled-messages-worker/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/cron/scheduled-messages-worker/route.ts):
  * Processa mensagens com `status = 'pending'` e `scheduled_for <= now()`;
  * Resolve a conversa ativa do contato ou cria conversa com a sessão ativa;
  * Renderiza placeholders no momento exato do envio;
  * Despacha via [`sendMessageHandler`](file:///c:/Projects/DKCRM/app/api/v1/messages/_handler.ts), reutilizando a infraestrutura nativa multi-provedor (WAHA / GOWA);
  * Atualiza o status para `sent` ou `failed` e registra auditoria.
* Agendado no [`docker/scheduler/entrypoint.sh`](file:///c:/Projects/DKCRM/docker/scheduler/entrypoint.sh) a cada minuto (`* * * * *|25|api/v1/cron/scheduled-messages-worker`).

### E. Interface do Usuário (Frontend)
* [`components/ui/date-time-picker.tsx`](file:///c:/Projects/DKCRM/components/ui/date-time-picker.tsx): Componente padrão de seleção de data e hora do sistema, combinando o [`DatePicker`](file:///c:/Projects/DKCRM/components/ui/date-picker.tsx) em pt-BR com seletor de horário 24h, atalhos inteligentes (`+15 min`, `+1 hora`, `Hoje às 18h`, `Amanhã às 09h`, `Amanhã às 14h`, `Segunda às 09h`) e resumo formatado por extenso;
* [`hooks/inbox/useScheduledMessages.ts`](file:///c:/Projects/DKCRM/hooks/inbox/useScheduledMessages.ts): Hooks do TanStack Query para listagem, criação, reagendamento e cancelamento;
* [`components/inbox/composer/AttachMenu.tsx`](file:///c:/Projects/DKCRM/components/inbox/composer/AttachMenu.tsx): Botão "Agendar mensagem" adicionado ao menu `+`;
* [`components/inbox/composer/ScheduleMessageDialog.tsx`](file:///c:/Projects/DKCRM/components/inbox/composer/ScheduleMessageDialog.tsx): Modal completo integrado com `DateTimePicker`, barra de atalho de tags, seletor de modelos e preview em tempo real;
* [`components/inbox/ScheduledMessagesSection.tsx`](file:///c:/Projects/DKCRM/components/inbox/ScheduledMessagesSection.tsx): Seção de cartões no sidebar com badges de status, opções de reagendar (com `DateTimePicker`) e cancelar;
* [`components/inbox/CRMSidePanel.tsx`](file:///c:/Projects/DKCRM/components/inbox/CRMSidePanel.tsx): Integração da seção logo abaixo de "Demandas abertas".

---

## 3. Validação e Testes Automatizados

### Comandos Executados:
```bash
pnpm vitest run tests/unit/scheduled-placeholders.test.ts tests/unit/scheduled-messages-worker.test.ts tests/unit/api-scheduled-messages.test.ts tests/unit/cron-routes-scheduled.test.ts
pnpm lint:channels
pnpm typecheck
```

### Resultados (15/15 testes aprovados):
* `tests/unit/scheduled-placeholders.test.ts` (5 testes): Interpolação de todas as tags, fallback para "Cliente", preservação de tags desconhecidas e chaves duplas.
* `tests/unit/scheduled-messages-worker.test.ts` (2 testes): Disparo e envio via handler, atualização de status e bloqueio para contatos anonimizados.
* `tests/unit/api-scheduled-messages.test.ts` (5 testes): Listagem, criação com validação de data futura, recusa de data passada (422), reagendamento (PATCH) e cancelamento (DELETE).
* `tests/unit/cron-routes-scheduled.test.ts` (3 testes): Validação de governança de que o novo cron worker está devidamente registrado no crontab do scheduler.

---

## 4. Validação em Ambiente Real (Live Execution)

* **Teste com Contato Real:** Agendamento criado no Inbox para o contato com mensagem `olá,{nome}{amanha}teremos uma reuniao as 18:00`.
* **Execução do Worker:** Acionado `scripts/trigger-scheduled-worker.ts`, resultando em `{ "scanned": 1, "sent": 1, "failed": 0, "skipped": 0 }`.
* **Resolução de Placeholders:** Nome do contato e data de amanhã interpolados perfeitamente na conversa do WhatsApp.

