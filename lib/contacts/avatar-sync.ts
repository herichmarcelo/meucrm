/**
 * lib/contacts/avatar-sync.ts — Serviço central de sincronização de fotos de perfil de contatos.
 *
 * Agnóstico a provedor: utiliza a camada ChannelAdapter e SessionRef.
 * Persiste a foto no bucket privado `whatsapp-media` em `{org_id}/avatars/{contact_id}.jpg`.
 * Respeita regras de privacidade e LGPD (invariante de anonimização e rollback para storage_redaction_queue).
 */
import { DEFAULT_CHANNEL_PROVIDER, getAdapter, type ChannelAdapter, type ChannelProvider } from "@/lib/channels";
import { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef, type ChannelSessionRef } from "@/lib/channels/session-ref";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB
export const AVATAR_BUCKET = "whatsapp-media";

export interface SyncAvatarContactData {
  id: string;
  organization_id: string;
  wa_identity: string | null;
  phone_number?: string | null;
  avatar_storage_path?: string | null;
  avatar_updated_at?: string | null;
  is_anonymized?: boolean;
}

export interface SyncAvatarInput {
  organizationId: string;
  contactId: string;
  contact?: SyncAvatarContactData;
  adminClient?: ReturnType<typeof createAdminClient>;
}

export type SyncAvatarReason =
  | "success"
  | "no_picture"
  | "contact_not_found"
  | "anonymized"
  | "no_identity"
  | "no_active_session"
  | "provider_unsupported"
  | "download_failed"
  | "upload_failed"
  | "db_error";

export interface SyncAvatarResult {
  success: boolean;
  reason: SyncAvatarReason;
  path: string | null;
  error?: string;
}

/** `lid:123…` / `phone:+55…` ou telefone puro → chatId do canal de mensagens. */
export function resolveChatIdFromContact(waIdentity: string | null, phoneNumber?: string | null): string | null {
  if (waIdentity) {
    if (waIdentity.startsWith("lid:")) return `${waIdentity.slice(4)}@lid`;
    if (waIdentity.startsWith("phone:")) return `${waIdentity.slice(6).replace(/\D/g, "")}@c.us`;
  }
  if (phoneNumber) {
    const digits = phoneNumber.replace(/\D/g, "");
    if (digits.length >= 8) return `${digits}@c.us`;
  }
  return null;
}

/**
 * Executa o download da imagem a partir da URL retornada pelo provider adapter.
 */
async function fetchAvatarImageBuffer(
  url: string,
  adapter: ChannelAdapter,
  organizationId: string,
  sessionRef: string,
): Promise<Buffer | null> {
  try {
    if (adapter.fetchInboundMedia) {
      const media = await adapter.fetchInboundMedia({
        organizationId,
        sessionRef,
        url,
      });
      if (media.buffer && media.buffer.byteLength > 0 && media.buffer.byteLength <= MAX_AVATAR_BYTES) {
        return media.buffer;
      }
    }

    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;

    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    if (buf.byteLength === 0 || buf.byteLength > MAX_AVATAR_BYTES) return null;

    return buf;
  } catch {
    return null;
  }
}

/**
 * Sincroniza a foto de perfil do contato a partir da sessão ativa da organização
 * e persiste no bucket `whatsapp-media`.
 */
export async function syncContactAvatar(input: SyncAvatarInput): Promise<SyncAvatarResult> {
  const admin = input.adminClient ?? createAdminClient();
  const { organizationId, contactId } = input;

  // 1. Usa contato pré-carregado ou busca contato no banco
  let contact: SyncAvatarContactData | null = input.contact ?? null;
  if (!contact) {
    const { data, error: contactErr } = await admin
      .from("contacts")
      .select("id, organization_id, wa_identity, phone_number, avatar_storage_path, avatar_updated_at, is_anonymized")
      .eq("id", contactId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (contactErr) {
      logger.error("[avatar-sync] erro ao buscar contato", { error: contactErr.message, contactId, organizationId });
      return { success: false, reason: "db_error", path: null, error: contactErr.message };
    }
    contact = data as SyncAvatarContactData | null;
  }

  if (!contact) {
    return { success: false, reason: "contact_not_found", path: null };
  }

  if (contact.is_anonymized) {
    return { success: false, reason: "anonymized", path: null };
  }

  // Se já possui foto atualizada nas últimas 24 horas, não precisa reprocessar
  if (contact.avatar_storage_path && contact.avatar_updated_at) {
    const lastUpdate = new Date(contact.avatar_updated_at).getTime();
    if (!isNaN(lastUpdate) && Date.now() - lastUpdate < 24 * 60 * 60 * 1000) {
      return { success: true, reason: "success", path: contact.avatar_storage_path };
    }
  }

  const chatId = resolveChatIdFromContact(contact.wa_identity, contact.phone_number);

  // Helper para carimbar `avatar_updated_at` mesmo sem foto para evitar loops infinitos
  const carimbar = async (path: string | null): Promise<boolean> => {
    const { data: afetadas } = await admin
      .from("contacts")
      .update({
        ...(path !== null ? { avatar_storage_path: path } : {}),
        avatar_updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
      .eq("organization_id", organizationId)
      .eq("is_anonymized", false)
      .select("id");
    return (afetadas ?? []).length > 0;
  };

  if (!chatId) {
    await carimbar(null);
    return { success: false, reason: "no_identity", path: null };
  }

  // 2. Busca sessão ativa da organização via CHANNEL_SESSION_REF_COLUMNS
  const { data: sessao, error: sessErr } = await admin
    .from("channel_sessions")
    .select(CHANNEL_SESSION_REF_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("status", "WORKING")
    .limit(1)
    .maybeSingle();

  if (sessErr || !sessao) {
    await carimbar(null);
    return { success: false, reason: "no_active_session", path: null };
  }

  let sessionRef: string;
  try {
    sessionRef = resolveSessionRef(sessao as unknown as ChannelSessionRef);
  } catch {
    await carimbar(null);
    return { success: false, reason: "no_active_session", path: null };
  }

  const provider = ((sessao as { provider?: string }).provider ?? DEFAULT_CHANNEL_PROVIDER) as ChannelProvider;
  const adapter = getAdapter(provider);

  if (!adapter.fetchProfilePictureUrl) {
    await carimbar(null);
    return { success: false, reason: "provider_unsupported", path: null };
  }

  // 3. Consulta a URL da foto de perfil no provedor
  let profilePictureUrl: string | null = null;
  try {
    profilePictureUrl = await adapter.fetchProfilePictureUrl({
      organizationId,
      sessionRef,
      recipient: chatId,
    });
  } catch (err) {
    logger.warn("[avatar-sync] falha na chamada do adapter", {
      contactId,
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!profilePictureUrl) {
    await carimbar(null);
    return { success: false, reason: "no_picture", path: null };
  }

  // 4. Download do buffer da imagem
  const imageBuffer = await fetchAvatarImageBuffer(profilePictureUrl, adapter, organizationId, sessionRef);
  if (!imageBuffer) {
    await carimbar(null);
    return { success: false, reason: "download_failed", path: null };
  }

  // 5. Upload no Supabase Storage (bucket `whatsapp-media`)
  const path = `${organizationId}/avatars/${contactId}.jpg`;
  const { error: uploadErr } = await admin.storage
    .from(AVATAR_BUCKET)
    .upload(path, imageBuffer, { contentType: "image/jpeg", upsert: true });

  if (uploadErr) {
    logger.error("[avatar-sync] falha no upload para o storage", { error: uploadErr.message, path });
    await carimbar(null);
    return { success: false, reason: "upload_failed", path: null, error: uploadErr.message };
  }

  // 6. Atualização atômica no banco de dados com proteção contra corrida LGPD
  const gravou = await carimbar(path);
  if (!gravou) {
    // O contato foi anonimizado durante o upload da foto. Enfileira para deleção física imediata.
    await admin.from("storage_redaction_queue").upsert(
      {
        organization_id: organizationId,
        bucket: AVATAR_BUCKET,
        object_path: path,
        status: "pending",
        attempts: 0,
        processed_at: null,
        error_message: null,
      },
      { onConflict: "bucket,object_path" },
    );
    logger.warn("[avatar-sync] contato anonimizado durante o sync; foto enviada para fila de exclusão", {
      contactId,
      organizationId,
    });
    return { success: false, reason: "anonymized", path: null };
  }

  return { success: true, reason: "success", path };
}
