import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { SeniorityDistribution, SeniorityStats } from "../types";

export function useSeniorityDistribution() {
  return useQuery({
    queryKey: ["seniority", "distribution"],
    queryFn: () =>
      apiFetch<{ success: boolean; data: SeniorityDistribution }>(
        "/api/seniority/distribution",
      ),
    staleTime: 300_000,
    select: (res) => res.data,
  });
}

export function useSeniorityStats() {
  return useQuery({
    queryKey: ["seniority", "stats"],
    queryFn: () =>
      apiFetch<{ success: boolean; data: SeniorityStats }>(
        "/api/seniority/stats",
      ),
    staleTime: 300_000,
    select: (res) => res.data,
  });
}
