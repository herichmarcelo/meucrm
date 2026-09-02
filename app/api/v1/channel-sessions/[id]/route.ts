/**
 * GET /api/v1/channel-sessions/[id] — health check AO VIVO de um canal.
 *
 * Consulta o status real no provider (WAHA ou GOWA), grava `last_health_check_at`
 * (+ sincroniza `status`) no DB e devolve o estado atual.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { CHANNEL_PROVIDER_GOWA, CHANNEL_PROVIDER_WAHA } from "@/lib/channels/capabilities";
import { numeroObservadoDaSessao } from "@/lib/channels/numero-observado";
import { isChannelStatus } from "@/lib/schemas/channels";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getGowaClient } from "@/lib/gowa/client";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

export interface ChannelDeletionImpact {
  outcome: "delete" | "archive";
  history: { conversations: number; messages: number; agent_versions: number };
  configuration: { ai_routers: number; channel_knobs: number; before_send_traces: number };
}

type DependentTable =
  | "conversations"
  | "messages"
  | "ai_agent_versions"
  | "ai_routers"
  | "channel_knobs"
  | "before_send_traces";

async function loadDeletionImpact(
  orgId: string,
  channelSessionId: string,
): Promise<ChannelDeletionImpact> {
  const admin = createAdminClient();
  const count = async (table: DependentTable): Promise<number> => {
    const { count: n } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("channel_session_id", channelSessionId);
    return n ?? 0;
  };

  const [
    conversations,
    messages,
    agent_versions,
    ai_routers,
    channel_knobs,
    before_send_traces,
  ] = await Promise.all([
    count("conversations"),
    count("messages"),
    count("ai_agent_versions"),
    count("ai_routers"),
    count("channel_knobs"),
    count("before_send_traces"),
  ]);

  const hasHistory = conversations > 0 || messages > 0 || agent_versions > 0;
  const hasConfig = ai_routers > 0 || channel_knobs > 0 || before_send_traces > 0;
  const outcome: "delete" | "archive" = hasHistory || hasConfig ? "archive" : "delete";

  return {
    outcome,
    history: { conversations, messages, agent_versions },
    configuration: { ai_routers, channel_knobs, before_send_traces },
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id, provider, waha_session_name, gowa_device_id, display_name, phone_number, status")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  const impact =
    req.nextUrl.searchParams.get("impact") === "1"
      ? await loadDeletionImpact(activeOrg.orgId, id)
      : null;
  const comImpacto = <T extends object>(corpo: T): T & { deletion_impact?: ChannelDeletionImpact } =>
    impact ? { ...corpo, deletion_impact: impact } : corpo;

  let liveStatus = session.status as string;
  let phoneNumber = session.phone_number as string | null;

  if (session.provider === CHANNEL_PROVIDER_GOWA || session.gowa_device_id) {
    const gowa = getGowaClient();
    const deviceId = session.gowa_device_id || session.waha_session_name;
    if (!gowa || !deviceId) {
      return ok(comImpacto({ ...session, waha_configured: false, gowa_configured: false }), {
        requestId,
      });
    }

    try {
      const st = await gowa.getDeviceStatus(deviceId);
      if (st.isLoggedIn && st.isConnected) {
        liveStatus = "WORKING";
      } else if (!st.isLoggedIn) {
        liveStatus = "SCAN_QR_CODE";
      } else {
        liveStatus = "STOPPED";
      }

      if (st.jid) {
        const digits = st.jid.replace(/@.*$/, "").replace(/\D/g, "");
        if (digits.length >= 8) {
          phoneNumber = `+${digits}`;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      if (msg.includes("404")) liveStatus = "STOPPED";
    }
  } else {
    const waha = getWahaClient();
    const nomeSessao =
      session.provider === CHANNEL_PROVIDER_WAHA ? session.waha_session_name : null;
    if (!waha || !nomeSessao) {
      return ok(comImpacto({ ...session, waha_configured: false }), { requestId });
    }

    try {
      const remote = (await waha.getSessionQr(nomeSessao)) as {
        status?: string;
        me?: { id?: string; pushName?: string };
      };
      if (remote.status) liveStatus = remote.status;
      phoneNumber = numeroObservadoDaSessao({
        jid: remote.me?.id,
        statusAoVivo: liveStatus,
        gravado: phoneNumber,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      if (msg.includes("404")) liveStatus = "STOPPED";
    }
  }

  // Sincroniza o DB: sempre carimba o health check; atualiza status/telefone só se válido.
  const checkedAt = new Date().toISOString();
  const patch: Record<string, unknown> = { last_health_check_at: checkedAt };
  if (isChannelStatus(liveStatus) && liveStatus !== session.status) {
    patch.status = liveStatus;
    patch.last_status_change_at = checkedAt;
  }
  if (phoneNumber && phoneNumber !== session.phone_number) patch.phone_number = phoneNumber;

  const gravar = (corpo: Record<string, unknown>) =>
    supabase
      .from("channel_sessions")
      .update(corpo)
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id);

  let phoneConflict = false;
  const { error: syncErr } = await gravar(patch);
  if (syncErr) {
    if (syncErr.code !== "23505") {
      return fail("internal_error", syncErr.message, 500, { requestId });
    }
    phoneConflict = true;
    phoneNumber = session.phone_number as string | null;
    const { phone_number: _descartado, ...semTelefone } = patch;
    const { error: retryErr } = await gravar(semTelefone);
    if (retryErr) return fail("internal_error", retryErr.message, 500, { requestId });
  }

  return ok(
    comImpacto({
      id: session.id,
      provider: session.provider,
      waha_session_name: session.waha_session_name,
      gowa_device_id: session.gowa_device_id,
      display_name: session.display_name,
      phone_number: phoneNumber,
      status: liveStatus,
      last_health_check_at: checkedAt,
      waha_configured: true,
      phone_number_conflict: phoneConflict,
    }),
    { requestId },
  );
}

const patchChannelSchema = z.object({
  display_name: z.string().trim().max(80).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  let rawBody: unknown = {};
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }
  const parsed = patchChannelSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("channel_sessions")
    .update({
      display_name: parsed.data.display_name ?? null,
    })
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .select("id, provider, waha_session_name, gowa_device_id, display_name, phone_number, status")
    .single();

  if (error || !updated) {
    return fail("internal_error", error?.message ?? "Falha ao atualizar canal.", 500, { requestId });
  }

  void audit({
    action: "channel.connected",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { display_name: parsed.data.display_name },
  });

  return ok(updated, { requestId });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: session } = await supabase
    .from("channel_sessions")
    .select("id, provider, waha_session_name, gowa_device_id, display_name, phone_number")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  const impact = await loadDeletionImpact(activeOrg.orgId, id);
  const arquivar = impact.outcome === "archive";

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    archived_at: now,
    status: "STOPPED",
    last_status_change_at: now,
  };

  if (session.provider === CHANNEL_PROVIDER_GOWA) {
    const gowa = getGowaClient();
    const deviceId = session.gowa_device_id || session.waha_session_name;
    if (gowa && deviceId) {
      try {
        await gowa.deleteDevice(deviceId);
      } catch (err) {
        logger.warn("[channel-sessions.delete] falha ao deletar device no gowa", {
          deviceId,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  } else if (session.provider === CHANNEL_PROVIDER_WAHA) {
    const waha = getWahaClient();
    if (!waha) {
      return fail(
        "waha_not_configured",
        "O WhatsApp (WAHA) não está configurado neste ambiente (faltam WAHA_API_BASE_URL e/ou WAHA_API_KEY) — sem ele o número não pode ser desconectado do aparelho.",
        503,
        { requestId },
      );
    }
    try {
      await waha.logoutSession(session.waha_session_name as string);
      await waha.deleteSession(session.waha_session_name as string);
    } catch (err) {
      return fail("waha_error", wahaFriendlyError(err), 502, { requestId });
    }
  } else {
    patch.meta_token_encrypted = null;
    patch.webhook_path_token = randomUUID().replace(/-/g, "");
  }

  if (arquivar) {
    const { error: archErr } = await supabase
      .from("channel_sessions")
      .update(patch)
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id);
    if (archErr) return fail("internal_error", archErr.message, 500, { requestId });
  } else {
    const { error: delErr } = await supabase
      .from("channel_sessions")
      .delete()
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id);
    if (delErr) return fail("internal_error", delErr.message, 500, { requestId });
  }

  void audit({
    action: arquivar ? "channel.archived" : "channel.deleted",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: {
      waha_session_name: session.waha_session_name,
      gowa_device_id: session.gowa_device_id,
      phone_number: session.phone_number,
      provider: session.provider,
      ...impact.history,
      ...impact.configuration,
    },
  });

  return ok({ id, archived: arquivar, impact }, { requestId });
}
