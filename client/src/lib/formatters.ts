import { formatDistanceToNow, format, parseISO } from "date-fns";

export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "MMM d, yyyy");
}

export function formatDateTime(
  date: string | Date | undefined | null,
): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "MMM d, yyyy h:mm a");
}

export function formatRelativeTime(
  date: string | Date | undefined | null,
): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? parseISO(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatNumber(n: number | undefined | null): string {
  if (n == null) return "N/A";
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatCompactNumber(n: number | undefined | null): string {
  if (n == null) return "N/A";
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
}

export function formatPercent(
  n: number | undefined | null,
  decimals = 1,
): string {
  if (n == null) return "N/A";
  return `${n.toFixed(decimals)}%`;
}

export function formatMonths(months: number | undefined | null): string {
  if (months == null) return "N/A";
  if (months < 12) return `${Math.round(months)}mo`;
  const years = Math.floor(months / 12);
  const remaining = Math.round(months % 12);
  return remaining > 0 ? `${years}y ${remaining}mo` : `${years}y`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + "\u2026";
}
