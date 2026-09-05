/**
 * GET  /api/v1/channel-sessions — lista os canais WhatsApp da org (do DB).
 *   Acessível a qualquer membro (usado pelo seletor do inbox e pela sidebar).
 * POST /api/v1/channel-sessions — conecta um NOVO número (cria a sessão com
 *   nome único e inicia no WAHA). Admin only.
 *
 * organization_id resolvido da sessão (cookie) — nunca do body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { createChannelSchema } from "@/lib/schemas/channels";
import { createClient } from "@/lib/supabase/server";
import { getGowaClient } from "@/lib/gowa/client";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export const CHANNEL_COLUMNS =
  "id, provider, waha_session_name, gowa_device_id, email_inbound_address, display_name, phone_number, status, status_reason, last_health_check_at, last_status_change_at, daily_message_limit, is_warmup_complete, created_at";

export const CHANNEL_COLUMNS_LEGACY =
  "id, waha_session_name, display_name, phone_number, status, status_reason, last_health_check_at, last_status_change_at, daily_message_limit, is_warmup_complete, created_at";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const base = (cols: string) =>
    supabase
      .from("channel_sessions")
      .select(cols)
      .eq("organization_id", activeOrg.orgId);

  let result = await queryTolerantToMissingArchived(
    () => base(CHANNEL_COLUMNS).is(ARCHIVED_AT, null).order("created_at", { ascending: true }),
    () => base(CHANNEL_COLUMNS).order("created_at", { ascending: true }),
  );

  if (
    result.error &&
    (result.error.code === "42703" ||
      (result.error.message ?? "").includes("gowa_device_id") ||
      (result.error.message ?? "").includes("provider"))
  ) {
    result = await queryTolerantToMissingArchived(
      () => base(CHANNEL_COLUMNS_LEGACY).is(ARCHIVED_AT, null).order("created_at", { ascending: true }),
      () => base(CHANNEL_COLUMNS_LEGACY).order("created_at", { ascending: true }),
    );
  }

  if (result.error) return fail("internal_error", result.error.message, 500, { requestId });

  return ok(result.data ?? [], {
    requestId,
    ...(result.schemaOutdated ? { meta: { schema_outdated: true } } : {}),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = createChannelSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const waha = getWahaClient();
  const gowa = getGowaClient();

  const chosenProvider =
    parsed.data.provider ||
    (waha ? "waha" : gowa ? "gowa" : "waha");

  if (chosenProvider === "gowa" && !gowa) {
    return fail(
      "gowa_not_configured",
      "O GOWA não está configurado neste ambiente: faltam GOWA_API_BASE_URL e/ou GOWA_API_USER. Configure-as e tente de novo.",
      503,
      { requestId },
    );
  }

  if (chosenProvider === "waha" && !waha) {
    return fail(
      "waha_not_configured",
      "O WhatsApp (WAHA) não está configurado neste ambiente: faltam WAHA_API_BASE_URL e/ou WAHA_API_KEY. Configure-as e tente de novo.",
      503,
      { requestId },
    );
  }

  const supabase = await createClient();
  const sessionName = `org_${activeOrg.orgId.slice(0, 8)}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const webhookToken = randomUUID().replace(/-/g, "");

  const insertPayload: Record<string, unknown> = {
    organization_id: activeOrg.orgId,
    provider: chosenProvider,
    display_name: parsed.data.display_name ?? null,
    engine: "NOWEB",
    webhook_path_token: webhookToken,
    webhook_secret_encrypted: Buffer.from([0]),
    status: "STARTING",
    last_status_change_at: new Date().toISOString(),
    consecutive_health_fails: 0,
    daily_message_limit: 250,
    metadata: {},
  };

  if (chosenProvider === "gowa") {
    insertPayload.gowa_device_id = sessionName;
    insertPayload.waha_session_name = null;
  } else {
    insertPayload.waha_session_name = sessionName;
    insertPayload.gowa_device_id = null;
  }

  const { data: created, error: insErr } = await supabase
    .from("channel_sessions")
    .insert(insertPayload)
    .select(CHANNEL_COLUMNS)
    .single();

  if (insErr || !created) {
    return fail("internal_error", insErr?.message ?? "channel_session_insert_failed", 500, { requestId });
  }

  if (chosenProvider === "gowa" && gowa) {
    try {
      // GOWA_WEBHOOK_BASE_URL deve apontar para um endereço alcançável de DENTRO
      // do container GOWA. Em desenvolvimento local com Docker, use
      // http://host.docker.internal:3000. Em produção, a URL pública do app.
      // NÃO use NEXT_PUBLIC_APP_URL aqui: ela resolve "localhost" que, de dentro
      // do container, aponta para o próprio container e não para o Next.js.
      const appUrl =
        (env.GOWA_WEBHOOK_BASE_URL ?? "").trim() ||
        "http://host.docker.internal:3000";
      const webhookUrl = `${appUrl}/api/v1/webhooks/gowa/${webhookToken}`;
      await gowa.addDevice(sessionName, webhookUrl, env.GOWA_WEBHOOK_SECRET || undefined);
      await gowa.loginDevice(sessionName).catch(() => null);

    } catch (err) {
      await supabase
        .from("channel_sessions")
        .delete()
        .eq("organization_id", activeOrg.orgId)
        .eq("id", created.id);
      return fail(
        "gowa_error",
        err instanceof Error ? err.message : "Erro ao registrar device no GOWA.",
        502,
        { requestId },
      );
    }
  } else if (chosenProvider === "waha" && waha) {
    try {
      await waha.startSession(sessionName);
    } catch (err) {
      await supabase
        .from("channel_sessions")
        .delete()
        .eq("organization_id", activeOrg.orgId)
        .eq("id", created.id);
      return fail("waha_error", wahaFriendlyError(err), 502, { requestId });
    }
  }

  void audit({
    action: "channel.connected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: created.id,
    requestId,
    metadata: {
      provider: chosenProvider,
      session_name: sessionName,
    },
  });

  return ok(created, { requestId, status: 201 });
}
