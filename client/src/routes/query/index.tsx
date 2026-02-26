import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Search,
  Plus,
  X,
  Play,
  FileDown,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useQueryPeople } from "@/api/hooks/use-query";
import { useCreateExport } from "@/api/hooks/use-export";
import {
  ALLOWED_FILTER_FIELDS,
  ALLOWED_SORT_FIELDS,
  FILTER_OPERATORS,
  FIELD_LABELS,
} from "@/lib/constants";
import type { QueryRequest, Person } from "@/api/types";

export const Route = createFileRoute("/query/")({
  component: QueryPage,
});

interface FilterRow {
  field: string;
  operator: string;
  value: string;
}

function QueryPage() {
  const [filters, setFilters] = useState<FilterRow[]>([
    { field: "", operator: "$eq", value: "" },
  ]);
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [limit, setLimit] = useState(20);
  const [showJson, setShowJson] = useState(false);

  const queryMutation = useQueryPeople();
  const exportMutation = useCreateExport("people", "csv");

  function updateFilter(index: number, patch: Partial<FilterRow>) {
    setFilters((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addFilter() {
    setFilters((prev) => [...prev, { field: "", operator: "$eq", value: "" }]);
  }

  function removeFilter(index: number) {
    setFilters((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function buildQuery(): QueryRequest {
    const mongoFilter: Record<string, unknown> = {};
    for (const row of filters) {
      if (!row.field || !row.value) continue;
      if (row.operator === "$in" || row.operator === "$nin") {
        mongoFilter[row.field] = {
          [row.operator]: row.value.split(",").map((v) => v.trim()),
        };
      } else if (row.operator === "$exists") {
        mongoFilter[row.field] = { $exists: row.value === "true" };
      } else {
        mongoFilter[row.field] = { [row.operator]: row.value };
      }
    }
    return {
      filters: mongoFilter,
      sort: sortField ? { [sortField]: sortDir } : undefined,
      limit,
    };
  }

  function handleRun() {
    queryMutation.mutate(buildQuery());
  }

  function handleExport() {
    exportMutation.mutate(buildQuery());
  }

  const query = buildQuery();
  const results = queryMutation.data?.data as Person[] | undefined;

  return (
    <div className="flex flex-col">
      <Header
        title="Query Builder"
        description="Build and run MongoDB queries against people"
      />
      <div className="p-6 space-y-6">
        {/* Filter builder */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {filters.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                {/* Field */}
                <Select
                  value={row.field}
                  onValueChange={(v) => updateFilter(i, { field: v })}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Select field..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ALLOWED_FILTER_FIELDS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {FIELD_LABELS[f] ?? f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Operator */}
                <Select
                  value={row.operator}
                  onValueChange={(v) => updateFilter(i, { operator: v })}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILTER_OPERATORS.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Value */}
                <Input
                  placeholder="Value..."
                  value={row.value}
                  onChange={(e) => updateFilter(i, { value: e.target.value })}
                  className="flex-1"
                />

                {/* Remove */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFilter(i)}
                  disabled={filters.length <= 1}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={addFilter}>
              <Plus className="mr-1 h-4 w-4" />
              Add Filter
            </Button>
          </CardContent>
        </Card>

        {/* Sort + Limit */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">Sort By</span>
            <Select value={sortField} onValueChange={setSortField}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="No sorting" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No sorting</SelectItem>
                {ALLOWED_SORT_FIELDS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FIELD_LABELS[f] ?? f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {sortField && sortField !== "none" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortDir((d) => (d === 1 ? -1 : 1))}
              className="h-9"
            >
              <ArrowUpDown className="mr-1 h-4 w-4" />
              {sortDir === 1 ? "Ascending" : "Descending"}
            </Button>
          )}

          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">Limit</span>
            <Select
              value={String(limit)}
              onValueChange={(v) => setLimit(Number(v))}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[20, 50, 100, 500].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* JSON Preview */}
        <Card>
          <CardHeader
            className="cursor-pointer"
            onClick={() => setShowJson((v) => !v)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Query Preview</CardTitle>
              {showJson ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          </CardHeader>
          {showJson && (
            <CardContent>
              <pre className="overflow-auto rounded-md bg-muted p-4 text-xs">
                {JSON.stringify(query, null, 2)}
              </pre>
            </CardContent>
          )}
        </Card>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <Button onClick={handleRun} disabled={queryMutation.isPending}>
            <Play className="mr-1 h-4 w-4" />
            {queryMutation.isPending ? "Running..." : "Run Query"}
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={exportMutation.isPending}
          >
            <FileDown className="mr-1 h-4 w-4" />
            {exportMutation.isPending ? "Exporting..." : "Export CSV"}
          </Button>
          {exportMutation.data?.jobId && (
            <span className="text-xs text-muted-foreground">
              Export job: {exportMutation.data.jobId} ({exportMutation.data.status})
            </span>
          )}
        </div>

        {/* Error */}
        {queryMutation.error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">
              Query failed: {queryMutation.error.message}
            </p>
          </div>
        )}

        {/* Loading */}
        {queryMutation.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {/* Results table */}
        {results && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                <Search className="inline h-4 w-4 mr-1" />
                {results.length} result{results.length !== 1 ? "s" : ""}{" "}
                {queryMutation.data?.total != null &&
                  `of ${queryMutation.data.total} total`}
              </p>
            </div>

            <div className="overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Title</th>
                    <th className="px-3 py-2 text-left font-medium">Company</th>
                    <th className="px-3 py-2 text-left font-medium">Location</th>
                    <th className="px-3 py-2 text-left font-medium">Industry</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((person) => (
                    <tr key={person._id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {person.snapshot?.fullName ??
                          ([person.snapshot?.firstName, person.snapshot?.lastName]
                            .filter(Boolean)
                            .join(" ") || person._id)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {person.snapshot?.currentTitle ?? "--"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {person.snapshot?.currentCompany ?? "--"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {person.snapshot?.location ?? "--"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {person.snapshot?.industry ?? "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
