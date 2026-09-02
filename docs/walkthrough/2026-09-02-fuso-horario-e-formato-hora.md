# Walkthrough: Fuso Horário (Campo Grande) & Formato de Hora (24h / 12h AM-PM)

> **Data:** 2026-09-02  
> **Módulo:** Configurações de Perfil, Fuso Horário e Formatador Global de Tempo  
> **Status:** Concluído e Validado (51/51 testes unitários verdes, typecheck e lint zerados)

---

## 1. Contexto e Objetivo

Permitir que usuários e operadores configurem em seu **Perfil** (`/app/settings/profile`):
1. **Fuso Horário Regional:** Inclusão do fuso `America/Campo_Grande` (Mato Grosso do Sul / UTC-4) e demais fusos brasileiros/latino-americanos;
2. **Formato de Hora Global:** Escolha entre o formato **24 horas** (`14:30`) e **12 horas AM/PM** (`02:30 PM`);
3. **Propagação Consistente no Sistema:** Garantir que o fuso e o formato de hora sejam aplicados em toda a interface (chat/inbox, notas internas, timeline do CRM, mensagens agendadas e DateTimePicker).

---

## 2. O Que Foi Implementado

### A. Vocabulário Canônico de Fusos Horários (`lib/tempo/fusos.ts`)
* Adicionados os fusos oficiais do Brasil ao array `FUSOS_OFERECIDOS`:
  * `America/Campo_Grande` (Campo Grande, MS)
  * `America/Cuiaba` (Cuiabá, MT)
  * `America/Manaus`, `America/Porto_Velho`, `America/Boa_Vista`, `America/Rio_Branco`
  * `America/Sao_Paulo`, `America/Belem`, `America/Recife`, `America/Fortaleza`, `America/Maceio`, `America/Bahia`, `America/Noronha`
  * `America/Asuncion`, `America/Argentina/Buenos_Aires`, `America/Montevideo`, etc.

### B. Funções Puras de Formatação (`lib/tempo/formato.ts`)
* Implementadas as funções universais baseadas na API nativa `Intl.DateTimeFormat`:
  * `formatarHora(data, { timezone, timeFormat, locale })`: Formata hora pura em 24h ou 12h AM/PM no fuso especificado com fallback seguro;
  * `formatarDataHora(data, { timezone, timeFormat, locale })`: Formata data e hora combinadas;
  * `formatarData(data, { timezone, locale })`: Formata data em pt-BR (`dd/MM/yyyy`).

### C. Contexto React Desacoplado (`lib/tempo/TempoProvider.tsx`)
* Criado o `TempoProvider` e o hook `useTempo()`.
* **Padrão Desacoplado:** Não depende de sessão ou mock de autenticação para renderizar texto (evitando quebra de testes legados), fornecendo fallbacks silenciosos e seguros.
* Integrado no layout autenticado principal ([`app/app/layout.tsx`](file:///c:/Projects/DKCRM/app/app/layout.tsx)).

### D. Schema & Persistência no Perfil
* [`lib/schemas/settings.ts`](file:///c:/Projects/DKCRM/lib/schemas/settings.ts): Adicionado `time_format: z.enum(["24h", "12h"]).default("24h")` no `profileSchema`.
* [`app/actions/settings/updateProfile.ts`](file:///c:/Projects/DKCRM/app/actions/settings/updateProfile.ts): Grava `time_format` e `timezone` em `auth.users.raw_user_meta_data` e na auditoria.
* [`lib/auth/server.ts`](file:///c:/Projects/DKCRM/lib/auth/server.ts) & [`lib/auth/types.ts`](file:///c:/Projects/DKCRM/lib/auth/types.ts): Mapeia `timezone` e `time_format` em `loadAuthUser()`.
* [`app/app/settings/profile/_form.tsx`](file:///c:/Projects/DKCRM/app/app/settings/profile/_form.tsx) & [`page.tsx`](file:///c:/Projects/DKCRM/app/app/settings/profile/page.tsx): Formulário atualizado com select de fusos completo e seletor de formato 24h vs 12h AM/PM.

### E. Atualização dos Componentes de Interface
* [`MessageBubble.tsx`](file:///c:/Projects/DKCRM/components/inbox/MessageBubble.tsx): Exibição dos horários das mensagens com `useTempo().formatarHora()`;
* [`ConversationListItem.tsx`](file:///c:/Projects/DKCRM/components/inbox/ConversationListItem.tsx): Exibição do horário da última mensagem no feed da inbox;
* [`NoteCard.tsx`](file:///c:/Projects/DKCRM/components/inbox/NoteCard.tsx): Exibição do horário de notas internas;
* [`TimelineView.tsx`](file:///c:/Projects/DKCRM/components/contacts/TimelineView.tsx): Exibição dos horários na linha do tempo de atividades do contato;
* [`ScheduledMessagesSection.tsx`](file:///c:/Projects/DKCRM/components/inbox/ScheduledMessagesSection.tsx): Exibição formatada das datas das mensagens agendadas;
* [`DateTimePicker.tsx`](file:///c:/Projects/DKCRM/components/ui/date-time-picker.tsx): Resumo por extenso utilizando a preferência de hora do usuário.

---

## 3. Arquivos Criados e Modificados

| Arquivo | Ação | Descrição |
|---|---|---|
| `lib/tempo/fusos.ts` | MODIFIED | Inclusão de `America/Campo_Grande` e demais fusos regionais |
| `lib/tempo/formato.ts` | NEW | Funções puras de formatação 12h/24h com fuso |
| `lib/tempo/TempoProvider.tsx` | NEW | Contexto React global e hook `useTempo()` |
| `lib/schemas/settings.ts` | MODIFIED | `profileSchema` com suporte a `time_format` |
| `app/actions/settings/updateProfile.ts` | MODIFIED | Persistência de `time_format` em `user_metadata` e auditoria |
| `lib/auth/types.ts` & `lib/auth/server.ts` | MODIFIED | `AuthUser` com `timezone` e `time_format` |
| `app/app/layout.tsx` | MODIFIED | Injeção do `<TempoProvider>` |
| `app/app/settings/profile/page.tsx` & `_form.tsx` | MODIFIED | Tela de perfil com lista de fusos e seletor 12h/24h |
| `components/inbox/MessageBubble.tsx` | MODIFIED | Horário de mensagens no chat |
| `components/inbox/ConversationListItem.tsx` | MODIFIED | Horário na listagem de conversas |
| `components/inbox/NoteCard.tsx` | MODIFIED | Horário de notas internas |
| `components/contacts/TimelineView.tsx` | MODIFIED | Horário na timeline de CRM |
| `components/inbox/ScheduledMessagesSection.tsx` | MODIFIED | Formatação em mensagens agendadas |
| `components/ui/date-time-picker.tsx` | MODIFIED | Resumo de agendamento com hora formatada |
| `docs/ARQUITETURA_FUSO_E_FORMATO_HORA.md` | NEW | Documento de arquitetura técnica |
| `docs/ARQUITETURA_MENSAGENS_AGENDADAS.md` | NEW | Documento de arquitetura técnica de mensagens agendadas |
| `tests/unit/tempo-formato.test.ts` | NEW | Bateria de testes unitários para formatação e fusos |
| `tests/unit/fuso-horario.test.ts` | MODIFIED | Teste unitário para inclusão de Campo Grande e tela de perfil |

---

## 4. Validação e Testes

* `pnpm typecheck` $\rightarrow$ **0 erros** de compilação TypeScript.
* `pnpm lint` $\rightarrow$ **0 erros** nos arquivos modificados.
* `pnpm vitest run tests/unit/tempo-formato.test.ts tests/unit/fuso-horario.test.ts tests/unit/inbox-demandas-abertas.test.tsx tests/unit/inbox-header-nao-trava.test.tsx tests/unit/inbox-filters-scope.test.tsx` $\rightarrow$ **51/51 testes aprovados**.
