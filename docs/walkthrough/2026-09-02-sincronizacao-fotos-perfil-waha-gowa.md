# Walkthrough: Sincronização e Armazenamento de Fotos de Perfil (WAHA e GOWA)

> **Data:** 2026-09-02  
> **Módulo:** Sincronização de Avatares WhatsApp e Bucket Supabase Storage  
> **Status:** Concluído e Validado (10/10 testes unitários verdes)

---

## 1. Contexto e Motivação

As fotos de perfil dos contatos no WhatsApp são disponibilizadas pelos motores (WAHA e GOWA) via links temporários da CDN do WhatsApp (`pps.whatsapp.net`), contendo assinaturas temporárias que expiram em aproximadamente **9 dias**. Para evitar que as fotos quebrem na interface, o sistema necessita:
1. Baixar o arquivo binário da imagem;
2. Persistir no bucket privado do Supabase Storage `whatsapp-media`;
3. Servir as imagens no frontend através de URLs assinadas com controle de cache;
4. Respeitar as regras de privacidade e LGPD (anonimização irreversível).

---

## 2. O Que Foi Implementado

### A. Serviço Central Agnóstico (`lib/contacts/avatar-sync.ts`)
* Implementado o serviço [`lib/contacts/avatar-sync.ts`](file:///c:/Projects/DKCRM/lib/contacts/avatar-sync.ts):
  * Resolução de sessão ativa via `CHANNEL_SESSION_REF_COLUMNS` e `resolveSessionRef` (suporte a WAHA, GOWA e futuras engines sem acoplamento a colunas específicas);
  * Invocação do adapter de canal correspondente (`adapter.fetchProfilePictureUrl`);
  * Download do buffer binário (limite de 2MB);
  * Upload atômico para o bucket privado `whatsapp-media` em `{organization_id}/avatars/{contact_id}.jpg` (`upsert: true`);
  * Atualização de `contacts.avatar_storage_path` e `contacts.avatar_updated_at` com proteção de integridade LGPD (`is_anonymized = false`);
  * Reversão automática para a fila `storage_redaction_queue` caso o contato seja anonimizado durante o upload.

### B. Rota de Sincronização Sob Demanda (Manual / UI)
* Criado o endpoint [`POST /api/v1/contacts/[id]/avatar/sync`](file:///c:/Projects/DKCRM/app/api/v1/contacts/%5Bid%5D/avatar/sync/route.ts):
  * Protegido com RBAC (`requireRole("agent")`) e isolamento da organização ativa;
  * Permite ao operador disparar a sincronização imediata da foto de um contato sem esperar o cron, retornando a nova URL assinada para atualização em tempo real.

### C. Refatoração do Cron Job
* Atualizado [`app/api/v1/cron/contact-avatars/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/cron/contact-avatars/route.ts) para delegar ao `syncContactAvatar`, processando contatos em lotes de 25 com suporte a múltiplos provedores.

### D. Aprimoramento do GowaClient
* Atualizado [`lib/gowa/client.ts`](file:///c:/Projects/DKCRM/lib/gowa/client.ts) para tratar múltiplos formatos de resposta da rota `/user/avatar` do GOWA v9.3.0 e URLs relativas com resolução para a `baseUrl`.

### E. Documentação de Arquitetura
* Criado documento de arquitetura completo em [`docs/ARQUITETURA_FOTOS_PERFIL.md`](file:///c:/Projects/DKCRM/docs/ARQUITETURA_FOTOS_PERFIL.md) e referenciado em [`docs/index.md`](file:///c:/Projects/DKCRM/docs/index.md), [`docs/ARQUITETURA_WAHA.md`](file:///c:/Projects/DKCRM/docs/ARQUITETURA_WAHA.md) e [`docs/ARQUITETURA_GOWA.md`](file:///c:/Projects/DKCRM/docs/ARQUITETURA_GOWA.md).

---

## 3. Validação e Testes Automatizados

### Testes Unitários
Comando:
```bash
pnpm vitest run tests/unit/contact-avatar-sync.test.ts tests/unit/api-contact-avatar-sync.test.ts tests/unit/cron-contact-avatars-corrida.test.ts
```

Resultados (10/10 testes aprovados):
* `tests/unit/contact-avatar-sync.test.ts`:
  * Sincronização via WAHA (sucesso e upload no bucket)
  * Sincronização via GOWA (sucesso e upload no bucket)
  * Tratamento de contato sem foto pública (`no_picture`)
  * Bloqueio para contato já anonimizado (`anonymized`)
  * Proteção contra corrida LGPD (reversão para `storage_redaction_queue`)
* `tests/unit/api-contact-avatar-sync.test.ts`:
  * Resposta 200 com caminho no bucket e URL assinada
  * Resposta 200 com `synced: false` para contatos sem foto
  * Resposta 404 para contatos inexistentes
* `tests/unit/cron-contact-avatars-corrida.test.ts`:
  * 2 testes de concorrência com anonimização em lote.

### Verificações de Governança
* `pnpm lint:channels` $\rightarrow$ Aprovado (0 violações de nome de provider).
* `pnpm typecheck` $\rightarrow$ Aprovado (0 erros TypeScript).
