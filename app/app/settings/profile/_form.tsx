"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateProfile } from "@/app/actions/settings/updateProfile";
import { profileSchema, type Locale, type TimeFormat } from "@/lib/schemas/settings";
import { FUSOS_OFERECIDOS } from "@/lib/tempo/fusos";

interface Props {
  email: string;
  initialFullName: string | null;
  initialAvatarUrl: string | null;
  initialLocale?: string | null;
  initialTimezone?: string | null;
  initialTimeFormat?: "24h" | "12h" | null;
  initialSignature?: string | null;
}

export function ProfileForm({
  email,
  initialFullName,
  initialAvatarUrl,
  initialLocale,
  initialTimezone,
  initialTimeFormat,
  initialSignature,
}: Props) {
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [locale, setLocale] = useState<Locale>((initialLocale as Locale) || "pt-BR");
  const [timezone, setTimezone] = useState(initialTimezone || "America/Sao_Paulo");
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(initialTimeFormat || "24h");
  const [signature, setSignature] = useState(initialSignature ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = profileSchema.safeParse({
      full_name: fullName || null,
      locale,
      timezone,
      time_format: timeFormat,
      signature: signature || null,
      avatar_url: avatarUrl || null,
    });
    if (!parsed.success) {
      toast.error("Dados inválidos.");
      return;
    }
    startTransition(async () => {
      const r = await updateProfile(parsed.data);
      if (r.ok) toast.success("Perfil atualizado com sucesso.");
      else toast.error(`Erro: ${r.error}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl">
      <Card className="space-y-4 p-6">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} disabled />
          <p className="text-xs text-muted-foreground">
            Trocar email — em breve.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="full_name">Nome completo</Label>
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="signature">Assinatura na conversa</Label>
          <Input
            id="signature"
            placeholder="ex: Herich M."
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            maxLength={100}
          />
          <p className="text-xs text-muted-foreground">
            Se preenchido, seu nome aparece no início de cada mensagem que você enviar nas conversas, para identificar qual atendente respondeu.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="locale">Idioma</Label>
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger id="locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">Fuso horário</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {FUSOS_OFERECIDOS.map((f) => (
                  <SelectItem key={f.codigo} value={f.codigo}>
                    {f.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="time_format">Formato de hora no sistema</Label>
          <Select value={timeFormat} onValueChange={(v) => setTimeFormat(v as TimeFormat)}>
            <SelectTrigger id="time_format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">24 horas — ex: 14:30 (Padrão)</SelectItem>
              <SelectItem value="12h">12 horas — ex: 02:30 PM (AM / PM)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Define como os horários das mensagens, agendamentos e atividades serão exibidos para você.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="avatar_url">Avatar URL</Label>
          <Input
            id="avatar_url"
            type="url"
            placeholder="https://…"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Upload de arquivo — em breve. Cole uma URL pública.
          </p>
        </div>
        <div className="flex sm:justify-end">
          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
