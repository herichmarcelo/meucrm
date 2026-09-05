"use client";
import { useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CanalInstagramClient } from "./CanalInstagramClient";
import { CanalOficialClient } from "./CanalOficialClient";
import { CanalParceiroClient } from "./CanalParceiroClient";
import { ConnectionsClient } from "./ConnectionsClient";
import { TemplatesClient } from "./TemplatesClient";
import { TemplatesParceiroClient } from "./TemplatesParceiroClient";

/**
 * Conexões — TODOS os canais em um lugar só.
 */
export function ConexoesShell({
  wahaConfigured,
  wahaAvailable,
  gowaAvailable,
}: {
  wahaConfigured: boolean;
  wahaAvailable?: boolean;
  gowaAvailable?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const abaParam = params.get("aba");
  const aba =
    abaParam === "oficial"
      ? "oficial"
      : abaParam === "parceiro"
        ? "parceiro"
        : abaParam === "instagram"
          ? "instagram"
          : "numeros";
  const sub = params.get("sub") === "templates" ? "templates" : "conexao";

  const irPara = (proximaAba: string, proximaSub?: string): void => {
    const q = new URLSearchParams();
    if (proximaAba !== "numeros") q.set("aba", proximaAba);
    if (proximaSub && proximaSub !== "conexao") q.set("sub", proximaSub);
    const qs = q.toString();
    // `scroll: false`: trocar de aba não é navegar para outra página; jogar o
    // usuário para o topo a cada clique faz a tela parecer que recarregou.
    router.replace(qs ? `/app/connections?${qs}` : "/app/connections", { scroll: false });
  };

  return (
    <Tabs value={aba} onValueChange={(v) => irPara(v, sub)} className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="numeros">Números por QR</TabsTrigger>
        <TabsTrigger value="oficial">API Oficial (Meta)</TabsTrigger>
        <TabsTrigger value="parceiro">Provedor parceiro</TabsTrigger>
        <TabsTrigger value="instagram">Instagram</TabsTrigger>
      </TabsList>

      <TabsContent value="numeros" className="mt-0">
        <ConnectionsClient
          wahaConfigured={wahaConfigured}
          wahaAvailable={wahaAvailable}
          gowaAvailable={gowaAvailable}
        />
      </TabsContent>

      <TabsContent value="parceiro" className="mt-0">
        <Tabs value={sub} onValueChange={(v) => irPara("parceiro", v)} className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="conexao">Conexão</TabsTrigger>
            <TabsTrigger value="templates">Modelos do parceiro</TabsTrigger>
          </TabsList>
          <TabsContent value="conexao" className="mt-0">
            <CanalParceiroClient />
          </TabsContent>
          <TabsContent value="templates" className="mt-0">
            <TemplatesParceiroClient />
          </TabsContent>
        </Tabs>
      </TabsContent>

      <TabsContent value="oficial" className="mt-0">
        <Tabs value={sub} onValueChange={(v) => irPara("oficial", v)} className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="conexao">Conexão</TabsTrigger>
            <TabsTrigger value="templates">Templates da Meta</TabsTrigger>
          </TabsList>
          <TabsContent value="conexao" className="mt-0">
            <CanalOficialClient />
          </TabsContent>
          <TabsContent value="templates" className="mt-0">
            <TemplatesClient />
          </TabsContent>
        </Tabs>
      </TabsContent>

      <TabsContent value="instagram" className="mt-0">
        <CanalInstagramClient />
      </TabsContent>
    </Tabs>
  );
}

