import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { ExportJob, QueryRequest } from "../types";

export function useCreateExport(
  collection: "people" | "companies" | "locations",
  format: "csv" | "json",
) {
  return useMutation({
    mutationFn: (query?: QueryRequest) =>
      apiFetch<ExportJob>(`/api/export/${collection}/${format}`, {
        method: "POST",
        body: JSON.stringify(query ?? {}),
      }),
  });
}

export function useExportStatus(jobId: string | undefined) {
  return useQuery({
    queryKey: ["export", "status", jobId],
    queryFn: () => apiFetch<ExportJob>(`/api/export/status/${jobId!}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 2000 : false;
    },
  });
}
