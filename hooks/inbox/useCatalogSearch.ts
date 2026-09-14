"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { CatalogSearchItem } from "@/app/api/v1/catalog/search/route";

export function useCatalogSearch(termo: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["catalog-search", termo],
    queryFn: async () => {
      const res = await apiClient.get<{ data: CatalogSearchItem[] }>(
        `/api/v1/catalog/search?q=${encodeURIComponent(termo)}`,
      );
      return res.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}
