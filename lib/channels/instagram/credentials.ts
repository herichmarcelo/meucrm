/**
 * Resolução de credenciais do canal oficial do Instagram Direct (Meta Graph API).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export interface InstagramCreds {
  accountId: string;
  token: string;
  pageId?: string | null;
  username?: string | null;
}

export function instagramCredsFromEnv(): InstagramCreds | null {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID?.trim();
  const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!accountId || !token) return null;
  return {
    accountId,
    token,
    pageId: process.env.INSTAGRAM_PAGE_ID?.trim() || null,
    username: process.env.INSTAGRAM_USERNAME?.trim() || null,
  };
}

export async function resolveInstagramCreds(
  organizationId: string,
  sessionRef?: string,
): Promise<InstagramCreds | null> {
  const admin = createAdminClient();

  let query = admin
    .from("channel_sessions")
    .select("instagram_account_id, instagram_page_id, instagram_username, instagram_token_encrypted, status")
    .eq("organization_id", organizationId)
    .eq("provider", "instagram")
    .is("archived_at", null);

  if (sessionRef && sessionRef !== "instagram_default") {
    query = query.eq("instagram_account_id", sessionRef);
  }

  const { data } = await query.maybeSingle();

  if (data && data.instagram_account_id && data.instagram_token_encrypted) {
    const token = await decryptWebhookSecret(admin, data.instagram_token_encrypted);
    if (token) {
      return {
        accountId: data.instagram_account_id,
        token,
        pageId: data.instagram_page_id,
        username: data.instagram_username,
      };
    }
  }

  return instagramCredsFromEnv();
}
