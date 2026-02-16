import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface StatusChartProps {
  title: string;
  description?: string;
  data: Array<{ name: string; value: number; fill?: string; totalValue?: number }>;
  onBarClick?: (name: string) => void;
}

export function StatusChart({ title, description, data, onBarClick }: StatusChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  
  const formatCurrency = (valueInCents: number) => {
    const dollars = valueInCents / 100;
    if (dollars >= 1000000) {
      return `$${(dollars / 1000000).toFixed(1)}M`;
    } else if (dollars >= 1000) {
      return `$${(dollars / 1000).toFixed(0)}K`;
    }
    return `$${dollars.toFixed(0)}`;
  };
  
  const CustomXAxisTick = ({ x, y, payload }: any) => {
    const item = data.find(d => d.name === payload.value);
    const percentage = item && total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
    const count = item?.value || 0;
    const dollarValue = item?.totalValue ? formatCurrency(item.totalValue) : '';
    
    return (
      <g transform={`translate(${x},${y})`}>
        <text 
          x={0} 
          y={0} 
          dy={12} 
          textAnchor="middle" 
          className="fill-foreground text-xs"
        >
          {payload.value}
        </text>
        <text 
          x={0} 
          y={0} 
          dy={28} 
          textAnchor="middle" 
          className="fill-foreground text-xs"
        >
          {count.toLocaleString()} ({percentage}%)
        </text>
        {dollarValue && (
          <text 
            x={0} 
            y={0} 
            dy={44} 
            textAnchor="middle" 
            className="fill-muted-foreground text-xs"
          >
            {dollarValue}
          </text>
        )}
      </g>
    );
  };

  const handleBarClick = (data: any) => {
    if (onBarClick && data?.name) {
      onBarClick(data.name);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg" data-testid="text-active-pos-chart-title">{title}</CardTitle>
        {description && <CardDescription data-testid="text-active-pos-chart-description">{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={data} margin={{ bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis 
              dataKey="name" 
              tick={<CustomXAxisTick />}
              height={70}
              tickLine={false}
            />
            <YAxis 
              tick={{ fill: "hsl(var(--foreground))" }}
              className="text-xs" 
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
              }}
              labelStyle={{
                color: "hsl(var(--card-foreground))",
                fontWeight: 600,
              }}
              itemStyle={{
                color: "hsl(var(--muted-foreground))",
              }}
              formatter={(value: number, name: string, props: any) => {
                const item = data.find(d => d.name === props.payload.name);
                const dollarValue = item?.totalValue ? formatCurrency(item.totalValue) : '';
                return [
                  `${value.toLocaleString()} orders${dollarValue ? ` - ${dollarValue}` : ''} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
                  props.payload.name
                ];
              }}
            />
            <Bar 
              dataKey="value" 
              radius={[4, 4, 0, 0]}
              onClick={handleBarClick}
              cursor={onBarClick ? "pointer" : undefined}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill || "hsl(var(--primary))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
