import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { Person } from "../types";

interface SearchResponse {
  success: boolean;
  data: Person[];
  total: number;
  limit: number;
  offset: number;
}

export function useSearch(
  query: string,
  params?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: ["search", query, params],
    queryFn: () => {
      const search = new URLSearchParams({ q: query });
      if (params?.limit) search.set("limit", String(params.limit));
      if (params?.offset) search.set("offset", String(params.offset));
      return apiFetch<SearchResponse>(`/api/search/?${search.toString()}`);
    },
    enabled: query.length >= 2,
    staleTime: 5_000,
  });
}
