# Arquitetura de Mensagens Agendadas no DeskcommCRM

> **Status:** Documentação de Arquitetura & Especificação Técnica  
> **Módulos:** Mensagens Agendadas (`scheduled_messages`), Scheduler Cron Worker, Inbox & Composer, CRM Side Panel

---

## 1. Contexto e Objetivo

A funcionalidade de **Mensagens Agendadas** permite que operadores, atendentes e gerentes programem mensagens de WhatsApp para serem enviadas automaticamente a um contato em uma data e horário futuros determinados.

### Casos de Uso Atendidos:
1. **Lembretes de compromissos e reuniões** agendadas com leads/clientes;
2. **Follow-ups pontuais** combinados com o cliente (ex.: *"retornar amanhã às 14h"*);
3. **Mensagens com variáveis dinâmicas** que refletem os dados no momento exato do envio (`{nome}`, `{data}`, `{hora}`, `{hoje}`, `{amanha}`);
4. **Reagendamento e cancelamento** ágeis diretamente na barra lateral do contato no CRM;
5. **Resiliência a reinicializações:** se o servidor ficar temporariamente fora do ar, as mensagens pendentes acumuladas são enviadas imediatamente no primeiro ciclo do worker após o boot.

---

## 2. Visão Geral da Arquitetura

```mermaid
flowchart TD
    subgraph Frontend [Camada de Interface]
        Composer["Composer (AttachMenu '+')"] -->|Abre| Modal["ScheduleMessageDialog<br/>(DateTimePicker + Tags + Templates)"]
        SidePanel["CRMSidePanel (Sidebar do Contato)"] -->|Exibe| ListSection["ScheduledMessagesSection<br/>(Badges, Reagendar, Cancelar)"]
        Modal -->|POST| API_Contacts["POST /api/v1/contacts/:id/scheduled-messages"]
        ListSection -->|GET| API_Contacts_GET["GET /api/v1/contacts/:id/scheduled-messages"]
        ListSection -->|PATCH/DELETE| API_Scheduled["PATCH & DELETE /api/v1/scheduled-messages/:id"]
    end

    subgraph Backend_API [API REST & Banco de Dados]
        API_Contacts -->|INSERT| DB[("scheduled_messages<br/>(Migration 0170 + RLS)")]
        API_Scheduled -->|UPDATE/SOFT CANCEL| DB
        DB -->|Audit| AuditLog[("api_audit_log")]
    end

    subgraph Background_Worker [Motor de Disparo Periódico]
        Scheduler["Scheduler Container<br/>(docker/scheduler/entrypoint.sh)"] -->|A cada 1 min| CronWorker["GET/POST /api/v1/cron/scheduled-messages-worker"]
        CronWorker -->|SELECT status='pending' AND scheduled_for <= now()| DB
        CronWorker -->|1. Valida Bloqueio/LGPD| ContactGuard{"Contato Ativo?"}
        ContactGuard -- Não --> FailMsg["Marca status='failed'<br/>(Contato bloqueado/anonimizado)"]
        ContactGuard -- Sim --> Resolver["renderScheduledPlaceholders()<br/>({nome}, {data}, {hora})"]
        Resolver --> Dispatcher["sendMessageHandler()<br/>(WhatsApp via WAHA/GOWA)"]
        Dispatcher -->|Sucesso| MarkSent["Marca status='sent'<br/>sent_at = now()"]
        Dispatcher -->|Erro| MarkFailed["Marca status='failed'<br/>error_message = err.message"]
    end
```

---

## 3. Banco de Dados & Schema (Migration `0170`)

A estrutura de dados foi criada pela migration versionada [`supabase/migrations/20260902140000_0170_scheduled_messages.sql`](file:///c:/Projects/DKCRM/supabase/migrations/20260902140000_0170_scheduled_messages.sql) e refletida como apêndice idempotente no [`supabase/baseline.sql`](file:///c:/Projects/DKCRM/supabase/baseline.sql).

### Tabela `scheduled_messages`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | `uuid PRIMARY KEY` | Identificador único do agendamento |
| `organization_id` | `uuid NOT NULL` | FK para `organizations(id)` (Isolamento Multi-tenant) |
| `contact_id` | `uuid NOT NULL` | FK para `contacts(id)` (Contato destinatário) |
| `conversation_id` | `uuid NULL` | FK para `conversations(id)` (Conversa associada) |
| `template_id` | `uuid NULL` | FK para `message_templates(id)` (Modelo utilizado) |
| `raw_body` | `text NOT NULL` | Corpo original com tags dinâmicas (`{nome}`, etc.) |
| `scheduled_for` | `timestamptz NOT NULL` | Data e hora programada para o envio |
| `status` | `text NOT NULL` | `'pending'` \| `'sent'` \| `'failed'` \| `'cancelled'` |
| `sent_at` | `timestamptz NULL` | Momento exato em que a mensagem foi disparada |
| `cancelled_at` | `timestamptz NULL` | Momento do cancelamento pelo operador |
| `error_message` | `text NULL` | Detalhe do erro em caso de falha no envio |
| `created_by_user_id` | `uuid NULL` | FK para `auth.users(id)` (Usuário que agendou) |
| `created_at` | `timestamptz NOT NULL` | Criação do registro (`now()`) |
| `updated_at` | `timestamptz NOT NULL` | Última atualização do registro |

### Índices de Alto Desempenho
```sql
-- Índice parcial para o Cron Worker buscar apenas pendências imediatas
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending
  ON scheduled_messages (scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_contact
  ON scheduled_messages (organization_id, contact_id, status);
```

### Políticas de Segurança (Row Level Security - RLS)
* Habilitada RLS obrigatória.
* Leitura e escrita restritas à mesma organização para usuários com papel `agent+` (`fn_role_at_least('agent')`).

---

## 4. Motor de Resolução de Tags (`scheduled-placeholders.ts`)

O módulo puro [`lib/inbox/scheduled-placeholders.ts`](file:///c:/Projects/DKCRM/lib/inbox/scheduled-placeholders.ts) realiza a interpolação no momento exato do disparo:

```typescript
renderScheduledPlaceholders(texto, {
  nome: "Roberto Carlos",
  dataHoraEnvio: new Date("2026-09-02T15:30:00Z"),
});
```

* `{nome}` / `{{nome}}`: Nome completo (fallback seguro para `"Cliente"`);
* `{primeiro_nome}` / `{{primeiro_nome}}`: Primeiro nome extraído;
* `{data}` / `{{data}}`: Data formatada em pt-BR (`02/09/2026`);
* `{hora}` / `{{hora}}`: Hora formatada (`15:30`);
* `{hoje}` / `{{hoje}}`: Data do dia atual;
* `{amanha}` / `{{amanha}}`: Data do dia seguinte;
* Tags desconhecidas são mantidas intactas sem corromper a mensagem.

---

## 5. Endpoints REST da API

### `GET /api/v1/contacts/:id/scheduled-messages`
* **Finalidade:** Lista todas as mensagens agendadas do contato ordenadas por `scheduled_for ASC`.
* **Guarda:** `requireRole("agent")`.

### `POST /api/v1/contacts/:id/scheduled-messages`
* **Finalidade:** Cria um novo agendamento de mensagem.
* **Validações:**
  * Zod Schema: `raw_body` (1 a 4096 caracteres), `scheduled_for` (ISO datetime no futuro);
  * Contato não pode estar bloqueado (`is_blocked = true`) nem anonimizado (`is_anonymized = true`);
  * Registro de auditoria: `action: "scheduled_message.created"`.

### `PATCH /api/v1/scheduled-messages/:id`
* **Finalidade:** Reagenda data/hora ou edita o texto de uma mensagem que ainda esteja com `status = 'pending'`.
* **Guarda:** Rejeita com HTTP 422 se o status for diferente de `pending`.
* **Auditoria:** `action: "scheduled_message.updated"`.

### `DELETE /api/v1/scheduled-messages/:id`
* **Finalidade:** Cancela suavemente o agendamento (`status = 'cancelled'`, preenchendo `cancelled_at`).
* **Auditoria:** `action: "scheduled_message.cancelled"`.

---

## 6. Worker Periódico em Background (`scheduled-messages-worker`)

* **Endpoint:** [`app/api/v1/cron/scheduled-messages-worker/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/cron/scheduled-messages-worker/route.ts)
* **Agendamento no Crontab:** Registrado em [`docker/scheduler/entrypoint.sh`](file:///c:/Projects/DKCRM/docker/scheduler/entrypoint.sh) a cada minuto (`* * * * *|25|api/v1/cron/scheduled-messages-worker`).
* **Autenticação:** Header `Authorization: Bearer <INTERNAL_CRON_SECRET | INTERNAL_SECRET>`.
* **Fluxo de Execução:**
  1. Busca lote de até 50 mensagens com `status = 'pending'` e `scheduled_for <= now()`;
  2. Garante lock atômico por linha com atualização de `updated_at`;
  3. Checa estado de privacidade/LGPD do contato (`is_anonymized`, `is_blocked`);
  4. Obtém os identificadores de nome do contato (`name` e `display_name`) e interpola dinamicamente os placeholders através de [`renderScheduledPlaceholders`](file:///c:/Projects/DKCRM/lib/inbox/scheduled-placeholders.ts);
  5. Localiza ou cria a conversa correspondente no canal WhatsApp ativo;
  6. Despacha através do handler canônico [`sendMessageHandler`](file:///c:/Projects/DKCRM/app/api/v1/messages/_handler.ts) com `type: 'text'`;
  7. Transita o status para `sent` (com carimbo `sent_at`) ou `failed` (com mensagem de erro).

---

## 7. Componentes de Interface (Frontend)

1. **[`DateTimePicker.tsx`](file:///c:/Projects/DKCRM/components/ui/date-time-picker.tsx):** Componente unificado com calendário nativo pt-BR, suporte dinâmico a 24h ou 12h (AM/PM) via `useTempo()`, atalhos inteligentes (`+15 min`, `+1 hora`, `Hoje às 18h`, `Amanhã às 09h`, `Amanhã às 14h`, `Segunda às 09h`) e resumo formatado por extenso;
2. **[`ScheduleMessageDialog.tsx`](file:///c:/Projects/DKCRM/components/inbox/composer/ScheduleMessageDialog.tsx):** Modal acionado no menu `+` do Composer com suporte a **Envio Único** ou **Lembrete Recorrente** (seleção de dias da semana `Dom`..`Sáb`, atalhos "Todos os dias" e "Seg a Sex", horário e período);
3. **[`ScheduledMessagesSection.tsx`](file:///c:/Projects/DKCRM/components/inbox/ScheduledMessagesSection.tsx):** Seção de cartões interativos no painel lateral do CRM com clique direto no card para reabertura de mensagem (sem botões redundantes), edição de pendências e reaproveitamento ágil em lote com modo de lembrete recorrente;
4. **[`scheduled-recurrence.ts`](file:///c:/Projects/DKCRM/lib/inbox/scheduled-recurrence.ts):** Utilitário de cálculo determinístico de ocorrências para lembretes diários e dias específicos da semana;
5. **[`useScheduledMessages.ts`](file:///c:/Projects/DKCRM/hooks/inbox/useScheduledMessages.ts):** Hook TanStack Query com suporte a criação única ou em lote (`Batch Create`).

---

## 8. Execução: Desenvolvimento Local vs Produção (VPS)

### Em Produção (VPS / Docker Compose)
O contêiner `deskcomm-scheduler` executa o busybox `crond` como PID 1 e realiza chamadas automáticas via `curl` a cada 60 segundos com o `INTERNAL_SECRET` injetado na inicialização.

### Em Desenvolvimento Local (`npm run dev`)
Durante o desenvolvimento local no Windows/Node, o scheduler do Docker não roda como daemon de fundo no terminal do Next.js.
Para disparar e testar o processamento de mensagens pendentes:
```bash
# Executa o worker pontualmente lendo as variáveis locais
pnpm tsx --env-file=.env.local scripts/trigger-scheduled-worker.ts
```

---

## 9. Troubleshooting & Gotchas de Arquitetura

1. **Colunas da Tabela `contacts`:**  
   A tabela `contacts` no schema do Supabase utiliza `name` e `display_name` (não existe `first_name` no Postgres). A separação de primeiro nome para `{primeiro_nome}` é realizada de forma determinística na camada de aplicação pelo [`renderScheduledPlaceholders`](file:///c:/Projects/DKCRM/lib/inbox/scheduled-placeholders.ts).
2. **Cache de Schema do PostgREST:**  
   Após criar ou alterar tabelas via migrations manuais ou SQL Editor, o PostgREST pode devolver `Could not find the table 'public.scheduled_messages' in the schema cache`. A resolução imediata é executar:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

---

## 10. Validação e Testes Automatizados

* **`tests/unit/scheduled-placeholders.test.ts`** (5 testes): Cobertura completa de todas as tags, chaves duplas e tags não reconhecidas.
* **`tests/unit/scheduled-messages-worker.test.ts`** (2 testes): Simulação de lote de mensagens pendentes, interpolação, despacho de envio e guarda de contatos anonimizados.
* **`tests/unit/api-scheduled-messages.test.ts`** (5 testes): Testes dos endpoints GET, POST, PATCH e DELETE.
* **`tests/unit/cron-routes-scheduled.test.ts`** (3 testes): Validação de governança de que o novo cron worker está devidamente registrado no crontab do scheduler.
