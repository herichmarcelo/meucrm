/**
 * GET /api/v1/channel-sessions/[id]/qr — proxy do QR de UM canal específico.
 *
 * Como o onboarding, faz proxy do WAHA para o browser poder <img src="..." />
 * sem expor a API key — mas resolve a sessão por `id` (multi-número), não pelo
 * nome derivado do org. organization_id vem da sessão autenticada.
 *
 * Canal EXCLUÍDO (arquivado) é recusado aqui, e não lá no WAHA. Escanear um QR é
 * o ato que RELIGA um número: se ele aparecer para um canal arquivado, o operador
 * pareia o aparelho e a linha continua arquivada — o mesmo "vivo e surdo" que a
 * rota de reconectar recusa, só que consumado no celular, fora do nosso alcance.
 *
 * Hoje o WAHA responderia 404 (a exclusão deslogou e apagou a sessão lá), mas
 * essa é uma correção EMPRESTADA do estado de um sistema externo, não uma decisão
 * nossa: basta a sessão sobreviver do outro lado para o QR voltar a aparecer.
 * Quem resolve um canal para religá-lo decide sobre `archived_at` — as três rotas
 * irmãs (conectar oficial, reconectar, retomar o onboarding) decidem, esta
 * faltava.
 *
 * Canal OFICIAL também não passa daqui: ele não tem sessão no transporte (nem QR
 * a mostrar), e o `null` seguia para a URL como se fosse nome de sessão.
 */
import { NextResponse } from "next/server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { createClient } from "@/lib/supabase/server";
import { getGowaClient } from "@/lib/gowa/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return new NextResponse(null, { status: 403 });

  const supabase = await createClient();
  const buscar = (colunas: string) =>
    supabase
      .from("channel_sessions")
      .select(colunas)
      .eq("organization_id", activeOrg.orgId)
      .eq("id", id)
      .maybeSingle();

  const { data: sessionRaw } = await queryTolerantToMissingArchived(
    () => buscar(`provider, waha_session_name, gowa_device_id, ${ARCHIVED_AT}`),
    () => buscar("provider, waha_session_name, gowa_device_id"),
  );
  const session = sessionRaw as {
    provider?: string;
    waha_session_name: string | null;
    gowa_device_id?: string | null;
    archived_at?: string | null;
  } | null;
  if (!session) return new NextResponse(null, { status: 404 });

  if (session.archived_at) {
    return new NextResponse(null, {
      status: 409,
      headers: { "x-channel-state": "archived" },
    });
  }

  // Se a sessão for GOWA, busca o QR do servidor GOWA
  if (session.provider === "gowa" || session.gowa_device_id) {
    const gowa = getGowaClient();
    if (!gowa) {
      return new NextResponse(null, { status: 503, headers: { "x-gowa-status": "not_configured" } });
    }

    const deviceId = session.gowa_device_id || session.waha_session_name;
    if (!deviceId) {
      return new NextResponse(null, { status: 409, headers: { "x-channel-state": "no-device-id" } });
    }

    try {
      const loginRes = await gowa.loginDevice(deviceId);
      if (!loginRes.qrLink) {
        return new NextResponse(null, { status: 503, headers: { "x-gowa-status": "no_qr_link" } });
      }

      const { buffer, contentType } = await gowa.fetchQrImage(loginRes.qrLink, deviceId);
      return new NextResponse(buffer, {
        status: 200,
        headers: { "content-type": contentType || "image/png", "cache-control": "no-store, max-age=0" },
      });
    } catch (err) {
      return new NextResponse(null, {
        status: 502,
        headers: { "x-gowa-error": err instanceof Error ? err.message.slice(0, 80) : "unknown" },
      });
    }
  }

  // Canal oficial não pareia por QR: `waha_session_name` é NULL nele por CHECK.
  if (!session.waha_session_name) {
    return new NextResponse(null, {
      status: 409,
      headers: { "x-channel-state": "no-session" },
    });
  }

  const baseUrl = process.env.WAHA_API_BASE_URL;
  const apiKey = process.env.WAHA_API_KEY;
  if (!baseUrl || !apiKey || apiKey === "dev_plaintext_change_me") {
    return new NextResponse(null, { status: 503 });
  }

  const upstream = await fetch(
    `${baseUrl}/api/${encodeURIComponent(session.waha_session_name)}/auth/qr?format=image`,
    { headers: { "X-Api-Key": apiKey }, cache: "no-store" },
  );
  if (!upstream.ok) {
    return new NextResponse(null, {
      status: upstream.status,
      headers: { "x-waha-status": String(upstream.status) },
    });
  }

  const ct = upstream.headers.get("content-type") ?? "image/png";
  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: { "content-type": ct, "cache-control": "no-store, max-age=0" },
  });
}
