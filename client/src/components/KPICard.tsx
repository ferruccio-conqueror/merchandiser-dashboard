import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  description?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  variant?: "success" | "danger" | "neutral";
  className?: string;
}

export function KPICard({ 
  title, 
  value, 
  subtitle, 
  description, 
  trend, 
  trendValue, 
  variant, 
  className
}: KPICardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-muted-foreground";
  const valueColor = variant === "success" ? "text-green-600" : variant === "danger" ? "text-red-600" : "";

  return (
    <Card className={className} data-testid={`kpi-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-1 pt-4">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        {trend && trendValue && (
          <div className={`flex items-center gap-1 text-xs ${trendColor}`}>
            <TrendIcon className="h-3 w-3" />
            <span>{trendValue}</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="pb-4">
        <div className={`text-2xl font-semibold ${valueColor}`} data-testid={`kpi-value-${title.toLowerCase().replace(/\s+/g, '-')}`}>{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        {description && (
          <p className="text-[10px] text-muted-foreground/70 mt-2 leading-tight border-t border-border/50 pt-2">
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
