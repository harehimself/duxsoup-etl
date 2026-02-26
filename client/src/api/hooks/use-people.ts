import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { Person, TimelineEvent, Change } from "../types";

export function usePerson(id: string | undefined) {
  return useQuery({
    queryKey: ["person", id],
    queryFn: () =>
      apiFetch<{ person: Person }>(`/api/people/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: 60_000,
    select: (data) => data.person,
  });
}

export function usePersonByAlias(value: string | undefined) {
  return useQuery({
    queryKey: ["person", "alias", value],
    queryFn: () =>
      apiFetch<{ person: Person }>(
        `/api/people/by-alias/${encodeURIComponent(value!)}`,
      ),
    enabled: !!value,
    staleTime: 60_000,
    select: (data) => data.person,
  });
}

export function usePersonTimeline(
  id: string | undefined,
  params?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: ["person", id, "timeline", params],
    queryFn: () => {
      const search = new URLSearchParams();
      if (params?.limit) search.set("limit", String(params.limit));
      if (params?.offset) search.set("offset", String(params.offset));
      const qs = search.toString();
      return apiFetch<{
        success: boolean;
        data: TimelineEvent[];
        total: number;
      }>(`/api/people/${encodeURIComponent(id!)}/timeline${qs ? `?${qs}` : ""}`);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function usePersonChanges(id: string | undefined) {
  return useQuery({
    queryKey: ["changes", "person", id],
    queryFn: () =>
      apiFetch<{ success: boolean; data: Change[] }>(
        `/api/changes/person/${encodeURIComponent(id!)}`,
      ),
    enabled: !!id,
    staleTime: 60_000,
  });
}
