import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Users,
  Building2,
  Eye,
  Activity,
  Search,
  Zap,
  ArrowRight,
} from "lucide-react";
import { useDashboard, useThroughput } from "@/api/hooks/use-health";
import { useSignals } from "@/api/hooks/use-signals";
import { StatCard } from "@/components/charts/stat-card";
import { AreaChart } from "@/components/charts/area-chart";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatNumber,
  formatCompactNumber,
  formatPercent,
  formatRelativeTime,
} from "@/lib/formatters";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

const signalTypeColors: Record<string, string> = {
  new_role: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  promotion:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  lateral_move:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  new_decision_maker:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
};

const signalTypeLabels: Record<string, string> = {
  new_role: "New Role",
  promotion: "Promotion",
  lateral_move: "Lateral Move",
  new_decision_maker: "Decision Maker",
};

function DashboardPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const dashboard = useDashboard();
  const throughput = useThroughput();
  const signals = useSignals({ limit: 5 });

  function handleSearch() {
    const q = searchQuery.trim();
    if (q) {
      void navigate({ to: "/people" });
    }
  }

  const isLoading = dashboard.isLoading;
  const isError = dashboard.isError;

  return (
    <div className="flex flex-col">
      <Header title="Dashboard" description="LinkedIn intelligence overview" />

      <div className="flex-1 space-y-6 p-6">
        {/* Quick Search */}
        <div className="flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search people..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              className="pl-9"
            />
          </div>
          <Button onClick={handleSearch} variant="default">
            <Search className="h-4 w-4" />
            Search
          </Button>
        </div>

        {/* Error State */}
        {isError && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-destructive">
                Failed to load dashboard data. Please check the API connection
                and try again.
              </p>
            </CardContent>
          </Card>
        )}

        {/* KPI Stat Cards */}
        {isLoading ? (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px]" />
            ))}
          </div>
        ) : dashboard.data ? (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total People"
              value={formatCompactNumber(dashboard.data.counts.people)}
              description={`${formatNumber(dashboard.data.counts.people)} profiles`}
              icon={Users}
            />
            <StatCard
              title="Companies"
              value={formatCompactNumber(dashboard.data.counts.companies)}
              description={`${formatNumber(dashboard.data.counts.companies)} tracked`}
              icon={Building2}
            />
            <StatCard
              title="Total Observations"
              value={formatCompactNumber(
                dashboard.data.counts.visits + dashboard.data.counts.scans,
              )}
              description={`${formatNumber(dashboard.data.counts.visits)} visits, ${formatNumber(dashboard.data.counts.scans)} scans`}
              icon={Eye}
            />
            <StatCard
              title="24h Activity"
              value={formatCompactNumber(
                dashboard.data.ingestion.last24h.visits +
                  dashboard.data.ingestion.last24h.scans,
              )}
              description={`${formatNumber(dashboard.data.ingestion.last24h.visits)} visits, ${formatNumber(dashboard.data.ingestion.last24h.scans)} scans`}
              icon={Activity}
            />
          </div>
        ) : null}

        {/* Ingestion + Throughput Row */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Ingestion Status */}
          {dashboard.data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ingestion Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Success Rate
                  </span>
                  <span className="text-2xl font-bold">
                    {formatPercent(dashboard.data.ingestion.successRate)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary">
                  <div
                    className="h-2 rounded-full bg-green-500 transition-all"
                    style={{
                      width: `${Math.min(100, dashboard.data.ingestion.successRate)}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    Database:{" "}
                    {dashboard.data.database.readyStateText ?? "Unknown"}
                  </span>
                  <span>
                    Dead letters:{" "}
                    {formatNumber(dashboard.data.counts.deadLetters)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Throughput Sparkline */}
          {throughput.data?.history && throughput.data.history.length > 0 ? (
            <AreaChart
              title="Throughput (1h)"
              data={throughput.data.history.map((h) => ({
                time: new Date(h.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                count: h.count,
              }))}
              dataKey="count"
              xKey="time"
              height={180}
            />
          ) : throughput.isLoading ? (
            <Skeleton className="h-[250px]" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Throughput (1h)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  No throughput data available yet.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recent Signals */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Recent Signals
            </CardTitle>
            <Link
              to="/signals"
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {signals.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : signals.data?.data && signals.data.data.length > 0 ? (
              <div className="space-y-3">
                {signals.data.data.map((signal, idx) => (
                  <div
                    key={`${signal.personId}-${signal.detectedAt}-${idx}`}
                    className="flex items-start justify-between gap-4 rounded-lg border p-3"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            signalTypeColors[signal.type] ?? "bg-muted"
                          }
                        >
                          {signalTypeLabels[signal.type] ?? signal.type}
                        </Badge>
                        <Link
                          to="/people/$id"
                          params={{ id: signal.personId }}
                          className="font-medium hover:underline truncate"
                        >
                          {signal.personName}
                        </Link>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {signal.previousTitle && signal.title
                          ? `${signal.previousTitle} → ${signal.title}`
                          : signal.title ?? ""}
                        {signal.company ? ` at ${signal.company}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatRelativeTime(signal.detectedAt)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No recent signals detected.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
