import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type {
  DashboardHealth,
  ThroughputData,
  DataQuality,
  DataCleanliness,
} from "../types";

export function useDashboard() {
  return useQuery({
    queryKey: ["health", "dashboard"],
    queryFn: () => apiFetch<DashboardHealth>("/api/health/dashboard"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useThroughput() {
  return useQuery({
    queryKey: ["health", "throughput"],
    queryFn: () => apiFetch<ThroughputData>("/api/health/throughput"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useIngestionHealth() {
  return useQuery({
    queryKey: ["health", "ingestion"],
    queryFn: () => apiFetch<Record<string, unknown>>("/api/health/ingestion"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useParityHealth() {
  return useQuery({
    queryKey: ["health", "parity"],
    queryFn: () => apiFetch<Record<string, unknown>>("/api/health/parity"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMetrics() {
  return useQuery({
    queryKey: ["health", "metrics"],
    queryFn: () => apiFetch<Record<string, unknown>>("/api/health/metrics"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useCoverageBreakdown() {
  return useQuery({
    queryKey: ["health", "coverage-breakdown"],
    queryFn: () =>
      apiFetch<Record<string, unknown>>("/api/health/coverage-breakdown"),
    staleTime: 60_000,
  });
}

export function useCanonicalCoverage() {
  return useQuery({
    queryKey: ["health", "canonical-coverage"],
    queryFn: () =>
      apiFetch<Record<string, unknown>>("/api/health/canonical-coverage"),
    staleTime: 60_000,
  });
}

export function useCompanyCoverage() {
  return useQuery({
    queryKey: ["health", "company-coverage"],
    queryFn: () =>
      apiFetch<Record<string, unknown>>("/api/health/company-coverage"),
    staleTime: 60_000,
  });
}

export function useLocationCoverage() {
  return useQuery({
    queryKey: ["health", "location-coverage"],
    queryFn: () =>
      apiFetch<Record<string, unknown>>("/api/health/location-coverage"),
    staleTime: 60_000,
  });
}

export function useDataQuality() {
  return useQuery({
    queryKey: ["health", "data-quality"],
    queryFn: () => apiFetch<DataQuality>("/api/health/data-quality"),
    staleTime: 60_000,
  });
}

export function useQualityDashboard() {
  return useQuery({
    queryKey: ["health", "quality"],
    queryFn: () => apiFetch<Record<string, unknown>>("/api/health/quality"),
    staleTime: 60_000,
  });
}

export function useDataCleanliness() {
  return useQuery({
    queryKey: ["health", "data-cleanliness"],
    queryFn: () => apiFetch<DataCleanliness>("/api/health/data-cleanliness"),
    staleTime: 60_000,
  });
}
