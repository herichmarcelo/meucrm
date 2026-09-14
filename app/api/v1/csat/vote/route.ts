/**
 * POST /api/v1/csat/vote — Registra a avaliação do cliente na pesquisa CSAT.
 *
 * Rota pública (validada por token unívoco assinado na criação da pesquisa).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const voteSchema = z.object({
  token: z.string().uuid("Token inválido"),
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().nullable(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "Corpo da requisição inválido.", 422, { requestId });
  }

  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: { errors: parsed.error.issues.map((i) => i.message) },
    });
  }

  const { token, score, comment } = parsed.data;
  const admin = createAdminClient();

  const { data: survey, error: findErr } = await admin
    .from("csat_surveys")
    .select("id, organization_id, status, score")
    .eq("token", token)
    .maybeSingle();

  if (findErr || !survey) {
    return fail("not_found", "Pesquisa de satisfação não encontrada.", 404, { requestId });
  }

  if (survey.status === "completed") {
    return ok(
      {
        already_completed: true,
        message: "Esta pesquisa já foi respondida anteriormente.",
        score: survey.score,
      },
      { requestId },
    );
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("csat_surveys")
    .update({
      score,
      comment: comment ?? null,
      status: "completed",
      responded_at: now,
      updated_at: now,
    })
    .eq("id", survey.id);

  if (updateErr) {
    return fail("internal_error", "Falha ao salvar sua avaliação.", 500, { requestId });
  }

  void audit({
    action: "csat.survey_responded",
    actorUserId: null,
    organizationId: survey.organization_id,
    resourceType: "csat_survey",
    resourceId: survey.id,
    requestId,
    metadata: {
      score,
      channel: "email",
      has_comment: Boolean(comment),
    },
  });

  return ok(
    {
      success: true,
      message: "Avaliação registrada com sucesso. Obrigado!",
      score,
    },
    { requestId },
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return fail("validation_failed", "Token não informado.", 422, { requestId });
  }

  const admin = createAdminClient();
  const { data: survey, error } = await admin
    .from("csat_surveys")
    .select("id, status, score, comment")
    .eq("token", token)
    .maybeSingle();

  if (error || !survey) {
    return fail("not_found", "Pesquisa não encontrada.", 404, { requestId });
  }

  return ok(survey, { requestId });
}
