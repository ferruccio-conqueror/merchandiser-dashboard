import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { KPICard } from "@/components/KPICard";
import { StatusChart } from "@/components/StatusChart";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ChevronDown, X } from "lucide-react";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatDistanceToNow } from "date-fns";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { DashboardFiltersPanel, type DashboardFilters } from "@/components/DashboardFilters";
import { AIShippingAnalyst } from "@/components/AIShippingAnalyst";
import { useClientContext } from "@/contexts/ClientContext";
import { HelpButton } from "@/components/HelpButton";
import type { PurchaseOrder } from "@shared/schema";

interface DashboardKPIs {
  otdPercentage: number;
  otdOriginalPercentage: number;
  otdOriginalTotal: number;
  otdOriginalOnTime: number;
  // Revised OTD breakdown
  trueOtdPercentage: number;
  shippedTotal: number;
  shippedOnTime: number;
  shippedLate: number;
  overdueUnshipped: number;
  totalShouldHaveShipped: number;
  avgLateDays: number;
  totalOrders: number;
  lateOrders: number;
  onTimeOrders: number;
  atRiskOrders: number;
  qualityPassRate: number;
  firstMtoDays: number;
  firstMtoCount: number;
  firstRegularDays: number;
  firstRegularCount: number;
  repeatMtoDays: number;
  repeatMtoCount: number;
  repeatRegularDays: number;
  repeatRegularCount: number;
}

interface LateShipmentYoY {
  year: number;
  month: number;
  month_name: string;
  late_count: number;
  total_shipped: number;
  late_percentage: number;
  shipped_on_time: number;
  shipped_late: number;
  overdue_unshipped: number;
  total_should_have_shipped: number;
  true_otd_pct: number;
  on_time_value: number;
  total_value: number;
  late_value: number;
  revised_otd_value_pct: number;
  overdue_backlog_value: number;
}

interface OriginalOtdYoY {
  year: number;
  month: number;
  month_name: string;
  shipped_on_time: number;
  total_shipped: number;
  original_otd_pct: number;
  on_time_value: number;
  total_value: number;
  late_value: number;
  original_otd_value_pct: number;
}

interface VendorLateAtRisk {
  vendor: string;
  late_count: number;
  at_risk_count: number;
}

interface LateShipmentReason {
  reason: string;
  count: number;
  avg_days_late: number;
  total_value: number;
}

interface LateShipmentStatus {
  status: string;
  count: number;
  avg_days_late: number;
  total_value: number;
}

interface LateAtRiskPO {
  id: number;
  po_number: string;
  vendor: string | null;
  revised_reason: string | null;
  status: string;
  days_late: number;
  is_late: boolean;
  is_at_risk: boolean;
  revised_cancel_date: string | null;
  total_value: number | null;
  has_pts: boolean;
}

interface HeaderKPIs {
  totalSkus: number;
  totalSkusPrevYear: number;
  newSkusYtd: number;
  newSkusYtdPrevYear: number;
  ytdTotalSales: number;
  ytdTotalSalesPrevYear: number;
  ytdTotalOrders: number;
  ytdTotalOrdersPrevYear: number;
  totalPosForYear: number;
  totalPosForYearPrevYear: number;
  ytdTotalPos: number;
  ytdTotalPosPrevYear: number;
  totalActivePOs: number;
  totalActivePosPrevYear: number;
  ytdPosUnshipped: number;
  ytdPosUnshippedPrevYear: number;
  ytdProjections: number;
  ytdProjectionsPrevYear: number;
  ytdPotential: number;
  ytdPotentialPrevYear: number;
}

interface OrdersOnHandYoYData {
  month: number;
  monthName: string;
  currentYear: {
    year: number;
    orders: number;
    totalValue: number;
    shippedValue: number;
    unshippedValue: number;
    projectionValue?: number;
  };
  lastYear: {
    year: number;
    orders: number;
    totalValue: number;
    shippedValue: number;
    unshippedValue: number;
  };
  yoyChange: {
    ordersChange: number;
    valueChange: number;
    valuePctChange: number | null;
  };
}

function OrdersOnHandYoYChart({ filters, clientName }: { filters?: DashboardFilters; clientName?: string }) {
  // Build query string from filters - include all page filters
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters?.vendor) params.append('vendor', filters.vendor);
    if (filters?.brand) params.append('brand', filters.brand);
    if (filters?.merchandiser) params.append('merchandiser', filters.merchandiser);
    if (filters?.merchandisingManager) params.append('merchandisingManager', filters.merchandisingManager);
    if (clientName) params.append('client', clientName);
    return params.toString();
  }, [filters, clientName]);
  
  const queryKey = queryString ? `/api/dashboard/orders-on-hand-yoy?${queryString}` : '/api/dashboard/orders-on-hand-yoy';
  
  const { data, isLoading } = useQuery<{ currentYear: number; lastYear: number; data: OrdersOnHandYoYData[] }>({
    queryKey: [queryKey],
  });

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Monthly Shipments - Year over Year</CardTitle>
          <CardDescription>Shipped by sailing date + pending orders by cancel date</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-80" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // Transform data for chart:
  // - Shipped: by actual sailing date (matches YTD KPI)
  // - Pending: remaining value (total - shipped) by cancel date (current year only)
  // - Projections: from active_projections (future business forecast)
  // Prior year shows only shipped for cleaner comparison
  // Note: Backend already converts cents to dollars, so no division needed here
  const chartData = data.data.map((row) => ({
    month: row.monthName.slice(0, 3), // Abbreviated month name
    // Prior year - shipped only (gray bar)
    priorYearShipped: row.lastYear.shippedValue,
    // Current year stacked: shipped (dark blue) + pending (medium blue) + projections (light blue)
    currentYearShipped: row.currentYear.shippedValue,
    currentYearPending: row.currentYear.unshippedValue,
    currentYearProjections: row.currentYear.projectionValue || 0,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="text-orders-yoy-title">Monthly Shipments - Year over Year</CardTitle>
        <CardDescription>
          {data.currentYear} shipped + pending + projections vs {data.lastYear} shipped
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80" data-testid="chart-orders-yoy">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 0, right: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis 
                tickFormatter={(value) => formatCurrency(value)}
                tick={{ fontSize: 11 }}
              />
              <Tooltip 
                formatter={(value: number, name: string) => [
                  formatCurrency(value), 
                  name
                ]}
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              {/* Prior year - gray bar for shipped only */}
              <Bar 
                dataKey="priorYearShipped" 
                name={`${data.lastYear} Shipped`}
                fill="#9ca3af" 
              />
              {/* Current year stacked - dark blue for shipped */}
              <Bar 
                dataKey="currentYearShipped" 
                stackId="current"
                name={`${data.currentYear} Shipped`}
                fill="#1d4ed8" 
              />
              {/* Current year stacked - medium blue for pending orders */}
              <Bar 
                dataKey="currentYearPending" 
                stackId="current"
                name={`${data.currentYear} Pending`}
                fill="#60a5fa" 
              />
              {/* Current year stacked - light blue for projections */}
              <Bar 
                dataKey="currentYearProjections" 
                stackId="current"
                name={`${data.currentYear} Projections`}
                fill="#93c5fd" 
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  // Initialize with no date filters - backend uses YTD logic by default
  const [filters, setFilters] = useState<DashboardFilters>({});
  const [riskStatusFilter, setRiskStatusFilter] = useState<'all' | 'late' | 'at-risk'>('all');
  const [poStatusFilters, setPoStatusFilters] = useState<string[]>([]);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const { selectedClient } = useClientContext();
  
  // OTD Chart toggles - unified chart with Original vs Revised and Count vs Value
  const [otdType, setOtdType] = useState<'revised' | 'original'>('revised');
  const [otdMetric, setOtdMetric] = useState<'count' | 'value'>('count');
  
  // Format currency values - handles cents conversion and abbreviation
  const formatCurrency = (valueInCents: number) => {
    const dollars = valueInCents / 100;
    if (dollars >= 1000000) {
      return `$${(dollars / 1000000).toFixed(1)}M`;
    } else if (dollars >= 1000) {
      return `$${(dollars / 1000).toFixed(0)}K`;
    }
    return `$${dollars.toFixed(0)}`;
  };
  
  // Build query string from filters including client
  const buildQueryString = (filters: DashboardFilters, clientName?: string) => {
    const params = new URLSearchParams();
    if (filters.merchandiser) params.append('merchandiser', filters.merchandiser);
    if (filters.merchandisingManager) params.append('merchandisingManager', filters.merchandisingManager);
    if (filters.vendor) params.append('vendor', filters.vendor);
    if (filters.brand) params.append('brand', filters.brand);
    if (clientName) params.append('client', clientName);
    if (filters.startDate) params.append('startDate', filters.startDate.toISOString());
    if (filters.endDate) params.append('endDate', filters.endDate.toISOString());
    return params.toString();
  };
  
  // Build query string for YoY chart - includes date filters to determine which years to show
  const buildQueryStringForYoY = (filters: DashboardFilters, clientName?: string) => {
    const params = new URLSearchParams();
    if (filters.merchandiser) params.append('merchandiser', filters.merchandiser);
    if (filters.merchandisingManager) params.append('merchandisingManager', filters.merchandisingManager);
    if (filters.vendor) params.append('vendor', filters.vendor);
    if (filters.brand) params.append('brand', filters.brand);
    if (clientName) params.append('client', clientName);
    // Include date filters so the YoY chart knows which years to display
    if (filters.startDate) params.append('startDate', filters.startDate.toISOString());
    if (filters.endDate) params.append('endDate', filters.endDate.toISOString());
    return params.toString();
  };

  // Navigation handlers for chart drill-downs
  const handleStatusChartClick = (statusName: string) => {
    // Map display names to filter values
    const statusMap: Record<string, string> = {
      'On Time': 'on-time',
      'At Risk': 'at-risk',
      'Late': 'late'
    };
    const statusFilter = statusMap[statusName] || statusName.toLowerCase();
    setLocation(`/purchase-orders?otdStatus=${statusFilter}`);
  };

  const handleVendorChartClick = (vendor: string, status: 'late' | 'at-risk') => {
    setLocation(`/purchase-orders?vendor=${encodeURIComponent(vendor)}&otdStatus=${status}`);
  };
  
  // Fetch filter options
  const { data: filterOptions } = useQuery<{
    merchandisers: string[];
    managers: string[];
    vendors: string[];
    brands: string[];
  }>({
    queryKey: ["/api/dashboard/filter-options"],
  });
  
  // Build query key with filters including client context
  const queryString = buildQueryString(filters, selectedClient?.shortName);
  
  // Fetch header KPIs with YoY comparison (respects filters)
  const headerKpisQueryKey = queryString ? `/api/dashboard/header-kpis?${queryString}` : '/api/dashboard/header-kpis';
  const { data: headerKpis, isLoading: headerKpisLoading } = useQuery<HeaderKPIs>({
    queryKey: [headerKpisQueryKey],
  });
  
  // Calculate YoY percentage changes for header KPIs
  const calculateYoYChange = (current: number, previous: number): { value: number; isPositive: boolean } => {
    if (previous === 0) return { value: current > 0 ? 100 : 0, isPositive: current >= 0 };
    const change = ((current - previous) / previous) * 100;
    return { value: Math.abs(change), isPositive: change >= 0 };
  };
  
  const skuYoY = headerKpis ? calculateYoYChange(headerKpis.totalSkus, headerKpis.totalSkusPrevYear) : null;
  const newSkusYoY = headerKpis ? calculateYoYChange(headerKpis.newSkusYtd, headerKpis.newSkusYtdPrevYear) : null;
  const salesYoY = headerKpis ? calculateYoYChange(headerKpis.ytdTotalSales, headerKpis.ytdTotalSalesPrevYear) : null;
  const ordersYoY = headerKpis ? calculateYoYChange(headerKpis.ytdTotalOrders, headerKpis.ytdTotalOrdersPrevYear) : null;
  const totalPosYoY = headerKpis ? calculateYoYChange(headerKpis.totalPosForYear ?? 0, headerKpis.totalPosForYearPrevYear ?? 0) : null;
  const posUnshippedYoY = headerKpis ? calculateYoYChange(headerKpis.ytdPosUnshipped, headerKpis.ytdPosUnshippedPrevYear) : null;
  const projectionsYoY = headerKpis ? calculateYoYChange(headerKpis.ytdProjections ?? 0, headerKpis.ytdProjectionsPrevYear ?? 0) : null;
  const potentialYoY = headerKpis ? calculateYoYChange(headerKpis.ytdPotential ?? 0, headerKpis.ytdPotentialPrevYear ?? 0) : null;
  
  const kpisQueryKey = queryString ? `/api/dashboard/kpis?${queryString}` : '/api/dashboard/kpis';
  
  const { data: kpis, isLoading: kpisLoading } = useQuery<DashboardKPIs>({
    queryKey: [kpisQueryKey],
  });
  
  // Build query key for Late & At-Risk POs with filters
  const lateAtRiskQueryKey = queryString ? `/api/dashboard/late-at-risk-pos?${queryString}` : '/api/dashboard/late-at-risk-pos';
  
  // CSV Export function with proper escaping
  const exportToCSV = (data: LateAtRiskPO[], filename: string) => {
    if (!data || data.length === 0) {
      toast({
        title: "Export Failed",
        description: "No data available to export.",
        variant: "destructive",
      });
      return;
    }
    
    // Helper function to escape CSV fields
    const escapeCSVField = (field: string | number | null | undefined): string => {
      const value = field?.toString() || '';
      // Replace double quotes with double-double quotes and wrap in quotes if needed
      if (value.includes('"') || value.includes(',') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };
    
    // Define CSV headers
    const headers = ['PO Number', 'Vendor', 'Revised Reason', 'Days Late', 'Status', 'Value'];
    
    // Helper to format currency value (stored in cents, display in dollars)
    const formatValue = (value: number | null): string => {
      if (value === null || value === undefined) return '$0.00';
      return `$${(value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    
    // Convert data to CSV rows
    const csvRows = [
      headers.join(','),
      ...data.map(po => [
        escapeCSVField(po.po_number),
        escapeCSVField(po.vendor),
        escapeCSVField(po.revised_reason || 'No Reason Provided'),
        escapeCSVField(po.days_late + 'd'),
        escapeCSVField(po.status),
        escapeCSVField(formatValue(po.total_value))
      ].join(','))
    ];
    
    // Create CSV blob and download
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Show success toast
    toast({
      title: "Export Successful",
      description: `Downloaded ${data.length} record${data.length === 1 ? '' : 's'} to ${filename}`,
    });
  };

  const { data: lateAtRiskPOs, isLoading: lateAtRiskLoading } = useQuery<LateAtRiskPO[]>({
    queryKey: [lateAtRiskQueryKey],
  });
  
  // Build query keys with filters for all chart endpoints
  // YoY chart uses date filters to determine which years to display
  const yoyQueryString = buildQueryStringForYoY(filters, selectedClient?.shortName);
  const yoyQueryKey = yoyQueryString ? `/api/dashboard/late-shipments-yoy?${yoyQueryString}` : '/api/dashboard/late-shipments-yoy';
  const vendorQueryKey = queryString ? `/api/dashboard/vendor-late-at-risk?${queryString}` : '/api/dashboard/vendor-late-at-risk';
  const reasonsQueryKey = queryString ? `/api/dashboard/late-shipments-by-reason?${queryString}` : '/api/dashboard/late-shipments-by-reason';
  const statusesQueryKey = queryString ? `/api/dashboard/late-shipments-by-status?${queryString}` : '/api/dashboard/late-shipments-by-status';
  
  const { data: yoyData, isLoading: yoyLoading } = useQuery<LateShipmentYoY[]>({
    queryKey: [yoyQueryKey],
    select: (data) => data.map(item => ({
      ...item,
      // Normalize monetary fields to numbers at fetch time
      on_time_value: Number(item.on_time_value || 0),
      total_value: Number(item.total_value || 0),
      late_value: Number(item.late_value || 0),
      overdue_backlog_value: Number(item.overdue_backlog_value || 0),
      revised_otd_value_pct: Number(item.revised_otd_value_pct || 0),
    })),
  });
  
  const { data: vendorLateAtRisk, isLoading: vendorLoading } = useQuery<VendorLateAtRisk[]>({
    queryKey: [vendorQueryKey],
  });
  
  const { data: lateReasons, isLoading: reasonsLoading } = useQuery<LateShipmentReason[]>({
    queryKey: [reasonsQueryKey],
  });

  const { data: lateStatuses, isLoading: statusesLoading } = useQuery<LateShipmentStatus[]>({
    queryKey: [statusesQueryKey],
  });

  // Fetch revision reasons for Original OTD filter
  const { data: revisionReasons } = useQuery<string[]>({
    queryKey: ['/api/dashboard/revision-reasons'],
  });

  // Build Original OTD query key with reason filter - includes all page filters
  const buildOriginalOtdQueryKey = () => {
    const params = new URLSearchParams();
    if (filters.merchandiser) params.append('merchandiser', filters.merchandiser);
    if (filters.merchandisingManager) params.append('merchandisingManager', filters.merchandisingManager);
    if (filters.vendor) params.append('vendor', filters.vendor);
    if (filters.brand) params.append('brand', filters.brand);
    if (selectedClient?.shortName) params.append('client', selectedClient.shortName);
    if (filters.startDate) params.append('startDate', filters.startDate.toISOString());
    if (filters.endDate) params.append('endDate', filters.endDate.toISOString());
    if (selectedReasons.length > 0) params.append('reasons', JSON.stringify(selectedReasons));
    const qs = params.toString();
    return qs ? `/api/dashboard/original-otd-yoy?${qs}` : '/api/dashboard/original-otd-yoy';
  };
  const originalOtdQueryKey = buildOriginalOtdQueryKey();

  const { data: originalOtdData, isLoading: originalOtdLoading } = useQuery<OriginalOtdYoY[]>({
    queryKey: [originalOtdQueryKey],
    select: (data) => data.map(item => ({
      ...item,
      // Normalize monetary fields to numbers at fetch time
      on_time_value: Number(item.on_time_value || 0),
      total_value: Number(item.total_value || 0),
      late_value: Number(item.late_value || 0),
      original_otd_value_pct: Number(item.original_otd_value_pct || 0),
    })),
  });

  const statusData = kpis ? [
    { name: "On Time", value: kpis.onTimeOrders, fill: "#22c55e", totalValue: kpis.onTimeValue || 0 },
    { name: "At Risk", value: kpis.atRiskOrders, fill: "#f97316", totalValue: kpis.atRiskValue || 0 },
    { name: "Late", value: kpis.lateOrders, fill: "#ef4444", totalValue: kpis.lateValue || 0 },
  ] : [];

  const vendorChartData = vendorLateAtRisk?.map(item => ({
    vendor: item.vendor,
    Late: item.late_count,
    "At Risk": item.at_risk_count,
  })) || [];

  // Calculate total late shipments and percentages for pie chart
  const totalLateShipments = lateReasons?.reduce((sum, item) => sum + item.count, 0) || 0;
  
  const pieChartData = lateReasons?.map((item) => ({
    name: item.reason,
    value: item.count,
    percentage: totalLateShipments > 0 ? ((item.count / totalLateShipments) * 100).toFixed(1) : "0.0",
    totalValue: item.total_value || 0,  // Keep in cents - formatCurrency handles conversion
  })) || [];

  // Color palette for pie chart (matching the reference image)
  const PIE_COLORS = ['#ef4444', '#fb923c', '#fbbf24', '#4ade80', '#60a5fa'];
  
  // Table data with percentages
  const totalLateReasonValue = lateReasons?.reduce((sum, item) => sum + (item.total_value || 0), 0) || 0;
  
  const reasonTableData = lateReasons?.map((item) => ({
    reason: item.reason,
    count: item.count,
    percentage: totalLateShipments > 0 ? ((item.count / totalLateShipments) * 100).toFixed(1) + '%' : '0.0%',
    avgDaysLate: item.avg_days_late + 'd',
    totalValue: item.total_value || 0,  // Keep in cents - formatCurrency handles conversion
  })) || [];

  // Late Shipments by Status data
  const totalLateByStatus = lateStatuses?.reduce((sum, item) => sum + item.count, 0) || 0;
  const totalLateStatusValue = lateStatuses?.reduce((sum, item) => sum + (item.total_value || 0), 0) || 0;
  
  const statusPieChartData = lateStatuses?.map((item) => ({
    name: item.status,
    value: item.count,
    percentage: totalLateByStatus > 0 ? ((item.count / totalLateByStatus) * 100).toFixed(1) : "0.0",
    totalValue: item.total_value || 0,  // Keep in cents - formatCurrency handles conversion
  })) || [];
  
  // Status pie chart colors
  const STATUS_PIE_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#ec4899', '#10b981', '#6366f1'];
  
  const statusTableData = lateStatuses?.map((item) => ({
    status: item.status,
    count: item.count,
    percentage: totalLateByStatus > 0 ? ((item.count / totalLateByStatus) * 100).toFixed(1) + '%' : '0.0%',
    avgDaysLate: item.avg_days_late + 'd',
    totalValue: item.total_value || 0,  // Keep in cents - formatCurrency handles conversion
  })) || [];

  const lateAtRiskColumns = [
    { 
      key: "po_number", 
      label: "PO Number", 
      sortable: true,
      render: (value: string, row: LateAtRiskPO) => {
        return (
          <Link href={`/purchase-orders/${row.id}`}>
            <span className="text-primary hover:underline cursor-pointer font-medium" data-testid={`link-po-${row.id}`}>
              {value}
            </span>
          </Link>
        );
      }
    },
    { 
      key: "risk_status", 
      label: "Risk Status", 
      sortable: true,
      render: (_value: unknown, row: LateAtRiskPO) => {
        // If already late, just show Late (no longer "at risk" of being late)
        if (row.is_late) {
          return <Badge variant="destructive" data-testid={`badge-late-${row.id}`}>Late</Badge>;
        } else if (row.is_at_risk) {
          return <Badge className="bg-orange-500 hover:bg-orange-600 text-white" data-testid={`badge-at-risk-${row.id}`}>At Risk</Badge>;
        }
        return null;
      }
    },
    { key: "vendor", label: "Vendor", sortable: true },
    { 
      key: "revised_cancel_date", 
      label: "Revised Cancel Date", 
      sortable: true,
      render: (value: string | null) => {
        if (!value) return "-";
        const date = new Date(value);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    },
    { 
      key: "revised_reason", 
      label: "Revised Reason", 
      sortable: true,
      render: (value: string | null) => value || "No Reason Provided"
    },
    { 
      key: "days_late", 
      label: "Days Late", 
      sortable: true,
      render: (value: number) => {
        const colorClass = value > 14 ? "text-destructive font-bold" : value > 7 ? "text-orange-600 font-semibold" : "text-muted-foreground";
        return <span className={colorClass} data-testid="text-days-late">{value}d</span>;
      }
    },
    { 
      key: "status", 
      label: "Status", 
      sortable: true,
      render: (value: string) => {
        // Map Closed/Shipped to "Handed Over" for display
        const displayStatus = (value === "Closed" || value === "Shipped") ? "Handed Over" : value;
        const variant = displayStatus === "Handed Over" ? "default" : displayStatus.includes("Production") ? "secondary" : "outline";
        return <Badge variant={variant} data-testid={`badge-status-${displayStatus}`}>{displayStatus}</Badge>;
      }
    },
    { 
      key: "has_pts", 
      label: "PTS", 
      sortable: true,
      render: (value: boolean, row: LateAtRiskPO) => {
        return (
          <span 
            className={value ? "text-green-600 font-medium" : "text-muted-foreground"} 
            data-testid={`text-pts-${row.id}`}
          >
            {value ? "Y" : "N"}
          </span>
        );
      }
    },
    { 
      key: "total_value", 
      label: "Value", 
      sortable: true,
      render: (value: number | null) => {
        if (value === null || value === undefined) return "$0.00";
        const formattedValue = (value / 100).toLocaleString('en-US', { 
          style: 'currency', 
          currency: 'USD',
          minimumFractionDigits: 2 
        });
        return <span className="font-medium" data-testid="text-po-value">{formattedValue}</span>;
      }
    },
  ];
  
  // Transform year-over-year data for chart (using Revised OTD percentage from API)
  // Use filters.startDate year or current year for chart display
  const currentYear = filters.startDate?.getFullYear() || new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed (0 = Jan, 11 = Dec)
  
  // Determine which years are in the data (based on selected date range)
  // Only include years that have at least one shipped order (shipped_on_time > 0)
  const yearsInData = useMemo(() => {
    if (!yoyData || yoyData.length === 0) return [currentYear - 1, currentYear];
    
    // Group data by year and sum shipped on-time counts
    const yearShipped: Record<number, number> = {};
    yoyData.forEach(d => {
      if (!yearShipped[d.year]) yearShipped[d.year] = 0;
      yearShipped[d.year] += (d.shipped_on_time || 0);
    });
    
    // Only include years with at least one shipped order
    const years = Object.entries(yearShipped)
      .filter(([_, shipped]) => shipped > 0)
      .map(([year, _]) => parseInt(year))
      .sort((a, b) => a - b);
    
    return years.length > 0 ? years : [currentYear - 1, currentYear];
  }, [yoyData, currentYear]);
  
  // Chart line colors for different years
  const yearColors: Record<number, string> = {
    2024: '#94a3b8', // slate-400
    2025: '#6b7280', // gray-500
    2026: '#22c55e', // green-500
    2027: '#3b82f6', // blue-500
    2028: '#a855f7', // purple-500
  };
  
  // Transform year-over-year data for chart using Revised OTD percentage
  // Revised OTD = On-Time Shipped / (Total Shipped + Overdue Unshipped)
  // Uses OS 340 shipment_status field for shipped status determination
  const yoyChartData = useMemo(() => {
    if (!yoyData || yoyData.length === 0) return [];
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Initialize all months with null values for all years in data
    const monthlyData: Record<string, { month: string; [key: string]: number | string | null }> = {};
    months.forEach(month => {
      monthlyData[month] = { month };
      yearsInData.forEach(year => {
        monthlyData[month][`${year}`] = null;
      });
    });
    
    // Fill in actual data - use true_otd_pct from API
    yoyData.forEach(item => {
      const monthName = item.month_name;
      if (monthlyData[monthName]) {
        const trueOtdPct = typeof item.true_otd_pct === 'string' ? parseFloat(item.true_otd_pct) : Number(item.true_otd_pct);
        monthlyData[monthName][`${item.year}`] = trueOtdPct;
      }
    });
    
    // Return all months - let Recharts handle null values (gaps in lines)
    return months.map(month => monthlyData[month]);
  }, [yoyData, yearsInData]);

  // Calculate YTD Revised OTD for each year in the data
  // This matches the KPI card calculation: total on-time / total shipped
  // Now includes both count-based and value-based metrics
  const ytdComparison = useMemo(() => {
    if (!yoyData || yoyData.length === 0 || yearsInData.length === 0) {
      return { yearStats: {}, hasData: false };
    }
    
    const yearStats: Record<number, { 
      ytd: number; 
      totalOnTime: number; 
      totalShipped: number;
      ytdValue: number;
      totalOnTimeValue: number;
      totalValue: number;
      lateValue: number;
      overdueBacklogValue: number;
    }> = {};
    
    yearsInData.forEach(year => {
      const yearData = yoyData.filter(d => d.year === year);
      const totalOnTime = yearData.reduce((sum, d) => sum + (d.shipped_on_time || 0), 0);
      const totalShipped = yearData.reduce((sum, d) => sum + (d.total_shipped || 0), 0);
      const ytd = totalShipped > 0 ? (totalOnTime / totalShipped) * 100 : 0;
      
      // Value-based metrics (already normalized to numbers at fetch time)
      const totalOnTimeValue = yearData.reduce((sum, d) => sum + (d.on_time_value || 0), 0);
      const totalValue = yearData.reduce((sum, d) => sum + (d.total_value || 0), 0);
      const lateValue = yearData.reduce((sum, d) => sum + (d.late_value || 0), 0);
      const overdueBacklogValue = yearData.reduce((sum, d) => sum + (d.overdue_backlog_value || 0), 0);
      const ytdValue = totalValue > 0 ? (totalOnTimeValue / totalValue) * 100 : 0;
      
      yearStats[year] = { 
        ytd, totalOnTime, totalShipped,
        ytdValue, totalOnTimeValue, totalValue, lateValue, overdueBacklogValue
      };
    });
    
    return { yearStats, hasData: Object.keys(yearStats).length > 0 };
  }, [yoyData, yearsInData]);
  
  // Calculate YoY change between last two years in the range
  const yoyChange = useMemo(() => {
    if (yearsInData.length < 2) return null;
    const sortedYears = [...yearsInData].sort((a, b) => b - a); // descending
    const latestYear = sortedYears[0];
    const previousYear = sortedYears[1];
    const latestYtd = ytdComparison.yearStats[latestYear]?.ytd || 0;
    const prevYtd = ytdComparison.yearStats[previousYear]?.ytd || 0;
    const difference = latestYtd - prevYtd;
    return { latestYear, previousYear, latestYtd, prevYtd, difference };
  }, [yearsInData, ytdComparison]);

  // Years in Original OTD data
  const originalOtdYearsInData = useMemo(() => {
    if (!originalOtdData || originalOtdData.length === 0) {
      return [currentYear - 1, currentYear];
    }
    const yearShipped: Record<number, number> = {};
    originalOtdData.forEach(d => {
      if (!yearShipped[d.year]) yearShipped[d.year] = 0;
      yearShipped[d.year] += (d.shipped_on_time || 0);
    });
    const years = Object.entries(yearShipped)
      .filter(([_, shipped]) => shipped > 0)
      .map(([year, _]) => parseInt(year))
      .sort((a, b) => a - b);
    return years.length > 0 ? years : [currentYear - 1, currentYear];
  }, [originalOtdData, currentYear]);

  // Transform Original OTD data for chart
  const originalOtdChartData = useMemo(() => {
    if (!originalOtdData || originalOtdData.length === 0) return [];
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyData: Record<string, { month: string; [key: string]: number | string | null }> = {};
    months.forEach(month => {
      monthlyData[month] = { month };
      originalOtdYearsInData.forEach(year => {
        monthlyData[month][`${year}`] = null;
      });
    });
    
    originalOtdData.forEach(item => {
      const monthName = item.month_name;
      if (monthlyData[monthName]) {
        const otdPct = typeof item.original_otd_pct === 'string' ? parseFloat(item.original_otd_pct) : Number(item.original_otd_pct);
        monthlyData[monthName][`${item.year}`] = otdPct;
      }
    });
    
    return months.map(month => monthlyData[month]);
  }, [originalOtdData, originalOtdYearsInData]);

  // Calculate YTD Original OTD for each year
  // Now includes both count-based and value-based metrics
  const originalOtdYtdComparison = useMemo(() => {
    if (!originalOtdData || originalOtdData.length === 0 || originalOtdYearsInData.length === 0) {
      return { yearStats: {}, hasData: false };
    }
    
    const yearStats: Record<number, { 
      ytd: number; 
      totalOnTime: number; 
      totalShipped: number;
      ytdValue: number;
      totalOnTimeValue: number;
      totalValue: number;
      lateValue: number;
    }> = {};
    
    originalOtdYearsInData.forEach(year => {
      const yearData = originalOtdData.filter(d => d.year === year);
      const totalOnTime = yearData.reduce((sum, d) => sum + (d.shipped_on_time || 0), 0);
      const totalShipped = yearData.reduce((sum, d) => sum + (d.total_shipped || 0), 0);
      const ytd = totalShipped > 0 ? (totalOnTime / totalShipped) * 100 : 0;
      
      // Value-based metrics (already normalized to numbers at fetch time)
      const totalOnTimeValue = yearData.reduce((sum, d) => sum + (d.on_time_value || 0), 0);
      const totalValue = yearData.reduce((sum, d) => sum + (d.total_value || 0), 0);
      const lateValue = yearData.reduce((sum, d) => sum + (d.late_value || 0), 0);
      const ytdValue = totalValue > 0 ? (totalOnTimeValue / totalValue) * 100 : 0;
      
      yearStats[year] = { 
        ytd, totalOnTime, totalShipped,
        ytdValue, totalOnTimeValue, totalValue, lateValue
      };
    });
    
    return { yearStats, hasData: Object.keys(yearStats).length > 0 };
  }, [originalOtdData, originalOtdYearsInData]);

  // Calculate YoY change for Original OTD
  const originalOtdYoyChange = useMemo(() => {
    if (originalOtdYearsInData.length < 2) return null;
    const sortedYears = [...originalOtdYearsInData].sort((a, b) => b - a);
    const latestYear = sortedYears[0];
    const previousYear = sortedYears[1];
    const latestYtd = originalOtdYtdComparison.yearStats[latestYear]?.ytd || 0;
    const prevYtd = originalOtdYtdComparison.yearStats[previousYear]?.ytd || 0;
    const difference = latestYtd - prevYtd;
    return { latestYear, previousYear, latestYtd, prevYtd, difference };
  }, [originalOtdYearsInData, originalOtdYtdComparison]);

  // Toggle reason selection
  const toggleReason = (reason: string) => {
    setSelectedReasons(prev => 
      prev.includes(reason) 
        ? prev.filter(r => r !== reason)
        : [...prev, reason]
    );
  };

  // Clear all reason filters
  const clearReasonFilters = () => {
    setSelectedReasons([]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-dashboard-title">Merchandising Operations Center</h1>
          <p className="text-muted-foreground">Track and analyze shipment performance metrics</p>
        </div>
        <HelpButton section="dashboard" />
      </div>
      {filterOptions && (
        <DashboardFiltersPanel
          filters={filters}
          onFiltersChange={setFilters}
          merchandisers={filterOptions.merchandisers}
          managers={filterOptions.managers}
          vendors={filterOptions.vendors}
          brands={filterOptions.brands}
        />
      )}
      {/* Header KPIs with YoY comparison - Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {headerKpisLoading ? (
          <>
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </>
        ) : (
          <>
            {/* 1. YTD Total Shipped */}
            <Card className="p-5">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  YTD Total Shipped
                </div>
                <span className="text-sm text-muted-foreground">YoY</span>
              </div>
              {/* Data Row */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-3xl font-bold text-primary" data-testid="text-ytd-sales">
                  ${((headerKpis?.ytdTotalSales ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                {salesYoY && (
                  <span className={`text-lg font-semibold ${salesYoY.isPositive ? 'text-green-500' : 'text-red-500'}`} data-testid="text-sales-yoy">
                    {salesYoY.isPositive ? '+' : '-'}{salesYoY.value.toFixed(1)}%
                  </span>
                )}
              </div>
              {/* Description Row */}
              <div className="text-xs text-muted-foreground">Revenue from shipped orders</div>
            </Card>

            {/* 2. YTD POs Unshipped */}
            <Card className="p-5">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  YTD POs Unshipped
                </div>
                <span className="text-sm text-muted-foreground">YoY</span>
              </div>
              {/* Data Row */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-3xl font-bold text-primary" data-testid="text-pos-unshipped">
                  ${((headerKpis?.ytdPosUnshipped ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                {posUnshippedYoY && (
                  <span className={`text-lg font-semibold ${posUnshippedYoY.isPositive ? 'text-green-500' : 'text-red-500'}`} data-testid="text-pos-unshipped-yoy">
                    {posUnshippedYoY.isPositive ? '+' : '-'}{posUnshippedYoY.value.toFixed(1)}%
                  </span>
                )}
              </div>
              {/* Description Row */}
              <div className="text-xs text-muted-foreground">Open POs not yet shipped</div>
            </Card>

            {/* 3. YTD Projections - No YoY comparison (projections are removed as they become confirmed POs) */}
            <Card className="p-5">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  YTD Projections
                </div>
              </div>
              {/* Data Row */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-3xl font-bold text-primary" data-testid="text-projections">
                  ${((headerKpis?.ytdProjections ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
              {/* Description Row */}
              <div className="text-xs text-muted-foreground">Client forecasts without POs</div>
            </Card>

            {/* 4. YTD Potential */}
            <Card className="p-5">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  YTD Potential
                </div>
                <span className="text-sm text-muted-foreground">YoY</span>
              </div>
              {/* Data Row */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-3xl font-bold text-primary" data-testid="text-potential">
                  ${((headerKpis?.ytdPotential ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
                {potentialYoY && (
                  <span className={`text-lg font-semibold ${potentialYoY.isPositive ? 'text-green-500' : 'text-red-500'}`} data-testid="text-potential-yoy">
                    {potentialYoY.isPositive ? '+' : '-'}{potentialYoY.value.toFixed(1)}%
                  </span>
                )}
              </div>
              {/* Description Row */}
              <div className="text-xs text-muted-foreground">Total: Shipped + Unshipped + Projections</div>
            </Card>
          </>
        )}
      </div>
      {/* Header KPIs with YoY comparison - Row 2: Work Volume for the Year */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {headerKpisLoading ? (
          <>
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </>
        ) : (
          <>
            {/* 1. POs Shipped */}
            <Card className="p-5">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  POs Shipped
                </div>
                <span className="text-sm text-muted-foreground">YoY</span>
              </div>
              {/* Data Row */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-3xl font-bold text-primary" data-testid="text-pos-shipped">
                  {headerKpis?.ytdTotalOrders?.toLocaleString() ?? 0}
                </div>
                {ordersYoY && (
                  <span className={`text-lg font-semibold ${ordersYoY.isPositive ? 'text-green-500' : 'text-red-500'}`} data-testid="text-pos-shipped-yoy">
                    {ordersYoY.isPositive ? '+' : '-'}{ordersYoY.value.toFixed(1)}%
                  </span>
                )}
              </div>
              {/* Description Row */}
              <div className="text-xs text-muted-foreground">Orders shipped in 2026</div>
            </Card>

            {/* 2. Total POs (shipped + on hand) */}
            <Card className="p-5">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Total POs
                </div>
                <span className="text-sm text-muted-foreground">YoY</span>
              </div>
              {/* Data Row */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-3xl font-bold text-primary" data-testid="text-total-pos">
                  {(headerKpis?.totalPosForYear ?? 0).toLocaleString()}
                </div>
                {totalPosYoY && (
                  <span className={`text-lg font-semibold ${totalPosYoY.isPositive ? 'text-green-500' : 'text-red-500'}`} data-testid="text-total-pos-yoy">
                    {totalPosYoY.isPositive ? '+' : '-'}{totalPosYoY.value.toFixed(1)}%
                  </span>
                )}
              </div>
              {/* Description Row */}
              <div className="text-xs text-muted-foreground">Shipped + on hand for 2026</div>
            </Card>

            {/* 3. Total SKUs */}
            <Card className="p-5">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  Total SKUs
                </div>
                <span className="text-sm text-muted-foreground">YoY</span>
              </div>
              {/* Data Row */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-3xl font-bold text-primary" data-testid="text-total-skus">
                  {headerKpis?.totalSkus?.toLocaleString() ?? 0}
                </div>
                {skuYoY && (
                  <span className={`text-lg font-semibold ${skuYoY.isPositive ? 'text-green-500' : 'text-red-500'}`} data-testid="text-sku-yoy">
                    {skuYoY.isPositive ? '+' : '-'}{skuYoY.value.toFixed(1)}%
                  </span>
                )}
              </div>
              {/* Description Row */}
              <div className="text-xs text-muted-foreground">Unique SKUs for 2026 orders</div>
            </Card>

            {/* 4. New SKUs */}
            <Card className="p-5">
              {/* Title Row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New SKUs
                </div>
                <span className="text-sm text-muted-foreground">YoY</span>
              </div>
              {/* Data Row */}
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-3xl font-bold text-primary" data-testid="text-new-skus">
                  {headerKpis?.newSkusYtd?.toLocaleString() ?? 0}
                </div>
                {newSkusYoY && (
                  <span className={`text-lg font-semibold ${newSkusYoY.isPositive ? 'text-green-500' : 'text-red-500'}`} data-testid="text-new-skus-yoy">
                    {newSkusYoY.isPositive ? '+' : '-'}{newSkusYoY.value.toFixed(1)}%
                  </span>
                )}
              </div>
              {/* Description Row */}
              <div className="text-xs text-muted-foreground">New style SKUs for 2026 (marked Y)</div>
            </Card>
          </>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpisLoading ? (
          <>
            {[...Array(7)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </>
        ) : (
          <>
            {/* Row 3: OTD metrics + Regular stock lead times */}
            <KPICard
              title="Original OTD"
              value={`${(kpis?.otdOriginalPercentage ?? 0).toFixed(1)}%`}
              subtitle={`${kpis?.otdOriginalOnTime ?? 0} / ${kpis?.otdOriginalTotal ?? 0} orders`}
              description="% of shipped orders delivered on or before the original cancel date"
              variant={(kpis?.otdOriginalPercentage ?? 0) >= 70 ? "success" : "danger"}
              data-testid="card-otd-original"
            />
            <KPICard
              title="Revised OTD"
              value={`${(kpis?.trueOtdPercentage ?? 0).toFixed(1)}%`}
              subtitle={`${kpis?.shippedOnTime ?? 0} / ${kpis?.shippedTotal ?? 0} orders`}
              description="% of shipped orders delivered on or before the revised cancel date"
              variant={(kpis?.trueOtdPercentage ?? 0) >= 80 ? "success" : "danger"}
              data-testid="card-revised-otd"
            />
            <KPICard
              title="1st Regular"
              value={`${kpis?.firstRegularDays ?? 0}d`}
              subtitle={`${kpis?.firstRegularCount ?? 0} orders`}
              description="Avg days from PO Date to Ship Date for first-time Regular stock items (YTD)"
              variant={(kpis?.firstRegularDays ?? 0) <= 120 ? "success" : "danger"}
              data-testid="card-first-regular"
            />
            <KPICard
              title="Repeat Reg"
              value={`${kpis?.repeatRegularDays ?? 0}d`}
              subtitle={`${kpis?.repeatRegularCount ?? 0} orders`}
              description="Avg days from PO Date to Ship Date for repeat Regular stock items (YTD)"
              variant={(kpis?.repeatRegularDays ?? 0) <= 45 ? "success" : "danger"}
              data-testid="card-repeat-reg"
            />
            {/* Row 4: Quality metrics + MTO lead times */}
            <KPICard
              title="Quality"
              value={`${(kpis?.qualityPassRate ?? 0).toFixed(1)}%`}
              subtitle="Pass rate"
              description="% of all inspections that passed (Material, Initial, Inline, Final)"
              variant={(kpis?.qualityPassRate ?? 0) >= 95 ? "success" : "danger"}
              data-testid="card-quality"
            />
            <KPICard
              title="Avg Late"
              value={`${kpis?.avgLateDays ?? 0} days`}
              subtitle="Delayed"
              description="Average number of days overdue for orders past their revised cancel date that haven't shipped"
              variant={(kpis?.avgLateDays ?? 0) <= 7 ? "success" : "danger"}
              data-testid="card-avg-late"
            />
            <KPICard
              title="1st MTO"
              value={`${kpis?.firstMtoDays ?? 0}d`}
              subtitle={`${kpis?.firstMtoCount ?? 0} orders`}
              description="Avg days from PO Date to Ship Date for first-time Made-To-Order items (YTD)"
              variant={(kpis?.firstMtoDays ?? 0) <= 120 ? "success" : "danger"}
              data-testid="card-first-mto"
            />
            <KPICard
              title="Repeat MTO"
              value={`${kpis?.repeatMtoDays ?? 0}d`}
              subtitle={`${kpis?.repeatMtoCount ?? 0} orders`}
              description="Avg days from PO Date to Ship Date for repeat Made-To-Order items (YTD)"
              variant={(kpis?.repeatMtoDays ?? 0) <= 60 ? "success" : "danger"}
              data-testid="card-repeat-mto"
            />
          </>
        )}
      </div>
      {/* Monthly Orders - YoY Comparison - positioned between KPIs and OTD chart */}
      <OrdersOnHandYoYChart filters={filters} clientName={selectedClient?.shortName} />
      {/* Unified OTD Performance Chart with Toggle Buttons */}
      <div>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle data-testid="text-yoy-chart-title">
                {otdType === 'revised' ? 'Revised' : 'Original'} OTD Performance
              </CardTitle>
              <CardDescription>
                {otdType === 'revised' 
                  ? 'On-Time Shipped / Total Shipped by month (uses revised cancel date)'
                  : 'On-Time Shipped vs Original Cancel Date by month (only vendor delays count as late)'
                } ({(otdType === 'revised' ? yearsInData : originalOtdYearsInData).join(' vs ')})
              </CardDescription>
            </div>
            
            {/* Toggle Buttons */}
            <div className="flex flex-col gap-3">
              {/* OTD Type Toggle - Revised vs Original */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Type:</span>
                <div className="flex rounded-md border">
                  <Button
                    variant={otdType === 'revised' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setOtdType('revised')}
                    className="rounded-r-none"
                    data-testid="button-otd-revised"
                  >
                    Revised
                  </Button>
                  <Button
                    variant={otdType === 'original' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setOtdType('original')}
                    className="rounded-l-none"
                    data-testid="button-otd-original"
                  >
                    Original
                  </Button>
                </div>
              </div>
              
              {/* Metric Toggle - Count vs Value */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Metric:</span>
                <div className="flex rounded-md border">
                  <Button
                    variant={otdMetric === 'count' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setOtdMetric('count')}
                    className="rounded-r-none"
                    data-testid="button-metric-count"
                  >
                    # Orders
                  </Button>
                  <Button
                    variant={otdMetric === 'value' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setOtdMetric('value')}
                    className="rounded-l-none"
                    data-testid="button-metric-value"
                  >
                    $ Shipped
                  </Button>
                </div>
              </div>
            </div>
            
            {/* YTD Comparison Stats */}
            {(() => {
              const isRevised = otdType === 'revised';
              const loading = isRevised ? yoyLoading : originalOtdLoading;
              const comparison = isRevised ? ytdComparison : originalOtdYtdComparison;
              const years = isRevised ? yearsInData : originalOtdYearsInData;
              const change = isRevised ? yoyChange : originalOtdYoyChange;
              
              if (loading || !comparison.hasData) return null;
              
              return (
                <div className="flex gap-4 flex-wrap text-right" data-testid="ytd-comparison">
                  <div className="text-xs text-muted-foreground self-center">
                    {otdMetric === 'count' ? 'By Order:' : 'By Value:'}
                  </div>
                  {years.map(year => (
                    <div key={year}>
                      <div className="text-xs text-muted-foreground">{year} YTD</div>
                      <div 
                        className="text-lg font-semibold" 
                        style={{ color: yearColors[year] || '#6b7280' }}
                        data-testid={`text-year-${year}-ytd`}
                      >
                        {otdMetric === 'count' 
                          ? (comparison.yearStats[year]?.ytd.toFixed(1) ?? 0)
                          : (comparison.yearStats[year]?.ytdValue.toFixed(1) ?? 0)}%
                      </div>
                    </div>
                  ))}
                  {years.length >= 2 && (() => {
                    const sortedYears = [...years].sort((a, b) => b - a);
                    const latestVal = otdMetric === 'count' 
                      ? comparison.yearStats[sortedYears[0]]?.ytd 
                      : comparison.yearStats[sortedYears[0]]?.ytdValue;
                    const prevVal = otdMetric === 'count' 
                      ? comparison.yearStats[sortedYears[1]]?.ytd 
                      : comparison.yearStats[sortedYears[1]]?.ytdValue;
                    const diff = (latestVal || 0) - (prevVal || 0);
                    return (
                      <div>
                        <div className="text-xs text-muted-foreground">YoY</div>
                        <div 
                          className={`text-lg font-semibold ${diff > 0 ? 'text-green-500' : diff < 0 ? 'text-red-500' : 'text-muted-foreground'}`}
                          data-testid="text-ytd-difference"
                        >
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </CardHeader>
          <CardContent>
            {(() => {
              const isRevised = otdType === 'revised';
              const loading = isRevised ? yoyLoading : originalOtdLoading;
              const chartData = isRevised ? yoyChartData : originalOtdChartData;
              const years = isRevised ? yearsInData : originalOtdYearsInData;
              const typeName = isRevised ? 'Revised' : 'Original';
              
              if (loading) {
                return <Skeleton className="h-80" />;
              }
              
              if (chartData.length === 0) {
                return (
                  <div className="flex items-center justify-center h-80 text-muted-foreground">
                    No {typeName.toLowerCase()} OTD data available
                  </div>
                );
              }
              
              // Transform chart data based on metric toggle
              const displayData = chartData.map(item => {
                const result: Record<string, any> = { month: item.month };
                years.forEach(year => {
                  if (otdMetric === 'value') {
                    // Use value-based OTD percentages
                    if (isRevised) {
                      const rawData = yoyData?.find((d) => d.year === year && d.month_name === item.month);
                      result[String(year)] = rawData?.revised_otd_value_pct ?? item[String(year)];
                    } else {
                      const rawData = originalOtdData?.find((d) => d.year === year && d.month_name === item.month);
                      result[String(year)] = rawData?.original_otd_value_pct ?? item[String(year)];
                    }
                  } else {
                    result[String(year)] = item[String(year)];
                  }
                });
                return result;
              });
              
              return (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={displayData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis 
                      tickFormatter={(value) => `${value}%`}
                      domain={[0, 100]}
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
                      formatter={(value) => {
                        const numValue = Number(value);
                        const metricLabel = otdMetric === 'value' ? '(by $)' : '(by #)';
                        return !isNaN(numValue) ? [`${numValue.toFixed(1)}%`, `${typeName} OTD ${metricLabel}`] : ['No data', ''];
                      }}
                      labelFormatter={(label) => `Month: ${label}`}
                    />
                    <Legend />
                    {years.map(year => (
                      <Line 
                        key={year}
                        type="monotone" 
                        dataKey={String(year)} 
                        stroke={yearColors[year] || '#6b7280'} 
                        strokeWidth={2}
                        name={`${year} ${typeName} OTD %`}
                        dot={{ r: 4 }}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              );
            })()}
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {kpisLoading ? (
          <>
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </>
        ) : (
          <>
            <StatusChart 
              title="Current Active POs by Status" 
              description="Unshipped orders only - click a bar to view filtered POs"
              data={statusData} 
              onBarClick={handleStatusChartClick}
              data-testid="chart-otd-status" 
            />
            <Card>
              <CardHeader>
                <CardTitle data-testid="text-vendor-chart-title">Vendor Late & At-Risk Shipments</CardTitle>
                <CardDescription>Click a bar to view filtered POs by vendor and status</CardDescription>
              </CardHeader>
              <CardContent>
                {vendorLoading ? (
                  <Skeleton className="h-80" />
                ) : vendorChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={vendorChartData} margin={{ left: 0, right: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="vendor" 
                        angle={-45} 
                        textAnchor="end" 
                        height={140}
                        interval={0}
                        tick={{ fontSize: 9 }}
                      />
                      <YAxis />
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
                      />
                      <Legend 
                        align="right" 
                        verticalAlign="bottom" 
                        wrapperStyle={{ paddingTop: 10, paddingRight: 10 }}
                      />
                      <Bar 
                        dataKey="Late" 
                        fill="#ef4444" 
                        cursor="pointer"
                        onClick={(data) => handleVendorChartClick(data.vendor, 'late')}
                      />
                      <Bar 
                        dataKey="At Risk" 
                        fill="#f97316" 
                        cursor="pointer"
                        onClick={(data) => handleVendorChartClick(data.vendor, 'at-risk')}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-80 text-muted-foreground">
                    No vendor data available
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
      {/* Currently Late Orders by Severity */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle data-testid="text-reason-chart-title">Currently Late Orders by Severity</CardTitle>
              <CardDescription>
                Orders past cancel date that haven't shipped (excludes Closed/Shipped/Cancelled)
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold text-destructive" data-testid="text-total-late-shipments">
                {totalLateShipments}
              </div>
              <div className="text-sm text-muted-foreground">Currently Late Orders</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {reasonsLoading ? (
            <Skeleton className="h-80" />
          ) : pieChartData.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Pie Chart with Legend */}
              <div className="flex flex-col items-center justify-center">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={pieChartData.slice(0, 6)}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={90}
                      paddingAngle={2}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieChartData.slice(0, 6).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value: number, name: string) => {
                        const item = pieChartData.find(d => d.name === name);
                        const dollarValue = item ? formatCurrency(item.totalValue) : '$0';
                        return [`${value} orders - ${dollarValue}`, name];
                      }}
                    />
                    <Legend 
                      layout="horizontal"
                      align="center"
                      verticalAlign="bottom"
                      wrapperStyle={{ paddingTop: 20, fontSize: '12px' }}
                      formatter={(value) => {
                        const item = pieChartData.find(d => d.name === value);
                        const dollarValue = item ? formatCurrency(item.totalValue) : '';
                        const displayName = value.length > 18 ? value.substring(0, 15) + '...' : value;
                        return `${displayName} (${dollarValue})`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div className="overflow-auto max-h-80">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-semibold" data-testid="header-reason">Severity</th>
                      <th className="text-right py-2 px-2 font-semibold whitespace-nowrap" data-testid="header-count">Count</th>
                      <th className="text-right py-2 px-2 font-semibold" data-testid="header-percentage">%</th>
                      <th className="text-right py-2 px-2 font-semibold whitespace-nowrap" data-testid="header-value">Value</th>
                      <th className="text-right py-2 px-2 font-semibold whitespace-nowrap" data-testid="header-avg-days">Avg Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reasonTableData.map((row, index) => (
                      <tr key={index} className="border-b hover:bg-muted/50" data-testid={`row-reason-${index}`}>
                        <td className="py-2 px-2 max-w-[200px] truncate" title={row.reason} data-testid={`text-reason-${index}`}>
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full flex-shrink-0" 
                              style={{ backgroundColor: index < 6 ? PIE_COLORS[index] : '#9ca3af' }}
                            />
                            <span className="truncate">{row.reason}</span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 font-medium" data-testid={`text-count-${index}`}>{row.count}</td>
                        <td className="text-right py-2 px-2" data-testid={`text-percentage-${index}`}>{row.percentage}</td>
                        <td className="text-right py-2 px-2 text-muted-foreground" data-testid={`text-value-${index}`}>
                          {formatCurrency(row.totalValue)}
                        </td>
                        <td className="text-right py-2 px-2 text-destructive font-medium" data-testid={`text-avg-days-${index}`}>
                          {row.avgDaysLate}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-80 text-muted-foreground">
              No late shipment data available
            </div>
          )}
        </CardContent>
      </Card>
      {/* Late Shipments by Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle data-testid="text-status-chart-title">Currently Late Orders by Status</CardTitle>
              <CardDescription>
                Orders past cancel date that haven't shipped yet (excludes Closed/Shipped/Cancelled)
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold text-purple-500" data-testid="text-total-late-by-status">
                {totalLateByStatus}
              </div>
              <div className="text-sm text-muted-foreground">Currently Late Orders</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {statusesLoading ? (
            <Skeleton className="h-80" />
          ) : statusPieChartData.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Pie Chart with Legend */}
              <div className="flex flex-col items-center justify-center">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={statusPieChartData.slice(0, 6)}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={90}
                      paddingAngle={2}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusPieChartData.slice(0, 6).map((entry, index) => (
                        <Cell key={`status-cell-${index}`} fill={STATUS_PIE_COLORS[index % STATUS_PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value: number, name: string) => {
                        const item = statusPieChartData.find(d => d.name === name);
                        const dollarValue = item ? formatCurrency(item.totalValue) : '$0';
                        return [`${value} orders - ${dollarValue}`, name];
                      }}
                    />
                    <Legend 
                      layout="horizontal"
                      align="center"
                      verticalAlign="bottom"
                      wrapperStyle={{ paddingTop: 20, fontSize: '12px' }}
                      formatter={(value) => {
                        const item = statusPieChartData.find(d => d.name === value);
                        const dollarValue = item ? formatCurrency(item.totalValue) : '';
                        const displayName = value.length > 15 ? value.substring(0, 12) + '...' : value;
                        return `${displayName} (${dollarValue})`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div className="overflow-auto max-h-80">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-semibold" data-testid="header-status">Status</th>
                      <th className="text-right py-2 px-2 font-semibold whitespace-nowrap" data-testid="header-status-count">Count</th>
                      <th className="text-right py-2 px-2 font-semibold" data-testid="header-status-percentage">%</th>
                      <th className="text-right py-2 px-2 font-semibold whitespace-nowrap" data-testid="header-status-value">Value</th>
                      <th className="text-right py-2 px-2 font-semibold whitespace-nowrap" data-testid="header-status-avg-days">Avg Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusTableData.map((row, index) => (
                      <tr key={index} className="border-b hover:bg-muted/50" data-testid={`row-status-${index}`}>
                        <td className="py-2 px-2 max-w-[200px] truncate" title={row.status} data-testid={`text-status-${index}`}>
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full flex-shrink-0" 
                              style={{ backgroundColor: index < 6 ? STATUS_PIE_COLORS[index] : '#9ca3af' }}
                            />
                            <span className="truncate">{row.status}</span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 font-medium" data-testid={`text-status-count-${index}`}>{row.count}</td>
                        <td className="text-right py-2 px-2" data-testid={`text-status-percentage-${index}`}>{row.percentage}</td>
                        <td className="text-right py-2 px-2 text-muted-foreground" data-testid={`text-status-value-${index}`}>
                          {formatCurrency(row.totalValue)}
                        </td>
                        <td className="text-right py-2 px-2 text-purple-500 font-medium" data-testid={`text-status-avg-days-${index}`}>
                          {row.avgDaysLate}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-80 text-muted-foreground">
              No late shipment status data available
            </div>
          )}
        </CardContent>
      </Card>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-semibold" data-testid="text-late-at-risk-title">Late & At-Risk Purchase Orders</h2>
            <p className="text-muted-foreground">Showing recent POs that are late or at risk</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Risk:</span>
              <Select value={riskStatusFilter} onValueChange={(v) => setRiskStatusFilter(v as 'all' | 'late' | 'at-risk')}>
                <SelectTrigger className="w-[130px]" data-testid="select-risk-filter">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="late">Late Only</SelectItem>
                  <SelectItem value="at-risk">At Risk Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-[170px] justify-between" data-testid="button-status-filter">
                    {poStatusFilters.length === 0 
                      ? "All Statuses" 
                      : poStatusFilters.length === 1 
                        ? poStatusFilters[0] 
                        : `${poStatusFilters.length} selected`}
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[200px]">
                  {["Booked-to-ship", "EDI/Initial", "Final Inspection Passed", "Shipped", "Closed"].map((status) => (
                    <DropdownMenuCheckboxItem
                      key={status}
                      checked={poStatusFilters.includes(status)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setPoStatusFilters([...poStatusFilters, status]);
                        } else {
                          setPoStatusFilters(poStatusFilters.filter(s => s !== status));
                        }
                      }}
                      data-testid={`checkbox-status-${status.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                    >
                      {status}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        {lateAtRiskLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <DataTable
            columns={lateAtRiskColumns}
            data={(lateAtRiskPOs || []).filter(po => {
              let passRiskFilter = true;
              if (riskStatusFilter === 'late') passRiskFilter = po.is_late;
              else if (riskStatusFilter === 'at-risk') passRiskFilter = po.is_at_risk && !po.is_late;
              
              let passStatusFilter = true;
              if (poStatusFilters.length > 0) passStatusFilter = poStatusFilters.includes(po.status);
              
              return passRiskFilter && passStatusFilter;
            })}
            searchPlaceholder="Search late/at-risk orders..."
            onExport={(filteredData) => exportToCSV(filteredData, 'late-at-risk-purchase-orders.csv')}
            data-testid="table-late-at-risk-pos"
          />
        )}
      </div>
      {/* AI Shipping Analyst Chat */}
      <AIShippingAnalyst />
    </div>
  );
}
