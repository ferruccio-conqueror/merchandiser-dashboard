import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useClientContext } from "@/contexts/ClientContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { TrendingUp, TrendingDown, Target, AlertTriangle, Download, ArrowUpRight, ArrowDownRight, Minus, RefreshCcw, ChevronDown, MessageSquare, Trash2, Check } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine, Cell } from "recharts";

// Type for unmatched projection record
interface UnmatchedProjection {
  id: number;
  vendor_id: number;
  vendor_name: string;
  sku: string;
  description: string | null;
  brand: string;
  year: number;
  month: number;
  projection_quantity: number;
  projection_value: number;
  order_type: string | null;
  match_status: string | null;
  matched_po_number: string | null;
  matched_value: number | null;
  actual_quantity?: number | null;
  actual_value?: number | null;
  comment?: string | null;
  created_at: string;
}

interface VendorAccuracyStats {
  vendorId: number;
  vendorName: string;
  totalProjected: number;
  totalActual: number;
  overallVariancePct: number;
  variance: number;
  byMonth: Record<number, { projected: number; actual: number }>;
  byBrand: Record<string, { projected: number; actual: number }>;
}

interface MonthlyTrend {
  month: number;
  projected: number;
  projectedMto?: number;
  projectedRegular?: number;
  actual: number;
  variance: number;
  variancePct: number;
}

// NEW V2 Types: Visual 1 - Accuracy Chart (Projected vs Actual with horizon)
interface AccuracyChartMonth {
  month: number;
  monthName: string;
  projected: number;
  actual: number;
  varianceDollar: number;
  variancePct: number | null;
  snapshotDate: string | null;
  hasSnapshot: boolean;
}

// NEW V2 Types: Visual 2A - Error Trend (line chart)
interface ErrorTrendMonth {
  month: number;
  monthName: string;
  errorPct: number | null;
  projected: number;
  actual: number;
  hasData: boolean;
}

// NEW V2 Types: Visual 2B - Churn Trend (volatility)
interface ChurnTrendMonth {
  month: number;
  monthName: string;
  churnScore: number;
  snapshotCount: number;
  avgProjection: number;
  series: Array<{ runDate: string; projectedValue: number }>;
}

// NEW V2 Types: Visual 3 - Cleanup Status (stacked bar)
interface CleanupStatusMonth {
  month: number;
  monthName: string;
  projected: number;
  actual: number;
  matched: number;
  unmatchedNotExpired: number;
  unmatchedExpired: number;
  overReceived: number;
  expectedBy: string;
  isExpired: boolean;
  isPartial: boolean;
  isUnderForecasted: boolean;
}

// LEGACY: Chart 1: Current Projection Status by month (kept for compatibility)
interface ProjectionStatusMonth {
  month: number;
  matched: number;
  partial: number;
  unmatched: number;
  expired: number;
  total: number;
}

// LEGACY: Chart 2: Locked Projection Accuracy with lead times (kept for compatibility)
interface LockedAccuracyMonth {
  month: number;
  lockedRegular: number;
  lockedMto: number;
  actualRegular: number;
  actualMto: number;
  totalLocked: number;
  totalActual: number;
  variance: number;
  variancePct: number;
  regularSourceMonth: number | null;
  mtoSourceMonth: number | null;
}

interface OverallStats {
  totalProjected: number;
  totalActual: number;
  overallVariancePct: number;
  variance: number;
  partialCount: number;
  unmatchedCount: number;
  partialValue: number;
}

interface AccuracyReportData {
  year: number;
  overall: OverallStats;
  byVendor: VendorAccuracyStats[];
  monthlyTrend: MonthlyTrend[];
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Locks Section Component - shows projection locks and accuracy data
function LocksSection({ year }: { year: number }) {
  const { toast } = useToast();
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [selectedHorizon, setSelectedHorizon] = useState<string>("all");

  const toggleMonth = (month: number) => {
    setSelectedMonths(prev => 
      prev.includes(month) 
        ? prev.filter(m => m !== month)
        : [...prev, month].sort((a, b) => a - b)
    );
  };

  const { data: locksData, isLoading, refetch } = useQuery<{ locks: any[]; summary: any }>({
    queryKey: ['/api/projections/accuracy-report', { year, months: selectedMonths.length > 0 ? selectedMonths.join(',') : undefined, horizon: selectedHorizon !== 'all' ? selectedHorizon : undefined }],
  });

  // Create locks from active_projections (existing projection data)
  const createLocksMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/projections/create-locks-from-sku-projections', {});
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "Locks Created", 
        description: `Created ${data.totalLocksCreated} new locks, updated ${data.totalLocksUpdated} existing locks from ${data.projectionsProcessed} projections` 
      });
      queryClient.invalidateQueries({ queryKey: ['/api/projections/accuracy'] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Sync locks with live actuals from po_headers (same data source as Dashboard)
  const syncActualsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/projections/match-actuals-to-locks', { targetYear: year });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Accuracy Updated", description: `${data.matched} with orders, ${data.unmatched} no orders yet` });
      queryClient.invalidateQueries({ queryKey: ['/api/projections/accuracy'] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
  };

  const exportLocksCSV = () => {
    if (!locksData?.locks?.length) return;
    const headers = ['Vendor', 'Year', 'Month', 'Horizon', 'Type', 'Locked Value', 'Actual Value', 'Variance $', 'Variance %', 'Status'];
    const rows = locksData.locks.map((l: any) => [
      l.vendor_name || `Vendor ${l.vendor_id}`,
      l.target_year,
      monthNames[(l.target_month || 1) - 1],
      l.lock_horizon,
      l.order_type,
      ((l.locked_value || 0) / 100).toFixed(2),
      ((l.actual_value || 0) / 100).toFixed(2),
      ((l.variance_dollar || 0) / 100).toFixed(2),
      l.variance_pct || 0,
      Math.abs(l.variance_pct || 0) <= 10 ? 'Accurate' : (l.variance_pct > 10 ? 'Over' : 'Under'),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `projection-locks-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }

  const locks = locksData?.locks || [];
  const summary = locksData?.summary || { accuracyRate: 0, totalLockedValue: 0, totalActualValue: 0, withinRange: 0, overOrdered: 0, underOrdered: 0 };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-40 justify-between" data-testid="select-lock-months">
                {selectedMonths.length === 0 
                  ? "All Months" 
                  : selectedMonths.length === 12 
                    ? "All Months"
                    : `${selectedMonths.length} month${selectedMonths.length > 1 ? 's' : ''}`}
                <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="start">
              <div className="flex flex-col gap-1">
                <div 
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover-elevate cursor-pointer"
                  onClick={() => setSelectedMonths([])}
                >
                  <Checkbox 
                    checked={selectedMonths.length === 0}
                    data-testid="checkbox-all-months"
                  />
                  <span className="text-sm">All Months</span>
                </div>
                <Separator className="my-1" />
                {monthNames.map((m, i) => (
                  <div 
                    key={i}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover-elevate cursor-pointer"
                    onClick={() => toggleMonth(i + 1)}
                  >
                    <Checkbox 
                      checked={selectedMonths.includes(i + 1)}
                      data-testid={`checkbox-month-${i + 1}`}
                    />
                    <span className="text-sm">{m}</span>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Select value={selectedHorizon} onValueChange={setSelectedHorizon}>
            <SelectTrigger className="w-32" data-testid="select-horizon">
              <SelectValue placeholder="All Horizons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Horizons</SelectItem>
              <SelectItem value="6_month">6 Month</SelectItem>
              <SelectItem value="90_day">90 Day</SelectItem>
              <SelectItem value="30_day">30 Day</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportLocksCSV} data-testid="button-export-locks">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button 
            variant="outline" 
            onClick={() => createLocksMutation.mutate()} 
            disabled={createLocksMutation.isPending} 
            data-testid="button-create-locks"
          >
            <Target className={`h-4 w-4 mr-2 ${createLocksMutation.isPending ? 'animate-spin' : ''}`} />
            Create Locks
          </Button>
          <Button onClick={() => syncActualsMutation.mutate()} disabled={syncActualsMutation.isPending} data-testid="button-sync-actuals">
            <RefreshCcw className={`h-4 w-4 mr-2 ${syncActualsMutation.isPending ? 'animate-spin' : ''}`} />
            Sync with PO Data
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Accuracy Rate</CardDescription>
            <CardTitle className="text-2xl text-green-600">{summary.accuracyRate}%</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Within ±10% variance</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Locked Value</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(summary.totalLockedValue)}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Frozen projections</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Shipped Value</CardDescription>
            <CardTitle className="text-2xl text-green-600">{formatCurrency(summary.totalActualValue)}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Same metric as Dashboard KPIs</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Lock Status</CardDescription>
            <CardTitle className="text-sm flex flex-col gap-1">
              <span className="text-green-600">{summary.withinRange} accurate</span>
              <span className="text-blue-600">{summary.overOrdered} over</span>
              <span className="text-amber-600">{summary.underOrdered} under</span>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Projection Locks</CardTitle>
          <CardDescription>Locked projections with variance calculations</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Month</TableHead>
                <TableHead>Horizon</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Locked $</TableHead>
                <TableHead className="text-right">Actual $</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locks.slice(0, 50).map((lock: any) => (
                <TableRow key={lock.id}>
                  <TableCell>{lock.vendor_name || `Vendor ${lock.vendor_id}`}</TableCell>
                  <TableCell>{monthNames[(lock.target_month || 1) - 1]} {lock.target_year}</TableCell>
                  <TableCell><Badge variant="outline">{lock.lock_horizon?.replace('_', ' ')}</Badge></TableCell>
                  <TableCell><Badge variant={lock.order_type === 'spo' ? 'secondary' : 'default'}>{lock.order_type}</Badge></TableCell>
                  <TableCell className="text-right">{formatCurrency(lock.locked_value || 0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(lock.actual_value || 0)}</TableCell>
                  <TableCell className="text-right">
                    <span className={lock.variance_pct > 10 ? 'text-blue-600' : lock.variance_pct < -10 ? 'text-amber-600' : 'text-green-600'}>
                      {lock.variance_pct !== null ? `${lock.variance_pct > 0 ? '+' : ''}${lock.variance_pct}%` : '-'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {Math.abs(lock.variance_pct || 0) <= 10 ? (
                      <Badge className="bg-green-100 text-green-800">Accurate</Badge>
                    ) : lock.variance_pct > 10 ? (
                      <Badge className="bg-blue-100 text-blue-800">Over</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">Under</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {locks.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No locks found. Import projections and apply locks first.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Drift Section Component - shows how projections changed over time
function DriftSection({ year }: { year: number }) {
  const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());

  const { data: driftData, isLoading } = useQuery<any>({
    queryKey: ['/api/projections/drift', { targetYear: year, targetMonth: parseInt(selectedMonth) }],
  });

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
  };

  const exportDriftCSV = () => {
    if (!driftData?.driftSummary?.length) return;
    const headers = ['Vendor', 'Uploads', 'First Projection', 'Last Projection', 'Drift $', 'Drift %'];
    const rows = driftData.driftSummary.map((v: any) => [
      v.vendorName,
      v.uploadCount,
      (v.firstProjectedValue / 100).toFixed(2),
      (v.lastProjectedValue / 100).toFixed(2),
      (v.driftDollar / 100).toFixed(2),
      v.driftPct,
    ]);
    const csv = [headers.join(','), ...rows.map((r: (string | number)[]) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forecast-drift-${year}-${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }

  const summary = driftData?.driftSummary || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Forecast Drift Analysis</h3>
          <p className="text-sm text-muted-foreground">Track how projections changed across monthly runs for {monthNames[parseInt(selectedMonth) - 1]} {year}</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-32" data-testid="select-drift-month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthNames.map((m, i) => (
                <SelectItem key={i} value={(i + 1).toString()}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportDriftCSV} data-testid="button-export-drift">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Uploads</CardDescription>
            <CardTitle className="text-2xl">{driftData?.totalUploads || 0}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Projection files for this month</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Vendors Tracked</CardDescription>
            <CardTitle className="text-2xl">{driftData?.vendorCount || 0}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">With projection data</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Largest Drift</CardDescription>
            <CardTitle className="text-2xl">
              {summary.length > 0 ? `${summary[0].driftPct > 0 ? '+' : ''}${summary[0].driftPct}%` : 'N/A'}
            </CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">{summary.length > 0 ? summary[0].vendorName : 'No drift data'}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vendor Forecast Drift</CardTitle>
          <CardDescription>Change from first to last projection upload</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Uploads</TableHead>
                <TableHead className="text-right">First Projection</TableHead>
                <TableHead className="text-right">Last Projection</TableHead>
                <TableHead className="text-right">Drift $</TableHead>
                <TableHead className="text-right">Drift %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.map((vendor: any) => (
                <TableRow key={vendor.vendorId}>
                  <TableCell className="font-medium">{vendor.vendorName}</TableCell>
                  <TableCell><Badge variant="secondary">{vendor.uploadCount}</Badge></TableCell>
                  <TableCell className="text-right">{formatCurrency(vendor.firstProjectedValue)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(vendor.lastProjectedValue)}</TableCell>
                  <TableCell className="text-right">
                    <span className={vendor.driftDollar > 0 ? 'text-blue-600' : 'text-amber-600'}>
                      {vendor.driftDollar > 0 ? '+' : ''}{formatCurrency(vendor.driftDollar)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={vendor.driftPct > 0 ? 'text-blue-600' : 'text-amber-600'}>
                      {vendor.driftPct > 0 ? '+' : ''}{vendor.driftPct}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {summary.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No drift data available. Import multiple projection files for the same target month to track drift.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Backlog Section Component - shows under-ordered items with comments
function BacklogSection({ year }: { year: number }) {
  const { toast } = useToast();
  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  const { data: backlogData, isLoading, refetch } = useQuery<{ items: any[]; summary: any }>({
    queryKey: ['/api/projections/backlog', { targetYear: year, targetMonth: selectedMonth !== 'all' ? parseInt(selectedMonth) : undefined }],
  });

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
  };

  const saveCommentMutation = useMutation({
    mutationFn: async ({ lockId, comment }: { lockId: number; comment: string }) => {
      const response = await apiRequest('POST', `/api/projections/backlog/${lockId}/comment`, { comment });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Comment Saved" });
      refetch();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const exportBacklogCSV = () => {
    if (!backlogData?.items?.length) return;
    const headers = ['Vendor', 'Year', 'Month', 'Type', 'Locked Value', 'Actual Value', 'Gap $', 'Comment'];
    const rows = backlogData.items.map((item: any) => [
      item.vendor_name || `Vendor ${item.vendor_id}`,
      item.target_year,
      monthNames[(item.target_month || 1) - 1],
      item.order_type,
      ((item.locked_value || 0) / 100).toFixed(2),
      ((item.actual_value || 0) / 100).toFixed(2),
      (Math.abs(item.variance_dollar || 0) / 100).toFixed(2),
      `"${(item.comment || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `projection-backlog-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }

  const items = backlogData?.items || [];
  const summary = backlogData?.summary || { totalItems: 0, totalBacklogValue: 0, byVendor: {} };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Backlog Management</h3>
          <p className="text-sm text-muted-foreground">Items where actual orders are below locked projections</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-32" data-testid="select-backlog-month">
              <SelectValue placeholder="All Months" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Months</SelectItem>
              {monthNames.map((m, i) => (
                <SelectItem key={i} value={(i + 1).toString()}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportBacklogCSV} data-testid="button-export-backlog">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardDescription>Total Backlog Items</CardDescription>
            <CardTitle className="text-2xl text-amber-600">{summary.totalItems}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Under-ordered projections</p></CardContent>
        </Card>
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardDescription>Total Backlog Value</CardDescription>
            <CardTitle className="text-2xl text-amber-600">{formatCurrency(summary.totalBacklogValue)}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Gap between locked and actual</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backlog Items</CardTitle>
          <CardDescription>Click to add notes explaining the gap</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Month</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Locked $</TableHead>
                <TableHead className="text-right">Actual $</TableHead>
                <TableHead className="text-right">Gap</TableHead>
                <TableHead>Comment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.slice(0, 50).map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.vendor_name || `Vendor ${item.vendor_id}`}</TableCell>
                  <TableCell>{monthNames[(item.target_month || 1) - 1]} {item.target_year}</TableCell>
                  <TableCell><Badge variant={item.order_type === 'spo' ? 'secondary' : 'default'}>{item.order_type}</Badge></TableCell>
                  <TableCell className="text-right">{formatCurrency(item.locked_value || 0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.actual_value || 0)}</TableCell>
                  <TableCell className="text-right text-amber-600">{formatCurrency(Math.abs(item.variance_dollar || 0))}</TableCell>
                  <TableCell>
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-sm border rounded"
                      placeholder="Add comment..."
                      defaultValue={item.comment || ''}
                      onBlur={(e) => {
                        if (e.target.value !== (item.comment || '')) {
                          saveCommentMutation.mutate({ lockId: item.id, comment: e.target.value });
                        }
                      }}
                      data-testid={`input-comment-${item.id}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {items.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No backlog items. All projections are meeting or exceeding actual orders.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ProjectionsDashboard() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedVendorId, setSelectedVendorId] = useState<string>("all");
  const [selectedMerchandiser, setSelectedMerchandiser] = useState<string>("all");
  const [selectedManager, setSelectedManager] = useState<string>("all");
  const [selectedBrand, setSelectedBrand] = useState<string>("all"); // all, CB, CB2, C&K
  const [comparisonHorizon, setComparisonHorizon] = useState<string>("90D"); // 90D or 180D for forecast comparison
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedProjection, setSelectedProjection] = useState<UnmatchedProjection | null>(null);
  const [projectionModalOpen, setProjectionModalOpen] = useState(false);
  const [editingComment, setEditingComment] = useState("");
  const [selectedHorizon, setSelectedHorizon] = useState<string>("90_day"); // 90_day, 6_month, or 90_day_from_today
  const [varianceOrderType, setVarianceOrderType] = useState<string>("all"); // all, regular, mto
  const [varianceBrand, setVarianceBrand] = useState<string>("all"); // all, CB, CB2, C&K
  
  // Client context for filtering
  const { selectedClientId } = useClientContext();
  
  // NEW: V2 Chart Controls
  const [v2Horizon, setV2Horizon] = useState<string>("90D"); // 90D or 6MO
  const [v2OrderType, setV2OrderType] = useState<string>("all"); // all, regular, spo
  const [v2Brand, setV2Brand] = useState<string>("all"); // all, CB, CB2, C&K
  const [v2MetricType, setV2MetricType] = useState<string>("signed"); // signed or absolute (for error trend)
  const [selectedChurnMonth, setSelectedChurnMonth] = useState<number | null>(null); // For drill-down
  
  const { toast } = useToast();

  // Mutation for updating projection comment
  const updateCommentMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment: string }) => {
      const response = await apiRequest('PATCH', `/api/projections/${id}/comment`, { comment });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Comment Saved", description: "Projection comment has been updated" });
      // Invalidate all projection-related queries using predicate
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/projections/');
        }
      });
      setProjectionModalOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Mutation for removing/marking projection as verified
  const removeProjectionMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const response = await apiRequest('PATCH', `/api/projections/${id}/remove`, { reason });
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Projection Removed", description: "Projection has been marked as verified/removed" });
      // Invalidate all projection-related queries using predicate
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.startsWith('/api/projections/');
        }
      });
      setProjectionModalOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Open projection detail modal
  const openProjectionModal = (projection: UnmatchedProjection) => {
    setSelectedProjection(projection);
    setEditingComment(projection.comment || "");
    setProjectionModalOpen(true);
  };

  // Fetch vendors for filter dropdown
  const { data: vendors = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['/api/vendors'],
  });

  // Fetch staff for filter dropdowns
  const { data: staff = [] } = useQuery<{ id: number; name: string; role: string }[]>({
    queryKey: ['/api/staff'],
  });

  // Get merchandisers and managers from staff list
  const merchandisers = staff.filter(s => s.role === 'merchandiser' || s.role === 'admin').map(s => s.name).sort();
  const managers = staff.filter(s => s.role === 'merchandising_manager' || s.role === 'admin').map(s => s.name).sort();

  const queryParams: Record<string, string | number> = { year: selectedYear };
  if (selectedVendorId !== "all") {
    queryParams.vendorId = selectedVendorId;
  }
  queryParams.horizon = selectedHorizon;
  if (varianceOrderType !== "all") {
    queryParams.orderType = varianceOrderType;
  }
  if (varianceBrand !== "all") {
    queryParams.brand = varianceBrand;
  }
  
  const { data: reportData, isLoading } = useQuery<AccuracyReportData>({
    queryKey: ['/api/projections/accuracy-report', queryParams],
  });

  // ============================================================================
  // NEW V2 API QUERIES - Following GPT Spec for 3 Visuals
  // ============================================================================
  
  // V2 Visual 1: Accuracy Chart (Projected vs Actual at horizon)
  // Uses main filters (selectedBrand, comparisonHorizon) for consistency
  const v2AccuracyParams: Record<string, string | number> = { 
    year: selectedYear, 
    horizon: comparisonHorizon === "180D" ? "6MO" : "90D", // Map 180D to 6MO for API
    orderType: v2OrderType,
  };
  if (selectedVendorId !== "all") {
    v2AccuracyParams.vendorId = selectedVendorId;
  }
  if (selectedBrand !== "all") {
    v2AccuracyParams.brand = selectedBrand;
  }
  if (selectedClientId) {
    v2AccuracyParams.clientId = selectedClientId;
  }
  const { data: v2AccuracyData, isLoading: isLoadingV2Accuracy } = useQuery<{ 
    year: number; 
    horizon: string;
    orderType: string;
    data: AccuracyChartMonth[]; 
  }>({
    queryKey: ['/api/projections/v2/accuracy-chart', v2AccuracyParams],
  });
  
  // V2 Visual 2A: Error Trend (line chart)
  // Uses main filters (selectedBrand, comparisonHorizon) for consistency
  const v2ErrorTrendParams: Record<string, string | number> = { 
    year: selectedYear, 
    horizon: comparisonHorizon === "180D" ? "6MO" : "90D",
    metricType: v2MetricType,
    orderType: v2OrderType,
  };
  if (selectedVendorId !== "all") {
    v2ErrorTrendParams.vendorId = selectedVendorId;
  }
  if (selectedBrand !== "all") {
    v2ErrorTrendParams.brand = selectedBrand;
  }
  if (selectedClientId) {
    v2ErrorTrendParams.clientId = selectedClientId;
  }
  const { data: v2ErrorTrendData, isLoading: isLoadingV2Error } = useQuery<{ 
    year: number; 
    horizon: string;
    metricType: string;
    data: ErrorTrendMonth[]; 
  }>({
    queryKey: ['/api/projections/v2/error-trend', v2ErrorTrendParams],
  });
  
  // V2 Visual 2B: Churn Trend (volatility)
  // Uses main filters (selectedBrand) for consistency
  const v2ChurnParams: Record<string, string | number> = { 
    year: selectedYear, 
    orderType: v2OrderType,
  };
  if (selectedVendorId !== "all") {
    v2ChurnParams.vendorId = selectedVendorId;
  }
  if (selectedBrand !== "all") {
    v2ChurnParams.brand = selectedBrand;
  }
  if (selectedClientId) {
    v2ChurnParams.clientId = selectedClientId;
  }
  const { data: v2ChurnData, isLoading: isLoadingV2Churn } = useQuery<{ 
    year: number; 
    data: ChurnTrendMonth[]; 
  }>({
    queryKey: ['/api/projections/v2/churn-trend', v2ChurnParams],
  });
  
  // V2 Visual 3: Cleanup Status (stacked bar: Matched, Unmatched Not Expired, Unmatched Expired)
  // Uses main filters (selectedBrand) for consistency
  const v2CleanupParams: Record<string, string | number> = { 
    year: selectedYear, 
    orderType: v2OrderType,
  };
  if (selectedVendorId !== "all") {
    v2CleanupParams.vendorId = selectedVendorId;
  }
  if (selectedBrand !== "all") {
    v2CleanupParams.brand = selectedBrand;
  }
  if (selectedClientId) {
    v2CleanupParams.clientId = selectedClientId;
  }
  const { data: v2CleanupData, isLoading: isLoadingV2Cleanup } = useQuery<{ 
    year: number;
    latestRunDate: string;
    data: CleanupStatusMonth[]; 
  }>({
    queryKey: ['/api/projections/v2/cleanup-status', v2CleanupParams],
  });
  
  // ============================================================================
  // LEGACY QUERIES - Kept for backward compatibility
  // ============================================================================
  
  // Chart 1: Current Projection Status - shows matched/unmatched/expired/partial by month
  const statusParams: Record<string, string | number> = { year: selectedYear };
  if (selectedVendorId !== "all") {
    statusParams.vendorId = selectedVendorId;
  }
  const { data: projectionStatusData } = useQuery<{ year: number; statusByMonth: ProjectionStatusMonth[] }>({
    queryKey: ['/api/projections/status-by-month', statusParams],
  });

  // Chart 2: Locked Projection Accuracy - compares locked projections to actuals with lead time offset
  const lockedAccuracyParams: Record<string, string | number> = { year: selectedYear };
  if (selectedVendorId !== "all") {
    lockedAccuracyParams.vendorId = selectedVendorId;
  }
  const { data: lockedAccuracyData } = useQuery<{ 
    year: number; 
    accuracyByMonth: LockedAccuracyMonth[]; 
    leadTimes: { regular: number; mto: number }; 
  }>({
    queryKey: ['/api/projections/locked-accuracy-chart', lockedAccuracyParams],
  });

  // Legacy query for Monthly Trends (kept for backward compatibility)
  const monthlyTrendsParams: Record<string, string | number> = { year: selectedYear };
  if (selectedVendorId !== "all") {
    monthlyTrendsParams.vendorId = selectedVendorId;
  }
  const { data: monthlyTrendsData } = useQuery<{ year: number; monthlyTrend: MonthlyTrend[] }>({
    queryKey: ['/api/projections/monthly-trends', monthlyTrendsParams],
  });

  // Build query params for unmatched projections (respects all filters)
  const unmatchedParams: Record<string, string | number> = { year: selectedYear };
  if (selectedVendorId !== "all") {
    unmatchedParams.vendorId = selectedVendorId;
  }
  if (selectedMerchandiser !== "all") {
    unmatchedParams.merchandiser = selectedMerchandiser;
  }
  if (selectedManager !== "all") {
    unmatchedParams.manager = selectedManager;
  }
  if (selectedMonth !== null) {
    unmatchedParams.month = selectedMonth;
  }
  if (selectedClientId) {
    unmatchedParams.clientId = selectedClientId;
  }

  const { data: unmatchedProjections = [] } = useQuery<UnmatchedProjection[]>({
    queryKey: ['/api/projections/unmatched', unmatchedParams],
  });

  const runMatchingMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/projections/run-matching', { year: selectedYear });
      return response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "SKU-Level Matching Complete",
        description: `${data.matched} fully matched, ${data.partialMatches || 0} partial. ${data.unmatched || 0} remain unmatched.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/projections/accuracy-report'] });
    },
    onError: (error: any) => {
      toast({
        title: "Matching Failed",
        description: error.message || "Failed to run projection matching",
        variant: "destructive",
      });
    },
  });

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  const formatPercent = (pct: number) => {
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
  };

  const getVarianceColor = (pct: number) => {
    if (Math.abs(pct) <= 10) return 'text-green-600';
    if (pct > 10) return 'text-blue-600'; // Over-ordering
    return 'text-amber-600'; // Under-ordering
  };

  const getVarianceBadge = (pct: number) => {
    if (Math.abs(pct) <= 10) return <Badge className="bg-green-100 text-green-800">Accurate</Badge>;
    if (pct > 10) return <Badge className="bg-blue-100 text-blue-800">Over-Ordered</Badge>;
    return <Badge className="bg-amber-100 text-amber-800">Under-Ordered</Badge>;
  };

  const getVarianceIcon = (pct: number) => {
    if (Math.abs(pct) <= 10) return <Minus className="h-4 w-4 text-green-600" />;
    if (pct > 0) return <ArrowUpRight className="h-4 w-4 text-blue-600" />;
    return <ArrowDownRight className="h-4 w-4 text-amber-600" />;
  };

  const exportToCSV = () => {
    if (!reportData) return;
    
    const headers = [
      'Vendor', 'Total Projected ($)', 'Total Actual ($)', 'Variance ($)', 'Variance %'
    ];
    
    const rows = reportData.byVendor.map(v => [
      v.vendorName,
      (v.totalProjected / 100).toFixed(2),
      (v.totalActual / 100).toFixed(2),
      (v.variance / 100).toFixed(2),
      v.overallVariancePct.toFixed(1),
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `projections-dashboard-${selectedYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Legacy: Prepare chart data for Monthly Trends (kept for backward compatibility if needed)
  const monthlyChartData = monthlyTrendsData?.monthlyTrend.map(m => ({
    name: monthNames[m.month - 1],
    monthNum: m.month,
    projected: m.projected / 100,
    projectedMto: (m.projectedMto || 0) / 100,
    projectedRegular: (m.projectedRegular || 0) / 100,
    actual: m.actual / 100,
    variance: m.variancePct,
  })) || [];

  const vendorChartData = (reportData?.byVendor || [])
    .map(v => ({
      vendorId: v.vendorId,
      name: v.vendorName.length > 15 ? v.vendorName.substring(0, 15) + '...' : v.vendorName,
      fullName: v.vendorName,
      variance: v.overallVariancePct,
      projected: v.totalProjected / 100,
      actual: v.totalActual / 100,
      byMonth: v.byMonth,
      byBrand: v.byBrand,
    }));
  
  const [expandedVendors, setExpandedVendors] = useState<Set<number>>(new Set());
  
  const toggleVendorExpand = (vendorId: number) => {
    setExpandedVendors(prev => {
      const next = new Set(prev);
      if (next.has(vendorId)) {
        next.delete(vendorId);
      } else {
        next.add(vendorId);
      }
      return next;
    });
  };
  
  const getVarianceBarColor = (variance: number) => {
    if (variance > 10) return '#3b82f6'; // Blue: over-ordered
    if (variance < -10) return '#f59e0b'; // Orange: under-ordered
    return '#22c55e'; // Green: accurate
  };
  
  const maxAbsVariance = Math.max(...vendorChartData.map(v => Math.abs(v.variance)), 60);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const overall = reportData?.overall || {
    totalProjected: 0,
    totalActual: 0,
    overallVariancePct: 0,
    variance: 0,
    partialCount: 0,
    unmatchedCount: 0,
    partialValue: 0,
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projections Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-32" data-testid="select-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear, currentYear - 1, currentYear - 2].map(y => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportToCSV} data-testid="button-export-csv">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button 
            variant="default" 
            onClick={() => runMatchingMutation.mutate()}
            disabled={runMatchingMutation.isPending}
            data-testid="button-run-matching"
          >
            <RefreshCcw className={`h-4 w-4 mr-2 ${runMatchingMutation.isPending ? 'animate-spin' : ''}`} />
            {runMatchingMutation.isPending ? 'Running...' : 'Run Matching'}
          </Button>
        </div>
      </div>
      {/* Filters Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Merchandiser</label>
              <Select value={selectedMerchandiser} onValueChange={setSelectedMerchandiser}>
                <SelectTrigger data-testid="select-merchandiser">
                  <SelectValue placeholder="All Merchandisers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Merchandisers</SelectItem>
                  {merchandisers.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Manager</label>
              <Select value={selectedManager} onValueChange={setSelectedManager}>
                <SelectTrigger data-testid="select-manager">
                  <SelectValue placeholder="All Managers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Managers</SelectItem>
                  {managers.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Vendor</label>
              <Select value={selectedVendorId} onValueChange={setSelectedVendorId}>
                <SelectTrigger data-testid="select-vendor">
                  <SelectValue placeholder="All Vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vendors</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Brand</label>
              <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                <SelectTrigger data-testid="select-brand">
                  <SelectValue placeholder="All Brands" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  <SelectItem value="CB">CB</SelectItem>
                  <SelectItem value="CB2">CB2</SelectItem>
                  <SelectItem value="C&K">C&K</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Comparison Horizon</label>
              <Select value={comparisonHorizon} onValueChange={setComparisonHorizon}>
                <SelectTrigger data-testid="select-horizon">
                  <SelectValue placeholder="90 Days" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="90D">90 Days</SelectItem>
                  <SelectItem value="180D">180 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      <Tabs defaultValue="trends" className="space-y-4">
        <TabsList className="flex-wrap gap-1">
          <TabsTrigger value="trends" data-testid="tab-trends">Monthly Trends</TabsTrigger>
          <TabsTrigger value="drift" data-testid="tab-drift">Forecast Drift</TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="space-y-4">
            {/* Chart Controls */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Chart Controls</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">Horizon</label>
                    <Select value={v2Horizon} onValueChange={setV2Horizon}>
                      <SelectTrigger className="w-40" data-testid="select-v2-horizon">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="90D">90 Day (Regular) / 30 Day (SPO)</SelectItem>
                        <SelectItem value="6MO">6 Month</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">Order Type</label>
                    <Select value={v2OrderType} onValueChange={setV2OrderType}>
                      <SelectTrigger className="w-32" data-testid="select-v2-order-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="regular">Regular Only</SelectItem>
                        <SelectItem value="spo">SPO Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">Brand</label>
                    <Select value={v2Brand} onValueChange={setV2Brand}>
                      <SelectTrigger className="w-28" data-testid="select-v2-brand">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="CB">CB</SelectItem>
                        <SelectItem value="CB2">CB2</SelectItem>
                        <SelectItem value="C&K">C&K</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">Error Metric</label>
                    <Select value={v2MetricType} onValueChange={setV2MetricType}>
                      <SelectTrigger className="w-32" data-testid="select-v2-metric">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="signed">Signed %</SelectItem>
                        <SelectItem value="absolute">Absolute %</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Visual 1: Accuracy Bar Chart (Projected vs Actual at horizon) */}
            <Card>
              <CardHeader>
                <CardTitle>Accuracy Bar Chart</CardTitle>
                <CardDescription>
                  Compares projected values (at {v2Horizon === '90D' ? '90-day/30-day' : '6-month'} horizon) vs actual orders received. 
                  {v2Horizon === '90D' ? ' Regular uses 90-day cutoff, SPO uses 30-day cutoff.' : ' Uses 6-month lookback for projections.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingV2Accuracy ? (
                  <div className="h-80 flex items-center justify-center">
                    <Skeleton className="w-full h-full" />
                  </div>
                ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={v2AccuracyData?.data || []} style={{ cursor: 'pointer' }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="monthName" />
                      <YAxis tickFormatter={(v) => {
                          const dollars = v / 100;
                          if (dollars >= 1000000) return `$${(dollars / 1000000).toFixed(1)}M`;
                          if (dollars >= 1000) return `$${(dollars / 1000).toFixed(0)}k`;
                          return `$${dollars.toFixed(0)}`;
                        }} />
                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null;
                          const data = payload[0]?.payload as AccuracyChartMonth;
                          return (
                            <div className="bg-background border rounded-md shadow-md p-3 text-sm">
                              <div className="font-medium mb-2">Delivery Month: {label}</div>
                              <div className="flex justify-between gap-4">
                                <span className="text-blue-600">Projected:</span>
                                <span className="font-medium">${(data.projected / 100).toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-green-600">Actual:</span>
                                <span className="font-medium">${(data.actual / 100).toLocaleString()}</span>
                              </div>
                              <div className="mt-2 pt-2 border-t">
                                <span className={data.variancePct !== null && data.variancePct >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  Variance: {data.variancePct !== null ? `${data.variancePct > 0 ? '+' : ''}${data.variancePct.toFixed(1)}%` : 'N/A'}
                                </span>
                                {data.snapshotDate && (
                                  <div className="text-xs text-muted-foreground mt-1">
                                    Snapshot from: {data.snapshotDate}
                                  </div>
                                )}
                                {!data.hasSnapshot && (
                                  <div className="text-xs text-amber-600 mt-1">
                                    No projection snapshot available
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Legend />
                      <Bar dataKey="projected" name="Projected" fill="#3b82f6" />
                      <Bar dataKey="actual" name="Actual" fill="#22c55e" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                )}
              </CardContent>
            </Card>

            {/* Visual 2A: Forecast Error Trend (line chart) */}
            <Card>
              <CardHeader>
                <CardTitle>Forecast Deviation Trend</CardTitle>
                <CardDescription>
                  Shows {v2MetricType === 'signed' ? 'signed' : 'absolute'} forecast deviation percentage by month. 
                  Positive = over-projected, Negative = under-projected.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingV2Error ? (
                  <div className="h-64 flex items-center justify-center">
                    <Skeleton className="w-full h-full" />
                  </div>
                ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={v2ErrorTrendData?.data || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="monthName" />
                      <YAxis 
                        tickFormatter={(v) => `${v}%`} 
                        domain={v2MetricType === 'absolute' ? [0, 'auto'] : ['auto', 'auto']}
                      />
                      <Tooltip 
                        formatter={(value: number | null) => [
                          value !== null ? `${value.toFixed(1)}%` : 'N/A', 
                          'Error %'
                        ]}
                      />
                      <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                      <Line 
                        type="monotone" 
                        dataKey="errorPct" 
                        name="Error %" 
                        stroke="#ef4444" 
                        strokeWidth={2}
                        dot={{ fill: '#ef4444' }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                )}
              </CardContent>
            </Card>

            {/* Visual 2B: Forecast Churn (Volatility) Trend */}
            <Card>
              <CardHeader>
                <CardTitle>Forecast Volatility</CardTitle>
                <CardDescription>
                  Measures projection instability across run dates. Higher churn = more volatile forecasts. Click a bar to see projection history.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingV2Churn ? (
                  <div className="h-64 flex items-center justify-center">
                    <Skeleton className="w-full h-full" />
                  </div>
                ) : (
                <>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={v2ChurnData?.data || []} 
                      onClick={(e) => {
                        if (e && e.activePayload && e.activePayload[0]) {
                          const month = e.activePayload[0].payload.month;
                          setSelectedChurnMonth(selectedChurnMonth === month ? null : month);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="monthName" />
                      <YAxis tickFormatter={(v) => `${v}%`} />
                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null;
                          const data = payload[0]?.payload as ChurnTrendMonth;
                          return (
                            <div className="bg-background border rounded-md shadow-md p-3 text-sm">
                              <div className="font-medium mb-2">Target Month: {label}</div>
                              <div>Churn Score: {data.churnScore.toFixed(1)}%</div>
                              <div>Snapshots: {data.snapshotCount}</div>
                              <div>Avg Projection: ${(data.avgProjection / 100).toLocaleString()}</div>
                              <div className="text-xs text-muted-foreground mt-1">Click for drill-down</div>
                            </div>
                          );
                        }}
                      />
                      <Bar 
                        dataKey="churnScore" 
                        name="Churn %" 
                        fill="#f59e0b"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                
                {/* Churn Drill-down */}
                {selectedChurnMonth !== null && v2ChurnData?.data && (
                  <div className="mt-4 border-t pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">Projection History for {monthNames[selectedChurnMonth - 1]}</h4>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedChurnMonth(null)}>
                        Close
                      </Button>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Run Date</TableHead>
                          <TableHead className="text-right">Projected Value</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {v2ChurnData.data
                          .find(m => m.month === selectedChurnMonth)
                          ?.series.map((s, i, arr) => {
                            const prevValue = i > 0 ? arr[i - 1].projectedValue : s.projectedValue;
                            const change = s.projectedValue - prevValue;
                            const changePct = prevValue > 0 ? ((change / prevValue) * 100) : 0;
                            return (
                              <TableRow key={s.runDate}>
                                <TableCell>{s.runDate}</TableCell>
                                <TableCell className="text-right">${(s.projectedValue / 100).toLocaleString()}</TableCell>
                                <TableCell className="text-right">
                                  {i > 0 && (
                                    <span className={change >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {change >= 0 ? '+' : ''}{changePct.toFixed(1)}%
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                </>
                )}
              </CardContent>
            </Card>

            {/* Visual 3: Current Cleanup View */}
            <Card>
              <CardHeader>
                <CardTitle>Current Cleanup View</CardTitle>
                <CardDescription>
                  Shows projection status by month: Matched (received), Unmatched Not Expired, Unmatched Expired.
                  Latest projection run: {v2CleanupData?.latestRunDate || 'N/A'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingV2Cleanup ? (
                  <div className="h-80 flex items-center justify-center">
                    <Skeleton className="w-full h-full" />
                  </div>
                ) : (
                <>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={v2CleanupData?.data || []} style={{ cursor: 'pointer' }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="monthName" />
                      <YAxis tickFormatter={(v) => {
                          const dollars = v / 100;
                          if (dollars >= 1000000) return `$${(dollars / 1000000).toFixed(1)}M`;
                          if (dollars >= 1000) return `$${(dollars / 1000).toFixed(0)}k`;
                          return `$${dollars.toFixed(0)}`;
                        }} />
                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null;
                          const data = payload[0]?.payload as CleanupStatusMonth;
                          return (
                            <div className="bg-background border rounded-md shadow-md p-3 text-sm">
                              <div className="font-medium mb-2">Target Month: {label}</div>
                              <div className="flex justify-between gap-4">
                                <span>Projected:</span>
                                <span className="font-medium">${(data.projected / 100).toLocaleString()}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span>Actual:</span>
                                <span className="font-medium">${(data.actual / 100).toLocaleString()}</span>
                              </div>
                              <div className="mt-2 pt-2 border-t space-y-1">
                                <div className="flex justify-between gap-4 text-green-600">
                                  <span>Matched:</span>
                                  <span>${(data.matched / 100).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between gap-4 text-blue-600">
                                  <span>Unmatched (Not Expired):</span>
                                  <span>${(data.unmatchedNotExpired / 100).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between gap-4 text-red-600">
                                  <span>Unmatched (Expired):</span>
                                  <span>${(data.unmatchedExpired / 100).toLocaleString()}</span>
                                </div>
                                {data.overReceived > 0 && (
                                  <div className="flex justify-between gap-4 text-amber-600">
                                    <span>Over Received (Under-forecasted):</span>
                                    <span>${(data.overReceived / 100).toLocaleString()}</span>
                                  </div>
                                )}
                              </div>
                              <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                                <div>Expected by: {data.expectedBy}</div>
                                {data.isExpired && <Badge variant="destructive" className="mt-1">Expired</Badge>}
                                {data.isPartial && <Badge variant="secondary" className="mt-1 ml-1">Partial</Badge>}
                                {data.isUnderForecasted && <Badge className="mt-1 ml-1 bg-amber-500">Under-forecasted</Badge>}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Legend 
                        formatter={(value) => {
                          const labels: Record<string, string> = {
                            matched: 'Matched (Received)',
                            unmatchedNotExpired: 'Unmatched (Not Expired)',
                            unmatchedExpired: 'Unmatched (Expired)',
                            overReceived: 'Over Received (Under-forecasted)',
                          };
                          return labels[value] || value;
                        }}
                      />
                      <Bar 
                        dataKey="matched" 
                        name="matched" 
                        stackId="cleanup" 
                        fill="#22c55e"
                        onClick={(data) => {
                          if (data && data.month) {
                            setSelectedMonth(selectedMonth === data.month ? null : data.month);
                          }
                        }}
                      />
                      <Bar 
                        dataKey="overReceived" 
                        name="overReceived" 
                        stackId="cleanup" 
                        fill="#f59e0b"
                        onClick={(data) => {
                          if (data && data.month) {
                            setSelectedMonth(selectedMonth === data.month ? null : data.month);
                          }
                        }}
                      />
                      <Bar 
                        dataKey="unmatchedNotExpired" 
                        name="unmatchedNotExpired" 
                        stackId="cleanup" 
                        fill="#3b82f6"
                        onClick={(data) => {
                          if (data && data.month) {
                            setSelectedMonth(selectedMonth === data.month ? null : data.month);
                          }
                        }}
                      />
                      <Bar 
                        dataKey="unmatchedExpired" 
                        name="unmatchedExpired" 
                        stackId="cleanup" 
                        fill="#ef4444"
                        onClick={(data) => {
                          if (data && data.month) {
                            setSelectedMonth(selectedMonth === data.month ? null : data.month);
                          }
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {selectedMonth !== null && (
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant="secondary">Filtered: Month {selectedMonth}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedMonth(null)}>
                      Clear Filter
                    </Button>
                  </div>
                )}
                </>
                )}
              </CardContent>
            </Card>


            {/* Unmatched Projections Table */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Unmatched Projections</CardTitle>
                  <CardDescription>
                    Projections without matching PO orders ({unmatchedProjections.length} records)
                    {selectedMonth !== null && ` - Month ${selectedMonth}`}
                  </CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    const headers = ['Vendor', 'SKU', 'Description', 'Brand', 'Month', 'Projected Qty', 'Actual Qty', 'Projected Value', 'Actual Value', 'Type', 'Status', 'Comment'];
                    const rows = unmatchedProjections.map(p => [
                      p.vendor_name,
                      p.sku,
                      p.description || '',
                      p.brand,
                      p.month,
                      p.projection_quantity,
                      p.actual_quantity || '',
                      (p.projection_value / 100).toFixed(2),
                      p.actual_value ? (p.actual_value / 100).toFixed(2) : '',
                      p.order_type || 'regular',
                      p.match_status || 'unmatched',
                      p.comment || '',
                    ]);
                    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
                    const blob = new Blob([csvContent], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `unmatched_projections_${selectedYear}${selectedMonth ? `_month${selectedMonth}` : ''}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast({ title: "Export Complete", description: `Exported ${unmatchedProjections.length} records to CSV` });
                  }}
                  data-testid="button-export-unmatched"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export Excel
                </Button>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead className="text-center">Month</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-8"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unmatchedProjections.slice(0, 100).map((proj) => (
                        <TableRow 
                          key={proj.id} 
                          data-testid={`row-projection-${proj.id}`}
                          className="cursor-pointer hover-elevate"
                          onClick={() => openProjectionModal(proj)}
                        >
                          <TableCell className="font-medium">{proj.vendor_name}</TableCell>
                          <TableCell className="font-mono text-xs">{proj.sku}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{proj.description || '-'}</TableCell>
                          <TableCell>{proj.brand}</TableCell>
                          <TableCell className="text-center">{proj.month}</TableCell>
                          <TableCell className="text-right">{proj.projection_quantity.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{formatCurrency(proj.projection_value)}</TableCell>
                          <TableCell>
                            <Badge variant={proj.order_type === 'mto' ? 'default' : 'secondary'}>
                              {proj.order_type === 'mto' ? 'MTO/SPO' : 'Regular'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant={proj.match_status === 'partial' ? 'outline' : 'destructive'}
                              className={proj.match_status === 'partial' ? 'border-blue-500 text-blue-600' : ''}
                            >
                              {proj.match_status === 'partial' ? 'Partial' : 
                               proj.match_status === 'expired' ? 'Expired' : 'Unmatched'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {proj.comment && <MessageSquare className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {unmatchedProjections.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">
                      No unmatched projections found for the selected filters
                    </p>
                  )}
                  {unmatchedProjections.length > 100 && (
                    <p className="text-center text-muted-foreground py-4 border-t">
                      Showing 100 of {unmatchedProjections.length} records. Export to see all.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
        </TabsContent>

        {/* Forecast Drift Tab */}
        <TabsContent value="drift" className="space-y-4">
          <DriftSection year={selectedYear} />
        </TabsContent>
      </Tabs>
      {/* Projection Detail Modal */}
      <Dialog open={projectionModalOpen} onOpenChange={setProjectionModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Projection Details</DialogTitle>
            <DialogDescription>
              View and manage projection for {selectedProjection?.vendor_name} - {selectedProjection?.sku}
            </DialogDescription>
          </DialogHeader>
          
          {selectedProjection && (
            <div className="space-y-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Vendor</Label>
                  <p className="font-medium">{selectedProjection.vendor_name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">SKU</Label>
                  <p className="font-mono">{selectedProjection.sku}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Description</Label>
                  <p>{selectedProjection.description || '-'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Brand</Label>
                  <p>{selectedProjection.brand}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Month</Label>
                  <p>{monthNames[selectedProjection.month - 1]} {selectedProjection.year}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Type</Label>
                  <Badge variant={selectedProjection.order_type === 'mto' ? 'default' : 'secondary'}>
                    {selectedProjection.order_type === 'mto' ? 'MTO/SPO' : 'Regular'}
                  </Badge>
                </div>
              </div>

              <Separator />

              {/* Projected vs Actual */}
              <div className="space-y-3">
                <h4 className="font-medium">Projected vs Actual</h4>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-muted-foreground text-xs mb-1">Projected Qty</p>
                    <p className="text-lg font-semibold">{selectedProjection.projection_quantity.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-muted-foreground text-xs mb-1">Actual Qty</p>
                    <p className="text-lg font-semibold">
                      {selectedProjection.actual_quantity?.toLocaleString() || '-'}
                    </p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-muted-foreground text-xs mb-1">Qty Variance</p>
                    <p className={`text-lg font-semibold ${
                      selectedProjection.actual_quantity 
                        ? selectedProjection.actual_quantity > selectedProjection.projection_quantity 
                          ? 'text-emerald-600 dark:text-emerald-400' 
                          : selectedProjection.actual_quantity < selectedProjection.projection_quantity 
                            ? 'text-red-600 dark:text-red-400' 
                            : ''
                        : ''
                    }`}>
                      {selectedProjection.actual_quantity 
                        ? `${selectedProjection.actual_quantity > selectedProjection.projection_quantity ? '+' : ''}${(selectedProjection.actual_quantity - selectedProjection.projection_quantity).toLocaleString()}`
                        : '-'}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-muted-foreground text-xs mb-1">Projected Value</p>
                    <p className="text-lg font-semibold">{formatCurrency(selectedProjection.projection_value)}</p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-muted-foreground text-xs mb-1">Actual Value</p>
                    <p className="text-lg font-semibold">
                      {selectedProjection.actual_value ? formatCurrency(selectedProjection.actual_value) : '-'}
                    </p>
                  </div>
                  <div className="p-3 bg-muted/50 rounded-md">
                    <p className="text-muted-foreground text-xs mb-1">Value Variance</p>
                    <p className={`text-lg font-semibold ${
                      selectedProjection.actual_value 
                        ? selectedProjection.actual_value > selectedProjection.projection_value 
                          ? 'text-emerald-600 dark:text-emerald-400' 
                          : selectedProjection.actual_value < selectedProjection.projection_value 
                            ? 'text-red-600 dark:text-red-400' 
                            : ''
                        : ''
                    }`}>
                      {selectedProjection.actual_value 
                        ? formatCurrency(selectedProjection.actual_value - selectedProjection.projection_value)
                        : '-'}
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Match Status */}
              <div className="flex items-center gap-4">
                <Label className="text-muted-foreground">Status:</Label>
                <Badge 
                  variant={selectedProjection.match_status === 'partial' ? 'outline' : 'destructive'}
                  className={selectedProjection.match_status === 'partial' ? 'border-blue-500 text-blue-600' : ''}
                >
                  {selectedProjection.match_status === 'partial' ? 'Partial Match' : 
                   selectedProjection.match_status === 'expired' ? 'Expired' : 
                   selectedProjection.match_status === 'removed' ? 'Removed' : 'Unmatched'}
                </Badge>
                {selectedProjection.matched_po_number && (
                  <span className="text-sm text-muted-foreground">
                    Matched to PO: <span className="font-mono">{selectedProjection.matched_po_number}</span>
                  </span>
                )}
              </div>

              <Separator />

              {/* Comment Section */}
              <div className="space-y-2">
                <Label htmlFor="projection-comment">Comment (for client communication)</Label>
                <Textarea
                  id="projection-comment"
                  placeholder="Add notes about this projection to share with the client..."
                  value={editingComment}
                  onChange={(e) => setEditingComment(e.target.value)}
                  rows={3}
                  data-testid="textarea-projection-comment"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedProjection) {
                  removeProjectionMutation.mutate({ 
                    id: selectedProjection.id, 
                    reason: editingComment || 'Marked as verified/removed by user' 
                  });
                }
              }}
              disabled={removeProjectionMutation.isPending}
              data-testid="button-remove-projection"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove Projection
            </Button>
            <Button
              variant="outline"
              onClick={() => setProjectionModalOpen(false)}
              data-testid="button-cancel-modal"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedProjection) {
                  updateCommentMutation.mutate({ id: selectedProjection.id, comment: editingComment });
                }
              }}
              disabled={updateCommentMutation.isPending}
              data-testid="button-save-comment"
            >
              <Check className="h-4 w-4 mr-2" />
              Save Comment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
