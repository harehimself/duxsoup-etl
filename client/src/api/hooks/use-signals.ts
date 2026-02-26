import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { Signal } from "../types";

interface SignalParams {
  type?: string[];
  minRank?: number;
  company?: string;
  days?: number;
  limit?: number;
  offset?: number;
}

interface SignalsResponse {
  success: boolean;
  data: Signal[];
  total: number;
  limit: number;
  offset: number;
}

export function useSignals(params?: SignalParams) {
  return useQuery({
    queryKey: ["signals", params],
    queryFn: () => {
      const search = new URLSearchParams();
      if (params?.type?.length) search.set("type", params.type.join(","));
      if (params?.minRank) search.set("minRank", String(params.minRank));
      if (params?.company) search.set("company", params.company);
      if (params?.days) search.set("days", String(params.days));
      if (params?.limit) search.set("limit", String(params.limit));
      if (params?.offset) search.set("offset", String(params.offset));
      const qs = search.toString();
      return apiFetch<SignalsResponse>(`/api/signals/${qs ? `?${qs}` : ""}`);
    },
    staleTime: 30_000,
  });
}
