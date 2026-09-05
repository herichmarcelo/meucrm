"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RecoveryCodesPanel } from "@/components/auth/RecoveryCodesPanel";
import { MfaEnrollModal } from "@/components/auth/MfaEnrollModal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { regenerateRecoveryCodes } from "@/app/actions/settings/regenerateRecoveryCodes";
import { signOutEverywhere } from "@/app/actions/settings/signOutEverywhere";
import {
  definirExigenciaDeMfa,
  desativarMfaDaConta,
} from "@/app/actions/auth/politicaDeMfa";

export function SecurityClient({
  mfaEnrolled,
  obrigatorio,
  podeExigirDaEquipe,
  empresaExige,
}: {
  mfaEnrolled: boolean;
  /** A política obriga esta pessoa a ter a verificação? */
  obrigatorio: boolean;
  /** Só admin muda a regra da empresa. */
  podeExigirDaEquipe: boolean;
  empresaExige: boolean;
}) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSigningOut, startSignOut] = useTransition();
  const [ativando, setAtivando] = useState(false);
  const [mexendo, startMexer] = useTransition();

  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);
  const [confirmSignOutAllOpen, setConfirmSignOutAllOpen] = useState(false);
  const [confirmDisableMfaOpen, setConfirmDisableMfaOpen] = useState(false);

  function executeRegenerate() {
    startTransition(async () => {
      const r = await regenerateRecoveryCodes();
      if (r.ok) {
        setCodes(r.recovery_codes);
        toast.success("Novos códigos gerados.");
        setConfirmRegenerateOpen(false);
      } else {
        toast.error(`Erro: ${r.error}`);
      }
    });
  }

  function executeSignOutAll() {
    startSignOut(async () => {
      await signOutEverywhere();
      setConfirmSignOutAllOpen(false);
    });
  }

  function executeDisableMfa() {
    startMexer(async () => {
      const r = await desativarMfaDaConta();
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Verificação desligada.");
      setConfirmDisableMfaOpen(false);
      window.location.reload();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* O modal é o MESMO do bloqueador de tela cheia — reusado, não copiado.
          Ele recarrega a página ao terminar, e o servidor reavalia o estado. */}
      {ativando ? <MfaEnrollModal motivo="escolha" /> : null}

      <Card className="space-y-3 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Verificação em duas etapas</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Além da senha, o sistema pede um código de 6 dígitos que só existe no
              seu celular. É a proteção que segura uma senha vazada.
            </p>
          </div>
          <span
            className={
              "shrink-0 rounded-full px-2 py-0.5 text-xs " +
              (mfaEnrolled
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-muted text-muted-foreground")
            }
          >
            {mfaEnrolled ? "Ativada" : "Desativada"}
          </span>
        </div>

        {mfaEnrolled ? (
          <div className="space-y-2">
            {obrigatorio ? (
              <p className="text-xs text-muted-foreground">
                Ela é obrigatória para administradores desta empresa, então não dá
                para desligar aqui. Um administrador pode mudar essa regra abaixo.
              </p>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={mexendo}
                onClick={() => setConfirmDisableMfaOpen(true)}
              >
                {mexendo ? "Desligando…" : "Desligar"}
              </Button>
            )}
          </div>
        ) : (
          <Button size="sm" onClick={() => setAtivando(true)}>
            Ativar
          </Button>
        )}
      </Card>

      {podeExigirDaEquipe ? (
        <Card className="space-y-3 p-6">
          <h2 className="text-sm font-semibold">Exigir de quem administra</h2>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={empresaExige}
              disabled={mexendo}
              onChange={(e) => {
                const marcar = e.target.checked;
                startMexer(async () => {
                  const r = await definirExigenciaDeMfa(marcar);
                  if (!r.ok) {
                    toast.error(r.erro);
                    return;
                  }
                  toast.success(
                    marcar
                      ? "Agora os administradores precisam da verificação."
                      : "A verificação deixou de ser obrigatória.",
                  );
                  window.location.reload();
                });
              }}
            />
            <span>
              Todo administrador desta empresa precisa configurar a verificação em
              duas etapas.
              <span className="mt-1 block text-xs text-muted-foreground">
                Quando ligado, quem administra vê uma tela pedindo a configuração
                antes de usar o sistema. Ligue se a sua equipe mexe com dados de
                clientes — é a diferença entre uma senha vazada virar um susto ou
                virar um vazamento.
              </span>
            </span>
          </label>
        </Card>
      ) : null}

      <Card className="space-y-3 p-6">
        <h2 className="text-sm font-semibold">Códigos de recuperação</h2>
        <p className="text-xs text-muted-foreground">
          Use se perder acesso ao autenticador. Cada código é de uso único.
        </p>
        {codes ? (
          <RecoveryCodesPanel codes={codes} onAcknowledge={() => setCodes(null)} />
        ) : (
          <Button
            variant="outline"
            disabled={!mfaEnrolled || isPending}
            onClick={() => setConfirmRegenerateOpen(true)}
          >
            {isPending ? "Gerando…" : "Regenerar códigos de recuperação"}
          </Button>
        )}
        {!mfaEnrolled && (
          <p className="text-xs text-muted-foreground">
            Habilite MFA antes de gerar códigos.
          </p>
        )}
      </Card>

      <Card className="space-y-3 p-6">
        <h2 className="text-sm font-semibold">Sessões ativas</h2>
        <p className="text-xs text-muted-foreground">
          Listagem de sessões — em breve. Por enquanto, deslogue todos os dispositivos:
        </p>
        <Button
          variant="outline"
          disabled={isSigningOut}
          onClick={() => setConfirmSignOutAllOpen(true)}
        >
          {isSigningOut ? "Saindo…" : "Sair de todos os dispositivos"}
        </Button>
      </Card>

      <ConfirmDialog
        open={confirmRegenerateOpen}
        onOpenChange={setConfirmRegenerateOpen}
        title="Regenerar códigos de recuperação?"
        description="Gerar novos códigos de recuperação invalida imediatamente TODOS os códigos anteriores. Certifique-se de salvar os novos códigos gerados."
        confirmLabel="Gerar Novos Códigos"
        loading={isPending}
        onConfirm={executeRegenerate}
      />

      <ConfirmDialog
        open={confirmSignOutAllOpen}
        onOpenChange={setConfirmSignOutAllOpen}
        title="Sair de todos os dispositivos?"
        description="Você será desconectado de todas as sessões ativas e precisará fazer login novamente em cada computador ou celular."
        confirmLabel="Sair de Todos os Dispositivos"
        variant="destructive"
        loading={isSigningOut}
        onConfirm={executeSignOutAll}
      />

      <ConfirmDialog
        open={confirmDisableMfaOpen}
        onOpenChange={setConfirmDisableMfaOpen}
        title="Desligar verificação em duas etapas?"
        description="A proteção adicional por aplicativo autenticador será removida desta conta."
        confirmLabel="Desligar Verificação"
        variant="destructive"
        loading={mexendo}
        onConfirm={executeDisableMfa}
      />
    </div>
  );
}
