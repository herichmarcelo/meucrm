// app/api/v1/messages/[id]/media/route.ts
/**
 * GET /api/v1/messages/[id]/media — acesso autenticado à mídia da mensagem.
 * Persistida → 302 pra signed URL (TTL 1h) do bucket whatsapp-media.
 * Ainda não persistida (janela até o worker rodar) → proxy dos bytes do WAHA.
 * A URL desta rota é usada diretamente como src de <img>/<video>/<audio>
 * (cookie de sessão vai junto por ser same-origin; RLS decide o acesso).
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { storagePathFor } from "@/lib/messaging/media/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_S = 3600;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: messageId } = await ctx.params;
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const authUser = await loadAuthUser();
  const activeOrg = authUser ? await resolveActiveOrg(authUser) : null;
  if (!activeOrg) {
    return fail("no_active_org", "No active organization.", 403, { requestId });
  }

  // Client de sessão: RLS garante que a mensagem pertence a uma org do usuário.
  // Filtro explícito de organization_id por doutrina (defense-in-depth).
  const { data: msg, error } = await supabase
    .from("messages")
    .select("id, conversation_id, external_id, type, media_url, media_mime, media_storage_path, channel_session_id, metadata")
    .eq("id", messageId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (error) {
    return fail("internal_error", "Erro ao buscar mensagem.", 500, { requestId });
  }

  const isMediaMsgType = msg && ["image", "audio", "video", "document", "sticker"].includes(msg.type);
  const mediaUrlCandidate = msg?.media_url || (isMediaMsgType && msg?.external_id ? `/api/files/${encodeURIComponent(msg.external_id)}` : null);

  if (!msg || (!msg.media_storage_path && !mediaUrlCandidate)) {
    return fail("not_found", "Mensagem sem mídia.", 404, { requestId });
  }

  const admin = createAdminClient();

  if (msg.media_storage_path) {
    const { data: signed, error: signErr } = await admin.storage
      .from("whatsapp-media")
      .createSignedUrl(msg.media_storage_path, SIGNED_URL_TTL_S);
    if (!signErr && signed?.signedUrl) {
      const response = NextResponse.redirect(signed.signedUrl, 302);
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
    if (signErr) {
      console.error("[messages.media] createSignedUrl failed", signErr.message);
    }
  }

  // ── Fallback: o worker ainda não persistiu ──────────────────────────────────
  //
  // Baixa server-side pelo ADAPTER com as credenciais do transporte e
  // persiste oportunisticamente no bucket `whatsapp-media`, atualizando a mensagem.
  if (mediaUrlCandidate) {
    try {
      let sessao = null;
      if (msg.channel_session_id) {
        const { data } = await admin
          .from("channel_sessions")
          .select(`provider, ${CHANNEL_SESSION_REF_COLUMNS}`)
          .eq("organization_id", activeOrg.orgId)
          .eq("id", msg.channel_session_id)
          .maybeSingle();
        sessao = data;
      }

      if (!sessao) {
        const { data } = await admin
          .from("channel_sessions")
          .select(`provider, ${CHANNEL_SESSION_REF_COLUMNS}`)
          .eq("organization_id", activeOrg.orgId)
          .eq("status", "WORKING")
          .limit(1)
          .maybeSingle();
        sessao = data;
      }

      if (!sessao) {
        const { data } = await admin
          .from("channel_sessions")
          .select(`provider, ${CHANNEL_SESSION_REF_COLUMNS}`)
          .eq("organization_id", activeOrg.orgId)
          .limit(1)
          .maybeSingle();
        sessao = data;
      }

      const adapter = getAdapter(
        ((sessao?.provider as string) ?? DEFAULT_CHANNEL_PROVIDER) as ChannelProvider,
      );
      const sessionRef = sessao ? resolveSessionRef(sessao as unknown as ChannelSessionRef) : null;
      if (!adapter.fetchInboundMedia || !sessionRef) {
        return fail("not_found", "Mensagem sem mídia.", 404, { requestId });
      }

      const media = await adapter.fetchInboundMedia({
        organizationId: activeOrg.orgId,
        sessionRef,
        url: mediaUrlCandidate,
        hintMime: msg.media_mime,
      });

      // Persistência oportunista no Supabase Storage
      const path = storagePathFor(activeOrg.orgId, msg.conversation_id, msg.id, media.mime);
      const { error: uploadErr } = await admin.storage
        .from("whatsapp-media")
        .upload(path, media.buffer, { contentType: media.mime, upsert: true });

      if (!uploadErr) {
        await admin
          .from("messages")
          .update({
            media_storage_path: path,
            media_size_bytes: media.buffer.byteLength,
            media_mime: media.mime,
            metadata: { ...((msg.metadata as Record<string, unknown>) ?? {}), media_status: "stored" },
          })
          .eq("id", msg.id)
          .eq("organization_id", activeOrg.orgId);
      }

      return new Response(new Uint8Array(media.buffer), {
        status: 200,
        headers: {
          "Content-Type": media.mime,
          "Cache-Control": "private, max-age=60",
          "X-Request-Id": requestId,
        },
      });
    } catch (err) {
      console.error("[messages.media] fallback proxy failed", err instanceof Error ? err.message : String(err));
      return fail("bad_gateway", "Mídia indisponível no momento.", 502, { requestId });
    }
  }

  return fail("not_found", "Mensagem sem mídia.", 404, { requestId });
}
