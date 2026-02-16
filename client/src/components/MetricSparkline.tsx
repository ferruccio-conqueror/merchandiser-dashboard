import { ResponsiveContainer, LineChart, Line } from "recharts";

interface SparklineDataPoint {
  month: string;
  value: number;
}

interface MetricSparklineProps {
  data: SparklineDataPoint[];
  invertTrendColor?: boolean;
  height?: number;
  className?: string;
}

export function MetricSparkline({ 
  data, 
  invertTrendColor = false,
  height = 32,
  className = ""
}: MetricSparklineProps) {
  if (!data || data.length < 2) {
    return null;
  }

  // Calculate actual trend direction from the data
  // Compare recent values (last 3 months avg) vs earlier values (first 3 months avg)
  const recentValues = data.slice(-3).map(d => d.value);
  const earlierValues = data.slice(0, 3).map(d => d.value);
  const recentAvg = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
  const earlierAvg = earlierValues.reduce((a, b) => a + b, 0) / earlierValues.length;
  
  // Determine if the sparkline trend is going up or down
  const actualTrendUp = recentAvg >= earlierAvg;
  
  // Determine color based on trend direction and inversion
  // For most metrics: up = good (green), down = bad (red)
  // For inverted metrics like "Avg Late Days": down = good (green), up = bad (red)
  const isGoodTrend = invertTrendColor ? !actualTrendUp : actualTrendUp;
  const strokeColor = isGoodTrend ? "#22c55e" : "#ef4444";

  return (
    <div className={`w-16 ${className}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={strokeColor}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
