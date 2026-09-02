import { requireAuth } from "@/lib/auth/server";
import { ProfileForm } from "./_form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireAuth();
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>
        <p className="text-sm text-muted-foreground">
          Informações pessoais. Email só pode ser trocado em breve.
        </p>
      </header>
      <ProfileForm
        email={user.email}
        initialFullName={user.full_name}
        initialAvatarUrl={user.avatar_url}
        initialLocale={user.locale}
        initialTimezone={user.timezone}
        initialTimeFormat={user.time_format}
        initialSignature={user.signature}
      />
    </div>
  );
}
