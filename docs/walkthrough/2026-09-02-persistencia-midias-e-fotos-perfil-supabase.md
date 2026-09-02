# Walkthrough: Persistência de Mídias e Sincronização Automática de Fotos de Perfil (Supabase Storage)

> **Data:** 2026-09-02  
> **Módulo:** Ingestão de Mensagens, Mídias Inbound (Áudios/Imagens/Vídeos/Documentos), Fotos de Perfil e Inbox  
> **Status:** Concluído e Validado (34/34 testes unitários e de integração verdes, typecheck e lint zerados)

---

## 1. Contexto e Problemas Resolvidos

Durante os testes de atendimento no WhatsApp (via WAHA e GOWA), foram identificados dois comportamentos anômalos:
1. **Mídias não salvas no bucket e indisponíveis no chat:** Mensagens contendo áudios, imagens, vídeos e documentos recebidas dos clientes não estavam sendo salvas no bucket `whatsapp-media` do Supabase Storage. Além disso, o chat apresentava erro de carregamento ao tentar reproduzir áudio ou exibir imagens.
2. **Fotos de perfil dos clientes não apareciam:** As fotos de perfil dos contatos não eram salvas no banco/bucket e não eram renderizadas no cabeçalho e na lista de conversas.

---

## 2. Causas-Raiz e Soluções Implementadas

### A. Persistência e Streaming Oportunista de Mídias de Mensagens
* **Causa 1 (GOWA sem emissão):** O pipeline de ingestão do GOWA (`lib/gowa/ingest.ts`) inseria a mensagem com mídia, mas não emitia o evento `media.persist_requested`.
  * **Solução:** Adicionada chamada `admin.rpc("emit_event", { p_event_type: "media.persist_requested", ... })` para todas as mensagens inbound com mídia no GOWA.
* **Causa 2 (Redirect 302 quebrando no Browser e URL de Mídia):** A rota `GET /api/v1/messages/[id]/media` realizava `NextResponse.redirect(msg.media_url, 302)` para URLs internas do WhatsApp (`http://waha:3000/...`). O navegador não alcança a rede interna do Docker nem possui as chaves de autenticação do provedor, resultando em erro 401/falha de conexão ("Mídia indisponível").
  * **Solução (Persistência Oportunista Imediata + Fallback de Sessão Ativa):** A rota agora:
    1. Resolve a sessão do canal da mensagem (ou faz fallback para a sessão `WORKING` ativa da organização);
    2. Baixa a mídia server-side com autenticação via adapter do canal;
    3. Faz o upload imediato no bucket privado `whatsapp-media` em `{orgId}/{convId}/{msgId}.{ext}`;
    4. Atualiza a linha em `messages` com `media_storage_path` e `media_status = "stored"`;
    5. Transmite os bytes diretamente com `Content-Type` correto e cache.
* **Causa 3 (Estrutura aninhada de payloads WAHA NOWEB):** Em versões modernas do WAHA NOWEB, a URL de mídia pode vir em `p._data.message.*.url`, `p._data.mediaUrl`, etc.
  * **Solução:** `mediaUrlOf(p)` e `mediaMimeOf(p)` foram aprimorados para inspecionar exaustivamente todas as propriedades e estruturas aninhadas do payload (`_data.message.imageMessage`, `audioMessage`, `videoMessage`, `documentMessage`, `stickerMessage` e fallback por `p.id`).

---

### B. Captura e Sincronização Automática de Fotos de Perfil (Avatars)
* **Causa 1 (Ausência de gatilho na entrada):** Quando um contato mandava mensagem, o sistema gravava o contato mas nunca disparava a busca da foto de perfil.
  * **Solução:** Em `lib/channels/pos-entrada.ts` (`aplicarEfeitosPosEntrada`), adicionado o passo 4: acionamento assíncrono em segundo plano (`syncContactAvatar`) para qualquer mensagem inbound de contato que ainda não possua foto sincronizada nas últimas 24h.
* **Causa 2 (Falta de busca sob demanda):** A rota `GET /api/v1/contacts/[id]/avatar` retornava 404 de imediato se o avatar ainda não estivesse persistido.
  * **Solução:** Adicionada tentativa de sincronização oportunista sob demanda com o provedor caso `avatar_storage_path` seja `NULL`.
* **Causa 3 (Ausência de Avatar no cabeçalho da conversa aberta):** O componente `ConversationHeader.tsx` exibia apenas o nome e número do contato.
  * **Solução:** Integrado o componente `<Avatar>` (com `<AvatarImage src="/api/v1/contacts/${c.id}/avatar" />` e `<AvatarFallback>` com iniciais) no topo da conversa aberta.
* **Causa 4 (Headers de autenticação no download do avatar):** Atualizado `fetchAvatarImageBuffer` no `avatar-sync.ts` para enviar credenciais de autenticação caso a URL aponte para servidores locais/privados do GOWA/WAHA.

---

## 3. Arquivos Modificados e Criados

| Arquivo | Ação | Descrição |
|---|---|---|
| [`lib/gowa/ingest.ts`](file:///c:/Projects/DKCRM/lib/gowa/ingest.ts) | MODIFIED | Emissão de `media.persist_requested` na ingestão com mídia |
| [`lib/gowa/client.ts`](file:///c:/Projects/DKCRM/lib/gowa/client.ts) | MODIFIED | Método `fetchInboundMedia` com headers e timeout |
| [`lib/channels/adapters/gowa.ts`](file:///c:/Projects/DKCRM/lib/channels/adapters/gowa.ts) | MODIFIED | Chamada correta a `fetchInboundMedia` no adapter |
| [`lib/messaging/media/waha-source.ts`](file:///c:/Projects/DKCRM/lib/messaging/media/waha-source.ts) | MODIFIED | Tratamento robusto de URLs absolutas e relativas |
| [`app/api/v1/messages/[id]/media/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/messages/[id]/media/route.ts) | MODIFIED | Persistência oportunista no bucket `whatsapp-media` e streaming de áudio/imagem |
| [`lib/channels/pos-entrada.ts`](file:///c:/Projects/DKCRM/lib/channels/pos-entrada.ts) | MODIFIED | Sincronização automática em segundo plano de foto de perfil na chegada de mensagem |
| [`lib/contacts/avatar-sync.ts`](file:///c:/Projects/DKCRM/lib/contacts/avatar-sync.ts) | MODIFIED | Suporte a credenciais em `fetchAvatarImageBuffer` e throttle de 24h |
| [`app/api/v1/contacts/[id]/avatar/route.ts`](file:///c:/Projects/DKCRM/app/api/v1/contacts/[id]/avatar/route.ts) | MODIFIED | Sincronização oportunista on-demand no endpoint de avatar |
| [`components/inbox/ConversationHeader.tsx`](file:///c:/Projects/DKCRM/components/inbox/ConversationHeader.tsx) | MODIFIED | Adição do componente `<Avatar>` no cabeçalho do chat |
| [`tests/unit/api-messages-media.test.ts`](file:///c:/Projects/DKCRM/tests/unit/api-messages-media.test.ts) | NEW | Testes unitários do endpoint de mídia com persistência oportunista |

---

## 4. Validação e Testes

* `pnpm vitest run tests/unit/api-messages-media.test.ts tests/unit/api-contact-avatar-sync.test.ts tests/unit/contact-avatar-sync.test.ts tests/unit/media-persist-worker.test.ts tests/unit/midia-de-entrada-por-canal.test.ts`: **34/34 testes aprovados**.
* `pnpm typecheck`: **0 erros**.
* `pnpm lint`: **0 erros**.
