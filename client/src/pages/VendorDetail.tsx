import { useState, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/DataTable";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Mail, Phone, MapPin, User, TrendingUp, CheckCircle2, AlertTriangle, Package, Calendar, DollarSign, Clock, Gauge, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import type { Vendor, PurchaseOrder, SKU, Inspection, QualityTest } from "@shared/schema";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { VendorTimelineTemplates } from "@/components/VendorTimelineTemplates";

// Year/Month dropdown constants
const currentYear = new Date().getFullYear();
const YEARS = [currentYear - 2, currentYear - 1, currentYear];
const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

interface VendorPerformance {
  otdPercentage: number;
  totalOrders: number;
  onTimeOrders: number;
  lateOrders: number;
  firstTimeRightPercentage: number;
  totalInspections: number;
  passedFirstTime: number;
  failedFirstTime: number;
}

interface VendorYTDPerformance {
  ytdSummary: {
    totalOrders: number;
    onTimeOrders: number;
    lateOrders: number;
    atRiskOrders: number;
    otdPercentage: number;
  };
  monthlyData: Array<{
    month: string;
    monthNum: number;
    totalOrders: number;
    onTimeOrders: number;
    lateOrders: number;
    atRiskOrders: number;
    cumulativeTotal: number;
    cumulativeOnTime: number;
    cumulativeLate: number;
    cumulativeOtdPercentage: number;
  }>;
}

interface YoYSalesData {
  year: number;
  month: number;
  monthName: string;
  totalSales: number;
  orderCount: number;
}

interface VendorOtdYoY {
  year: number;
  month: number;
  monthName: string;
  shippedOnTime: number;
  totalShipped: number;
  otdPct: number;
  onTimeValue: number;
  totalValue: number;
  lateValue: number;
  otdValuePct: number;
  overdueUnshipped: number;
  overdueBacklogValue: number;
  revisedOtdPct: number;
  revisedOtdValuePct: number;
}

interface AggregatedPO {
  poNumber: string;
  copNumber: string | null;
  status: string;
  originalShipDate: string | null;
  revisedShipDate: string | null;
  orderQuantity: number;
  totalValue: number;
  lineItemCount: number;
}

export default function VendorDetail() {
  const { id } = useParams();

  // Default to YOY: start = Jan 1 of last year, end = current month
  const [startDate, setStartDate] = useState<Date | undefined>(() => {
    return new Date(currentYear - 1, 0, 1); // Jan 1 of previous year
  });
  const [endDate, setEndDate] = useState<Date | undefined>(() => {
    const today = new Date();
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return new Date(today.getFullYear(), today.getMonth(), lastDayOfMonth); // Last day of current month
  });

  // Build date params object for queries
  const dateParams = {
    startDate: startDate?.toISOString(),
    endDate: endDate?.toISOString(),
  };

  const { data: vendor, isLoading: vendorLoading } = useQuery<Vendor>({
    queryKey: ["/api/vendors", id],
  });

  const { data: performance, isLoading: perfLoading } = useQuery<VendorPerformance>({
    queryKey: ["/api/vendors", id, "performance", dateParams],
  });

  const { data: aggregatedPOs = [], isLoading: posLoading } = useQuery<AggregatedPO[]>({
    queryKey: ["/api/vendors", id, "aggregated-purchase-orders", dateParams],
  });

  const { data: skus = [] } = useQuery<SKU[]>({
    queryKey: ["/api/vendors", id, "skus"],
  });

  const { data: inspections = [] } = useQuery<Inspection[]>({
    queryKey: ["/api/vendors", id, "inspections", dateParams],
  });

  const { data: qualityTests = [] } = useQuery<QualityTest[]>({
    queryKey: ["/api/vendors", id, "quality-tests", dateParams],
  });

  const { data: ytdPerformance, isLoading: ytdLoading } = useQuery<VendorYTDPerformance>({
    queryKey: ["/api/vendors", id, "ytd-performance", dateParams],
  });

  // YoY Sales should NOT use date filters - always show all years to see business development
  const { data: yoySales = [], isLoading: yoySalesLoading } = useQuery<YoYSalesData[]>({
    queryKey: ["/api/vendors", id, "yoy-sales"],
  });

  // OTD YoY - always show all years for trend comparison
  const { data: otdYoY = [], isLoading: otdYoYLoading } = useQuery<VendorOtdYoY[]>({
    queryKey: ["/api/vendors", id, "otd-yoy"],
  });

  const hasDateFilter = startDate || endDate;
  const clearDateFilters = () => {
    setStartDate(undefined);
    setEndDate(undefined);
  };

  if (vendorLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Vendor not found</p>
      </div>
    );
  }

  const poColumns = [
    { 
      key: "poNumber", 
      label: "PO Number", 
      sortable: true,
      render: (value: string) => (
        <Link 
          href={`/purchase-orders/${value}`} 
          className="text-primary hover:underline font-medium"
          data-testid={`link-po-${value}`}
        >
          {value}
        </Link>
      )
    },
    { key: "copNumber", label: "COP Number", sortable: true },
    { 
      key: "status", 
      label: "Status", 
      render: (value: string) => <Badge variant="outline">{value}</Badge>
    },
    { 
      key: "revisedShipDate", 
      label: "Ship Date", 
      sortable: true,
      render: (value: string | null) => value ? format(new Date(value), "MM/dd/yyyy") : "-"
    },
    { key: "orderQuantity", label: "Quantity", sortable: true },
    { 
      key: "totalValue", 
      label: "Value", 
      sortable: true,
      render: (value: number) => `$${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    },
    { key: "lineItemCount", label: "Line Items", sortable: true },
  ];

  const skuColumns = [
    { key: "sku", label: "SKU", sortable: true },
    { key: "style", label: "Style", sortable: true },
    { key: "description", label: "Description" },
    { key: "category", label: "Category", sortable: true },
    { key: "productGroup", label: "Product Group", sortable: true },
  ];

  const inspectionColumns = [
    { key: "sku", label: "SKU", sortable: true },
    { key: "poNumber", label: "PO Number", sortable: true },
    { key: "inspectionType", label: "Type", sortable: true },
    { 
      key: "inspectionDate", 
      label: "Date", 
      sortable: true,
      render: (value: Date | null) => value ? format(new Date(value), "MM/dd/yyyy") : "-"
    },
    { 
      key: "result", 
      label: "Result", 
      render: (value: string) => {
        const variant = value?.toLowerCase() === "passed" ? "default" : value?.toLowerCase() === "failed" ? "destructive" : "secondary";
        return value ? <Badge variant={variant}>{value}</Badge> : "-";
      }
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-vendor-name">
            <Building2 className="h-6 w-6" />
            {vendor.name}
          </h1>
          <p className="text-muted-foreground">Complete vendor profile and performance metrics</p>
        </div>
        <Link href={`/capacity/${encodeURIComponent(vendor.name.split(' ')[0])}`}>
          <Button variant="outline" data-testid="button-view-capacity">
            <Gauge className="h-4 w-4 mr-2" />
            View Capacity
          </Button>
        </Link>
      </div>

      {/* Date Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Performance Date Range
            </h3>
            {hasDateFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearDateFilters}
                data-testid="button-clear-date-filters"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Start Period */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Start Period</label>
              <div className="flex gap-2">
                <Select
                  value={startDate ? String(startDate.getMonth() + 1) : ""}
                  onValueChange={(monthStr) => {
                    const month = parseInt(monthStr);
                    const year = startDate?.getFullYear() || currentYear;
                    setStartDate(new Date(year, month - 1, 1));
                  }}
                >
                  <SelectTrigger className="flex-1" data-testid="select-vendor-start-month">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label.slice(0, 3)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={startDate ? String(startDate.getFullYear()) : ""}
                  onValueChange={(yearStr) => {
                    const year = parseInt(yearStr);
                    const month = startDate ? startDate.getMonth() : 0;
                    setStartDate(new Date(year, month, 1));
                  }}
                >
                  <SelectTrigger className="w-24" data-testid="select-vendor-start-year">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* End Period */}
            <div className="space-y-2">
              <label className="text-sm font-medium">End Period</label>
              <div className="flex gap-2">
                <Select
                  value={endDate ? String(endDate.getMonth() + 1) : ""}
                  onValueChange={(monthStr) => {
                    const month = parseInt(monthStr);
                    const year = endDate?.getFullYear() || currentYear;
                    const lastDay = new Date(year, month, 0).getDate();
                    setEndDate(new Date(year, month - 1, lastDay));
                  }}
                >
                  <SelectTrigger className="flex-1" data-testid="select-vendor-end-month">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label.slice(0, 3)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={endDate ? String(endDate.getFullYear()) : ""}
                  onValueChange={(yearStr) => {
                    const year = parseInt(yearStr);
                    const month = endDate ? endDate.getMonth() + 1 : 12;
                    const lastDay = new Date(year, month, 0).getDate();
                    setEndDate(new Date(year, month - 1, lastDay));
                  }}
                >
                  <SelectTrigger className="w-24" data-testid="select-vendor-end-year">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Filter Info */}
            <div className="col-span-1 md:col-span-2 flex items-end">
              <p className="text-xs text-muted-foreground">
                {startDate && endDate ? (
                  <>Showing data from {format(startDate, "MMM yyyy")} to {format(endDate, "MMM yyyy")}</>
                ) : startDate ? (
                  <>Showing data from {format(startDate, "MMM yyyy")}</>
                ) : endDate ? (
                  <>Showing data through {format(endDate, "MMM yyyy")}</>
                ) : (
                  <>Select a date range to filter performance data</>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vendor Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {vendor.contactPerson && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Contact:</span>
                <span>{vendor.contactPerson}</span>
              </div>
            )}
            {vendor.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Email:</span>
                <span>{vendor.email}</span>
              </div>
            )}
            {vendor.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Phone:</span>
                <span>{vendor.phone}</span>
              </div>
            )}
            {vendor.country && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Country:</span>
                <span>{vendor.country}</span>
              </div>
            )}
            {vendor.merchandiser && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Merchandiser:</span>
                <span>{vendor.merchandiser}</span>
              </div>
            )}
            {vendor.merchandisingManager && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Manager:</span>
                <span>{vendor.merchandisingManager}</span>
              </div>
            )}
            <div className="pt-2">
              <Badge variant={vendor.status === "active" ? "default" : "secondary"}>
                {vendor.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Supplier Performance
            </CardTitle>
            <CardDescription>Quality and delivery metrics</CardDescription>
          </CardHeader>
          <CardContent>
            {(perfLoading || ytdLoading) ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (ytdPerformance || performance) ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-muted-foreground">On-Time Delivery</span>
                  </div>
                  <p className="text-2xl font-semibold" data-testid="text-otd-percentage">
                    {Number(ytdPerformance?.ytdSummary?.otdPercentage ?? 0).toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ytdPerformance?.ytdSummary?.onTimeOrders ?? 0} / {ytdPerformance?.ytdSummary?.totalOrders ?? 0} orders
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-blue-600" />
                    <span className="text-sm text-muted-foreground">First Time Right</span>
                  </div>
                  <p className="text-2xl font-semibold" data-testid="text-ftr-percentage">
                    {Number(performance?.firstTimeRightPercentage ?? 0).toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {performance?.passedFirstTime ?? 0} / {performance?.totalInspections ?? 0} inspections
                  </p>
                </div>

                {(ytdPerformance?.ytdSummary?.lateOrders ?? 0) > 0 && (
                  <div className="col-span-2 flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-950 rounded-lg border border-orange-200 dark:border-orange-800">
                    <AlertTriangle className="h-4 w-4 text-orange-600" />
                    <span className="text-sm">
                      {ytdPerformance?.ytdSummary?.lateOrders ?? 0} late order{(ytdPerformance?.ytdSummary?.lateOrders ?? 0) !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No performance data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Year-over-Year Sales Chart - Moved above table to show business development */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Year-over-Year Sales by Month
          </CardTitle>
          <CardDescription>Total sales comparison across years (all available data)</CardDescription>
        </CardHeader>
        <CardContent>
          {yoySalesLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : yoySales.length > 0 ? (
            (() => {
              const yearsSet = new Set<number>();
              yoySales.forEach(d => yearsSet.add(d.year));
              const years = Array.from(yearsSet).sort();
              const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const chartData = months.map((month, idx) => {
                const monthNum = idx + 1;
                const point: Record<string, string | number> = { month };
                years.forEach(year => {
                  const dataPoint = yoySales.find(d => d.year === year && d.month === monthNum);
                  point[`sales_${year}`] = dataPoint?.totalSales || 0;
                });
                return point;
              });
              const colors = ['#94a3b8', '#6b7280', '#22c55e', '#3b82f6', '#a855f7'];
              return (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-4 mb-4">
                    {years.map((year, idx) => {
                      const yearTotal = yoySales
                        .filter(d => d.year === year)
                        .reduce((sum, d) => sum + d.totalSales, 0);
                      const yearOrders = yoySales
                        .filter(d => d.year === year)
                        .reduce((sum, d) => sum + d.orderCount, 0);
                      return (
                        <div key={year} className="text-center p-3 bg-muted/50 rounded-lg min-w-[120px]">
                          <p className="text-sm text-muted-foreground">{year}</p>
                          <p className="text-xl font-bold" style={{ color: colors[idx % colors.length] }} data-testid={`text-year-sales-${year}`}>
                            ${(yearTotal / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </p>
                          <p className="text-xs text-muted-foreground">{yearOrders.toLocaleString()} orders</p>
                        </div>
                      );
                    })}
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis 
                        tick={{ fontSize: 12 }} 
                        tickFormatter={(value) => `$${(value / 100 / 1000).toFixed(0)}k`}
                      />
                      <Tooltip 
                        formatter={(value: number) => [`$${(value / 100).toLocaleString()}`, '']}
                        labelFormatter={(label) => `Month: ${label}`}
                      />
                      <Legend />
                      {years.map((year, idx) => (
                        <Line
                          key={year}
                          type="monotone"
                          dataKey={`sales_${year}`}
                          name={`${year}`}
                          stroke={colors[idx % colors.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })()
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No sales data available</p>
          )}
        </CardContent>
      </Card>

      {/* OTD Year-over-Year Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            On-Time Delivery Performance (Year-over-Year)
          </CardTitle>
          <CardDescription>Revised OTD % by month (includes overdue backlog) - both order count and value-based metrics</CardDescription>
        </CardHeader>
        <CardContent>
          {otdYoYLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : otdYoY.length > 0 ? (
            (() => {
              const yearsSet = new Set<number>();
              otdYoY.forEach(d => yearsSet.add(d.year));
              const years = Array.from(yearsSet).sort();
              const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const chartData = months.map((month, idx) => {
                const monthNum = idx + 1;
                const point: Record<string, string | number | null> = { month };
                years.forEach(year => {
                  const dataPoint = otdYoY.find(d => d.year === year && d.month === monthNum);
                  // Use Revised OTD which includes overdue backlog in denominator
                  point[`otd_${year}`] = dataPoint?.revisedOtdPct ?? null;
                  point[`otdValue_${year}`] = dataPoint?.revisedOtdValuePct ?? null;
                });
                return point;
              });
              const colors = ['#94a3b8', '#6b7280', '#22c55e', '#3b82f6', '#a855f7'];
              
              // Calculate YTD stats for each year using revised methodology
              const yearStats = years.map(year => {
                const yearData = otdYoY.filter(d => d.year === year);
                const totalOnTime = yearData.reduce((sum, d) => sum + d.shippedOnTime, 0);
                const totalShipped = yearData.reduce((sum, d) => sum + d.totalShipped, 0);
                const totalOverdue = yearData.reduce((sum, d) => sum + d.overdueUnshipped, 0);
                const totalOnTimeValue = yearData.reduce((sum, d) => sum + d.onTimeValue, 0);
                const totalValue = yearData.reduce((sum, d) => sum + d.totalValue, 0);
                const totalOverdueValue = yearData.reduce((sum, d) => sum + d.overdueBacklogValue, 0);
                // Revised OTD includes overdue in denominator
                const revisedDenominator = totalShipped + totalOverdue;
                const revisedValueDenominator = totalValue + totalOverdueValue;
                return {
                  year,
                  ytdOtd: revisedDenominator > 0 ? (totalOnTime / revisedDenominator) * 100 : 0,
                  ytdOtdValue: revisedValueDenominator > 0 ? (totalOnTimeValue / revisedValueDenominator) * 100 : 0,
                  totalShipped,
                  totalOnTime,
                  totalOverdue,
                };
              });
              
              return (
                <div className="space-y-4">
                  {/* YTD Summary Cards */}
                  <div className="flex flex-wrap gap-4 mb-4">
                    {yearStats.map((stat, idx) => (
                      <div key={stat.year} className="text-center p-3 bg-muted/50 rounded-lg min-w-[160px]">
                        <p className="text-sm text-muted-foreground">{stat.year}</p>
                        <div className="flex flex-col gap-1">
                          <div>
                            <p className="text-xl font-bold" style={{ color: colors[idx % colors.length] }} data-testid={`text-vendor-otd-${stat.year}`}>
                              {stat.ytdOtd.toFixed(1)}%
                            </p>
                            <p className="text-xs text-muted-foreground">
                              By Order ({stat.totalOnTime}/{stat.totalShipped + stat.totalOverdue})
                              {stat.totalOverdue > 0 && <span className="text-orange-500"> +{stat.totalOverdue} overdue</span>}
                            </p>
                          </div>
                          <div>
                            <p className="text-lg font-semibold" style={{ color: colors[idx % colors.length] }} data-testid={`text-vendor-otd-value-${stat.year}`}>
                              {stat.ytdOtdValue.toFixed(1)}%
                            </p>
                            <p className="text-xs text-muted-foreground">By Value</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis 
                        tick={{ fontSize: 12 }} 
                        tickFormatter={(value) => `${value}%`}
                        domain={[0, 100]}
                      />
                      <Tooltip 
                        formatter={(value: number, name: string) => {
                          const isValue = name.includes('Value');
                          return [`${value?.toFixed(1) || 0}%`, isValue ? 'Revised OTD by Value' : 'Revised OTD by Order'];
                        }}
                        labelFormatter={(label) => `Month: ${label}`}
                      />
                      <Legend />
                      {years.map((year, idx) => (
                        <Line
                          key={`otd-${year}`}
                          type="monotone"
                          dataKey={`otd_${year}`}
                          name={`${year} OTD`}
                          stroke={colors[idx % colors.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls={false}
                        />
                      ))}
                      {years.map((year, idx) => (
                        <Line
                          key={`otdValue-${year}`}
                          type="monotone"
                          dataKey={`otdValue_${year}`}
                          name={`${year} OTD Value`}
                          stroke={colors[idx % colors.length]}
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={{ r: 2 }}
                          connectNulls={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-muted-foreground text-center">
                    Solid lines = Revised OTD by Order | Dashed lines = Revised OTD by Value | Includes overdue backlog in denominator
                  </p>
                </div>
              );
            })()
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No OTD data available</p>
          )}
        </CardContent>
      </Card>

      {/* YTD Cumulative Performance Report */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            YTD Cumulative Performance ({new Date().getFullYear()})
          </CardTitle>
          <CardDescription>Monthly breakdown with cumulative on-time delivery metrics</CardDescription>
        </CardHeader>
        <CardContent>
          {ytdLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : ytdPerformance && ytdPerformance.monthlyData.length > 0 ? (
            <div className="space-y-4">
              {/* YTD Summary */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="text-center">
                  <p className="text-2xl font-bold" data-testid="text-ytd-total">{ytdPerformance.ytdSummary.totalOrders}</p>
                  <p className="text-xs text-muted-foreground">Total Orders</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600" data-testid="text-ytd-ontime">{ytdPerformance.ytdSummary.onTimeOrders}</p>
                  <p className="text-xs text-muted-foreground">On Time</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-600" data-testid="text-ytd-late">{ytdPerformance.ytdSummary.lateOrders}</p>
                  <p className="text-xs text-muted-foreground">Late</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-orange-600" data-testid="text-ytd-atrisk">{ytdPerformance.ytdSummary.atRiskOrders}</p>
                  <p className="text-xs text-muted-foreground">At Risk</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold" data-testid="text-ytd-otd-pct">{ytdPerformance.ytdSummary.otdPercentage}%</p>
                  <p className="text-xs text-muted-foreground">YTD OTD %</p>
                </div>
              </div>

              {/* Monthly Table with Totals */}
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Month</TableHead>
                      <TableHead className="text-right font-semibold">Orders</TableHead>
                      <TableHead className="text-right font-semibold">On Time</TableHead>
                      <TableHead className="text-right font-semibold">Late</TableHead>
                      <TableHead className="text-right font-semibold">At Risk</TableHead>
                      <TableHead className="text-right font-semibold">Cumulative Total</TableHead>
                      <TableHead className="text-right font-semibold">Cumulative OTD %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ytdPerformance.monthlyData.map((row) => (
                      <TableRow key={row.monthNum} data-testid={`row-ytd-month-${row.monthNum}`}>
                        <TableCell className="font-medium">{row.month}</TableCell>
                        <TableCell className="text-right">{row.totalOrders}</TableCell>
                        <TableCell className="text-right text-green-600">{row.onTimeOrders}</TableCell>
                        <TableCell className="text-right text-red-600">{row.lateOrders}</TableCell>
                        <TableCell className="text-right text-orange-600">{row.atRiskOrders}</TableCell>
                        <TableCell className="text-right font-medium">{row.cumulativeTotal}</TableCell>
                        <TableCell className="text-right">
                          <Badge 
                            variant={row.cumulativeOtdPercentage >= 90 ? "default" : row.cumulativeOtdPercentage >= 80 ? "secondary" : "destructive"}
                          >
                            {row.cumulativeOtdPercentage}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Totals Row */}
                    <TableRow className="bg-muted/50 font-semibold border-t-2" data-testid="row-ytd-totals">
                      <TableCell className="font-bold">Total</TableCell>
                      <TableCell className="text-right font-bold">{ytdPerformance.ytdSummary.totalOrders}</TableCell>
                      <TableCell className="text-right font-bold text-green-600">{ytdPerformance.ytdSummary.onTimeOrders}</TableCell>
                      <TableCell className="text-right font-bold text-red-600">{ytdPerformance.ytdSummary.lateOrders}</TableCell>
                      <TableCell className="text-right font-bold text-orange-600">{ytdPerformance.ytdSummary.atRiskOrders}</TableCell>
                      <TableCell className="text-right font-bold">{ytdPerformance.ytdSummary.totalOrders}</TableCell>
                      <TableCell className="text-right">
                        <Badge 
                          variant={ytdPerformance.ytdSummary.otdPercentage >= 90 ? "default" : ytdPerformance.ytdSummary.otdPercentage >= 80 ? "secondary" : "destructive"}
                          className="font-bold"
                        >
                          {ytdPerformance.ytdSummary.otdPercentage}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No YTD performance data available</p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="pos" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="pos" data-testid="tab-purchase-orders">
            Purchase Orders ({aggregatedPOs.length})
          </TabsTrigger>
          <TabsTrigger value="skus" data-testid="tab-skus">
            SKUs ({skus.length})
          </TabsTrigger>
          <TabsTrigger value="inspections" data-testid="tab-inspections">
            Inspections ({inspections.length})
          </TabsTrigger>
          <TabsTrigger value="quality" data-testid="tab-quality-tests">
            Quality Tests ({qualityTests.length})
          </TabsTrigger>
          <TabsTrigger value="timelines" data-testid="tab-timeline-templates">
            <Clock className="h-4 w-4 mr-1" />
            Timelines
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pos" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Purchase Order History</CardTitle>
              <CardDescription>All purchase orders for this vendor</CardDescription>
            </CardHeader>
            <CardContent>
              {posLoading ? (
                <Skeleton className="h-96 w-full" />
              ) : (
                <DataTable 
                  columns={poColumns} 
                  data={aggregatedPOs} 
                  searchKey="poNumber"
                  searchPlaceholder="Search PO numbers..."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skus" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Product SKUs</CardTitle>
              <CardDescription>SKUs associated with this vendor</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable 
                columns={skuColumns} 
                data={skus} 
                searchKey="sku"
                searchPlaceholder="Search SKUs..."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inspections" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Inspection History</CardTitle>
              <CardDescription>Quality inspection records</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable 
                columns={inspectionColumns} 
                data={inspections} 
                searchKey="sku"
                searchPlaceholder="Search by SKU or PO..."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quality Test Results</CardTitle>
              <CardDescription>Lab tests and certifications</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable 
                columns={[
                  { key: "sku", label: "SKU", sortable: true },
                  { key: "testType", label: "Test Type", sortable: true },
                  { 
                    key: "reportDate", 
                    label: "Date", 
                    sortable: true,
                    render: (value: Date | null) => value ? format(new Date(value), "MM/dd/yyyy") : "-"
                  },
                  { key: "reportNumber", label: "Report #" },
                  { 
                    key: "result", 
                    label: "Result", 
                    render: (value: string) => {
                      const variant = value?.toLowerCase() === "passed" ? "default" : value?.toLowerCase() === "failed" ? "destructive" : "secondary";
                      return value ? <Badge variant={variant}>{value}</Badge> : "-";
                    }
                  },
                ]} 
                data={qualityTests} 
                searchKey="sku"
                searchPlaceholder="Search by SKU..."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timelines" className="mt-6">
          <VendorTimelineTemplates 
            vendorId={vendor.id} 
            vendorName={vendor.name}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
