import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch } from "../client";
import type { ExportJob, QueryRequest } from "../types";

export function useCreateExport(
  collection: "people" | "companies" | "locations",
  format: "csv" | "json",
) {
  return useMutation({
    mutationFn: async (query?: QueryRequest) => {
      const res = await apiFetch<{ success: boolean; data: ExportJob }>(
        `/api/export/${collection}/${format}`,
        {
          method: "POST",
          body: JSON.stringify(query ?? {}),
        },
      );
      return res.data;
    },
  });
}

export function useExportStatus(jobId: string | undefined) {
  return useQuery({
    queryKey: ["export", "status", jobId],
    queryFn: () =>
      apiFetch<{ success: boolean; data: ExportJob }>(
        `/api/export/status/${jobId!}`,
      ),
    enabled: !!jobId,
    select: (res) => res.data,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 2000 : false;
    },
  });
}
