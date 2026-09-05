import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { branding } from "@/lib/branding";
import { RecoverOrganizationForm } from "@/components/auth/RecoverOrganizationForm";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (activeOrg) redirect("/app/inbox");

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const nomeSugerido = (authUser?.user_metadata?.org_name as string | undefined) ?? undefined;

  const idioma = normalizarIdioma(user.locale);
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <IdiomaProvider locale={user.locale}>
      <main className="bg-muted/40 flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6 rounded-lg border bg-background p-6 shadow-sm">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {branding().name}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Configure sua organização")}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t(
                "Sua conta foi confirmada, mas a organização inicial ainda não foi criada. Informe o nome da sua empresa para concluir o primeiro acesso e abrir o onboarding do CRM.",
              )}
            </p>
          </div>
          <RecoverOrganizationForm nomeSugerido={nomeSugerido} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              "Se você recebeu um convite, não crie uma organização nova. Use o link do convite ou peça ao administrador para reenviá-lo.",
            )}
          </p>
        </div>
      </main>
    </IdiomaProvider>
  );
}
