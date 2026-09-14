import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { SlaConfigClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function SlaSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SLA e CSAT</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Defina as metas de tempo de resposta por tipo de atendimento, regras de pesquisa CSAT e horário de expediente comercial.
        </p>
      </div>
      <SlaConfigClient />
    </div>
  );
}
