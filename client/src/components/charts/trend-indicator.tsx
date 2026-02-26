import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrendIndicatorProps {
  value: number;
  label?: string;
  className?: string;
}

export function TrendIndicator({
  value,
  label,
  className,
}: TrendIndicatorProps) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const color =
    value > 0
      ? "text-green-500"
      : value < 0
        ? "text-red-500"
        : "text-muted-foreground";

  return (
    <div className={cn("flex items-center gap-1 text-sm", color, className)}>
      <Icon className="h-4 w-4" />
      <span>
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}%
      </span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </div>
  );
}
