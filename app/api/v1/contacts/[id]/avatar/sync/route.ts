/**
 * POST /api/v1/contacts/{id}/avatar/sync — sincronização sob demanda da foto de perfil.
 *
 * Permite que um operador ou a interface solicite a busca e atualização imediata
 * do avatar de um contato via canal conectado, sem aguardar o ciclo do cron.
 *
 * Auth: Role `agent`+ (RBAC) e escopo estrito da organização ativa.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { syncContactAvatar } from "@/lib/contacts/avatar-sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const SIGNED_TTL_SECONDS = 300;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const activeOrg = authz.org;

  const result = await syncContactAvatar({
    organizationId: activeOrg.orgId,
    contactId: id,
  });

  if (!result.success) {
    switch (result.reason) {
      case "contact_not_found":
        return fail("not_found", "Contato não encontrado.", 404, { requestId });
      case "anonymized":
        return fail("unprocessable_entity", "Contato anonimizado não pode receber foto de perfil.", 422, { requestId });
      case "no_identity":
        return fail("unprocessable_entity", "Contato não possui número de WhatsApp ou identidade associada.", 422, { requestId });
      case "no_active_session":
        return fail("service_unavailable", "Nenhuma conexão do WhatsApp ativa no momento para esta organização.", 503, { requestId });
      case "provider_unsupported":
        return fail("not_implemented", "O canal configurado não possui suporte à busca de fotos de perfil.", 501, { requestId });
      case "no_picture":
        return ok(
          {
            synced: false,
            reason: "no_picture",
            message: "Contato sem foto de perfil pública no WhatsApp.",
            avatar_url: null,
          },
          { requestId },
        );
      default:
        return fail("internal_error", result.error ?? "Falha ao sincronizar foto de perfil.", 500, { requestId });
    }
  }

  // Gera URL assinada fresca para o frontend atualizar instantaneamente a imagem
  let signedAvatarUrl: string | null = null;
  if (result.path) {
    const admin = createAdminClient();
    const { data: signed } = await admin.storage
      .from("whatsapp-media")
      .createSignedUrl(result.path, SIGNED_TTL_SECONDS);
    signedAvatarUrl = signed?.signedUrl ?? null;
  }

  return ok(
    {
      synced: true,
      reason: "success",
      avatar_storage_path: result.path,
      avatar_url: signedAvatarUrl,
    },
    { requestId },
  );
}
