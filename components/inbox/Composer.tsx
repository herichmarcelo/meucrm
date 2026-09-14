"use client";
import { useT } from "@/hooks/i18n/useT";
import {
  forwardRef,
  Suspense,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import {
  CircleNotch,
  PaperPlaneTilt,
  Smiley,
  Sparkle,
  X,
} from "@/lib/ui/icons";
import { useOptionalTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AttachMenu } from "@/components/inbox/composer/AttachMenu";
import { AttachmentPreviewDialog } from "@/components/inbox/composer/AttachmentPreviewDialog";
import { ContactPickerDialog } from "@/components/inbox/composer/ContactPickerDialog";
import { CatalogPickerDialog } from "@/components/inbox/composer/CatalogPickerDialog";
import type { CatalogSearchItem } from "@/app/api/v1/catalog/search/route";
import { ScheduleMessageDialog } from "@/components/inbox/composer/ScheduleMessageDialog";
import { AudioRecorder } from "@/components/inbox/composer/AudioRecorder";
import { DraftReplyButton } from "@/components/inbox/composer/DraftReplyButton";
import { EmojiButton, EmojiPickerLazy } from "@/components/inbox/composer/EmojiButton";
import { GifButton } from "@/components/inbox/composer/GifButton";
import { GifPicker } from "@/components/inbox/composer/GifPicker";
import { resolveSlash, TemplateMenu } from "@/components/inbox/composer/TemplateMenu";
import { useCreateNote } from "@/hooks/inbox/useCreateNote";
import { useMessageTemplates, type MessageTemplate } from "@/hooks/inbox/useMessageTemplates";
import { toast } from "sonner";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { useUploadMedia } from "@/hooks/inbox/useUploadMedia";
import { useDraftReply } from "@/hooks/inbox/useDraftReply";
import { imagemDoClipboard } from "@/lib/inbox/clipboard-image";
import { interpolateTemplate } from "@/lib/inbox/template-vars";
import { channelKindOf } from "@/lib/channels/types";
import { cn } from "@/lib/utils";
import type { GiphyGifItem } from "@/app/api/v1/gifs/route";

export interface ComposerHandle {
  focus: () => void;
}

interface Props {
  conversationId: string;
  disabled?: boolean;
  /** Set true when contact is blocked / anonymized — explanation shown. */
  blockedReason?: string | null;
  /**
   * Janela de 24h fechada: barra a RESPOSTA, e só ela.
   *
   * Separado de `blockedReason` porque a nota interna nunca chega ao cliente —
   * a regra da plataforma não a alcança, e barrá-la tira do atendente
   * justamente o lugar onde ele registra por que a conversa esfriou. A primeira
   * versão deste bloqueio usava `blockedReason` e levou a nota junto.
   */
  janelaFechada?: string | null;
  /**
   * A mensagem que esta resposta CITA, quando o atendente escolheu responder
   * "em cima" de uma. `null` = envio solto, o caso comum.
   *
   * Vem de fora e não daqui porque quem escolhe é a lista de mensagens: o
   * composer só precisa mostrar o que foi escolhido e mandá-lo junto.
   */
  respondendo?: { id: string; body: string | null; direction: string } | null;
  /** Desfaz a escolha — o `x` da faixa de citação. */
  onCancelarResposta?: () => void;
  /** Nome do contato da conversa, para interpolar {{nome}}/{{primeiro_nome}} do template escolhido. */
  contactName?: string | null;
  /** Contato da conversa — excluído do seletor de cartão compartilhado. */
  currentContactId?: string | null;
  /** Canal da conversa ('whatsapp' | 'email') */
  channel?: string | null;
  /** Provider da sessão do canal */
  channelProvider?: string | null;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    conversationId,
    disabled,
    blockedReason,
    janelaFechada,
    contactName,
    currentContactId,
    respondendo,
    onCancelarResposta,
    channel,
    channelProvider,
  },
  ref,
) {
  const t = useT();
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const themeCtx = useOptionalTheme();
  const emojiTheme =
    themeCtx?.resolvedTheme ??
    (typeof document !== "undefined" &&
    (document.documentElement.classList.contains("dark") ||
      document.documentElement.getAttribute("data-theme") === "dark")
      ? "dark"
      : "light");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [mobilePanelTab, setMobilePanelTab] = useState<"emoji" | "gif" | "ai">("emoji");
  const [aiDraftText, setAiDraftText] = useState("");
  const send = useSendMessage();
  const upload = useUploadMedia();
  const draftReply = useDraftReply();
  const createNote = useCreateNote();
  const templates = useMessageTemplates();
  const slash = resolveSlash(text);
  const menuOpen = mode === "reply" && slash.open && !menuDismissed;

  const isEmail = channel === "email" || channelKindOf(channelProvider) === "email";

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
  }));

  // send/createNote fora do disable: o texto some na hora do envio; travar o campo
  // até a API voltar impedia digitar a próxima mensagem com o campo ainda cheio.
  const isDisabled = disabled || !!blockedReason || upload.isPending;
  // A janela só alcança o que SAI. Em modo nota o composer segue liberado: a
  // nota interna nunca chega ao cliente, e é onde o atendente registra por que
  // a conversa esfriou — barrá-la tira exatamente o que ainda dá para fazer.
  const respostaBarrada = isDisabled || (mode === "reply" && !!janelaFechada);

  function autoresize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }

  function handleSubmit() {
    const body = text.trim();
    if (!body || (mode === "note" ? isDisabled : respostaBarrada)) return;

    const emailSubject = isEmail ? subject.trim() : "";

    setText("");
    if (isEmail) setSubject("");
    requestAnimationFrame(() => autoresize());

    const restoreOnError = () => {
      setText(body);
      if (isEmail && emailSubject) setSubject(emailSubject);
      requestAnimationFrame(() => autoresize());
    };

    if (mode === "note") {
      createNote.mutate({ conversation_id: conversationId, body }, { onError: restoreOnError });
      return;
    }
    send.mutate(
      {
        conversation_id: conversationId,
        body,
        type: "text",
        ...(emailSubject ? { metadata: { subject: emailSubject } } : {}),
        ...(respondendo ? { reply_to_message_id: respondendo.id } : {}),
      },
      {
        onSuccess: () => {
          setText("");
          if (isEmail) setSubject("");
          // A citação vale para UMA mensagem. Mantê-la depois do envio faria a
          // próxima frase sair citando algo que o atendente já respondeu.
          onCancelarResposta?.();
          requestAnimationFrame(() => autoresize());
        },
        // Do upstream, e fica: sem isto o texto some quando o envio falha, e
        // quem escreveu um parágrafo o perde sem ter como recuperá-lo.
        onError: restoreOnError,
      },
    );
  }

  function applyTemplate(t: MessageTemplate) {
    const filled = interpolateTemplate(t.body, { name: contactName ?? null });
    setText(filled);
    setMenuDismissed(true);
    const ta = taRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = filled.length;
      autoresize();
    });
  }

  function applyDraft(draft: string) {
    // O rascunho é uma resposta COMPLETA sugerida — substitui o conteúdo, nunca
    // concatena (inserir no cursor grudaria dois textos completos, gerando uma
    // mensagem sem sentido). O vendedor edita/envia a partir daqui.
    setText(draft);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      autoresize();
    });
  }

  function handleEmojiInsert(emoji: string) {
    const ta = taRef.current;
    if (!ta) {
      setText((t) => t + emoji);
      return;
    }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + emoji.length;
      autoresize();
    });
  }

  function handleSendGif(gif: GiphyGifItem) {
    send.mutate(
      {
        conversation_id: conversationId,
        type: gif.is_mp4 ? "video" : "image",
        media_url: gif.url,
        media_mime: gif.is_mp4 ? "video/mp4" : "image/gif",
        ...(gif.is_mp4 ? { metadata: { gif_playback: true } } : {}),
        reply_to_message_id: respondendo?.id,
      },
      {
        onSuccess: () => {
          if (respondendo?.id) onCancelarResposta?.();
        },
        onError: (err) => {
          toast.error(
            "Erro ao enviar GIF: " +
              (err instanceof Error ? err.message : "tente novamente"),
          );
        },
      },
    );
  }

  function handlePickProduct(product: CatalogSearchItem) {
    const texto = `*${product.nome}*\n${product.preco_formatado}`;
    if (product.imagem_url) {
      const ext = product.imagem_url.split("?")[0]?.toLowerCase().split(".").pop();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      send.mutate(
        {
          conversation_id: conversationId,
          type: "image",
          media_url: product.imagem_url,
          media_mime: mime,
          body: texto,
          reply_to_message_id: respondendo?.id,
        },
        {
          onSuccess: () => {
            setCatalogPickerOpen(false);
            if (respondendo?.id) onCancelarResposta?.();
          },
          onError: (err) => {
            toast.error(
              "Erro ao enviar produto: " +
                (err instanceof Error ? err.message : "tente novamente"),
            );
          },
        },
      );
    } else {
      send.mutate(
        {
          conversation_id: conversationId,
          type: "text",
          body: texto,
          reply_to_message_id: respondendo?.id,
        },
        {
          onSuccess: () => {
            setCatalogPickerOpen(false);
            if (respondendo?.id) onCancelarResposta?.();
          },
          onError: (err) => {
            toast.error(
              "Erro ao enviar produto: " +
                (err instanceof Error ? err.message : "tente novamente"),
            );
          },
        },
      );
    }
  }

  /**
   * Ctrl/Cmd+V com imagem no clipboard cai no MESMO caminho do menu "+":
   * abre o preview com legenda e envia por ali. Nada de atalho paralelo — a
   * validação, o toast de erro e o retry já vivem lá.
   *
   * As três guardas antes de olhar o clipboard não são zelo: em "Nota interna"
   * não existe anexo (a nota é só texto e o envio nem passa pelo upload), com
   * um anexo já em preview a colagem substituiria em silêncio o que o operador
   * escolheu, e desabilitado é desabilitado. Em qualquer um desses casos o
   * Ctrl+V precisa continuar sendo o Ctrl+V de sempre.
   */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (mode !== "reply" || respostaBarrada || pendingFile) return;
    const imagem = imagemDoClipboard(e.clipboardData, new Date());
    if (!imagem) return; // colagem de texto segue o caminho normal do browser
    e.preventDefault();
    setPendingFile(imagem);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && menuOpen) {
      setMenuDismissed(true);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (menuOpen) return; // deixa o Enter pro menu; não envia /query como mensagem
      handleSubmit();
    }
  }

  if (blockedReason) {
    return (
      <div className="border-t border-border bg-muted/40 px-4 py-3 text-center text-xs text-muted-foreground">
        {blockedReason}
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "relative border-t border-border bg-background px-3 py-2",
          mode === "note" && "border-warning/40 bg-warning-bg",
        )}
      >
        <TemplateMenu
          open={menuOpen}
          query={slash.query}
          templates={templates.data ?? []}
          onPick={applyTemplate}
          onClose={() => setMenuDismissed(true)}
        />
        <div className="mb-1.5 flex gap-1">
          <button
            type="button"
            onClick={() => setMode("reply")}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "reply"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t("Responder")}
          </button>
          <button
            type="button"
            onClick={() => setMode("note")}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "note"
                ? "bg-warning text-warning-fg"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t("Nota interna")}
          </button>
        </div>
        {/*
          A FAIXA DA CITAÇÃO — o que o atendente escolheu responder.

          Fica ACIMA do campo, como no WhatsApp, e não dentro dele: o texto
          citado pode ter várias linhas, e empurrá-lo para dentro do campo faria
          o que se digita disputar espaço com o que se cita.

          `line-clamp-2` porque o objetivo é reconhecer qual mensagem é, não
          relê-la — ela está logo acima, no fio.
        */}
        {respondendo && mode === "reply" && (
          <div className="mb-1 flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted/60 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-primary">
                {respondendo.direction === "outbound" ? t("Você") : t("Cliente")}
              </div>
              <div className="line-clamp-2 text-xs text-muted-foreground">
                {respondendo.body?.trim() || t("(sem texto)")}
              </div>
            </div>
            <button
              type="button"
              onClick={onCancelarResposta}
              aria-label={t("Cancelar resposta")}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        {mode === "reply" && isEmail && (
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={
                respondendo?.body
                  ? `Re: ${respondendo.body.slice(0, 40).trim()}…`
                  : t("Assunto do e-mail (opcional)")
              }
              className="h-7 flex-1 rounded-md border border-input bg-background px-2.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Assunto do e-mail"
              disabled={respostaBarrada}
            />
          </div>
        )}
        <div className="flex items-end gap-2">
          {/*
            TOOLBAR DE RICH INPUT — dois layouts por breakpoint.

            MOBILE (< md):
            • "+" (AttachMenu): sempre visível no rodapé — fotos, docs, contato, agendamento.
            • "☺" (Smiley): abre Popover expansível ancorado com abas: Emoji, GIF, IA.
            • Direita: microfone (AudioRecorder) quando vazio; botão Enviar quando há texto.

            DESKTOP (md+):
            • Todos os botões visíveis em linha: +, IA, GIF, Emoji, textarea, Enviar/Áudio.
          */}

          {/* ── BOTÃO "+" (AttachMenu): Fotos e vídeos / Documento / Contato / Agendar ── */}
          {/* Sempre visível (tanto no mobile quanto no desktop) — preserva todas as funções */}
          {mode === "reply" && (
            <AttachMenu
              disabled={respostaBarrada}
              onPick={setPendingFile}
              onPickContact={() => setContactPickerOpen(true)}
              onPickCatalog={() => setCatalogPickerOpen(true)}
              onScheduleMessage={currentContactId ? () => setScheduleDialogOpen(true) : undefined}
            />
          )}

          {/* ── DESKTOP (md+): botões de IA e GIF em linha ── */}
          {mode === "reply" && (
            <div className="hidden md:flex items-center gap-0.5 shrink-0">
              <DraftReplyButton conversationId={conversationId} disabled={isDisabled} onDraft={applyDraft} />
              <GifButton
                disabled={respostaBarrada}
                onPick={handleSendGif}
              />
            </div>
          )}

          {/* ── DESKTOP (md+): Emoji inline ── */}
          <div className="hidden md:flex shrink-0">
            <EmojiButton
              disabled={isDisabled}
              onPick={handleEmojiInsert}
            />
          </div>

          {/* ── MOBILE (< md): Botão de Emoji com Painel de 2 Camadas (Emoji / GIF / IA) ── */}
          {mode === "reply" && (
            <div className="flex md:hidden shrink-0">
              <Popover open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn(
                      "h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground",
                      mobilePanelOpen && "bg-muted text-foreground",
                    )}
                    aria-label="Abrir emojis, gifs e IA"
                    disabled={respostaBarrada}
                  >
                    <Smiley size={20} weight="regular" aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={2}
                  className="w-[calc(100vw-1rem)] sm:w-[380px] h-[420px] sm:h-[460px] max-h-[calc(100dvh-170px)] p-0 flex flex-col bg-popover text-popover-foreground rounded-xl shadow-2xl border border-border overflow-hidden z-50"
                >
                  <Tabs
                    value={mobilePanelTab}
                    onValueChange={(v) => setMobilePanelTab(v as "emoji" | "gif" | "ai")}
                    className="flex flex-col h-full w-full"
                  >
                    <div className="flex items-center justify-between border-b border-border bg-muted/40 px-2.5 py-1.5 shrink-0">
                      <TabsList className="grid grid-cols-3 h-8 w-full max-w-[260px] p-0.5 bg-muted">
                        <TabsTrigger value="emoji" className="text-xs flex items-center gap-1.5 py-1">
                          <Smiley size={14} weight="regular" />
                          <span>Emoji</span>
                        </TabsTrigger>
                        <TabsTrigger value="gif" className="text-xs flex items-center gap-1.5 py-1">
                          <span className="text-[9px] font-bold border border-current px-1 rounded leading-none">GIF</span>
                          <span>GIF</span>
                        </TabsTrigger>
                        <TabsTrigger value="ai" className="text-xs flex items-center gap-1.5 py-1">
                          <Sparkle size={14} weight="duotone" className="text-primary" />
                          <span>IA</span>
                        </TabsTrigger>
                      </TabsList>
                      <button
                        type="button"
                        onClick={() => setMobilePanelOpen(false)}
                        className="p-1 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                        aria-label="Fechar painel"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    {/* Aba 1: Emoji */}
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

                    {/* Aba 2: GIF */}
                    <TabsContent
                      value="gif"
                      className="flex-1 min-h-0 overflow-hidden m-0 p-0 data-[state=active]:flex data-[state=inactive]:!hidden flex-col bg-popover"
                    >
                      {mobilePanelTab === "gif" && (
                        <GifPicker
                          onPick={(gif) => {
                            setMobilePanelOpen(false);
                            handleSendGif(gif);
                          }}
                          className="h-full w-full border-0 shadow-none rounded-none bg-transparent"
                        />
                      )}
                    </TabsContent>

                    {/* Aba 3: IA ("Ajuda para escrever") */}
                    <TabsContent
                      value="ai"
                      className="flex-1 min-h-0 overflow-y-auto m-0 p-4 data-[state=active]:flex data-[state=inactive]:!hidden flex-col bg-popover"
                    >
                      {mobilePanelTab === "ai" && (
                        draftReply.isPending ? (
                          <div className="flex flex-1 flex-col items-center justify-center py-8 gap-3 text-muted-foreground">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                              <CircleNotch size={28} className="animate-spin" />
                            </div>
                            <div className="text-center space-y-1">
                              <p className="text-xs font-semibold text-foreground">Analisando conversa…</p>
                              <p className="text-[11px] text-muted-foreground">Gerando sugestão de resposta contextual com IA</p>
                            </div>
                          </div>
                        ) : aiDraftText ? (
                          <div className="flex flex-1 flex-col gap-3 min-h-0">
                            <div className="flex items-center justify-between shrink-0">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                                <Sparkle size={15} weight="fill" />
                                <span>Sugestão gerada</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">Pronto para envio</span>
                            </div>
                            <div className="flex-1 min-h-[140px] rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground overflow-y-auto whitespace-pre-wrap leading-relaxed">
                              {aiDraftText}
                            </div>
                            <div className="flex items-center gap-2 mt-auto pt-2 shrink-0">
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                className="flex-1 text-xs h-9 font-medium gap-1.5"
                                onClick={() => {
                                  applyDraft(aiDraftText);
                                  setMobilePanelOpen(false);
                                }}
                              >
                                <PaperPlaneTilt size={14} weight="fill" />
                                <span>Inserir na mensagem</span>
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-xs h-9"
                                onClick={() => {
                                  draftReply.mutate(conversationId, {
                                    onSuccess: (res) => setAiDraftText(res.data.draft),
                                  });
                                }}
                              >
                                Gerar outro
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-1 flex-col items-center justify-center text-center py-6 px-4 gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                              <Sparkle size={24} weight="fill" />
                            </div>
                            <div className="space-y-1.5 max-w-xs">
                              <h4 className="text-sm font-semibold text-foreground">Ajuda para escrever com IA</h4>
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                Gere um rascunho de resposta contextual e personalizado com base nas mensagens recentes do cliente.
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              className="w-full max-w-xs flex items-center justify-center gap-2 h-9 font-medium shadow-sm"
                              disabled={isDisabled}
                              onClick={() => {
                                draftReply.mutate(conversationId, {
                                  onSuccess: (res) => setAiDraftText(res.data.draft),
                                });
                              }}
                            >
                              <Sparkle size={15} weight="fill" />
                              <span>Gerar rascunho com IA</span>
                            </Button>
                          </div>
                        )
                      )}
                    </TabsContent>
                  </Tabs>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Campo de texto (sempre visível no meio) */}
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!resolveSlash(e.target.value).open) setMenuDismissed(false);
              autoresize();
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            // O atalho saiu do placeholder e foi para o diálogo de atalhos (`?`)
            // e para o `title` aqui. Dois motivos, nesta ordem: ele some assim
            // que se digita a primeira letra — isto é, some justamente quando
            // você ia quebrar linha —; e, com a coluna do inbox mais estreita
            // depois do conserto do layout, a frase quebrava em duas linhas
            // dentro de um campo de uma linha só.
            //
            // "(só o time vê)" FICA: não é atalho, é consequência. Quem escreve
            // uma nota interna precisa saber que ela não vai para o cliente, e
            // essa informação não pode depender de abrir um diálogo.
            placeholder={
              mode === "note"
                ? t("Escreva uma nota interna… (só o time vê)")
                : isEmail
                  ? t("Escreva uma resposta por e-mail…")
                  : t("Escreva uma mensagem…")
            }
            title={
              mode === "note"
                ? "Enter salva a nota · Shift+Enter quebra linha"
                : "Enter envia · Shift+Enter quebra linha"
            }
            className={cn(
              "min-h-9 max-h-40 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            )}
            disabled={mode === "note" ? isDisabled : respostaBarrada}
            aria-label="Mensagem"
          />

          {/* ── BOTÃO DE AÇÃO DIREITA: Enviar (quando há texto ou nota/email) OU Gravação de Áudio (quando vazio) ── */}
          {text.trim() || mode === "note" || isEmail ? (
            <Button
              type="button"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleSubmit}
              disabled={(mode === "note" ? isDisabled : respostaBarrada) || !text.trim()}
              aria-label="Enviar"
            >
              <PaperPlaneTilt size={16} weight="fill" aria-hidden />
            </Button>
          ) : (
            <AudioRecorder conversationId={conversationId} disabled={respostaBarrada} />
          )}
        </div>
      </div>
      <AttachmentPreviewDialog
        file={pendingFile}
        sending={upload.isPending || send.isPending}
        onCancel={() => setPendingFile(null)}
        onSend={async (caption) => {
          if (!pendingFile) return;
          try {
            const uploaded = await upload.mutateAsync({ conversationId, file: pendingFile });
            send.mutate(
              {
                conversation_id: conversationId,
                type: uploaded.kind,
                body: caption || undefined,
                media_storage_path: uploaded.storage_path,
                media_mime: uploaded.media_mime,
                media_size_bytes: uploaded.media_size_bytes,
              },
              { onSuccess: () => setPendingFile(null) },
            );
          } catch {
            // toast já disparado pelo onError de useUploadMedia; dialog fica aberto p/ retry
            return;
          }
        }}
      />
      <ContactPickerDialog
        open={contactPickerOpen}
        onOpenChange={setContactPickerOpen}
        excludeContactId={currentContactId}
        sending={send.isPending}
        onPick={(payload) => {
          send.mutate(
            {
              conversation_id: conversationId,
              type: "contact",
              metadata: payload.contactId
                ? { shared_contact_id: payload.contactId }
                : {
                    shared_contact: {
                      name: payload.name,
                      phone_number: payload.phone_number,
                    },
                  },
            },
            { onSuccess: () => setContactPickerOpen(false) },
          );
        }}
      />
      <CatalogPickerDialog
        open={catalogPickerOpen}
        onOpenChange={setCatalogPickerOpen}
        sending={send.isPending}
        onPick={handlePickProduct}
      />
      {currentContactId && (
        <ScheduleMessageDialog
          open={scheduleDialogOpen}
          onOpenChange={setScheduleDialogOpen}
          contactId={currentContactId}
          conversationId={conversationId}
          contactName={contactName}
        />
      )}
    </>
  );
});
