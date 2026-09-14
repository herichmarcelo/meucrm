"use client";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JanelaSelo } from "@/components/inbox/JanelaSelo";
import {
  Phone,
  EnvelopeSimple,
  InstagramLogo,
  ArrowRight,
  DotsThreeVertical,
  Clock,
} from "@/lib/ui/icons";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useReleaseConversation } from "@/hooks/inbox/useReleaseConversation";
import { useCloseConversation } from "@/hooks/inbox/useCloseConversation";
import { useResumeAiAttendance } from "@/hooks/inbox/useResumeAiAttendance";
import { useSnoozeConversation } from "@/hooks/inbox/useSnoozeConversation";
import { ReassignDialog } from "@/components/inbox/ReassignDialog";
import { SnoozeButton } from "@/components/inbox/SnoozeButton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

interface Props {
  conversation: ConversationWithContact;
}

function initials(name: string | null | undefined, fallback: string): string {
  const v = (name ?? "").trim();
  if (!v) return fallback.slice(0, 2).toUpperCase();
  const parts = v.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback.slice(0, 2).toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase();
}

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  // É EXATAMENTE o estado em que a passagem para humano deixa a conversa
  // (`performHumanHandoff`: 'ai_handling' → 'pending'), e o rótulo faltava — toda
  // conversa escalada mostrava `pending` cru no rosto do atendente. O
  // `conversationStatusSchema` não lista 'pending' porque valida ENTRADA da API;
  // quem escreve este estado é o motor, e a tela precisa saber lê-lo.
  pending: "Aguardando atendente",
  claimed: "Em atendimento",
  ai_handling: "IA atendendo",
  closed: "Fechada",
  archived: "Arquivada",
};

const SNOOZE_DURATIONS: Array<{ hours: 1 | 3 | 24; label: string }> = [
  { hours: 1, label: "Em 1 hora" },
  { hours: 3, label: "Em 3 horas" },
  { hours: 24, label: "Em 24 horas" },
];

function isSnoozeActive(snoozeUntil: string | null | undefined): boolean {
  return snoozeUntil != null && new Date(snoozeUntil).getTime() > Date.now();
}

export function ConversationHeader({ conversation }: Props) {
  const t = useT();
  const { user } = useAuth();
  const claim = useClaimConversation();
  const release = useReleaseConversation();
  const close = useCloseConversation();
  const retomar = useResumeAiAttendance();
  const { snooze, cancel: cancelSnooze } = useSnoozeConversation();
  const [reassignOpen, setReassignOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const c = conversation.contacts ?? null;
  const displayName = rotuloDoContato(c);
  const phone = c?.phone_number ?? null;
  const status = conversation.status;
  const isMineAssigned = conversation.assigned_to_user_id === user.id;
  const isOpen = status === "open" || conversation.assigned_to_user_id == null;
  const isActive = status !== "closed" && status !== "archived";
  const snoozeIsActive = isSnoozeActive(conversation.snooze_until);

  /**
   * A conversa saiu do atendimento automático? As DUAS travas contam: o silêncio
   * na conversa e o `force_human` no contato. Olhar só o silêncio deixaria de
   * oferecer a volta justamente no caso em que ela mais falta — o contato travado
   * com a conversa já liberada, em que nenhum envio automático sai e nada na tela
   * explica por quê.
   */
  const silenciada =
    conversation.bot_silenced_until !== null && conversation.bot_silenced_until !== undefined;
  const emAtendimentoHumano =
    (silenciada || c?.force_human === true) && status !== "closed" && status !== "archived";
  const LABEL_RETOMAR = "Devolver ao automático" as const;

  return (
    // LAYOUT ADAPTATIVO — celular vs desktop.
    //
    // Linha 1 do contato: Nome truncado à esquerda + botão ⋮ no canto direito (mobile).
    // Linha 2 do contato: Badges ("Em atendimento", "Automático pausado", JanelaSelo) abaixo do nome.
    // Linha 3 do contato: Telefone / e-mail.
    // Desktop (md+): botões em linha visível e o ⋮ some.
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border bg-background px-4 py-2.5 md:items-center md:gap-3">
      <div className="flex min-w-0 items-start gap-3 md:items-center">
        {c?.id && (
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage
              src={`/api/v1/contacts/${c.id}/avatar`}
              alt=""
              className="object-cover"
            />
            <AvatarFallback className="text-xs font-semibold">
              {initials(displayName, phone ?? "WA")}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="min-w-0">
          {/* Nome e Badges: empilhados no mobile (< md), em linha única no desktop (md+) */}
          <div className="flex flex-col md:flex-row md:items-center md:gap-2">
            <h2 className="truncate text-sm font-semibold">
              {displayName}
            </h2>

            {/* Badges: no mobile abaixo do nome, no desktop ao lado */}
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 md:mt-0">
              <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">
                {t(STATUS_LABEL[status] ?? status)}
              </Badge>
              {/* Ao lado do estado, não escondido num painel: a pergunta "dá para
                  escrever agora?" se faz ANTES de digitar, não depois de receber um
                  `failed` com um código de cinco dígitos. */}
              <JanelaSelo
                provider={conversation.channel_sessions?.provider ?? null}
                lastInboundAt={conversation.last_inbound_at}
              />
              {/* Sem esta marca, a conversa em que o robô está calado tem exatamente
                  a mesma cara de uma conversa normal — e ninguém entende por que as
                  respostas automáticas pararam. */}
              {emAtendimentoHumano && (
                <Badge
                  variant="outline"
                  className="h-4 shrink-0 px-1.5 text-[10px]"
                  data-testid="badge-atendimento-humano"
                >
                  Automático pausado
                </Badge>
              )}
            </div>
          </div>

          {phone && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Phone size={11} weight="regular" aria-hidden /> {phone}
            </p>
          )}
          {!phone && c?.email && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <EnvelopeSimple size={11} weight="regular" aria-hidden /> {c.email}
            </p>
          )}
          {!phone && !c?.email && (c as { instagram_username?: string })?.instagram_username && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <InstagramLogo size={11} weight="regular" aria-hidden /> {(c as { instagram_username?: string }).instagram_username}
            </p>
          )}
        </div>
      </div>

      {/*
        BARRA DE AÇÕES — header.children[1] exigido por invariantes de teste.
        `flex-wrap min-w-0` preserva os limites de responsividade testados em
        `tests/unit/inbox-header-nao-trava.test.tsx`.
      */}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        {/* ── MOBILE (< md): botão ⋮ único alinhado no canto direito ── */}
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                aria-label="Ações da conversa"
              >
                <DotsThreeVertical size={16} weight="bold" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {isOpen && (
                <DropdownMenuItem
                  disabled={claim.isPending}
                  onClick={() =>
                    claim.mutate({
                      conversation_id: conversation.id,
                      expected_assignee: conversation.assigned_to_user_id,
                    })
                  }
                >
                  {t("Assumir")}
                </DropdownMenuItem>
              )}
              {isMineAssigned && (
                <DropdownMenuItem
                  disabled={release.isPending}
                  onClick={() => release.mutate({ conversation_id: conversation.id })}
                >
                  {t("Liberar")}
                </DropdownMenuItem>
              )}
              {emAtendimentoHumano && (
                <DropdownMenuItem
                  disabled={retomar.isPending}
                  onClick={() => retomar.mutate({ conversation_id: conversation.id })}
                >
                  {retomar.isPending ? "Devolvendo..." : t(LABEL_RETOMAR)}
                </DropdownMenuItem>
              )}
              {isActive && (
                <DropdownMenuItem onClick={() => setReassignOpen(true)}>
                  {t("Transferir")}
                </DropdownMenuItem>
              )}
              {/* Lembrar: sub-menu com durações, ou cancelar se lembrete ativo */}
              {isActive && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Clock size={14} className="mr-2" aria-hidden />
                    {snoozeIsActive ? "Lembrete ativo" : t("Lembrar")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {snoozeIsActive ? (
                      <DropdownMenuItem
                        onClick={() =>
                          cancelSnooze.mutate({ conversation_id: conversation.id })
                        }
                      >
                        Cancelar lembrete
                      </DropdownMenuItem>
                    ) : (
                      SNOOZE_DURATIONS.map((d) => (
                        <DropdownMenuItem
                          key={d.hours}
                          onClick={() =>
                            snooze.mutate({
                              conversation_id: conversation.id,
                              duration_hours: d.hours,
                            })
                          }
                        >
                          {d.label}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {isActive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={close.isPending}
                    className="text-destructive focus:text-destructive"
                    onClick={() => setCloseConfirmOpen(true)}
                  >
                    {t("Fechar")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── DESKTOP (md+): botões em linha ── */}
        <div className="hidden flex-wrap items-center gap-1.5 md:flex">
        {isOpen && (
          <Button
            size="sm"
            variant="default"
            disabled={claim.isPending}
            onClick={() =>
              claim.mutate({
                conversation_id: conversation.id,
                expected_assignee: conversation.assigned_to_user_id,
              })
            }
          >
            {t("Assumir")}
          </Button>
        )}
        {isMineAssigned && (
          <Button
            size="sm"
            variant="outline"
            disabled={release.isPending}
            onClick={() => release.mutate({ conversation_id: conversation.id })}
          >
            {t("Liberar")}
          </Button>
        )}
        {/* A volta. Fica ANTES de transferir/fechar porque é a ação que a pessoa
            procura quando terminou o que tinha para fazer aqui. */}
        {emAtendimentoHumano && (
          <Button
            size="sm"
            variant="outline"
            disabled={retomar.isPending}
            data-testid="devolver-ao-automatico"
            onClick={() => retomar.mutate({ conversation_id: conversation.id })}
          >
            {retomar.isPending ? "Devolvendo..." : t("Devolver ao automático")}
          </Button>
        )}
        {isActive && (
          <Button size="sm" variant="outline" onClick={() => setReassignOpen(true)}>
            {t("Transferir")}
          </Button>
        )}
        {isActive && (
          <SnoozeButton
            conversationId={conversation.id}
            snoozeUntil={conversation.snooze_until ?? null}
          />
        )}
        {isActive && (
          <Button
            size="sm"
            variant="outline"
            disabled={close.isPending}
            onClick={() => setCloseConfirmOpen(true)}
          >
            {t("Fechar")}
          </Button>
        )}
        {/*
          Item 3: "Ver contato" visível SOMENTE no desktop (md a xl), nunca no
          mobile. No mobile o botão "Ficha" no header superior já cobre essa
          função — mostrar os dois é duplicidade que confunde.

          `hidden md:inline-flex xl:hidden` = visível apenas entre md e xl.
          Acima de xl o painel lateral de CRM já tem o link para o contato.
        */}
        {c?.id && (
          <Button asChild size="sm" variant="ghost" className="hidden md:inline-flex xl:hidden">
            <Link href={`/app/contacts/${c.id}`} className="flex items-center gap-1">
              Ver contato
              <ArrowRight size={12} weight="regular" aria-hidden />
            </Link>
          </Button>
        )}
        </div>
      </div>
      <ReassignDialog
        conversationId={conversation.id}
        open={reassignOpen}
        onOpenChange={setReassignOpen}
      />
      <ConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        title="Fechar conversa?"
        description="A conversa será movida para a aba de conversas fechadas. Caso o cliente envie uma nova mensagem, ela será reaberta automaticamente."
        confirmLabel="Fechar Conversa"
        loading={close.isPending}
        onConfirm={async () => {
          await close.mutateAsync({ conversation_id: conversation.id });
          setCloseConfirmOpen(false);
        }}
      />
    </div>
  );
}
