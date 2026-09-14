/**
 * lib/tags/exclusive-group.ts
 *
 * Garante que em grupos exclusivos de tags (ex: 'tipo_atendimento'),
 * apenas uma tag do grupo permaneça na lista de tags da conversa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

interface TagGroupInfo {
  name: string;
  group_slug: string | null;
  is_exclusive: boolean;
}

/**
 * Filtra a lista de tags da conversa garantindo que grupos exclusivos tenham no máximo uma tag (a mais recente na lista).
 */
export async function resolverTagsExclusivas(
  inputTags: string[],
  organizationId: string,
  client: SupabaseClient,
): Promise<string[]> {
  if (!inputTags || inputTags.length <= 1) {
    return inputTags ?? [];
  }

  // Normaliza nomes para minúsculas
  const normalized = inputTags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (normalized.length <= 1) return normalized;

  // Busca definições de tags para a organização
  const { data } = await client
    .from("tags")
    .select("name, group_slug, is_exclusive")
    .eq("organization_id", organizationId)
    .eq("is_exclusive", true)
    .not("group_slug", "is", null);

  const exclusiveDefs = (data as TagGroupInfo[] | null) ?? [];
  if (exclusiveDefs.length === 0) {
    return normalized;
  }

  // Mapeia nome da tag para seu group_slug
  const tagToGroup = new Map<string, string>();
  for (const def of exclusiveDefs) {
    if (def.group_slug) {
      tagToGroup.set(def.name.toLowerCase(), def.group_slug);
    }
  }

  // Percorre as tags de trás para frente para manter a última de cada grupo exclusivo
  const seenGroups = new Set<string>();
  const reversedResult: string[] = [];

  for (let i = normalized.length - 1; i >= 0; i--) {
    const tag = normalized[i];
    if (!tag) continue;
    const group = tagToGroup.get(tag);

    if (!group) {
      // Tag livre
      reversedResult.push(tag);
    } else {
      // Tag de grupo exclusivo: só entra se o grupo ainda não foi visto
      if (!seenGroups.has(group)) {
        seenGroups.add(group);
        reversedResult.push(tag);
      }
    }
  }

  return reversedResult.reverse();
}
