import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Users, Download } from "lucide-react";
import { Header } from "@/components/layout/header";
import { StatCard } from "@/components/charts/stat-card";
import { BarChart } from "@/components/charts/bar-chart";
import { PieChart } from "@/components/charts/pie-chart";
import { TrendIndicator } from "@/components/charts/trend-indicator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNetworkProfile, useNetworkTrends, useEnrichmentGaps } from "@/api/hooks/use-insights";
import { useSeniorityDistribution, useSeniorityStats } from "@/api/hooks/use-seniority";
import { formatNumber, formatPercent } from "@/lib/formatters";

export const Route = createFileRoute("/insights/")({
  component: InsightsPage,
});

function InsightsPage() {
  const [tab, setTab] = useState("network");

  return (
    <div className="flex flex-col">
      <Header
        title="Insights"
        description="Network analytics and enrichment intelligence"
      />
      <div className="p-6 space-y-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="network">Network</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="seniority">Seniority</TabsTrigger>
            <TabsTrigger value="enrichment">Enrichment Gaps</TabsTrigger>
          </TabsList>

          <TabsContent value="network">
            <NetworkTab />
          </TabsContent>
          <TabsContent value="trends">
            <TrendsTab />
          </TabsContent>
          <TabsContent value="seniority">
            <SeniorityTab />
          </TabsContent>
          <TabsContent value="enrichment">
            <EnrichmentTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function NetworkTab() {
  const { data, isLoading, error } = useNetworkProfile();

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorMessage message={error.message} />;
  if (!data) return null;

  const { totalConnections, distributions } = data;

  return (
    <div className="space-y-6 pt-4">
      <StatCard
        title="Total Connections"
        value={formatNumber(totalConnections)}
        icon={Users}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <BarChart
          title="Top Companies"
          data={distributions.company.slice(0, 10)}
          nameKey="name"
          dataKey="count"
        />
        <BarChart
          title="Seniority Distribution"
          data={distributions.seniority}
          nameKey="tier"
          dataKey="count"
        />
        <BarChart
          title="Top Titles"
          data={distributions.title.slice(0, 10)}
          nameKey="title"
          dataKey="count"
        />
        <BarChart
          title="Geography"
          data={distributions.geography.slice(0, 10)}
          nameKey="location"
          dataKey="count"
        />
        <PieChart
          title="Industry"
          data={distributions.industry.slice(0, 8)}
          nameKey="industry"
          dataKey="count"
        />
        <PieChart
          title="Department"
          data={distributions.department.slice(0, 8)}
          nameKey="department"
          dataKey="count"
        />
      </div>
    </div>
  );
}

function TrendsTab() {
  const { data, isLoading, error } = useNetworkTrends();

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorMessage message={error.message} />;
  if (!data) return null;

  const windowKeys = ["30d", "60d", "90d"] as const;

  return (
    <div className="space-y-6 pt-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {windowKeys.map((key) => {
          const window = data.windows[key];
          if (!window) return null;
          return (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="text-base">{key} Window</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-2xl font-bold">
                  {formatNumber(window.total)}
                </div>
                <TrendIndicator value={window.growthRate} label="growth" />
                {window.insights.length > 0 && (
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {window.insights.map((insight, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
                        {insight}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SeniorityTab() {
  const distribution = useSeniorityDistribution();
  const stats = useSeniorityStats();

  if (distribution.isLoading || stats.isLoading) return <LoadingSkeleton />;
  if (distribution.error) return <ErrorMessage message={distribution.error.message} />;
  if (stats.error) return <ErrorMessage message={stats.error.message} />;

  return (
    <div className="space-y-6 pt-4">
      {distribution.data?.tiers && (
        <BarChart
          title="Seniority Distribution"
          data={distribution.data.tiers}
          nameKey="tier"
          dataKey="count"
          layout="vertical"
        />
      )}

      {stats.data?.topCompanies && stats.data.topCompanies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Top Companies with Senior Leaders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium">Company</th>
                  <th className="pb-2 font-medium text-right">
                    Senior Leaders
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.data.topCompanies.map((row) => (
                  <tr key={row.company} className="border-b last:border-0">
                    <td className="py-2">{row.company}</td>
                    <td className="py-2 text-right">
                      {row.seniorLeaderCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EnrichmentTab() {
  const { data, isLoading, error } = useEnrichmentGaps();

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorMessage message={error.message} />;
  if (!data) return null;

  const sorted = [...data.fields].sort(
    (a, b) => b.percentMissing - a.percentMissing,
  );

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {formatNumber(data.totalPeople)} people analyzed
        </p>
        <Button variant="outline" size="sm" asChild>
          <a
            href="/api/insights/enrichment-gaps/revisit-list"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download className="mr-2 h-4 w-4" />
            Download Revisit List
          </a>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {sorted.map((field) => (
            <div key={field.field} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>{field.field}</span>
                <span className="text-muted-foreground">
                  {formatPercent(field.percentMissing)} missing (
                  {formatNumber(field.missing)})
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-destructive/70"
                  style={{ width: `${Math.min(field.percentMissing, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 pt-4">
      <Skeleton className="h-24 w-64" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mt-4">
      <p className="text-sm text-destructive">Failed to load data: {message}</p>
    </div>
  );
}
