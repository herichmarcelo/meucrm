/**
 * POST /api/v1/channel-sessions/[id]/reconnect — reconecta um canal caído.
 *
 * Dois modos, porque "caiu" tem duas causas com custos bem diferentes:
 *
 *  - PADRÃO (stop + start): soluço de rede, container reiniciado, sessão que
 *    parou sozinha. As credenciais em `/app/.sessions` continuam válidas e o
 *    engine volta sozinho para WORKING — sem QR, sem incomodar o usuário.
 *  - `{ force: true }` (stop + LOGOUT + start): o aparelho foi desvinculado
 *    pelo celular e o WhatsApp revogou a credencial. Aí o start comum
 *    reaproveita uma credencial morta e a sessão vai direto para FAILED, sem
 *    NUNCA passar por SCAN_QR_CODE — era exatamente esse o buraco em que a tela
 *    ficava presa esperando um QR que nunca vinha. O logout descarta a
 *    credencial e o pareamento recomeça do zero.
 *
 * O padrão é o modo suave de propósito: forçar logout sempre custaria um
 * reescaneamento a cada queda passageira. A UI só oferece o `force` depois que
 * o modo suave falhou.
 *
 * Canal EXCLUÍDO (arquivado) é recusado, não reconectado: subir a sessão de novo
 * no transporte devolveria um canal que recebe e não entrega nada — o webhook, o
 * ingest e o envio filtram `archived_at` e descartariam tudo. Vivo e surdo é pior
 * que desligado. E não há o que "reconectar": a exclusão deslogou o aparelho e
 * apagou a sessão no transporte, então o caminho de volta é conectar um número
 * (que também é o que a mensagem de erro diz).
 *
 * Canal OFICIAL é recusado por outro motivo, e com outro desfecho (422): ele não
 * tem sessão no transporte para parar e subir — `waha_session_name` é NULL nele
 * por CHECK. Reiniciar não é a operação dele; trocar a credencial é.
 *
 * Admin only. organization_id vem da sessão — nunca do path/body.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { createClient } from "@/lib/supabase/server";
import { getGowaClient } from "@/lib/gowa/client";
import { getWahaClient, wahaFriendlyError } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

const reconnectSchema = z.object({ force: z.boolean().optional() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  let rawBody: unknown = {};
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }
  const parsedBody = reconnectSchema.safeParse(rawBody ?? {});
  const force = parsedBody.success ? (parsedBody.data.force ?? false) : false;

  const authz = await requireRole("admin", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const buscar = (colunas: string) =>
    supabase
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id)
      .maybeSingle();

  const { data: sessionRaw } = await queryTolerantToMissingArchived(
    () => buscar(`id, provider, waha_session_name, gowa_device_id, ${ARCHIVED_AT}`),
    () => buscar("id, provider, waha_session_name, gowa_device_id"),
  );
  const session = sessionRaw as {
    id: string;
    provider?: string;
    waha_session_name: string | null;
    gowa_device_id: string | null;
    archived_at?: string | null;
  } | null;
  if (!session) return fail("not_found", "Canal não encontrado.", 404, { requestId });
  if (session.archived_at) {
    return fail(
      "channel_archived",
      "Este número foi excluído da Central de Conexões — reconectar não o traz de volta. Conecte um número para voltar a atender.",
      409,
      { requestId },
    );
  }

  if (session.provider === "gowa" || session.gowa_device_id) {
    const gowa = getGowaClient();
    if (!gowa) {
      return fail(
        "gowa_not_configured",
        "O GOWA não está configurado neste ambiente: faltam GOWA_API_BASE_URL e/ou GOWA_API_USER. Configure-as e tente de novo.",
        503,
        { requestId },
      );
    }
    const deviceId = session.gowa_device_id || session.waha_session_name;
    if (!deviceId) {
      return fail("channel_without_session", "Sessão sem device id registrado.", 422, { requestId });
    }

    try {
      if (force) {
        await gowa.logoutDevice(deviceId);
      }
      await supabase
        .from("channel_sessions")
        .update({
          status: "STARTING",
          last_status_change_at: new Date().toISOString(),
          consecutive_health_fails: 0,
        })
        .eq("organization_id", activeOrg.orgId)
        .eq("id", id);

      void audit({
        action: "channel.reconnected",
        actorUserId: user.id,
        organizationId: activeOrg.orgId,
        resourceType: "channel_session",
        resourceId: id,
        requestId,
        metadata: { gowa_device_id: deviceId, force },
      });

      return ok({ id, status: "STARTING", force }, { requestId });
    } catch (err) {
      return fail("gowa_error", err instanceof Error ? err.message : "Erro no GOWA", 502, { requestId });
    }
  }

  const nomeSessao = session.waha_session_name;
  if (!nomeSessao) {
    return fail(
      "channel_without_session",
      "Este canal é o oficial (API da plataforma): ele não tem sessão de WhatsApp para reiniciar. Se parou de entregar, atualize a credencial na tela do canal oficial.",
      422,
      { requestId },
    );
  }

  const waha = getWahaClient();
  if (!waha) {
    return fail(
      "waha_not_configured",
      "O WhatsApp (WAHA) não está configurado neste ambiente: faltam WAHA_API_BASE_URL e/ou WAHA_API_KEY. Configure-as e tente de novo.",
      503,
      { requestId },
    );
  }

  try {
    await waha.stopSession(nomeSessao);
    if (force) await waha.logoutSession(nomeSessao);
    const remote = (await waha.startSession(nomeSessao)) as { status?: string };
    const nextStatus = remote.status ?? "STARTING";
    await supabase
      .from("channel_sessions")
      .update({
        status: "STARTING",
        last_status_change_at: new Date().toISOString(),
        consecutive_health_fails: 0,
      })
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id);

    void audit({
      action: "channel.reconnected",
      actorUserId: user.id,
      organizationId: activeOrg.orgId,
      resourceType: "channel_session",
      resourceId: id,
      requestId,
      metadata: { waha_session_name: nomeSessao, force },
    });

    return ok({ id, status: nextStatus, force }, { requestId });
  } catch (err) {
    return fail("waha_error", wahaFriendlyError(err), 502, { requestId });
  }
}
