import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearch } from "@/api/hooks/use-search";
import { formatRelativeTime, formatNumber } from "@/lib/formatters";

export const Route = createFileRoute("/people/")({
  component: PeoplePage,
});

function PeoplePage() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isError } = useSearch(debouncedQuery, {
    limit,
    offset,
  });

  const total = data?.total ?? 0;
  const people = data?.data ?? [];

  return (
    <div className="flex flex-col">
      <Header
        title="People"
        description={`${total > 0 ? formatNumber(total) + " profiles" : "Search your network"}`}
      />

      <div className="p-6 space-y-4">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search people by name, title, or company..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Results */}
        {debouncedQuery.length < 2 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Type at least 2 characters to search
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Card>
            <CardContent className="py-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="py-12 text-center text-destructive">
              Failed to load results. Please try again.
            </CardContent>
          </Card>
        ) : people.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No results found for "{debouncedQuery}"
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                        Name
                      </th>
                      <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                        Title
                      </th>
                      <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                        Company
                      </th>
                      <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                        Location
                      </th>
                      <th className="p-3 text-left text-sm font-medium text-muted-foreground">
                        Seniority
                      </th>
                      <th className="p-3 text-right text-sm font-medium text-muted-foreground">
                        Connections
                      </th>
                      <th className="p-3 text-right text-sm font-medium text-muted-foreground">
                        Last Seen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => (
                      <tr
                        key={person._id}
                        className="border-b hover:bg-muted/50 transition-colors"
                      >
                        <td className="p-3">
                          <Link
                            to="/people/$id"
                            params={{ id: person._id }}
                            className="font-medium text-primary hover:underline"
                          >
                            {person.snapshot?.fullName ?? "Unknown"}
                          </Link>
                        </td>
                        <td className="p-3 text-sm text-muted-foreground max-w-[200px] truncate">
                          {person.snapshot?.currentTitle ?? "N/A"}
                        </td>
                        <td className="p-3 text-sm">
                          {person.snapshot?.currentCompanyId ? (
                            <Link
                              to="/companies/$id"
                              params={{
                                id: person.snapshot.currentCompanyId,
                              }}
                              className="text-primary hover:underline"
                            >
                              {person.snapshot?.currentCompany ?? "N/A"}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              {person.snapshot?.currentCompany ?? "N/A"}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {person.snapshot?.city && person.snapshot?.state
                            ? `${person.snapshot.city}, ${person.snapshot.state}`
                            : person.snapshot?.location ?? "N/A"}
                        </td>
                        <td className="p-3">
                          {person.snapshot?.parsedSeniority ? (
                            <Badge variant="secondary">
                              {person.snapshot.parsedSeniority}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              N/A
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right text-sm text-muted-foreground">
                          {formatNumber(person.snapshot?.connections)}
                        </td>
                        <td className="p-3 text-right text-sm text-muted-foreground">
                          {formatRelativeTime(person.meta?.lastObservedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Pagination */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">
                  Showing {offset + 1}-{Math.min(offset + limit, total)} of{" "}
                  {formatNumber(total)}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Per page:
                  </span>
                  <Select
                    value={String(limit)}
                    onValueChange={(v) => {
                      setLimit(Number(v));
                      setOffset(0);
                    }}
                  >
                    <SelectTrigger className="w-[70px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset((o) => o + limit)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
