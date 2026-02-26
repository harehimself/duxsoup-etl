import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BarChartProps {
  title?: string;
  data: Array<Record<string, unknown>>;
  dataKey: string;
  nameKey: string;
  color?: string;
  height?: number;
  layout?: "horizontal" | "vertical";
}

export function BarChart({
  title,
  data,
  dataKey,
  nameKey,
  color = "var(--color-chart-1)",
  height = 300,
  layout = "vertical",
}: BarChartProps) {
  const content = (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data}
        layout={layout}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        {layout === "vertical" ? (
          <>
            <XAxis type="number" className="text-xs" />
            <YAxis
              dataKey={nameKey}
              type="category"
              width={120}
              className="text-xs"
              tick={{ fontSize: 12 }}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey={nameKey}
              className="text-xs"
              tick={{ fontSize: 12 }}
            />
            <YAxis className="text-xs" />
          </>
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            color: "var(--color-popover-foreground)",
          }}
        />
        <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
      </RechartsBarChart>
    </ResponsiveContainer>
  );

  if (!title) return content;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
