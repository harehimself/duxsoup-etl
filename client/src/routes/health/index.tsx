import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Database,
  Trash2,
  Building2,
  Users,
  AlertTriangle,
} from "lucide-react";
import { StatCard } from "@/components/charts/stat-card";
import { AreaChart } from "@/components/charts/area-chart";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatPercent } from "@/lib/formatters";
import {
  useDashboard,
  useThroughput,
  useDataQuality,
  useQualityDashboard,
  useDataCleanliness,
  useParityHealth,
  useIngestionHealth,
} from "@/api/hooks/use-health";

export const Route = createFileRoute("/health/")({
  component: HealthPage,
});

function LoadingGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}

// --- Overview Tab ---

function OverviewTab() {
  const { data: dashboard, isLoading: dashLoading } = useDashboard();
  const { data: throughput, isLoading: tpLoading } = useThroughput();

  if (dashLoading) return <LoadingGrid count={5} />;

  const summary = dashboard?.summary;
  const ingestion = dashboard?.ingestion;
  const isHealthy = ingestion?.status === "healthy";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-3 w-3 rounded-full ${isHealthy ? "bg-green-500" : "bg-red-500"}`}
        />
        <span className="text-sm font-medium">
          {isHealthy ? "Healthy" : "Unhealthy"}
        </span>
        {ingestion && (
          <Badge variant="outline" className="ml-2">
            Status: {ingestion.status}
          </Badge>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total People"
          value={formatNumber(summary?.totalPeople)}
          icon={Users}
        />
        <StatCard
          title="Companies"
          value={formatNumber(summary?.totalCompanies)}
          icon={Building2}
        />
        <StatCard
          title="Observations"
          value={formatNumber(summary?.totalObservations)}
          icon={Activity}
        />
        <StatCard
          title="Dead Letters"
          value={formatNumber(ingestion?.deadLettersPending)}
          icon={Trash2}
          className={
            ingestion?.deadLettersPending && ingestion.deadLettersPending > 0
              ? "border-destructive/50"
              : undefined
          }
        />
      </div>

      {ingestion && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ingestion (Last 24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 text-sm">
              <div>
                Visits:{" "}
                <span className="font-semibold">
                  {formatNumber(ingestion.visits24h)}
                </span>
              </div>
              <div>
                Scans:{" "}
                <span className="font-semibold">
                  {formatNumber(ingestion.scans24h)}
                </span>
              </div>
              <div>
                Success Rate:{" "}
                <span className="font-semibold">
                  {formatPercent(ingestion.successRate24h)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tpLoading ? (
        <Skeleton className="h-52 w-full" />
      ) : throughput?.history && throughput.history.length > 0 ? (
        <AreaChart
          title="Throughput"
          data={throughput.history}
          dataKey="count"
          xKey="timestamp"
        />
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No throughput history available
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// --- Data Quality Tab ---

function DataQualityTab() {
  const { data, isLoading } = useDataQuality();

  if (isLoading) return <LoadingGrid count={2} />;
  if (!data) return <EmptyState message="No data quality information available" />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Field completeness across{" "}
        <span className="font-medium text-foreground">
          {formatNumber(data.totalPeople)}
        </span>{" "}
        people records
      </p>

      <div className="space-y-3">
        {data.fields.map((f) => (
          <div key={f.field} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium capitalize">
                {f.field.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <span className="text-muted-foreground">
                {formatPercent(f.percentPresent)} ({formatNumber(f.present)} /{" "}
                {formatNumber(f.present + f.missing)})
              </span>
            </div>
            <div className="h-2 w-full rounded bg-muted">
              <div
                className="h-2 rounded bg-primary"
                style={{ width: `${Math.min(f.percentPresent, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Structural Quality Tab ---

function StructuralQualityTab() {
  const { data, isLoading } = useQualityDashboard();

  if (isLoading) return <LoadingGrid count={2} />;
  if (!data) return <EmptyState message="No structural quality data available" />;

  return (
    <div className="space-y-4">
      {Object.entries(data).map(([section, value]) => (
        <Card key={section}>
          <CardHeader>
            <CardTitle className="text-base capitalize">
              {section.replace(/([A-Z])/g, " $1").trim()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {typeof value === "object" && value !== null ? (
              <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(value, null, 2)}
              </pre>
            ) : (
              <p className="text-sm">{String(value)}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// --- Data Cleanliness Tab ---

function DataCleanlinessTab() {
  const { data, isLoading } = useDataCleanliness();

  if (isLoading) return <LoadingGrid count={4} />;
  if (!data) return <EmptyState message="No data cleanliness information available" />;

  const issues = data.issues;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Data cleanliness issues across{" "}
        <span className="font-medium text-foreground">
          {formatNumber(data.totalPeople)}
        </span>{" "}
        people records
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Whitespace Issues"
          value={formatNumber(issues.whitespace)}
          description="Fields with leading/trailing whitespace"
          icon={AlertTriangle}
          className={issues.whitespace > 0 ? "border-yellow-500/50" : undefined}
        />
        <StatCard
          title="Invalid Emails"
          value={formatNumber(issues.invalidEmail)}
          description="Email fields that fail validation"
          icon={AlertTriangle}
          className={
            issues.invalidEmail > 0 ? "border-destructive/50" : undefined
          }
        />
        <StatCard
          title="Duplicate Skills"
          value={formatNumber(issues.duplicateSkills)}
          description="Records with duplicate skill entries"
          icon={AlertTriangle}
          className={
            issues.duplicateSkills > 0 ? "border-yellow-500/50" : undefined
          }
        />
        <StatCard
          title="Duplicate Education"
          value={formatNumber(issues.duplicateEducation)}
          description="Records with duplicate education entries"
          icon={AlertTriangle}
          className={
            issues.duplicateEducation > 0 ? "border-yellow-500/50" : undefined
          }
        />
      </div>

      {issues.missingFields &&
        Object.keys(issues.missingFields).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Missing Fields</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(issues.missingFields).map(([field, count]) => (
                  <div
                    key={field}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="capitalize">
                      {field.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                    <Badge variant="secondary">{formatNumber(count)}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  );
}

// --- Pipeline Tab ---

function PipelineTab() {
  const { data: parity, isLoading: parityLoading } = useParityHealth();
  const { data: ingestion, isLoading: ingestionLoading } = useIngestionHealth();
  const { data: dashboard } = useDashboard();

  if (parityLoading || ingestionLoading) return <LoadingGrid count={3} />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Dead Letters"
          value={formatNumber(dashboard?.ingestion?.deadLettersPending)}
          description="Failed person upserts queued for retry"
          icon={Trash2}
        />
      </div>

      {parity && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visit / Scan Parity</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(parity, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {ingestion && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ingestion Health</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
              {JSON.stringify(ingestion, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// --- Shared ---

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  );
}

// --- Main Page ---

function HealthPage() {
  return (
    <div className="flex flex-col">
      <Header
        title="System Health"
        description="Monitor pipeline health, data quality, and system metrics"
      />
      <div className="flex-1 space-y-6 p-6">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="data-quality">Data Quality</TabsTrigger>
            <TabsTrigger value="structural-quality">
              Structural Quality
            </TabsTrigger>
            <TabsTrigger value="data-cleanliness">Data Cleanliness</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="data-quality">
            <DataQualityTab />
          </TabsContent>
          <TabsContent value="structural-quality">
            <StructuralQualityTab />
          </TabsContent>
          <TabsContent value="data-cleanliness">
            <DataCleanlinessTab />
          </TabsContent>
          <TabsContent value="pipeline">
            <PipelineTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
