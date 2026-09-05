import { redirect } from "next/navigation";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { InboxLayout } from "@/components/inbox/InboxLayout";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p>Você não tem nenhuma organização ativa.</p>
        <a href="/get-started" className="text-primary underline">
          Criar ou configurar sua organização
        </a>
      </div>
    );
  }
  const { id } = await searchParams;
  return <InboxLayout initialSelectedId={id ?? null} />;
}
