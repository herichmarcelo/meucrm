import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { SlaDashboardClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function SlaDashboardPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const canManage =
    !!activeOrg &&
    (user.is_platform_admin ||
      (activeOrg.role ? ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager : false));

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SLA e CSAT</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conformidade de metas de atendimento, monitoramento de demandas em risco e satisfação do cliente.
          </p>
        </div>
      </header>

      <SlaDashboardClient canManage={canManage} />
    </div>
  );
}
