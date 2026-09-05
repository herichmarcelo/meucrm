/**
 * Validação de credenciais do canal oficial do Instagram Direct na Graph API da Meta antes de gravar.
 */
export type ValidacaoCredencialInstagram =
  | { ok: true; username: string | null; name: string | null; profilePictureUrl: string | null }
  | { ok: false; motivo: string };

export async function validateInstagramCredentials(input: {
  accountId: string;
  token: string;
  graphVersion?: string;
}): Promise<ValidacaoCredencialInstagram> {
  const version = input.graphVersion ?? process.env.META_GRAPH_VERSION ?? "v22.0";
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${input.accountId}?fields=id,username,name,profile_picture_url`,
      { headers: { Authorization: `Bearer ${input.token}` } },
    );
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
      error?: { message?: string; error_data?: { details?: string } };
    };

    if (!res.ok || body.error) {
      return {
        ok: false,
        motivo: body.error?.error_data?.details ?? body.error?.message ?? `http_${res.status}`,
      };
    }

    return {
      ok: true,
      username: body.username ?? null,
      name: body.name ?? null,
      profilePictureUrl: body.profile_picture_url ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      motivo: `rede indisponível: ${err instanceof Error ? err.message : "erro"}`,
    };
  }
}
