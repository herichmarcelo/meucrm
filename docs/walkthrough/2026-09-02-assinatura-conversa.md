# Walkthrough: Assinatura na Conversa no Perfil do Atendente

> **Data:** 2026-09-02  
> **Módulo:** Configurações de Perfil, Envio de Mensagens e Identificação de Atendente no WhatsApp  
> **Status:** Concluído e Validado (100% testes unitários verdes, typecheck e lint zerados)

---

## 1. Contexto e Objetivo

No DeskcommCRM / PLUMA, múltiplos atendentes podem trabalhar simultaneamente na mesma organização ou atender uma mesma conversa de WhatsApp.

Para que o cliente final receba no WhatsApp uma identificação clara de quem está respondendo:
1. **Configuração Pessoal no Perfil:** O atendente pode definir uma **"Assinatura na conversa"** em `/app/settings/profile` (ex.: `Herich M.`, `Herich - Suporte`, `Dr. Roberto`).
2. **Injeção Automática no Envio:** Quando o campo está preenchido, toda mensagem manual enviada pelo atendente é prefixada automaticamente no formato:
   ```text
   *{assinatura}:*
   {corpo da mensagem}
   ```
   *Exemplo:*
   ```text
   *Herich Marcelo:*
   Olá! Tudo bem? Como posso te ajudar hoje?
   ```
3. **Isolamento Completo:** Mensagens geradas pela IA (`ai_agent`), crons/sistema e notas internas nunca recebem assinatura de atendente.

---

## 2. O Que Foi Implementado

### A. Tipos e Metadados do Atendente (`lib/auth/`)
* **`lib/auth/types.ts`:** Adicionado `signature?: string | null` na interface `AuthUser`.
* **`lib/auth/server.ts`:** `loadAuthUser()` extrai `signature` de `user.user_metadata?.signature` da sessão Supabase Auth.
* **`lib/api/handlers/types.ts`:** Adicionado `signature?: string | null` no tipo discriminado `Actor` quando `type: "user"`.

### B. Validação Zod & Persistência
* **`lib/schemas/settings.ts`:** `profileSchema` valida o campo `signature` (máx. 100 caracteres) com transformação automática que normaliza strings vazias ou só espaços para `null`.
* **`app/actions/settings/updateProfile.ts`:** Persiste `signature` em `auth.users.raw_user_meta_data` via `supabase.auth.updateUser` e registra o evento na auditoria (`api_audit_log`).

### C. Pipeline de Envio de Mensagens (`app/api/v1/messages/`)
* **`app/api/v1/messages/route.ts`:** O endpoint `POST /api/v1/messages` passa a assinatura do atendente logado no contexto da requisição (`actor: { type: "user", id: user.id, signature: user.signature }`).
* **`app/api/v1/messages/_handler.ts`:**
  * Avalia se `ctx.actor.type === "user"` e se `ctx.actor.signature` está preenchido.
  * Se positivo, monta `outboundBody = *${sig}:*\n${outboundBody}`.
  * Grava a mensagem na tabela `messages` já com a assinatura embutida e repassa `outboundBody` para o adapter do WhatsApp (`waha`, `gowa`, etc.).
  * Atualiza o `last_message_preview` da conversa para refletir exatamente o texto com assinatura no feed de conversas.
  * Mantém mídias sem legenda, notas internas, templates oficiais e mensagens de IA intocadas.

### D. Interface do Usuário (Frontend)
* **`app/app/settings/profile/page.tsx`:** Carrega `user.signature` e passa como `initialSignature` para o formulário.
* **`app/app/settings/profile/_form.tsx`:** Adicionado o campo `Input` "Assinatura na conversa" com placeholder `ex: Herich M.`, limite de 100 caracteres e texto de apoio:
  > *"Se preenchido, seu nome aparece no início de cada mensagem que você enviar nas conversas, para identificar qual atendente respondeu."*

---

## 3. Arquivos Criados e Modificados

| Arquivo | Ação | Descrição |
|---|---|---|
| [`lib/auth/types.ts`](file:///c:/Projects/DKCRM/lib/auth/types.ts) | MODIFIED | Adicionado campo `signature` em `AuthUser` |
| [`lib/api/handlers/types.ts`](file:///c:/Projects/DKCRM/lib/api/handlers/types.ts) | MODIFIED | Adicionado campo `signature` em `Actor` (`type: "user"`) |
| [`lib/auth/server.ts`](file:///c:/Projects/DKCRM/lib/auth/server.ts) | MODIFIED | Extração de `signature` em `loadAuthUser()` |
| [`lib/schemas/settings.ts`](file:///c:/Projects/DKCRM/lib/schemas/settings.ts) | MODIFIED | `profileSchema` com validação e normalização de `signature` |
| [`app/actions/settings/updateProfile.ts`](file:///c:/Projects/DKCRM/app/actions/settings/updateProfile.ts) | MODIFIED | Persistência e auditoria de `signature` |
| [`app/api/v1/messages/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/messages/route.ts) | MODIFIED | Propagação de `signature` no `actor` |
| [`app/api/v1/messages/_handler.ts`](file:///c:/Projects/DKCRM/app/api/v1/messages/_handler.ts) | MODIFIED | Injeção da assinatura em `outboundBody`, insert no banco e adapter |
| [`app/app/settings/profile/page.tsx`](file:///c:/Projects/DKCRM/app/app/settings/profile/page.tsx) | MODIFIED | Passagem de `initialSignature` para o formulário |
| [`app/app/settings/profile/_form.tsx`](file:///c:/Projects/DKCRM/app/app/settings/profile/_form.tsx) | MODIFIED | Input "Assinatura na conversa" com help text |
| [`docs/ARQUITETURA_ASSINATURA_CONVERSA.md`](file:///c:/Projects/DKCRM/docs/ARQUITETURA_ASSINATURA_CONVERSA.md) | NEW | Documentação de arquitetura detalhada e fluxo Mermaid |
| [`tests/unit/assinatura-conversa.test.ts`](file:///c:/Projects/DKCRM/tests/unit/assinatura-conversa.test.ts) | NEW | Testes unitários para validação de schema e envio |

---

## 4. Testes e Validações

### Testes Automatizados
* **`tests/unit/assinatura-conversa.test.ts` (7 testes):**
  * `profileSchema`: Aceita assinatura válida, normaliza strings vazias para `null`, aceita `null`/`undefined`, e rejeita strings com mais de 100 caracteres.
  * `sendMessageHandler`: Valida que o atendente com assinatura envia `*Herich M.:*\n{texto}` no DB e no WhatsApp; atendente sem assinatura envia texto original; e agente de IA (`ai_agent`) nunca adiciona assinatura.

### Comandos de Verificação
* `pnpm vitest run tests/unit/assinatura-conversa.test.ts`: **7/7 testes aprovados**.
* `pnpm typecheck`: **0 erros de TypeScript**.
* `pnpm lint`: **0 erros de ESLint**.
