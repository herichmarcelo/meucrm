# Arquitetura e Integração do Canal de E-mail Nativo

> **Documento de Arquitetura de Software**  
> **Módulo:** Canal de E-mail Nativo (`EmailChannelAdapter`)  
> **Stack:** Next.js 16 (App Router) · Supabase (PostgreSQL + RLS + Realtime) · Resend API (Envio SMTP) · Svix / Resend Webhooks (Inbound) · RFC 5322 Threading

---

## 1. Visão Geral da Arquitetura de E-mail

O **Canal de E-mail Nativo** permite que o DeskcommCRM funcione como uma plataforma completa de atendimento ao cliente via e-mail (Helpdesk / Suporte Comercial). O sistema recebe e-mails enviados para endereços corporativos (ex: `suporte@empresa.com`), agrupa as respostas em threads de conversas com histórico completo no Inbox, e permite o envio de respostas por atendentes humanos ou pelo **Agente de IA Autônomo**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Provedor de E-mail / DNS                        │
│                                                                        │
│   ┌────────────────────┐                   ┌───────────────────────┐   │
│   │ E-mail do Cliente  │◄─────────────────►│   Resend API / SMTP   │   │
│   │ (Gmail, Outlook...)│                   │ (Inbound + Outbound)  │   │
│   └────────────────────┘                   └───────────┬───────────┘   │
└────────────────────────────────────────────────────────┼───────────────┘
                                                         │ Webhook Inbound (Svix)
                                                         │ /api/v1/webhooks/channel/:token
                                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              DeskcommCRM                               │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │     Webhook de Entrada & Ingestão (lib/channels/email/)        │   │
│   │     - Validação Svix HMAC / Bearer Token                       │   │
│   │     - Resolução/Criação de Contato por email (email:endereco)  │   │
│   │     - Threading por In-Reply-To / References                   │   │
│   │     - Deduplicação Postgres 23505 (Message-ID / external_id)   │   │
│   │     - Efeitos Pós-Entrada (Agente de IA, Realtime, Webhooks)   │   │
│   └────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                   │
│                                    ▼                                   │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 Supabase Postgres com RLS                      │   │
│   │        [channel_sessions]  [contacts]  [conversations]         │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Doutrina de Isolamento & Capacidades Declarativas

Seguindo a doutrina de canais (`docs/doctrine/restricao-de-canal.md`):
- O canal de e-mail é classificado pelo discriminador `ChannelKind = "email"`.
- O resolvedor puro `channelKindOf("email") === "email"` orienta os comportamentos de UI e regras de negócio sem acoplamento de strings proprietárias.

### 2.1 Matriz de Capacidades do Canal de E-mail

| Capacidade | Valor | Racional / Comportamento no Sistema |
|---|---|---|
| `canSendMedia` | `true` | Suporte a envio e recebimento de anexos. |
| `supportsReaction` | `false` | E-mail tradicional não suporta reações por emoji. |
| `supportsStatusAck` | `false` | Sem confirmações imediatas de leitura (blue check). |
| `freeformOutsideWindow` | `true` | Sem limitação de janela de 24 horas (envio livre a qualquer momento). |
| `requiresTemplates` | `false` | Não exige aprovação prévia de templates HSM. |
| `banRisk` | `false` | Risco zero de bloqueio de número por spam. |

---

## 3. Banco de Dados & Schema (Migration 0173)

A migração [`supabase/migrations/20260904080000_0173_canal_email_channel_sessions.sql`](file:///c:/Projects/DKCRM/supabase/migrations/20260904080000_0173_canal_email_channel_sessions.sql) expande o schema:

### 3.1 Alterações em `channel_sessions`
- `email_inbound_address TEXT`: Endereço de e-mail de suporte associado à sessão (ex: `suporte@empresa.com`).
- **Constraint de Tagged Union (`channel_sessions_provider_ref_check`)**:
  Garante que sessões do provedor `email` possuam obrigatoriamente `email_inbound_address NOT NULL`.
- **Unicidade de E-mail Ativo**:
  ```sql
  create unique index channel_sessions_email_inbound_address_ativo_unique
    on public.channel_sessions (email_inbound_address)
    where archived_at is null and email_inbound_address is not null;
  ```

---

## 4. Threading RFC 5322 e Pipeline Inbound

Para manter as mensagens agrupadas na mesma conversa:

1. **Associação de Contato**: O contato é localizado pelo campo `contacts.email` ou criado automaticamente com `email: <remetente>`.
2. **Localização de Thread**:
   - O payload de entrada inspeciona os cabeçalhos `In-Reply-To` e `References`.
   - Se os cabeçalhos correspondem a uma mensagem anterior do CRM, a nova mensagem é vinculada à mesma `conversations.id`.
3. **Deduplicação**: O `Message-ID` do e-mail é utilizado como `external_id` na tabela `messages`. Tentativas de entrega duplicadas são absorvidas com tratamento seguro do erro Postgres `23505`.
4. **Efeitos Pós-Entrada**: A mensagem recebida aciona `aplicarEfeitosPosEntrada`, notificando o atendente em tempo real e permitindo que o Agente de IA processe o chamado se a automação estiver habilitada.

---

## 5. Envio de Respostas (Outbound via Resend)

O `EmailChannelAdapter` ([`lib/channels/adapters/email.ts`](file:///c:/Projects/DKCRM/lib/channels/adapters/email.ts)):
- Converte o texto da resposta para HTML legível com conversão inteligente de quebras de linha e parágrafos.
- Injeta os cabeçalhos `In-Reply-To` e `References` apontando para o `Message-ID` anterior para que o cliente de e-mail do destinatário (Gmail, Outlook) agrupe o e-mail na mesma conversa.
- Permite anexar arquivos armazenados no bucket Supabase Storage.
- Mapeia códigos de erro da API Resend para `ChannelSendError` tipados.

---

## 6. Interface do Usuário e Experiência no Inbox

1. **Composer Adaptativo**:
   - Quando a conversa selecionada é de um canal de e-mail, o `<Composer>` exibe um campo opcional para **Assunto do e-mail** (`Subject`), pré-preenchido com `Re: [assunto anterior]`.
   - O botão de envio adapta seu ícone e placeholders.
2. **Identificação Visual**:
   - Ícone de envelope (`EnvelopeSimple`) e badge com o endereço de e-mail nos itens de lista e no cabeçalho da conversa.
