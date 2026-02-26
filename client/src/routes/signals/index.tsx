import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio, ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useSignals } from "@/api/hooks/use-signals";
import { SIGNAL_TYPES } from "@/lib/constants";
import { formatRelativeTime } from "@/lib/formatters";

export const Route = createFileRoute("/signals/")({
  component: SignalsPage,
});

const TYPE_STYLES: Record<string, string> = {
  new_role: "bg-blue-500/20 text-blue-400",
  promotion: "bg-green-500/20 text-green-400",
  lateral_move: "bg-yellow-500/20 text-yellow-400",
  new_decision_maker: "bg-purple-500/20 text-purple-400",
};

const TYPE_LABELS: Record<string, string> = {
  new_role: "New Role",
  promotion: "Promotion",
  lateral_move: "Lateral Move",
  new_decision_maker: "New Decision Maker",
};

const LIMIT = 20;

function SignalsPage() {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [minRank, setMinRank] = useState<string>("");
  const [company, setCompany] = useState("");
  const [days, setDays] = useState<string>("30");
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error } = useSignals({
    type: selectedTypes.length > 0 ? selectedTypes : undefined,
    minRank: minRank ? Number(minRank) : undefined,
    company: company || undefined,
    days: Number(days),
    limit: LIMIT,
    offset,
  });

  function toggleType(type: string) {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
    setOffset(0);
  }

  const total = data?.total ?? 0;
  const hasNext = offset + LIMIT < total;
  const hasPrev = offset > 0;

  return (
    <div className="flex flex-col">
      <Header
        title="Signals"
        description="Engagement triggers and career moves"
        actions={
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Radio className="h-4 w-4" />
            {total} signals
          </div>
        }
      />
      <div className="p-6 space-y-6">
        {/* Filter bar */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-6">
              {/* Type checkboxes */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Signal Type
                </Label>
                <div className="flex flex-wrap gap-3">
                  {SIGNAL_TYPES.map((type) => (
                    <div key={type} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`type-${type}`}
                        checked={selectedTypes.includes(type)}
                        onCheckedChange={() => toggleType(type)}
                      />
                      <Label htmlFor={`type-${type}`} className="text-sm cursor-pointer">
                        {TYPE_LABELS[type] ?? type}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Min seniority */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Min Seniority Rank
                </Label>
                <Select value={minRank} onValueChange={(v) => { setMinRank(v); setOffset(0); }}>
                  <SelectTrigger className="w-28">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Company filter */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Company
                </Label>
                <Input
                  placeholder="Filter by company..."
                  value={company}
                  onChange={(e) => { setCompany(e.target.value); setOffset(0); }}
                  className="w-48"
                />
              </div>

              {/* Days lookback */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Lookback
                </Label>
                <Select value={days} onValueChange={(v) => { setDays(v); setOffset(0); }}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[7, 14, 30, 60, 90].map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} days
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Signal cards */}
        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">
              Failed to load signals: {error.message}
            </p>
          </div>
        )}

        {data?.data && data.data.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No signals found for current filters.
          </p>
        )}

        {data?.data?.map((signal, idx) => (
          <Card key={`${signal.personId}-${signal.detectedAt}-${idx}`}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={TYPE_STYLES[signal.type] ?? "bg-muted text-muted-foreground"}
                      variant="outline"
                    >
                      {TYPE_LABELS[signal.type] ?? signal.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(signal.detectedAt)}
                    </span>
                  </div>

                  <div>
                    <Link
                      to="/people/$id"
                      params={{ id: signal.personId }}
                      className="font-medium hover:underline"
                    >
                      {signal.personName}
                    </Link>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {signal.previousTitle && (
                      <span>{signal.previousTitle}</span>
                    )}
                    {signal.previousTitle && signal.title && (
                      <ArrowRight className="h-3 w-3 shrink-0" />
                    )}
                    {signal.title && (
                      <span className="font-medium text-foreground">
                        {signal.title}
                      </span>
                    )}
                    {signal.company && (
                      <>
                        <span>at</span>
                        {signal.companyId ? (
                          <Link
                            to="/companies/$id"
                            params={{ id: signal.companyId }}
                            className="hover:underline text-foreground"
                          >
                            {signal.company}
                          </Link>
                        ) : (
                          <span className="text-foreground">
                            {signal.company}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {signal.actionContext && (
                    <p className="text-xs text-muted-foreground italic">
                      {signal.actionContext}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {offset + 1}--{Math.min(offset + LIMIT, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setOffset(offset + LIMIT)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
