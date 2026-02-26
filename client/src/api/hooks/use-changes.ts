import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { Change } from "../types";

interface ChangesResponse {
  success: boolean;
  data: Change[];
  total: number;
  limit: number;
  offset: number;
}

export function useRecentChanges(params?: {
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["changes", params],
    queryFn: () => {
      const search = new URLSearchParams();
      if (params?.limit) search.set("limit", String(params.limit));
      if (params?.offset) search.set("offset", String(params.offset));
      const qs = search.toString();
      return apiFetch<ChangesResponse>(`/api/changes/${qs ? `?${qs}` : ""}`);
    },
    staleTime: 30_000,
  });
}
