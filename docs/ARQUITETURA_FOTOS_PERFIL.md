# Arquitetura de Sincronização e Armazenamento de Fotos de Perfil (WAHA e GOWA)

> **Documento de Arquitetura e Especificação Técnica**  
> **Módulo:** Sincronização de Fotos de Perfil de Contatos WhatsApp & Armazenamento em Bucket  
> **Stack:** Next.js 16 (App Router) · Supabase (PostgreSQL + Storage + RLS) · WAHA Plus · GOWA v9.3.0 · LGPD Cascade

---

## 1. Visão Geral

Este documento detalha o funcionamento, as decisões de engenharia e os fluxos de integração para importação, armazenamento e exibição das fotos de perfil de contatos WhatsApp no CRM, cobrindo tanto o engine **WAHA Plus** quanto o **GOWA (Go WhatsApp Web MultiDevice)**.

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Fluxo de Sincronização                                  │
│                                                                                           │
│   ┌────────────────┐       ┌──────────────────────┐       ┌───────────────────────────┐   │
│   │ Cron Job       │       │ Core Sync Service    │       │ WhatsApp Providers        │   │
│   │ (a cada 10 min)│──────►│ lib/contacts/        │──────►│ • WAHA (/api/contacts/..) │   │
│   └────────────────┘       │   avatar-sync.ts     │       │ • GOWA (/user/avatar?..)  │   │
│                            └──────────┬───────────┘       └─────────────┬─────────────┘   │
│   ┌────────────────┐                  │                                 │                 │
│   │ On-Demand Sync │──────────────────┘                                 │                 │
│   │ (Manual / UI)  │                  │ Buffer Binário (JPEG <= 2MB)    │ URL CDN / Foto  │
│   └────────────────┘                  ▼                                 ▼                 │
│                            ┌──────────────────────┐       ┌───────────────────────────┐   │
│                            │ Supabase Storage     │       │ WhatsApp CDN              │   │
│                            │ (whatsapp-media)     │◄──────│ (pps.whatsapp.net)        │   │
│                            │ {org}/avatars/{id}   │       └───────────────────────────┘   │
│                            └──────────┬───────────┘                                       │
│                                       │ URL Assinada (TTL 300s)                           │
│                                       ▼                                                   │
│                            ┌──────────────────────┐       ┌───────────────────────────┐   │
│                            │ GET /api/v1/contacts/│──────►│ Frontend UI               │   │
│                            │ [id]/avatar (307)    │       │ (Avatar Component)        │   │
│                            └──────────────────────┘       └───────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decisões Fundamentais de Engenharia

### 2.1 Por que persistir o arquivo em vez de salvar a URL da CDN?
As URLs retornadas pelo WhatsApp (CDN `pps.whatsapp.net`) contêm parâmetros de assinatura temporária (`&oe=<timestamp>`) que **expiram em ~9 dias** (medido em produção). Salvar apenas o link externo causaria o desaparecimento silencioso de todas as fotos de perfil após uma semana. O CRM baixa o binário e armazena no bucket privado.

### 2.2 Gatilhos de Sincronização e Desacoplamento do Webhook
O webhook de entrada de mensagens precisa responder com latência mínima (<50ms). Por isso:
1. **Background Async Pós-Entrada:** Em `lib/channels/pos-entrada.ts`, o sistema dispara `syncContactAvatar` de forma não-bloqueante (`void syncContactAvatar(...)`) com throttle de 24h para atualizar o contato assim que ele manda uma mensagem.
2. **Sincronização Oportunista na Rota:** Ao solicitar `GET /api/v1/contacts/[id]/avatar`, se o contato ainda não possuir `avatar_storage_path`, a rota tenta sincronizar imediatamente com o provedor antes de retornar fallback.
3. **Cron Job Periódico:** O cron executa a cada 10 minutos para contatos sem foto recente ou pendentes.

### 2.3 Conformidade com LGPD e Privacidade
A foto de perfil é classificada como **Dado Pessoal**.
* **Armazenamento Próprio:** Ter o arquivo sob controle do sistema é o que possibilita cumprir o direito à exclusão/anonimização.
* **Anonimização Irreversível:** Ao executar o pipeline de anonimização (`lib/lgpd/redact-cascade.ts`), a coluna `contacts.avatar_storage_path` é zerada e o caminho é inserido na tabela `storage_redaction_queue` para deleção física no bucket.
* **Prevenção de Corrida:** Caso um contato seja anonimizado durante o download/upload da foto pelo cron, o sistema detecta que nenhuma linha foi atualizada no banco (`is_anonymized = false`), aborta o vínculo e agenda a remoção imediata do arquivo recém-enviado.

---

## 3. Endpoints dos Provedores (Upstream)

| Provedor | Endpoint de Consulta | Headers / Autenticação | Formato de Resposta |
| :--- | :--- | :--- | :--- |
| **WAHA** | `GET /api/contacts/profile-picture?session={session}&contactId={chatId}` | `X-Api-Key: {hash}` | `{"profilePictureURL": "https://pps.whatsapp.net/..."}` |
| **GOWA** | `GET /user/avatar?phone={phoneDigits}` | `Authorization: Basic ...`<br/>`X-Device-Id: {deviceId}` | `{"results": {"url": "...", "avatar_url": "..."}}` |

### 3.1 Camada de Adaptação Agnóstica (`lib/channels/`)
A lógica de negócio nunca chama o WAHA ou GOWA diretamente. Ela utiliza a interface comum:
* **WAHA Adapter:** `lib/channels/adapters/waha.ts` $\rightarrow$ `fetchProfilePictureUrl({ sessionRef, recipient })`
* **GOWA Adapter:** `lib/channels/adapters/gowa.ts` $\rightarrow$ `fetchProfilePictureUrl({ sessionRef, recipient })`
* **Resolução de Sessão:** `lib/channels/session-ref.ts` $\rightarrow$ `resolveSessionRef(session)` (resolve `waha_session_name` ou `gowa_device_id` de forma transparente).

---

## 4. Pipeline de Sincronização

### 4.1 Sincronização Periódica em Segundo Plano (Cron)
* **Agendamento:** A cada 10 minutos pelo scheduler (`docker/scheduler/entrypoint.sh`):
  ```cron
  */10 * * * *|60|api/v1/cron/contact-avatars
  ```
* **Rota:** `POST /api/v1/cron/contact-avatars` (autenticado via `Bearer INTERNAL_SECRET`).
* **Lote e Critérios de Busca:**
  * Lote de até **25 contatos** por ciclo (`SCAN_LIMIT = 25`).
  * Contatos com `wa_identity IS NOT NULL` e `is_anonymized = false`.
  * Condição de atualização: `avatar_updated_at IS NULL` OU `avatar_updated_at < NOW() - 7 dias`.
  * Ordenação: `avatar_updated_at ASC NULLS FIRST`.
* **Índice Postgres Dedicado:**
  ```sql
  CREATE INDEX IF NOT EXISTS idx_contacts_avatar_refresh
    ON public.contacts (avatar_updated_at nulls first)
    WHERE wa_identity IS NOT NULL AND is_anonymized = false;
  ```

### 4.2 Sincronização Sob Demanda (Manual / UI)
* **Rota:** `POST /api/v1/contacts/[id]/avatar/sync`
* **Segurança:** Autenticação por sessão de usuário + RBAC (`requireRole(["admin", "operator", "agent"])`) + tenant ativo (`activeOrg.orgId`).
* **Comportamento:** Executa imediatamente a busca da foto para o contato especificado, atualiza o bucket e o banco, e retorna a URL assinada para atualização instantânea na interface.

---

## 5. Estrutura de Armazenamento no Supabase Storage

* **Bucket:** `whatsapp-media` (configurado como bucket privado).
* **Estrutura de Diretórios:**
  ```
  whatsapp-media/
  └── {organization_id}/
      └── avatars/
          └── {contact_id}.jpg
  ```
* **Estratégia de Sobrescrita (`upsert: true`):**
  Ao atualizar a foto de um contato existente, o novo arquivo sobrescreve o antigo no mesmo caminho estável `{organization_id}/avatars/{contact_id}.jpg`, evitando a proliferação de arquivos órfãos no storage.
* **Validações de Arquivo:**
  * Tamanho máximo aceito: `2 MB` (`MAX_BYTES = 2 * 1024 * 1024`).
  * `Content-Type`: `image/jpeg`.

---

## 6. Exibição e Cache no Frontend

Para evitar expor o bucket privado ou sobrecarregar a API com proxy de imagens pesadas:

1. A interface renderiza o avatar apontando para o endpoint interno:
   ```html
   <img src="/api/v1/contacts/{contact_id}/avatar" alt="Avatar" />
   ```
2. A rota `GET /api/v1/contacts/[id]/avatar`:
   * Verifica a permissão do usuário para o `organization_id` do contato.
   * Se o contato não tem foto ou foi anonimizado $\rightarrow$ retorna HTTP `404` (o componente exibe o fallback de iniciais).
   * Se tem foto $\rightarrow$ gera uma URL assinada temporária no storage (`createSignedUrl(path, 300)` — validade de 5 minutos).
   * Retorna um redirect HTTP `307 Temporary Redirect` com cabeçalho de cache:
     ```http
     HTTP/1.1 307 Temporary Redirect
     Location: https://<supabase-storage-signed-url>
     Cache-Control: private, max-age=240
     ```
3. **Vantagem:** O navegador faz cache do redirect por 4 minutos (`max-age=240`), baixando a imagem diretamente da infraestrutura de storage sem onerar o servidor do CRM a cada renderização da lista de conversas.

---

## 7. Referência de Arquivos no Repositório

| Arquivo | Descrição |
| :--- | :--- |
| [`lib/contacts/avatar-sync.ts`](file:///c:/Projects/DKCRM/lib/contacts/avatar-sync.ts) | Serviço reutilizável de sincronização e persistência de avatar. |
| [`app/api/v1/cron/contact-avatars/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/cron/contact-avatars/route.ts) | Rota de varredura periódica de avatares. |
| [`app/api/v1/contacts/[id]/avatar/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/contacts/%5Bid%5D/avatar/route.ts) | Rota de entrega da foto com URL assinada e cache HTTP 307. |
| [`app/api/v1/contacts/[id]/avatar/sync/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/contacts/%5Bid%5D/avatar/sync/route.ts) | Rota de sincronização manual sob demanda. |
| [`lib/channels/adapters/waha.ts`](file:///c:/Projects/DKCRM/lib/channels/adapters/waha.ts) | Implementação da busca de foto no adapter WAHA. |
| [`lib/channels/adapters/gowa.ts`](file:///c:/Projects/DKCRM/lib/channels/adapters/gowa.ts) | Implementação da busca de foto no adapter GOWA. |
| [`lib/gowa/client.ts`](file:///c:/Projects/DKCRM/lib/gowa/client.ts) | Cliente HTTP do GOWA com método `fetchProfilePictureUrl`. |
| [`lib/waha/client.ts`](file:///c:/Projects/DKCRM/lib/waha/client.ts) | Cliente HTTP do WAHA com método `getProfilePictureUrl`. |
| [`lib/lgpd/redact-cascade.ts`](file:///c:/Projects/DKCRM/lib/lgpd/redact-cascade.ts) | Cascata de anonimização e enfileiramento de exclusão de avatar no bucket. |
| [`supabase/migrations/20260801220000_0099_contacts_avatar.sql`](file:///c:/Projects/DKCRM/supabase/migrations/20260801220000_0099_contacts_avatar.sql) | Migration das colunas `avatar_storage_path`, `avatar_updated_at` e índice parcial. |
