# Especificação Técnica: Player de Áudio Estilo WhatsApp com Avatar e Autoplay Sequencial

> **Status:** Implementado e Homologado  
> **Data:** 2026-09-05  
> **Arquivos:** `components/inbox/media/AudioPlayer.tsx`, `components/inbox/media/audioCoordinator.ts`, `components/inbox/media/MediaRenderer.tsx`, `components/inbox/ChatThread.tsx`, `public/*.svg`

---

## 1. Visão Geral

A bolha de mensagem de áudio (PTT - *Push to Talk*) do Inbox foi reformulada para seguir a experiência nativa do WhatsApp (Web e Mobile), introduzindo:
1. **Avatar do Remetente com Microfone**: A bolinha de foto da pessoa integrada à bolha de áudio.
2. **Alternância Dinâmica no Playback**: Enquanto parado, exibe a foto do remetente e o ícone de microfone. Ao dar play (`playing`), o avatar se transforma no botão de controle de velocidade (`1x`, `1.5x`, `2x`). Ao pausar ou terminar, a foto retorna automaticamente.
3. **Ícones Vetoriais Nativos em `/public/`**: `/play.svg`, `/pause.svg`, `/loading.svg`, `/erro.svg` e `/microfone.svg`.
4. **Coordenação de Áudio Único & Autoplay Sequencial**: Impede múltiplos áudios tocando simultaneamente e engatilha automaticamente o próximo áudio da conversa quando o atual terminar.

---

## 2. Arquitetura dos Componentes

### 2.1 `AudioPlayer.tsx` (`components/inbox/media/AudioPlayer.tsx`)
Responsável pela renderização da bolha, controle do elemento `<audio>`, cálculo de progresso e alternância visual.

- **Props**:
  - `messageId: string` — Identificador da mensagem (usado para resolver `mediaSrc(messageId)`).
  - `isOutbound: boolean` — Direção da mensagem (`true` para enviada, `false` para recebida).
  - `message?: Message` — Objeto da mensagem para extração de `contact_id`, `sent_via` e metadados.
- **Resolução de Avatar**:
  - **Inbound (`!isOutbound`)**:
    - Busca a foto do perfil do contato em `/api/v1/contacts/${contactId}/avatar`.
    - Fallback: Iniciais estilizadas (`WA`) caso o contato não possua foto cadastrada.
  - **Outbound (`isOutbound`)**:
    - Se `sent_via === "ai"`: Avatar temático do robô de IA (`Robot` em verde esmeralda com ring translúcido).
    - Se operador humano: Foto do usuário logado (`user.avatar_url`) ou iniciais do nome (`user.full_name`).
  - **Selo de Microfone**: Imagem `/microfone.svg` sobreposta de forma absoluta (`absolute -bottom-1 -left-1`) com sombra e proteção contra seleção de texto (`pointer-events-none`).
- **Alternância Dinâmica**:
  - `playing === false`: Renderiza o container com o Avatar + Microfone.
  - `playing === true`: Renderiza a pílula de velocidade (`RATES[rateIdx]}x`), com suporte a cliques rápidos para alternar entre `1x`, `1.5x` e `2x`.

### 2.2 `audioCoordinator.ts` (`components/inbox/media/audioCoordinator.ts`)
Coordenador em memória (Singleton leve de cliente) para gerenciamento de playback global no Inbox.

- **`registerAudioPlayer(messageId, { play, pause })`**:
  - Registra os métodos de controle de cada player montado na árvore DOM.
  - Retorna a função de limpeza (*cleanup*) para o `useEffect`.
- **`notifyAudioStarted(messageId)`**:
  - Ao iniciar um áudio, pausa automaticamente qualquer outro áudio que esteja em reprodução.
- **`notifyAudioEnded(messageId)`**:
  - Ao término do áudio (`onended`), localiza o índice do áudio na lista `orderedMessageIds` da conversa e dispara o `play()` do próximo áudio subsequente.
- **`setOrderedAudioIds(ids: string[])`**:
  - Atualizado dinamicamente pelo `ChatThread.tsx` para manter a ordem cronológica dos áudios visíveis.

### 2.3 `MediaRenderer.tsx` & `ChatThread.tsx`
- **`MediaRenderer.tsx`**: Encaminha a `message` completa para o `AudioPlayer`.
- **`ChatThread.tsx`**: Mapeia as mensagens da conversa, filtra as do tipo `audio` em ordem cronológica e alimenta o coordenador via `setOrderedAudioIds`.

---

## 3. Ícones em `/public/`

| Arquivo | Finalidade | Comportamento |
| :--- | :--- | :--- |
| `/play.svg` | Botão de reprodução | Exibido quando pausado ou parado. |
| `/pause.svg` | Botão de pausa | Exibido enquanto o áudio está tocando. |
| `/loading.svg` | Carregamento / buffer | Exibido enquanto o áudio está carregando com `animate-spin`. |
| `/erro.svg` | Indicador de erro | Exibido caso o arquivo de áudio falhe no download. |
| `/microfone.svg` | Indicador de áudio PTT | Sobreposto no canto inferior do avatar. |

---

## 4. Garantias e Boas Práticas

1. **Sem Memory Leaks**: Todos os event listeners (`timeupdate`, `loadedmetadata`, `waiting`, `canplay`, `ended`, `error`) e registros no coordenador são devidamente removidos no retorno do `useEffect`.
2. **Design Responsivo & Dark/Light Mode**: As classes utilizam variáveis Tailwind CSS (`bg-primary`, `text-primary-foreground`, `bg-muted`, `text-foreground`), adaptando-se com perfeição tanto no tema claro quanto no escuro.
3. **Respeito aos Contratos de Mídia**: O carregamento de mídia continua utilizando o endpoint seguro `mediaSrc(messageId)`, sem expor URLs privadas ou chaves do Supabase Storage.
