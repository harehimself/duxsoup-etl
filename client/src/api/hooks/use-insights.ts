import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { NetworkProfile, NetworkTrends, EnrichmentGaps } from "../types";

export function useNetworkProfile() {
  return useQuery({
    queryKey: ["insights", "network-profile"],
    queryFn: () =>
      apiFetch<NetworkProfile>("/api/insights/network-profile"),
    staleTime: 300_000,
  });
}

export function useNetworkTrends() {
  return useQuery({
    queryKey: ["insights", "network-trends"],
    queryFn: () =>
      apiFetch<NetworkTrends>("/api/insights/network-profile/trends"),
    staleTime: 300_000,
  });
}

export function useEnrichmentGaps() {
  return useQuery({
    queryKey: ["insights", "enrichment-gaps"],
    queryFn: () =>
      apiFetch<EnrichmentGaps>("/api/insights/enrichment-gaps"),
    staleTime: 600_000,
  });
}
