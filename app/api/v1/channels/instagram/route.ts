/**
 * GET, POST, DELETE /api/v1/channels/instagram — gestão do canal oficial do Instagram Direct (Meta Graph API).
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { validateInstagramCredentials } from "@/lib/channels/instagram/validate-credentials";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const conectarSchema = z.object({
  account_id: z.string().trim().min(3),
  token: z.string().trim().min(15),
  page_id: z.string().trim().optional(),
});

type Gate = { ok: true; orgId: string; userId: string } | { ok: false; resposta: NextResponse };

async function adminGate(requestId: string): Promise<Gate> {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org || ROLE_RANK[org.role] < ROLE_RANK.admin) {
    return { ok: false, resposta: fail("forbidden", "admin_required", 403, { requestId }) };
  }
  return { ok: true, orgId: org.orgId, userId: user.id };
}

function publicBase(req: NextRequest): string {
  const configurada = env.NEXT_PUBLIC_APP_URL;
  const usavel = configurada && !configurada.includes("placeholder.invalid") ? configurada : null;
  return (
    usavel ?? req.headers.get("origin") ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const g = await adminGate(requestId);
  if (!g.ok) return g.resposta;

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("channel_sessions")
    .select("id, instagram_account_id, instagram_page_id, instagram_username, display_name, webhook_path_token, status, archived_at")
    .eq("organization_id", g.orgId)
    .eq("provider", "instagram")
    .is("archived_at", null)
    .maybeSingle();

  const base = publicBase(req);
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "instagram_verify_token";

  if (!session) {
    return ok(
      {
        connected: false,
        webhook_url: `${base}/api/v1/webhooks/instagram`,
        verify_token: verifyToken,
      },
      { requestId },
    );
  }

  return ok(
    {
      connected: true,
      id: session.id,
      account_id: session.instagram_account_id,
      page_id: session.instagram_page_id,
      username: session.instagram_username,
      display_name: session.display_name ?? session.instagram_username ?? "Instagram Direct",
      status: session.status,
      webhook_url: `${base}/api/v1/webhooks/instagram`,
      channel_webhook_url: session.webhook_path_token ? `${base}/api/v1/webhooks/channel/${session.webhook_path_token}` : null,
      verify_token: verifyToken,
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const g = await adminGate(requestId);
  if (!g.ok) return g.resposta;

  const parsed = conectarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", "account_id e token são obrigatórios", 422, { requestId });
  }

  // Valida a credencial contra a Graph API da Meta
  const validacao = await validateInstagramCredentials({
    accountId: parsed.data.account_id,
    token: parsed.data.token,
  });

  if (!validacao.ok) {
    return fail("invalid_request", validacao.motivo, 422, { requestId });
  }

  const admin = createAdminClient();
  const tokenCifrado = await encryptWebhookSecret(admin, parsed.data.token);

  if (!tokenCifrado) {
    return fail(
      "invalid_request",
      "cifra indisponível nesta instalação — a credencial não foi gravada",
      422,
      { requestId },
    );
  }

  const { data: existente } = await admin
    .from("channel_sessions")
    .select("id, webhook_path_token")
    .eq("organization_id", g.orgId)
    .eq("provider", "instagram")
    .maybeSingle();

  const webhookToken = existente?.webhook_path_token ?? randomBytes(16).toString("hex");
  const username = validacao.username ? `@${validacao.username.replace(/^@/, "")}` : null;
  const displayName = validacao.name || username || "Instagram Direct";

  if (existente?.id) {
    await admin
      .from("channel_sessions")
      .update({
        instagram_account_id: parsed.data.account_id,
        instagram_page_id: parsed.data.page_id || null,
        instagram_username: username,
        instagram_token_encrypted: tokenCifrado,
        display_name: displayName,
        status: "WORKING",
        archived_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existente.id);
  } else {
    await admin
      .from("channel_sessions")
      .insert({
        organization_id: g.orgId,
        provider: "instagram",
        instagram_account_id: parsed.data.account_id,
        instagram_page_id: parsed.data.page_id || null,
        instagram_username: username,
        instagram_token_encrypted: tokenCifrado,
        webhook_path_token: webhookToken,
        display_name: displayName,
        status: "WORKING",
      });
  }

  const base = publicBase(req);
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "instagram_verify_token";

  return ok(
    {
      connected: true,
      account_id: parsed.data.account_id,
      username,
      display_name: displayName,
      webhook_url: `${base}/api/v1/webhooks/instagram`,
      verify_token: verifyToken,
    },
    { requestId },
  );
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const g = await adminGate(requestId);
  if (!g.ok) return g.resposta;

  const admin = createAdminClient();
  await admin
    .from("channel_sessions")
    .update({
      archived_at: new Date().toISOString(),
      status: "DISCONNECTED",
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", g.orgId)
    .eq("provider", "instagram")
    .is("archived_at", null);

  return ok({ success: true }, { requestId });
}
