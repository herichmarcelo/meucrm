"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { obterCorPadraoTag } from "@/lib/tags/paleta";

export interface TagDefinition {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  group_slug?: string | null;
  is_exclusive?: boolean;
  is_csat_enabled?: boolean;
  sla_first_response_minutes?: number | null;
  sla_resolution_minutes?: number | null;
  created_at: string;
  updated_at: string;
}

interface UpsertTagArgs {
  name: string;
  color?: string | null;
  group_slug?: string | null;
  is_exclusive?: boolean;
  is_csat_enabled?: boolean;
  sla_first_response_minutes?: number | null;
  sla_resolution_minutes?: number | null;
}

/**
 * Consulta todas as definições de tags da organização e suas cores associadas.
 */
export function useOrganizationTags(orgId?: string | null) {
  const query = useQuery({
    queryKey: ["organization-tags", orgId],
    staleTime: 60_000,
    queryFn: async (): Promise<TagDefinition[]> => {
      const res = await apiClient.get<{ data: TagDefinition[] }>("/api/v1/tags");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const tagColorMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    if (Array.isArray(query.data)) {
      for (const t of query.data) {
        map[t.name.toLowerCase()] = t.color;
      }
    }
    return map;
  }, [query.data]);

  /**
   * Retorna a cor canônica de uma tag.
   * - Se a tag tem entrada no banco com cor explícita → retorna essa cor.
   * - Se a tag não tem entrada ou a cor é null → retorna cor determinística
   *   baseada no nome (hash DJB2 sobre a paleta vibrante), garantindo que
   *   toda tag tenha sempre uma cor visível e consistente.
   */
  function getTagColor(name: string): string {
    const trimmed = name.trim().toLowerCase();
    const fromDb = tagColorMap[trimmed];
    // fromDb pode ser null (linha existe mas sem cor) ou undefined (linha inexistente)
    return fromDb ?? obterCorPadraoTag(trimmed);
  }

  return {
    ...query,
    tags: Array.isArray(query.data) ? query.data : [],
    tagColorMap,
    getTagColor,
  };
}

/**
 * Cadastra ou altera a cor de uma tag na organização (upsert).
 */
export function useUpsertTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: UpsertTagArgs) =>
      apiClient.post<{ data: TagDefinition }>("/api/v1/tags", args),
    onError: (err) => {
      showApiError(err);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organization-tags"] });
    },
  });
}
