# Arquitetura de Persistência e Streaming de Mídias Inbound (Supabase Storage)

> **Documento de Arquitetura e Especificação Técnica**  
> **Módulo:** Persistência de Mídias Inbound (Áudios, Imagens, Vídeos, Documentos, Figurinhas) & Supabase Storage  
> **Stack:** Next.js 16 (App Router) · Supabase (PostgreSQL + Storage + RLS) · WAHA Plus · GOWA v9.3.0 · Event Log

---

## 1. Visão Geral

Este documento descreve a arquitetura e os fluxos de captura, armazenamento persistente e streaming de mídias enviadas por clientes via WhatsApp (áudios, mensagens de voz PTT, imagens, vídeos, figurinhas/stickers e documentos) no CRM.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     Fluxo de Mídias WhatsApp no CRM                                     │
│                                                                                                         │
│  [Cliente WhatsApp] ──► [WAHA / GOWA Engine]                                                            │
│                                │                                                                        │
│                                ▼ Webhook Inbound                                                        │
│                    ┌───────────────────────┐                                                            │
│                    │ Webhook Route Handler │                                                            │
│                    │  • /api/v1/webhooks/… │                                                            │
│                    └───────────┬───────────┘                                                            │
│                                │                                                                        │
│                ┌───────────────┴────────────────┐                                                       │
│                ▼                                ▼                                                       │
│     ┌───────────────────────┐       ┌───────────────────────┐                                           │
│     │   Tabela `messages`   │       │   Tabela `event_log`  │                                           │
│     │   (Grava media_url,   │       │   (Emite evento:      │                                           │
│     │    tipo e metadados)  │       │   media.persist_req)  │                                           │
│     └──────────┬────────────┘       └───────────┬───────────┘                                           │
│                │                                │                                                       │
│                │                                ▼ Drain Cron                                            │
│                │                    ┌───────────────────────┐                                           │
│                │                    │ media-persist-worker  │                                           │
│                │                    └───────────┬───────────┘                                           │
│                │                                │                                                       │
│                │   ┌────────────────────────────┼───────────────────────────┐                           │
│                │   │                            │ Download server-side      │                           │
│                ▼   ▼                            ▼ com credenciais           │                           │
│     ┌───────────────────────┐       ┌───────────────────────┐               │                           │
│     │ GET /api/v1/messages/ │◄─────►│ Adapter Provedor      │               │                           │
│     │ [id]/media            │       │ (WAHA / GOWA Client)  │               │                           │
│     └──────────┬────────────┘       └───────────────────────┘               │                           │
│                │                                                            │                           │
│                │ Upload imediato / persistência oportuna                    │                           │
│                ▼                                                            │                           │
│     ┌───────────────────────────────────────────────────────┐               │                           │
│     │ Supabase Storage (Bucket Privado `whatsapp-media`)    │◄──────────────┘                           │
│     │ Caminho: `{org_id}/{conversation_id}/{message_id}.{ext}`                                          │
│     └──────────────────────────┬────────────────────────────┘                                           │
│                                │                                                                        │
│                                ▼ Streaming Binário (Content-Type) / Signed URL (TTL 3600s)              │
│                     [Frontend Inbox - AudioPlayer / ImageMedia / VideoMedia / DocumentCard]             │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Decisões Fundamentais de Engenharia

### 2.1 Por que o navegador NÃO pode acessar as URLs de mídia do WhatsApp diretamente?
1. **Rede Interna e Isolamento de Contêineres:** Em instalações de produção (Docker Compose / VPS), o WAHA ou GOWA opera dentro da rede do contêiner (`http://waha:3000` ou `http://127.0.0.1:...`). O navegador do cliente fora do servidor não tem resolução de DNS para esses hosts.
2. **Segurança e Autenticação:** Os arquivos servidos pelos motores exigem cabeçalhos de autenticação (`X-Api-Key` ou Basic Auth). O navegador não os envia ao renderizar `<img src="...">` ou `<audio src="...">`.
3. **Persistência Centralizada:** Fazer o proxy ou download server-side permite persistir permanentemente os bytes no bucket privado `whatsapp-media` do Supabase Storage.

### 2.2 Persistência Oportunista na Primeira Visualização
- O sistema opera em duas vias de alta confiabilidade:
  1. **Via Assíncrona de Background:** O webhook emite `media.persist_requested` no `event_log` para ser consumido pelo worker do cron (`event-log-drain`);
  2. **Via Oportunista Síncrona:** Caso o atendente abra a conversa antes de o worker de background rodar (ou em ambientes de desenvolvimento), o endpoint `GET /api/v1/messages/[id]/media` baixa o arquivo server-side com autenticação, salva imediatamente no bucket do Supabase Storage e atualiza a mensagem no banco com `media_storage_path`.

---

## 3. Estrutura de Armazenamento no Supabase Storage

### 3.1 Configuração do Bucket
- **Nome do Bucket:** `whatsapp-media`
- **Visibilidade:** Privado (`public = false`)
- **Tamanho Máximo de Arquivo:** 50 MB (`52428800` bytes)
- **Acesso:** Exclusivamente via `service_role` (Upload e Assinatura de URLs). Sem policies públicas em `storage.objects`.

### 3.2 Hierarquia de Diretórios
```
whatsapp-media/
  └── {organization_id}/
        ├── avatars/
        │     └── {contact_id}.jpg
        └── {conversation_id}/
              ├── {message_id}.jpg
              ├── {message_id}.ogg
              ├── {message_id}.mp4
              └── {message_id}.pdf
```

---

## 4. Normalização de Mídias por Provedor

### 4.1 WAHA Plus (Engine NOWEB)
- Em versões recentes do WAHA NOWEB, os dados de mídia podem estar aninhados em:
  - `payload.media.url` / `payload.mediaUrl`
  - `payload._data.message.imageMessage.url` / `audioMessage` / `videoMessage` / `documentMessage` / `stickerMessage`
  - Caso `hasMedia: true` sem URL explícita: `/api/files/{id}`.
- O extrator `mediaUrlOf(p)` e `mediaMimeOf(p)` em `lib/waha/ingest.ts` verifica todas as estruturas de forma recursiva e tolerante a falhas.

### 4.2 GOWA (Go WhatsApp Web MultiDevice)
- O GOWA envia mídias no payload em `rawObj.media_url`, `image_url`, `audio_url`, `file_url` ou via endpoint `/app/media/{external_id}`.
- O cliente `GowaClient.fetchInboundMedia` conecta-se à API interna do GOWA injetando `Authorization: Basic ...` e `X-Device-Id`.

---

## 5. Componentes de Renderização no Frontend (Inbox)

| Tipo de Mídia | Componente React | Formato / Comportamento |
|---|---|---|
| **Áudio / Voz (PTT)** | [`AudioPlayer.tsx`](file:///c:/Projects/DKCRM/components/inbox/media/AudioPlayer.tsx) | Player customizado com barra de progresso, tempo e controle de velocidade |
| **Imagem** | [`ImageMedia.tsx`](file:///c:/Projects/DKCRM/components/inbox/media/ImageMedia.tsx) | Miniatura na bolha de mensagem + Lightbox Modal em tela cheia |
| **Figurinha (Sticker)** | [`StickerMedia.tsx`](file:///c:/Projects/DKCRM/components/inbox/media/StickerMedia.tsx) | Exibição transparente sem borda de bolha |
| **Vídeo** | [`VideoMedia.tsx`](file:///c:/Projects/DKCRM/components/inbox/media/VideoMedia.tsx) | Player HTML5 com suporte a proporção 16:9 |
| **Documento / PDF** | [`DocumentCard.tsx`](file:///c:/Projects/DKCRM/components/inbox/media/DocumentCard.tsx) | Cartão com ícone do tipo de arquivo, tamanho em bytes e botão de download |
| **Erro / Indisponível** | [`MediaUnavailable.tsx`](file:///c:/Projects/DKCRM/components/inbox/media/MediaUnavailable.tsx) | Estado resiliente com ícone e aviso "Mídia indisponível" |
