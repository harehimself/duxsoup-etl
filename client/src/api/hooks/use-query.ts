import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { Person, QueryRequest, ApiResponse } from "../types";

export function useQueryPeople() {
  return useMutation({
    mutationFn: (query: QueryRequest) =>
      apiFetch<ApiResponse<Person[]>>("/api/query/people", {
        method: "POST",
        body: JSON.stringify(query),
      }),
  });
}

export function useQueryCompanies() {
  return useMutation({
    mutationFn: (query: QueryRequest) =>
      apiFetch<ApiResponse<unknown[]>>("/api/query/companies", {
        method: "POST",
        body: JSON.stringify(query),
      }),
  });
}
