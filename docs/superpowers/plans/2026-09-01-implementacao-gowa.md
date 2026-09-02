# Plano de Implementação: Provider GOWA (go-whatsapp-web-multidevice v9.3.0)

> **Data:** 2026-09-01
> **Status:** Pronto para Execução
> **Documento de Arquitetura:** [`docs/ARQUITETURA_GOWA.md`](../ARQUITETURA_GOWA.md)

---

## 1. Visão Geral

Implementação do provedor **GOWA** (`aldinokemal2104/go-whatsapp-web-multidevice:v9.3.0`) no DeskcommCRM, operando em coexistência nativa com o **WAHA Plus**.

---

## 2. Checklist de Tarefas

- [ ] **Task 1: Variáveis de Ambiente**
  - Adicionar `GOWA_API_BASE_URL`, `GOWA_API_USER`, `GOWA_API_PASS`, `GOWA_WEBHOOK_SECRET`, `GOWA_WEBHOOK_REQUIRE_SIGNATURE` em `lib/env.ts` e `.env.example`.
- [ ] **Task 2: Tipos e Capabilities de Canal**
  - Adicionar `"gowa"` a `ChannelProvider` em `lib/channels/types.ts`.
  - Registrar capabilities de `"gowa"` em `lib/channels/capabilities.ts`.
- [ ] **Task 3: Migration de Banco de Dados**
  - Criar `supabase/migrations/20260901170000_0130_gowa_channel_provider.sql`.
  - Atualizar apêndice idempotente em `supabase/baseline.sql`.
  - Registrar no `supabase/migrations/MANIFEST.md`.
- [ ] **Task 4: Cliente HTTP e Tipos GOWA (`lib/gowa/`)**
  - Criar `lib/gowa/client.ts` com suporte a Basic Auth, `X-Device-Id`, envio de mensagens e busca de QR code.
  - Criar `lib/gowa/send.ts` com resolução de chat IDs `@s.whatsapp.net`.
  - Criar `lib/gowa/message-id.ts` com normalização de IDs.
- [ ] **Task 5: Envelopes e Autenticação de Webhook**
  - Criar `lib/gowa/envelope.ts` com schemas Zod loose para roteamento e contrato.
  - Criar `lib/gowa/webhook-auth.ts` com validação HMAC-SHA256 fail-closed.
- [ ] **Task 6: Pipeline de Ingestão Inbound**
  - Criar `lib/gowa/ingest.ts` com parse de identificadores (`@s.whatsapp.net`, `@lid`, `@g.us`), upsert atômico de contatos/conversas e disparo de efeitos pós-entrada.
- [ ] **Task 7: Adapter de Canal (`lib/channels/adapters/gowa.ts`)**
  - Implementar `gowaAdapter` seguindo a interface `ChannelAdapter`.
  - Registrar em `lib/channels/index.ts`.
- [ ] **Task 8: Rota de Webhook e Proxy de QR Code**
  - Criar `app/api/v1/webhooks/gowa/[token]/route.ts`.
  - Atualizar `app/api/v1/channel-sessions/[id]/qr/route.ts` para servir o QR gerado pelo GOWA.
  - Atualizar `app/api/v1/channel-sessions/route.ts` e `[id]/route.ts` para criação, reconexão e health check do GOWA.
- [ ] **Task 9: Lint de Canais**
  - Atualizar `scripts/lint-channels.ts` com proteção dos termos GOWA.
- [ ] **Task 10: Testes Automatizados**
  - Criar `tests/unit/gowa-client.test.ts`.
  - Criar `tests/unit/gowa-ingest.test.ts`.
  - Criar `tests/unit/gowa-webhook-auth.test.ts`.
  - Criar `tests/unit/channel-capability-gowa.test.ts`.
  - Criar `tests/invariants/gowa-provider-schema.test.ts`.
- [ ] **Task 11: Validação e Governança**
  - Executar `pnpm typecheck` e `pnpm lint`.
  - Executar `pnpm test:unit` e `pnpm gov:verify`.
