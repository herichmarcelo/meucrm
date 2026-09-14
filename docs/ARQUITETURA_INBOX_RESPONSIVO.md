# Arquitetura e Especificação Técnica — Inbox Responsivo (Mobile & Desktop)

> **Módulo:** Interface de Conversa do Inbox (Cabeçalho de Contato & Barra de Composição)  
> **Componentes Principais:** [ConversationHeader.tsx](file:///c:/Projects/DKCRM/components/inbox/ConversationHeader.tsx) · [Composer.tsx](file:///c:/Projects/DKCRM/components/inbox/Composer.tsx) · [GifPicker.tsx](file:///c:/Projects/DKCRM/components/inbox/composer/GifPicker.tsx) · [tabs.tsx](file:///c:/Projects/DKCRM/components/ui/tabs.tsx)  
> **Stack:** Next.js 16 (App Router) · React 19 · Tailwind CSS 3 · shadcn/ui · Radix UI Primitives

---

## 1. Visão Geral

O Inbox do DeskcommCRM opera em múltiplos viewports: desde smartphones em atendimento de campo (~390px) até monitores desktop widescreen com visão de três colunas (Lista de Conversas, Chat Central e Painel Lateral de CRM).

Para garantir produtividade sem perda de contexto em nenhuma das duas extremidades, o sistema adota **regras estritas de layout responsivo adaptativo**, evitando duplicidade de código ou rotas separadas por dispositivo.

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                               Inbox Responsivo — Breakpoints                              │
│                                                                                           │
│   MOBILE (< md: 768px):                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │ [Avatar] Nome do Contato (truncate)                                          [⋮]  │   │
│   │          [Em atendimento] [Automático pausado] [Janela 24h]                       │   │
│   │          📞 +55 45 99999-9999                                                     │   │
│   ├───────────────────────────────────────────────────────────────────────────────────┤   │
│   │ [Mensagens do Chat...]                                                            │   │
│   ├───────────────────────────────────────────────────────────────────────────────────┤   │
│   │ [+] [☺] [ Campo "Escreva uma mensagem..."                             ] [🎙 / ➤]   │   │
│   │  │   └─► Abre Painel com Abas (Emoji / GIF / IA)                                  │   │
│   │  └─────► Fotos/Vídeos, Documentos, Contato, Agendamento                           │   │
│   └───────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                           │
│   DESKTOP (md+: >= 768px):                                                                │
│   ┌───────────────────────────────────────────────────────────────────────────────────┐   │
│   │ [Avatar] Nome do Contato [Em atendimento] [Automático pausado]    [Liberar][Fechar]│   │
│   │          📞 +55 45 99999-9999                                     [Devolver...][etc│   │
│   ├───────────────────────────────────────────────────────────────────────────────────┤   │
│   │ [Mensagens do Chat...]                                                            │   │
│   ├───────────────────────────────────────────────────────────────────────────────────┤   │
│   │ [+] [IA] [GIF] [☺] [ Campo "Escreva uma mensagem..."                  ] [🎙 / ➤]   │   │
│   └───────────────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Cabeçalho de Conversa (`ConversationHeader.tsx`)

### 2.1. O Problema da Refatoração Mobile vs Desktop

Em uma alteração anterior focada exclusivamente em mobile, os badges de status (*"Em atendimento"*, *JanelaSelo* e *"Automático pausado"*) haviam sido empilhados abaixo do nome incondicionalmente em todas as telas:
- No desktop, a coluna esquerda do contato aumentava para 4 linhas verticais (Nome, Badge 1, Badge 2, Telefone).
- Como o container do cabeçalho alinha os filhos verticalmente pelo centro (`items-center`), os botões de ação à direita (*"Liberar"*, *"Devolver ao automático"*, *"Transferir"*, *"Lembrar"*, *"Fechar"*) ficavam alinhados no meio exato da coluna esquerda — ou seja, na altura do badge *"Em atendimento"*.
- Visualmente, o botão *"Liberar"* invadia a linha dos badges, deixando o *"Automático pausado"* isolado abaixo e quebrando a hierarquia visual.

### 2.2. A Solução Adaptativa

O cabeçalho utiliza flexbox responsivo com Tailwind:

```tsx
<div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-background px-4 py-2.5 md:items-center md:gap-3">
  <div className="flex min-w-0 items-start gap-3 md:items-center">
    {/* Avatar (40x40) */}
    {c?.id && <Avatar className="h-10 w-10 shrink-0">...</Avatar>}

    <div className="min-w-0">
      {/* Nome e Badges: empilhados no mobile (< md), em linha única no desktop (md+) */}
      <div className="flex flex-col md:flex-row md:items-center md:gap-2">
        <h2 className="truncate text-sm font-semibold">{displayName}</h2>

        {/* Badges: mt-0.5 no mobile; md:mt-0 alinhado ao lado no desktop */}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 md:mt-0">
          <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
            {t(STATUS_LABEL[status] ?? status)}
          </Badge>
          <JanelaSelo provider={provider} lastInboundAt={lastInboundAt} />
          {emAtendimentoHumano && (
            <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]" data-testid="badge-atendimento-humano">
              Automático pausado
            </Badge>
          )}
        </div>
      </div>

      {/* Telefone / E-mail na segunda linha */}
      {phone && (
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <Phone size={11} weight="regular" aria-hidden /> {phone}
        </p>
      )}
    </div>
  </div>

  {/* Ações da conversa */}
  <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
    {/* Mobile: Botão ⋮ (DropdownMenu) */}
    <div className="md:hidden">...</div>

    {/* Desktop: Botões em linha (Liberar, Devolver, Transferir, Snooze, Fechar) */}
    <div className="hidden flex-wrap items-center gap-1.5 md:flex">...</div>
  </div>
</div>
```

### 2.3. Catracas e Invariantes de Governança
- `tests/unit/inbox-header-nao-trava.test.tsx` garante que a barra de ações **nunca** volte a ter a classe `shrink-0` (o que historicamente impunha piso de 707px e expulsava o painel lateral de CRM da tela em 1280px).
- O cabeçalho e a barra de ações continuam declarando `flex-wrap min-w-0`, garantindo encolhimento seguro se a janela for redimensionada.

---

## 3. Barra de Composição de Mensagens (`Composer.tsx`)

### 3.1. Estrutura de Controles no Mobile (< md)

No mobile, o rodapé segue rigorosamente o padrão visual e ergonomia do WhatsApp:
1. **Botão "+" (`AttachMenu`):** Sempre visível no canto esquerdo inferior, provendo acesso imediato a Fotos e Vídeos, Documentos (PDF, DOCX, etc.), Envio de Contato, Catálogo de Produtos e Agendamento de Mensagem.
2. **Botão "☺" (Smiley):** Abre o painel integrado de composição com abas (**Emoji**, **GIF**, **IA**).
3. **Área de Texto:** `textarea` autoexpansível (`autoresize()`) com placeholder contextual.
4. **Botão Dinâmico Direito:** Alternância automática entre gravação de áudio (`AudioRecorder` com microfone quando o campo está vazio) e botão de envio (`Enviar` com ícone de avião quando há texto ou nota).

### 3.2. Diagnóstico F12: Conflito Crítico entre Radix TabsContent e Tailwind CSS

#### A Causa Raiz
O Radix UI controla a visibilidade de abas inativas adicionando o atributo HTML booleano `hidden` ao elemento:
```html
<div role="tabpanel" data-state="inactive" hidden></div>
```
Nos navegadores, a folha de estilo nativa define:
```css
[hidden] { display: none; } /* especificidade: 0-1-0 */
```
Contudo, no Tailwind CSS, ao aplicar uma classe de display utilitária diretamente no `<TabsContent>` (como `className="... flex flex-col flex-1 ..."`):
```css
.flex { display: flex; } /* especificidade: 0-1-0 */
```
Como as classes utilitárias do Tailwind são declaradas após o reset/user-agent CSS, a regra `.flex` **sobrescrevia o `hidden`**.
Com isso:
- As abas inativas (`gif` e `ai`) mantinham `display: flex`.
- Todas as três abas eram renderizadas **simultaneamente** dentro do painel flex, dividindo a altura com `flex-1`.
- A aba `gif` (186.8px) e a aba `ai` (145.86px) ficavam posicionadas fisicamente sob a barra de navegação de emojis, com fundo opaco `bg-popover`, **cobrindo integralmente a lista de emojis**.
- A soma das alturas de todas as abas abertas estourava os 420px do painel, gerando a barra de rolagem com setas `▲ ▲` no canto direito.

#### A Correção em Duas Camadas

1. **Camada de Infraestrutura UI ([components/ui/tabs.tsx](file:///c:/Projects/DKCRM/components/ui/tabs.tsx)):**
   Adicionada a regra `data-[state=inactive]:hidden` à definição base do componente:
   ```tsx
   const TabsContent = React.forwardRef<
     React.ElementRef<typeof TabsPrimitive.Content>,
     React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
   >(({ className, ...props }, ref) => (
     <TabsPrimitive.Content
       ref={ref}
       className={cn(
         "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=inactive]:hidden",
         className
       )}
       {...props}
     />
   ))
   ```
   Como o seletor gerado é `[data-state="inactive"].data-[state=inactive]:hidden` (especificidade `0-2-0`), ele vence qualquer classe utilitária simples (`0-1-0`).

2. **Camada de Aplicação ([components/inbox/Composer.tsx](file:///c:/Projects/DKCRM/components/inbox/Composer.tsx)):**
   Uso de variantes condicionais de estado e renderização sob demanda:
   ```tsx
   <TabsContent
     value="emoji"
     className="flex-1 min-h-0 overflow-hidden m-0 p-0 data-[state=active]:flex data-[state=inactive]:!hidden flex-col bg-popover [&_em-emoji-picker]:!h-full [&_em-emoji-picker]:!w-full [&_em-emoji-picker]:!max-w-full [&_em-emoji-picker]:!border-0"
   >
     {mobilePanelOpen && (
       <Suspense fallback={<Skeleton className="h-full w-full" />}>
         <EmojiPickerLazy onPick={handleEmojiInsert} theme={emojiTheme} />
       </Suspense>
     )}
   </TabsContent>

   <TabsContent
     value="gif"
     className="flex-1 min-h-0 overflow-hidden m-0 p-0 data-[state=active]:flex data-[state=inactive]:!hidden flex-col bg-popover"
   >
     {mobilePanelTab === "gif" && (
       <GifPicker onPick={...} className="h-full w-full border-0 shadow-none rounded-none bg-transparent" />
     )}
   </TabsContent>
   ```

### 3.3. Otimização de Performance no GifPicker (`GifPicker.tsx`)
- Na montagem do componente com query vazia (`query === ""`), a busca pelos GIFs "Em Alta" é disparada imediatamente sem o debounce de 400ms.
- O debounce só é acionado quando o usuário de fato digita no campo de busca.

---

## 4. Matriz de Testes e Validação

Todas as alterações contam com cobertura automatizada de regressão:

| Escopo | Arquivo de Teste | Validação |
|---|---|---|
| **Header sem trava** | `tests/unit/inbox-header-nao-trava.test.tsx` | Impede `shrink-0` e garante presença de botões essenciais. |
| **Janela 24h e Selos** | `tests/unit/janela-de-atendimento.test.tsx` | Verifica exibição de badges de atendimento e canal. |
| **Composer & Rich Input** | `tests/unit/composer-*` (7 suítes, 35 testes) | Áudio, anexos, templates, emojis, colagem de imagem, notas e e-mail. |
| **Botões GIF e IA** | `tests/unit/gif-button.test.tsx`, `draft-reply-button.test.tsx` | Disparo e inserção de rascunhos. |
| **Branding** | `tests/unit/branding.test.ts` | Integridade das marcas e conformidade white-label. |
| **Integridade de Tipos** | `pnpm typecheck` | Compilação TypeScript 6 estrita (0 erros). |
| **Qualidade de Código** | `pnpm eslint` | Conformidade estrita com padrões do projeto (0 erros/avisos). |
