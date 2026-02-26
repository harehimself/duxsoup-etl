import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { Company, CompanyIntelligence } from "../types";

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ["company", id],
    queryFn: () =>
      apiFetch<{ company: Company }>(
        `/api/companies/${encodeURIComponent(id!)}`,
      ),
    enabled: !!id,
    staleTime: 300_000,
    select: (data) => data.company,
  });
}

export function useCompanyByAlias(value: string | undefined) {
  return useQuery({
    queryKey: ["company", "alias", value],
    queryFn: () =>
      apiFetch<{ company: Company }>(
        `/api/companies/by-alias/${encodeURIComponent(value!)}`,
      ),
    enabled: !!value,
    staleTime: 300_000,
    select: (data) => data.company,
  });
}

export function useCompanyIntelligence(id: string | undefined) {
  return useQuery({
    queryKey: ["company", id, "intelligence"],
    queryFn: () =>
      apiFetch<{ success: boolean; data: CompanyIntelligence }>(
        `/api/companies/${encodeURIComponent(id!)}/intelligence`,
      ),
    enabled: !!id,
    staleTime: 300_000,
    select: (res) => res.data,
  });
}
