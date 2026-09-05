import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { CatalogListClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app/inbox");

  const canManage =
    user.is_platform_admin ||
    (activeOrg.role ? ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager : false);

  return (
    <div className="flex h-full flex-col gap-6">
      <CatalogListClient canManage={canManage} />
    </div>
  );
}
