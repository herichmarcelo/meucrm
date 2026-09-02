# Walkthrough: Precedência de Nome vs Display Name do Contato

> **Data:** 2026-09-02  
> **Módulo:** Contatos, Resolução de Nomes e Inbox  
> **Status:** Concluído e Validado (12/12 testes unitários verdes, typecheck e lint zerados)

---

## 1. Contexto e Problema Identificado

Quando um cliente entra em contato pelo WhatsApp, o canal (WAHA / GOWA) captura o *pushName* público configurado no WhatsApp do cliente (por exemplo, as iniciais `"Wl"` ou um apelido) e salva em `contacts.display_name`.

Quando o atendente identificava o cliente e preenchia o campo **Nome** (ex.: `"Wesley Lopes"`) na ficha do CRM:
- A função central [`rotuloDoContato`](file:///c:/Projects/DKCRM/lib/contacts/rotulo-do-contato.ts) possuía a ordem `[c.display_name, c.name]`.
- Como resultado, `"Wl"` continuava vencendo `"Wesley Lopes"`, e a conversa na Inbox, o cabeçalho do chat e o título do contato permaneciam exibindo `"Wl"`.
- Além disso, a rota `PATCH /api/v1/contacts/[id]` atualizava apenas `name`, mantendo `display_name` congelado no valor antigo do WhatsApp.

---

## 2. O Que Foi Corrigido e Implementado

### A. Precedência Canônica em `rotuloDoContato` ([`lib/contacts/rotulo-do-contato.ts`](file:///c:/Projects/DKCRM/lib/contacts/rotulo-do-contato.ts))
* Alterada a ordem de avaliação dos candidatos para:
  ```typescript
  const candidatos = [c.name, c.display_name];
  ```
* **Comportamento:**
  1. Se `name` estiver preenchido (ex.: `"Wesley Lopes"`), ele assume **prioridade absoluta** em todas as telas (Inbox, Header, CRM, Tabela de Contatos, Cards do Kanban).
  2. Se `name` for nulo/vazio, o sistema faz fallback para o `display_name` do WhatsApp (`"Wl"`).
  3. Se nenhum dos dois for válido ou for identificador técnico (`@lid`), cai no número de telefone.
  4. Se não houver telefone, exibe `"Sem nome"`.

### B. Sincronização Automática no Backend ([`app/api/v1/contacts/_handler.ts`](file:///c:/Projects/DKCRM/app/api/v1/contacts/_handler.ts))
* **`createContactHandler`:** Ao criar um contato com `name` sem `display_name` explícito:
  `display_name: input.display_name ?? input.name ?? null`.
* **`patchContactHandler`:** Ao atualizar o `name` do contato sem passar um `display_name` diferente:
  ```typescript
  if (input.name !== undefined) {
    patch.name = input.name;
    if (input.display_name === undefined) {
      patch.display_name = input.name;
    }
  }
  ```

---

## 3. Arquivos Modificados e Documentados

| Arquivo | Ação | Descrição |
|---|---|---|
| [`lib/contacts/rotulo-do-contato.ts`](file:///c:/Projects/DKCRM/lib/contacts/rotulo-do-contato.ts) | MODIFIED | Precedência de `name` sobre `display_name` |
| [`app/api/v1/contacts/_handler.ts`](file:///c:/Projects/DKCRM/app/api/v1/contacts/_handler.ts) | MODIFIED | Sincronização automática de `display_name` no create e patch |
| [`tests/unit/rotulo-do-contato.test.ts`](file:///c:/Projects/DKCRM/tests/unit/rotulo-do-contato.test.ts) | MODIFIED | Testes unitários de precedência e de sincronização no PATCH |
| [`docs/ARQUITETURA_NOME_VS_DISPLAY_NAME.md`](file:///c:/Projects/DKCRM/docs/ARQUITETURA_NOME_VS_DISPLAY_NAME.md) | NEW | Documentação de arquitetura da resolução de nomes |
| [`docs/walkthrough/2026-09-02-nome-vs-display-name.md`](file:///c:/Projects/DKCRM/docs/walkthrough/2026-09-02-nome-vs-display-name.md) | NEW | Relatório de entrega da correção |

---

## 4. Testes e Validação

* `pnpm vitest run tests/unit/rotulo-do-contato.test.ts`: **12/12 testes aprovados**.
* `pnpm typecheck`: **0 erros**.
* `pnpm lint`: **0 erros**.
