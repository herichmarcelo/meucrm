"use client";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useConnectInstagramChannel,
  useDisconnectInstagramChannel,
  useInstagramChannel,
} from "@/hooks/channels/useInstagramChannel";
import { copyToClipboard } from "@/lib/clipboard";
import { CheckCircle, Copy, InstagramLogo, Trash } from "@/lib/ui/icons";

/** Campo com botão de copiar para configuração na Meta */
function ParaColar({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  if (!valor) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded bg-muted px-3 py-2 text-xs font-mono">
          {valor}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await copyToClipboard(valor);
            toast.success("Copiado para a área de transferência.");
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copiar
        </Button>
      </div>
    </div>
  );
}

export function CanalInstagramClient() {
  const { data, isPending } = useInstagramChannel();
  const conectar = useConnectInstagramChannel();
  const desconectar = useDisconnectInstagramChannel();

  const [form, setForm] = useState({
    account_id: "",
    token: "",
    page_id: "",
  });

  const estado = data?.data;

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!form.account_id || !form.token) {
      toast.error("Preencha o ID da conta do Instagram e o Token de acesso.");
      return;
    }

    try {
      const res = await conectar.mutateAsync(form);
      toast.success(
        `Instagram conectado com sucesso: ${res.data.display_name || res.data.username || res.data.account_id}`,
      );
      setForm({ account_id: "", token: "", page_id: "" });
    } catch {
      // Erro tratado via toast pelo showApiError no hook
    }
  }

  async function handleDisconnect() {
    if (!confirm("Tem certeza que deseja desconectar o canal do Instagram?")) return;
    try {
      await desconectar.mutateAsync();
      toast.success("Instagram desconectado.");
    } catch {
      // Erro tratado no hook
    }
  }

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Carregando dados do canal...</p>;
  }

  return (
    <div className="flex flex-col gap-6" data-testid="canal-instagram-root">
      {estado?.connected ? (
        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 text-white shadow-sm">
                  <InstagramLogo size={28} weight="bold" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg">{estado.display_name}</h3>
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <CheckCircle className="mr-1 h-3.5 w-3.5" />
                      Conectado
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ID da Conta: <span className="font-mono">{estado.account_id}</span>
                    {estado.username ? ` • ${estado.username}` : ""}
                  </p>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive self-start sm:self-auto"
                onClick={handleDisconnect}
                disabled={desconectar.isPending}
              >
                <Trash className="mr-1.5 h-4 w-4" />
                Desconectar
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            <h4 className="text-sm font-semibold mb-3">Configuração do Webhook na Meta</h4>
            <p className="text-xs text-muted-foreground mb-4">
              Cole estes dados no painel do <strong>Meta for Developers</strong> (Produto Messenger / Instagram &gt; Webhooks):
            </p>
            <div className="flex flex-col gap-4">
              <ParaColar rotulo="URL de Retorno de Chamada (Callback URL)" valor={estado.webhook_url} />
              <ParaColar rotulo="Token de Verificação (Verify Token)" valor={estado.verify_token} />
            </div>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 text-white">
                <InstagramLogo size={22} weight="bold" />
              </div>
              <div>
                <h3 className="font-semibold">Conectar Instagram Direct (Meta Graph API)</h3>
                <p className="text-xs text-muted-foreground">
                  Receba e responda mensagens diretas, áudios e interações de Stories no CRM.
                </p>
              </div>
            </div>

            <form onSubmit={handleConnect} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ig-account-id">
                    Instagram Account ID (IGSID) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="ig-account-id"
                    placeholder="Ex: 17841400000000000"
                    value={form.account_id}
                    onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
                    required
                  />
                  <span className="text-[11px] text-muted-foreground">
                    ID da sua conta comercial do Instagram no painel da Meta.
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="ig-page-id">ID da Página do Facebook (Opcional)</Label>
                  <Input
                    id="ig-page-id"
                    placeholder="Ex: 100234567890123"
                    value={form.page_id}
                    onChange={(e) => setForm((f) => ({ ...f, page_id: e.target.value }))}
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Página do Facebook vinculada ao perfil profissional.
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="ig-token">
                  Access Token da Meta (System User / Page Token) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ig-token"
                  type="password"
                  placeholder="EAAG..."
                  value={form.token}
                  onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
                  required
                />
                <span className="text-[11px] text-muted-foreground">
                  Token permanente com permissões <code>instagram_manage_messages</code>, <code>pages_manage_metadata</code>.
                </span>
              </div>

              <div className="mt-2 flex justify-end">
                <Button type="submit" disabled={conectar.isPending}>
                  {conectar.isPending ? "Validando e Conectando..." : "Conectar Instagram"}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-6">
            <h4 className="text-sm font-semibold mb-3">Dados para configurar o Webhook na Meta</h4>
            <p className="text-xs text-muted-foreground mb-4">
              Antes ou depois de conectar, configure este endpoint no seu App no Meta for Developers:
            </p>
            <div className="flex flex-col gap-4">
              <ParaColar rotulo="URL do Webhook" valor={estado?.webhook_url} />
              <ParaColar rotulo="Token de Verificação" valor={estado?.verify_token} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
