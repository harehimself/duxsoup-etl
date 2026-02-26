import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  User,
  Mail,
  Phone,
  Globe,
  Briefcase,
  GraduationCap,
  MapPin,
  Calendar,
  ExternalLink,
  ChevronLeft,
  ArrowRight,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  usePerson,
  usePersonTimeline,
  usePersonChanges,
} from "@/api/hooks/use-people";
import {
  formatDate,
  formatRelativeTime,
  formatNumber,
  formatMonths,
} from "@/lib/formatters";
import type {
  PersonSnapshot,
  PersonDerived,
  PersonMeta,
  PersonRole,
  PersonEducation,
  TimelineEvent,
  Change,
} from "@/api/types";

export const Route = createFileRoute("/people/$id")({
  component: PersonDetailPage,
});

function PersonDetailPage() {
  const { id } = Route.useParams();
  const { data: person, isLoading, isError } = usePerson(id);

  if (isLoading) {
    return (
      <div className="flex flex-col">
        <Header title="Person" />
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !person) {
    return (
      <div className="flex flex-col">
        <Header title="Person" />
        <div className="p-6">
          <Card>
            <CardContent className="py-12 text-center text-destructive">
              Failed to load person. The profile may not exist.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const s = person.snapshot;
  const d = person.derived;

  return (
    <div className="flex flex-col">
      <Header
        title={s?.fullName ?? "Unknown"}
        description={
          [s?.currentTitle, s?.currentCompany].filter(Boolean).join(" at ") ||
          undefined
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/people">
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
        }
      />

      <div className="p-6">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="career">Career</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab snapshot={s} derived={d} meta={person.meta} />
          </TabsContent>

          <TabsContent value="career">
            <CareerTab roles={s?.roles} education={s?.education} />
          </TabsContent>

          <TabsContent value="activity">
            <ActivityTab personId={id} />
          </TabsContent>

          <TabsContent value="changes">
            <ChangesTab personId={id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview Tab                                                        */
/* ------------------------------------------------------------------ */

function OverviewTab({
  snapshot: s,
  derived: d,
  meta,
}: {
  snapshot: PersonSnapshot;
  derived?: PersonDerived;
  meta?: PersonMeta;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 mt-4">
      {/* Profile header */}
      <Card className="md:col-span-2">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            {s?.profilePicture ? (
              <img
                src={s.profilePicture}
                alt={s?.fullName ?? "Profile"}
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <User className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">{s?.fullName ?? "Unknown"}</h2>
              <p className="text-muted-foreground">
                {[s?.currentTitle, s?.currentCompany].filter(Boolean).join(" at ") || "N/A"}
              </p>
              {s?.location && (
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {s.city && s.state ? `${s.city}, ${s.state}` : s.location}
                </p>
              )}
              <div className="flex items-center gap-2 pt-1">
                {s?.parsedSeniority && (
                  <Badge variant="secondary">{s.parsedSeniority}</Badge>
                )}
                {s?.parsedDepartment && (
                  <Badge variant="outline">{s.parsedDepartment}</Badge>
                )}
                {s?.industry && (
                  <Badge variant="outline">{s.industry}</Badge>
                )}
                {s?.degree && (
                  <Badge variant="outline">{s.degree} connection</Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contact info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ContactRow icon={Mail} label="Email" value={s?.email} />
          <ContactRow icon={Phone} label="Phone" value={s?.phone} />
          <ContactRow icon={Globe} label="Twitter" value={s?.twitter} />
          <ContactRow
            icon={Globe}
            label="Personal Website"
            value={s?.personalWebsite}
            href={s?.personalWebsite}
          />
          <ContactRow
            icon={Globe}
            label="Company Website"
            value={s?.companyWebsite}
            href={s?.companyWebsite}
          />
          {s?.connections != null && (
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Connections:</span>
              <span>{formatNumber(s.connections)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Derived metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Metrics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <MetricRow label="Avg Tenure" value={formatMonths(d?.avgTenureMonths)} />
          <MetricRow
            label="Years at Current Company"
            value={d?.yearsAtCurrentCompany != null ? `${d.yearsAtCurrentCompany.toFixed(1)}y` : "N/A"}
          />
          <MetricRow label="Highest Seniority" value={d?.highestSeniority ?? "N/A"} />
          {d?.highestSeniorityRoleTitle && (
            <MetricRow
              label="Highest Role"
              value={`${d.highestSeniorityRoleTitle}${d.highestSeniorityRoleCompany ? ` at ${d.highestSeniorityRoleCompany}` : ""}`}
            />
          )}
          <Separator />
          <MetricRow
            label="Last Observed"
            value={formatRelativeTime(meta?.lastObservedAt)}
          />
          <MetricRow
            label="Total Observations"
            value={formatNumber(meta?.observationsCount)}
          />
        </CardContent>
      </Card>

      {/* Summary */}
      {s?.summary && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-line">
              {s.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Skills */}
      {s?.skills && s.skills.length > 0 && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Skills ({s.skills.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {s.skills.map((skill) => (
                <Badge key={skill} variant="secondary">
                  {skill}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string | null;
  href?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline flex items-center gap-1"
        >
          {value}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Career Tab                                                          */
/* ------------------------------------------------------------------ */

function CareerTab({
  roles,
  education,
}: {
  roles?: PersonRole[];
  education?: PersonEducation[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 mt-4">
      {/* Roles */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Briefcase className="h-4 w-4" />
            Experience ({roles?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!roles || roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No roles recorded
            </p>
          ) : (
            <div className="space-y-4">
              {roles.map((role, i) => (
                <div key={i} className="relative pl-6 pb-4 last:pb-0">
                  {/* Timeline connector */}
                  {i < roles.length - 1 && (
                    <div className="absolute left-[9px] top-6 bottom-0 w-px bg-border" />
                  )}
                  <div className="absolute left-0 top-1.5 h-[18px] w-[18px] rounded-full border-2 border-border bg-background flex items-center justify-center">
                    {role.isCurrent && (
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {role.title ?? "Untitled Role"}
                      </span>
                      {role.isCurrent && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0">
                          Current
                        </Badge>
                      )}
                      {role.seniority && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {role.seniority}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {role.companyId ? (
                        <Link
                          to="/companies/$id"
                          params={{ id: role.companyId }}
                          className="text-primary hover:underline"
                        >
                          {role.companyName ?? "Unknown Company"}
                        </Link>
                      ) : (
                        role.companyName ?? "Unknown Company"
                      )}
                      {role.location && (
                        <span className="ml-2 text-muted-foreground">
                          - {role.location}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatRoleDateRange(role.startDate, role.endDate, role.isCurrent)}
                    </p>
                    {role.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {role.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Education */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GraduationCap className="h-4 w-4" />
            Education ({education?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!education || education.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No education recorded
            </p>
          ) : (
            <div className="space-y-4">
              {education.map((edu, i) => (
                <div key={i} className="space-y-1">
                  <p className="font-medium text-sm">
                    {edu.school ?? "Unknown School"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[edu.degree, edu.field].filter(Boolean).join(", ") || "N/A"}
                  </p>
                  {(edu.startDate || edu.endDate) && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatRoleDateRange(edu.startDate, edu.endDate)}
                    </p>
                  )}
                  {i < education.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatRoleDateRange(
  startDate?: string | null,
  endDate?: string | null,
  isCurrent?: boolean,
): string {
  const start = startDate ? formatDate(startDate) : "Unknown";
  const end = isCurrent ? "Present" : endDate ? formatDate(endDate) : "Unknown";
  return `${start} - ${end}`;
}

/* ------------------------------------------------------------------ */
/* Activity Tab                                                        */
/* ------------------------------------------------------------------ */

function ActivityTab({ personId }: { personId: string }) {
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const { data, isLoading, isError } = usePersonTimeline(personId, {
    limit,
    offset,
  });

  const events = data?.data ?? [];
  const total = data?.total ?? 0;

  if (isLoading) {
    return (
      <div className="mt-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center text-destructive">
          Failed to load timeline.
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center text-muted-foreground">
          No activity recorded.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          {events.map((event) => (
            <TimelineEventRow key={event.id} event={event} />
          ))}
        </CardContent>
      </Card>

      {total > limit && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
          </span>
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
      )}
    </div>
  );
}

function TimelineEventRow({ event }: { event: TimelineEvent }) {
  const variantMap: Record<string, "default" | "secondary" | "outline"> = {
    visit: "default",
    scan: "secondary",
    change: "outline",
  };

  return (
    <div className="flex items-start gap-3 pb-3 border-b last:border-0 last:pb-0">
      <Badge variant={variantMap[event.type] ?? "outline"} className="mt-0.5">
        {event.type}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          {event.type === "visit" && "Profile visited"}
          {event.type === "scan" && "Profile scanned"}
          {event.type === "change" && summarizeChangeEvent(event.data)}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatRelativeTime(event.timestamp)}
        </p>
      </div>
    </div>
  );
}

function summarizeChangeEvent(data: Record<string, unknown>): string {
  const field = data.field as string | undefined;
  const changeType = data.changeType as string | undefined;
  if (changeType && field) return `${changeType}: ${field}`;
  if (changeType) return changeType;
  return "Change detected";
}

/* ------------------------------------------------------------------ */
/* Changes Tab                                                         */
/* ------------------------------------------------------------------ */

function ChangesTab({ personId }: { personId: string }) {
  const { data, isLoading, isError } = usePersonChanges(personId);

  const changes = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="mt-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center text-destructive">
          Failed to load changes.
        </CardContent>
      </Card>
    );
  }

  if (changes.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-12 text-center text-muted-foreground">
          No changes detected.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          {changes.map((change) => (
            <ChangeRow key={change._id} change={change} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ChangeRow({ change }: { change: Change }) {
  return (
    <div className="flex items-start gap-3 pb-3 border-b last:border-0 last:pb-0">
      <Badge variant="outline" className="mt-0.5 whitespace-nowrap">
        {change.changeType}
      </Badge>
      <div className="flex-1 min-w-0 space-y-1">
        {change.field && (
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {change.field}
          </p>
        )}
        <div className="flex items-center gap-2 text-sm flex-wrap">
          {change.before && (
            <span className="text-muted-foreground line-through">
              {change.before}
            </span>
          )}
          {change.before && change.after && (
            <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          )}
          {change.after && <span className="font-medium">{change.after}</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          {formatRelativeTime(change.detectedAt)}
        </p>
      </div>
    </div>
  );
}
