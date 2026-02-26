import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Users,
  TrendingUp,
  MapPin,
  Heart,
  Activity,
} from "lucide-react";
import { StatCard } from "@/components/charts/stat-card";
import { BarChart } from "@/components/charts/bar-chart";
import { PieChart } from "@/components/charts/pie-chart";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatMonths } from "@/lib/formatters";
import { useCompany, useCompanyIntelligence } from "@/api/hooks/use-companies";

export const Route = createFileRoute("/companies/$id")({
  component: CompanyDetailPage,
});

function CompanyDetailPage() {
  const { id } = Route.useParams();
  const { data: company, isLoading: companyLoading } = useCompany(id);
  const { data: intel, isLoading: intelLoading } = useCompanyIntelligence(id);

  const isLoading = companyLoading || intelLoading;
  const companyName =
    intel?.company?.snapshot?.name ?? company?.snapshot?.name ?? "Company";

  if (isLoading) {
    return (
      <div className="flex flex-col">
        <Header title="Company Intelligence" />
        <div className="space-y-6 p-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!intel) {
    return (
      <div className="flex flex-col">
        <Header title="Company Intelligence" />
        <div className="p-6">
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No intelligence data available for this company.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Header
        title={companyName}
        description="Company intelligence and workforce analytics"
        actions={
          company?.snapshot?.industry ? (
            <Badge variant="secondary">{company.snapshot.industry}</Badge>
          ) : undefined
        }
      />

      <div className="flex-1 space-y-6 p-6">
        {/* KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Headcount"
            value={formatNumber(intel.headcount)}
            description="Known employees in network"
            icon={Users}
          />
          <StatCard
            title="Avg Tenure"
            value={formatMonths(intel.avgTenureMonths)}
            description="Average employee tenure"
            icon={Activity}
          />
          <StatCard
            title="Recent Hires"
            value={formatNumber(intel.recentHires)}
            description="New hires detected"
            icon={Heart}
          />
          <StatCard
            title="Hiring Velocity"
            value={formatNumber(intel.hiringVelocity)}
            description="Hires per period"
            icon={TrendingUp}
          />
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 lg:grid-cols-2">
          {intel.seniorityDistribution &&
          intel.seniorityDistribution.length > 0 ? (
            <BarChart
              title="Seniority Distribution"
              data={intel.seniorityDistribution}
              nameKey="tier"
              dataKey="count"
              layout="vertical"
            />
          ) : (
            <EmptyCard title="Seniority Distribution" />
          )}

          {intel.departmentDistribution &&
          intel.departmentDistribution.length > 0 ? (
            <PieChart
              title="Department Distribution"
              data={intel.departmentDistribution}
              nameKey="department"
              dataKey="count"
            />
          ) : (
            <EmptyCard title="Department Distribution" />
          )}
        </div>

        {/* Decision Makers */}
        {intel.decisionMakers && intel.decisionMakers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Decision Makers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">Name</th>
                      <th className="pb-2 pr-4 font-medium">Title</th>
                      <th className="pb-2 font-medium">Seniority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intel.decisionMakers.map((dm) => (
                      <tr key={dm.personId} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <Link
                            to="/people/$id"
                            params={{ id: dm.personId }}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {dm.name}
                          </Link>
                        </td>
                        <td className="py-2 pr-4">{dm.title}</td>
                        <td className="py-2">
                          <Badge variant="secondary">{dm.seniority}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Geography */}
        {intel.geographyDistribution &&
          intel.geographyDistribution.length > 0 && (
            <BarChart
              title="Geography Distribution"
              data={intel.geographyDistribution}
              nameKey="location"
              dataKey="count"
              layout="vertical"
            />
          )}

        {/* Hires & Departures summary */}
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            title="Recent Hires"
            value={formatNumber(intel.recentHires)}
            description="New employees detected in recent observations"
            icon={TrendingUp}
          />
          <StatCard
            title="Recent Departures"
            value={formatNumber(intel.recentDepartures)}
            description="Employees who have left the company"
            icon={MapPin}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyCard({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        No data available
      </CardContent>
    </Card>
  );
}
