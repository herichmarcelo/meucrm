import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { marcaDaSaida } from "@/lib/branding/saida";
import CsatVoteClient from "./CsatVoteClient";

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ score?: string }>;
}

export default async function CsatVotePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { score: queryScore } = await searchParams;

  const admin = createAdminClient();
  const { data: survey } = await admin
    .from("csat_surveys")
    .select("id, organization_id, status, score, comment")
    .eq("token", token)
    .maybeSingle();

  if (!survey) {
    notFound();
  }

  const marca = await marcaDaSaida(survey.organization_id);
  const initialScore = queryScore ? parseInt(queryScore, 10) : (survey.score ?? 5);

  return (
    <CsatVoteClient
      token={token}
      marcaNome={marca.nome}
      logoUrl={marca.logoUrl}
      accentColor={marca.accent}
      accentFg={marca.accentFg}
      initialStatus={survey.status}
      initialScore={Number.isNaN(initialScore) ? 5 : Math.max(1, Math.min(5, initialScore))}
      initialComment={survey.comment ?? ""}
    />
  );
}
