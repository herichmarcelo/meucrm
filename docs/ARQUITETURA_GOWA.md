# Arquitetura e Integração GOWA (Go WhatsApp Web MultiDevice)

> **Documento de Arquitetura de Software**
> **Módulo:** Integração WhatsApp via GOWA (Docker / Portainer)
> **Stack:** Next.js 16 (App Router) · Supabase (PostgreSQL + RLS + Realtime) · Docker (aldinokemal2104/go-whatsapp-web-multidevice:v9.3.0)

---

## 1. Arquitetura Geral do GOWA

O **GOWA (Go WhatsApp Web MultiDevice)** é um serviço open source desenvolvido em Go que expõe uma API RESTful HTTP sobre o protocolo multi-device do WhatsApp (engine Baileys-like em Go). Ele roda em container Docker dedicado, operando em paralelo e coexistência com o **WAHA Plus**.

```
┌────────────────────────────────────────────────────────┐
│                   Host VPS / Docker                    │
│                                                        │
│  ┌──────────────────┐            ┌──────────────────┐  │
│  │   GOWA v9.3.0    │  HTTP/REST │   DeskcommCRM    │  │
│  │ (Multi-Device Go)│◄──────────►│    (Next.js)     │  │
│  │   [Porta 4000]   │  Webhooks  │                  │  │
│  └────────┬─────────┘            └────────┬─────────┘  │
│           │ /app/storages                 │            │
│           ▼ (Volume Docker)               ▼            │
│     [Storage Chaves]              [Supabase Postgres]  │
└────────────────────────────────────────────────────────┘
```

### 1.1 Características Operacionais do GOWA v9.3.0
* **Multi-Device e Múltiplas Contas:** Gerencia instâncias independentes através do endpoint `/devices` e do header de escopo `X-Device-Id`.
* **Baixo Consumo de Recursos:** Construído em Go, o GOWA consome tipicamente entre **30MB a 80MB de RAM por sessão**, sendo extremamente eficiente em VPS.
* **Autenticação:** Protegido por HTTP Basic Auth (`Authorization: Basic <base64(user:pass)>`).
* **Segurança de Webhooks:** Assinatura criptográfica dos payloads com HMAC SHA-256 via header `X-Hub-Signature-256: sha256=<hash>`.
* **Persistência de Sessões:** Dados de pareamento e chaves de criptografia Signal são persistidos no volume Docker `/app/storages` e/ou banco Postgres auxiliar.

---

## 2. Fluxo de Entrada (Inbound Webhook)

Quando uma mensagem é recebida no WhatsApp em um número conectado via GOWA:

### 2.1 Passo a Passo do Pipeline

1. **Recepção no GOWA:** O WhatsApp entrega o pacote no socket do GOWA $\rightarrow$ O GOWA formata o evento `message`.
2. **Disparo do Webhook:** O GOWA faz um `POST` HTTP para o endpoint dedicado:
   `/api/v1/webhooks/gowa/[token]` com o header `X-Hub-Signature-256: sha256=<hash>`.
3. **Validação e Roteamento (`app/api/v1/webhooks/gowa/[token]/route.ts`):**
   * **Estágio 1 (Roteamento com Zod Loose):** Valida a estrutura básica do JSON (`lerRoteamentoGowa`) sem descartar campos extras.
   * **Lookup do Tenant:** Busca no banco (`channel_sessions`) pela sessão ativa com `webhook_path_token == token` e `provider == 'gowa'`.
   * **Autenticação HMAC SHA-256 (*Fail-Closed*):** O Next.js recupera a chave criptografada da sessão (`webhook_secret_encrypted`), decifra e valida a assinatura usando comparação em tempo constante (`crypto.timingSafeEqual`).
   * **Arquivamento Bruto:** Insere o payload e headers em `webhook_events_log` com status `received` para auditoria e rastreabilidade forense.
   * **Estágio 2 (Contrato de Conteúdo):** Valida a integridade dos campos da mensagem (`conferirContratoGowa`).
4. **Execução do Pipeline (`dispatchGowaEvent` em `lib/gowa/ingest.ts`):**
   * **Parse de Identidade (`parseChatIdGowa`):**
     * `{number}@s.whatsapp.net` $\rightarrow$ Formato telefônico E.164 (`+55...`).
     * `{lid}@lid` ou `from_lid` $\rightarrow$ Identificador LID do WhatsApp.
     * `@g.us` $\rightarrow$ Grupos são ignorados do vínculo de CRM por doutrina de produto.
   * **Upsert Atômico de Contato (`fn_upsert_wa_contact`):** Insere ou atualiza o contato sem *race conditions* sob `(organization_id, wa_identity)`.
   * **Upsert Atômico de Conversa (`fn_upsert_wa_conversation`):** Garante o vínculo da conversa associada ao contato e à `channel_session`.
   * **Persistência da Mensagem:** Grava na tabela `messages` com direção `inbound`, `status: "delivered"` e `external_id` (bare ID retornado pelo GOWA).
   * **Idempotência (Postgres `23505`):** Captura reenvios acidentais sem duplicar mensagens.
   * **Carimbo Operacional:** A RPC `fn_mark_conversation_message` atualiza a prévia e a data da última mensagem na conversa.
   * **Efeitos Pós-Entrada (`aplicarEfeitosPosEntrada`):** Processa opt-out LGPD ("SAIR"), qualificação de Leads e despacho para o **Agente de IA**.
5. **Propagação em Tempo Real:**
   * Supabase dispara evento CDC via Realtime (`INSERT` em `public.messages`) para o WebSocket no navegador do operador.

---

## 3. Diagrama de Sequência — Inbound

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Celular do Cliente
    participant WA as Servidores WhatsApp
    participant GOWA as Container GOWA (Porta 4000)
    participant Next as Next.js Webhook Route<br/>(/api/v1/webhooks/gowa/[token])
    participant Supa as Supabase (Postgres & RPCs)
    participant Realtime as Supabase Realtime
    actor Operador as Frontend (Inbox UI)

    Cliente->>WA: Envia mensagem ("Olá, gostaria de um orçamento")
    WA->>GOWA: Entrega frame via WebSocket
    GOWA->>Next: POST /api/v1/webhooks/gowa/[token]<br/>(Header: X-Hub-Signature-256)
    
    rect rgb(240, 245, 255)
        Note over Next,Supa: Pipeline de Segurança e Roteamento
        Next->>Supa: Lookup channel_sessions por webhook_path_token (provider='gowa')
        Supa-->>Next: Dados da Sessão + organization_id + secret
        Next->>Next: Valida HMAC-SHA256 (crypto.timingSafeEqual)
        Next->>Supa: INSERT INTO webhook_events_log (raw_body, status='received')
    end

    rect rgb(245, 255, 245)
        Note over Next,Supa: Ingestão Atômica (dispatchGowaEvent)
        Next->>Next: Extrai identidade (E.164 ou LID de payload.from / from_lid)
        Next->>Supa: RPC fn_upsert_wa_contact(org, phone, from_name)
        Supa-->>Next: contact_id
        Next->>Supa: RPC fn_upsert_wa_conversation(org, contact_id, session_id)
        Supa-->>Next: conversation_id
        Next->>Supa: INSERT INTO messages (direction='inbound', external_id, ...)
        Next->>Supa: RPC fn_mark_conversation_message(conv_id, preview, ...)
        Next->>Next: Executa aplicarEfeitosPosEntrada (LGPD / Leads / AI Agent)
    end

    Next-->>GOWA: HTTP 200 { "accepted": true }
    
    Supa->>Realtime: Evento CDC (INSERT em public.messages)
    Realtime-->>Operador: WebSocket push (Atualiza chat no Inbox)
```

---

## 4. Exemplos Reais de JSON do GOWA

### 4.1 Payload do Webhook Inbound (Recebido do GOWA)
```json
{
  "event": "message",
  "device_id": "5511999998888@s.whatsapp.net",
  "session_id": "org_7f81a_vendas",
  "payload": {
    "id": "3EB0C127D7BACC83D6A1",
    "chat_id": "5511987654321@s.whatsapp.net",
    "from": "5511987654321@s.whatsapp.net",
    "from_lid": "251556368777322@lid",
    "from_name": "Carlos Eduardo",
    "sender_display_name": "Carlos Eduardo",
    "timestamp": "2026-09-01T20:30:00Z",
    "is_from_me": false,
    "body": "Olá! Gostaria de receber a proposta comercial."
  }
}
```

### 4.2 Payload de Mensagem com Citação (Reply)
```json
{
  "event": "message",
  "device_id": "5511999998888@s.whatsapp.net",
  "session_id": "org_7f81a_vendas",
  "payload": {
    "id": "3EB0C127D7BACC83D6A2",
    "chat_id": "5511987654321@s.whatsapp.net",
    "from": "5511987654321@s.whatsapp.net",
    "from_name": "Carlos Eduardo",
    "timestamp": "2026-09-01T20:32:00Z",
    "is_from_me": false,
    "body": "Pode me enviar por aqui mesmo?",
    "replied_to_id": "3EB0C127D7BACC83D6A1",
    "quoted_body": "Olá! Gostaria de receber a proposta comercial."
  }
}
```

---

## 5. Fluxo de Saída (Outbound) e Proxy de QR Code

### 5.1 Envio de Mensagem Outbound
1. Backend Next.js invoca `GowaClient` (`lib/gowa/client.ts`).
2. Roteamento por tipo:
   - Texto: `POST /send/message` com header `X-Device-Id: <session_name>` e body `{ "phone": "5511987654321@s.whatsapp.net", "message": "Texto...", "reply_message_id": "..." }`.
   - Mídia: `POST /send/image`, `/send/file`, `/send/audio`.
3. Headers de Autenticação: `Authorization: Basic <base64>` e `X-Device-Id: <session_name>`.
4. Persistência na tabela `messages` com `direction: "outbound"` e status inicial `sent`.

### 5.2 Fluxo de Exibição de QR Code no Frontend
1. O frontend requisita a imagem via:
   `<img src="/api/v1/channel-sessions/[id]/qr?t=[timestamp]" />`
2. A rota `/api/v1/channel-sessions/[id]/qr/route.ts` identifica `session.provider === 'gowa'`.
3. O Next.js chama `GET /devices/{device_id}/login` no GOWA no backend, obtém o link do QR gerado e faz o proxy do buffer binário da imagem PNG diretamente com `Content-Type: image/png` e `Cache-Control: no-store`.
4. **Segurança:** O browser nunca tem acesso à URL interna do GOWA nem às credenciais Basic Auth.

---

## 6. Configuração no Docker / Portainer

Stack de execução do GOWA no Portainer:

```yaml
version: "3.9"

networks:
  gowa-network:
    driver: bridge

volumes:
  gowa_postgres_data:
  gowa_data:

services:
  postgres:
    image: postgres:16-alpine
    container_name: gowa-postgres
    restart: unless-stopped
    networks:
      - gowa-network
    environment:
      POSTGRES_DB: gowa
      POSTGRES_USER: gowa
      POSTGRES_PASSWORD: gowa_db_password_change_me
    volumes:
      - gowa_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gowa -d gowa"]
      interval: 5s
      timeout: 5s
      retries: 10

  gowa:
    image: aldinokemal2104/go-whatsapp-web-multidevice:v9.3.0
    container_name: gowa
    restart: unless-stopped
    networks:
      - gowa-network
    ports:
      - "4000:3000"
    dns:
      - 8.8.8.8
      - 1.1.1.1
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      TZ: America/Campo_Grande
      APP_TIMEZONE: America/Campo_Grande
      APP_PORT: 3000
      APP_DEBUG: "true"
      APP_OS: GOWA_Deskcomm_Engine
      APP_BASIC_AUTH: "admin:5pGy5LqNi3FpMJYAlcB0wNZ0HI453qZV"
      WHATSAPP_WEBHOOK: "http://host.docker.internal:3000/api/v1/webhooks/gowa"
      WHATSAPP_WEBHOOK_EVENTS: "message,message.ack"
      WHATSAPP_WEBHOOK_IGNORE_JIDS: "@g.us"
      DB_URI: "postgres://gowa:gowa_db_password_change_me@postgres:5432/gowa?sslmode=disable"
    volumes:
      - gowa_data:/app/storages
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    depends_on:
      postgres:
        condition: service_healthy
    command:
      - rest
```

---

## 7. Variáveis de Ambiente no DeskcommCRM (`.env`)

```bash
# GOWA (WhatsApp Multi-Device Alternativo)
GOWA_API_BASE_URL=http://localhost:4000
GOWA_API_USER=admin
GOWA_API_PASS=5pGy5LqNi3FpMJYAlcB0wNZ0HI453qZV
GOWA_WEBHOOK_SECRET=
GOWA_WEBHOOK_REQUIRE_SIGNATURE=false
```

---

## 8. Gestão de Instâncias Nomeadas e Segmentação por Equipes

Para atender às necessidades de empresas com múltiplos setores ou equipes comerciais (ex: Vendas, Suporte, Financeiro), cada conexão/instância criada pode receber um **Nome Amigável / Nome da Instância** (`display_name`).

### 8.1 Regras de Negócio e Casos de Uso
1. **Identificação da Equipe:**
   - Ao conectar um novo número de WhatsApp ou editar um existente, o usuário define o nome da instância (ex: `VENDEDORES`, `SUPORTE`, `PLANTÃO`).
   - Isso permite que o CRM identifique visualmente e programmaticamente a finalidade do canal.
2. **Segmentação de Atendentes e Filas:**
   - Um vendedor (ex: `João`) é associado à fila/instância `VENDEDORES`.
   - Conversas recebidas pelo número daquela instância entram na fila específica e ficam restritas ou priorizadas para a equipe responsável.
3. **Persistência e APIs:**
   - `POST /api/v1/channel-sessions`: aceita `{ "display_name": "VENDEDORES", "provider": "gowa" }`.
   - `PATCH /api/v1/channel-sessions/[id]`: permite renomear a instância a qualquer momento `{ "display_name": "NOVO_NOME" }`.
    - Na listagem de conexões e na Central de Atendimento, o sistema exibe o nome customizado destacado junto ao número (ex: `VENDEDORES (+55 45 8820-6525)`).

---

## 9. Sincronização de Fotos de Perfil (Avatares)

* **Consulta Upstream:** `GET /user/avatar?phone={phone}` (com headers `Authorization: Basic ...` e `X-Device-Id: {deviceId}`) via `GowaClient.fetchProfilePictureUrl()`.
* **Persistência em Bucket Privado:** O arquivo binário retornado (ou baixado via link temporário) é salvo no Supabase Storage no bucket `whatsapp-media` em `{org_id}/avatars/{contact_id}.jpg` com `upsert: true`.
* **Desacoplamento e LGPD:** A sincronização roda via cron (`app/api/v1/cron/contact-avatars/route.ts`) ou sob demanda. Ao anonimizar o contato por LGPD, o arquivo é removido do storage via `storage_redaction_queue`.
* **Documentação Completa:** Detalhes em [`docs/ARQUITETURA_FOTOS_PERFIL.md`](ARQUITETURA_FOTOS_PERFIL.md).
