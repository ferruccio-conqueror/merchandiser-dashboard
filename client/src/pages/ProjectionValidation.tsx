import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Clock, TrendingUp, TrendingDown, CheckCircle2, XCircle, RefreshCw, Trash2, Link2Off, Link2, Download, Package, X, Target } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface ProjectionSummary {
  totalProjections: number;
  unmatched: number;
  matched: number;
  removed: number;
  overdueCount: number;
  atRiskCount: number;
  withVariance: number;
  spoTotal: number;
  spoMatched: number;
  spoUnmatched: number;
}

interface OverdueProjection {
  id: number;
  vendorId: number;
  vendorCode: string;
  sku: string;
  skuDescription: string | null;
  brand: string;
  year: number;
  month: number;
  quantity: number;
  projectionValue: number;
  orderType: string | null;
  matchStatus: string | null;
  daysUntilDue: number;
  isOverdue: boolean;
  collection?: string | null;
  productClass?: string | null;
}

interface VarianceProjection {
  id: number;
  vendorId: number;
  vendorCode: string;
  sku: string;
  skuDescription: string | null;
  brand: string;
  year: number;
  month: number;
  quantity: number;
  projectionValue: number;
  matchedPoNumber: string | null;
  actualQuantity: number | null;
  actualValue: number | null;
  quantityVariance: number | null;
  valueVariance: number | null;
  variancePct: number | null;
  orderType: string | null;
  collection?: string | null;
}

interface SpoProjection {
  id: number;
  vendorId: number;
  vendorCode: string;
  sku: string;
  skuDescription: string | null;
  brand: string;
  year: number;
  month: number;
  quantity: number;
  projectionValue: number;
  matchedPoNumber: string | null;
  matchStatus: string | null;
  actualQuantity: number | null;
  actualValue: number | null;
  quantityVariance: number | null;
  valueVariance: number | null;
  variancePct: number | null;
  collection: string | null;
  productClass: string | null;
  daysUntilDue?: number;
  isOverdue?: boolean;
}

interface ValidationReport {
  summary: ProjectionSummary;
  overdue: OverdueProjection[];
  variances: VarianceProjection[];
  spo: SpoProjection[];
}

interface ProjectionFilters {
  vendorId?: number;
  brand?: string;
  year?: number;
  month?: number;
}

interface VendorOption {
  id: number;
  name: string;
  vendorCode: string;
}

interface ExpiredProjection {
  id: number;
  originalProjectionId: number;
  vendorId: number;
  vendorCode: string;
  sku: string;
  skuDescription: string | null;
  brand: string;
  year: number;
  month: number;
  quantity: number;
  projectionValue: number;
  orderType: string | null;
  expiredAt: string;
  expirationReason: string;
  thresholdDays: number;
  daysOverdue: number;
  verificationStatus: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
  verificationNotes: string | null;
}

interface ExpiredProjectionsResponse {
  projections: ExpiredProjection[];
  summary: {
    total: number;
    pending: number;
    verified: number;
    cancelled: number;
    restored: number;
  };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const currentYear = new Date().getFullYear();
const YEARS = [currentYear - 1, currentYear, currentYear + 1];

export default function ProjectionValidation() {
  const { toast } = useToast();
  const [selectedProjection, setSelectedProjection] = useState<number | null>(null);
  const [removalReason, setRemovalReason] = useState("");
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
  const [isMatchDialogOpen, setIsMatchDialogOpen] = useState(false);
  const [matchPoNumber, setMatchPoNumber] = useState("");
  const [filters, setFilters] = useState<ProjectionFilters>({});
  const [activeTab, setActiveTab] = useState("overdue");

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (filters.vendorId) params.append('vendorId', filters.vendorId.toString());
    if (filters.brand) params.append('brand', filters.brand);
    if (filters.year) params.append('year', filters.year.toString());
    if (filters.month) params.append('month', filters.month.toString());
    return params.toString() ? `?${params.toString()}` : '';
  };

  const { data: report, isLoading, refetch } = useQuery<ValidationReport>({
    queryKey: ['/api/projections/validation-report', filters],
    queryFn: async () => {
      const res = await fetch(`/api/projections/validation-report${buildQueryString()}`);
      if (!res.ok) throw new Error('Failed to fetch report');
      return res.json();
    },
  });

  const { data: filterOptions } = useQuery<{
    vendors: VendorOption[];
    brands: string[];
  }>({
    queryKey: ['/api/projections/filter-options'],
  });

  // Helper to get vendor name from vendor ID
  const getVendorName = (vendorId: number, vendorCode?: string): string => {
    const vendor = filterOptions?.vendors.find(v => v.id === vendorId);
    return vendor?.name || vendorCode || `Vendor #${vendorId}`;
  };

  // Query for expired projections
  const { data: expiredData, refetch: refetchExpired } = useQuery<ExpiredProjectionsResponse>({
    queryKey: ['/api/projections/expired', filters],
    queryFn: async () => {
      const res = await fetch(`/api/projections/expired${buildQueryString()}`);
      if (!res.ok) throw new Error('Failed to fetch expired projections');
      return res.json();
    },
  });

  // Mutation to check and expire projections past their order window
  const checkExpiredMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/projections/check-expired');
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Expiration Check Complete",
        description: `Moved ${data.regularExpired} regular and ${data.spoExpired} SPO projections to expired`,
      });
      refetch();
      refetchExpired();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to check expired projections",
        variant: "destructive",
      });
    },
  });

  // Mutation to restore an expired projection
  const restoreExpiredMutation = useMutation({
    mutationFn: async (expiredId: number) => {
      const res = await apiRequest('POST', `/api/projections/expired/${expiredId}/restore`, {
        restoredBy: 'user'
      });
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Projection Restored",
        description: "The projection has been restored to active status",
      });
      refetch();
      refetchExpired();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore projection",
        variant: "destructive",
      });
    },
  });

  // Mutation to verify an expired projection
  const verifyExpiredMutation = useMutation({
    mutationFn: async ({ expiredId, status, notes }: { expiredId: number; status: 'verified' | 'cancelled'; notes?: string }) => {
      const res = await apiRequest('POST', `/api/projections/expired/${expiredId}/verify`, {
        status,
        verifiedBy: 'user',
        notes
      });
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Verification Complete",
        description: "The expired projection has been verified",
      });
      refetchExpired();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to verify projection",
        variant: "destructive",
      });
    },
  });

  const runMatchingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/projections/run-matching');
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Matching Complete",
        description: `Matched ${data.matched} projections to POs${data.variances > 0 ? ` (${data.variances} with variance)` : ''}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/projections/validation-report'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to run matching",
        variant: "destructive",
      });
    },
  });

  const removeProjectionMutation = useMutation({
    mutationFn: async ({ projectionId, reason }: { projectionId: number; reason: string }) => {
      await apiRequest('POST', `/api/projections/${projectionId}/remove`, { reason });
    },
    onSuccess: () => {
      toast({
        title: "Projection Removed",
        description: "The projection has been marked as removed",
      });
      setIsRemoveDialogOpen(false);
      setRemovalReason("");
      setSelectedProjection(null);
      queryClient.invalidateQueries({ queryKey: ['/api/projections/validation-report'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove projection",
        variant: "destructive",
      });
    },
  });

  const unmatchProjectionMutation = useMutation({
    mutationFn: async (projectionId: number) => {
      await apiRequest('POST', `/api/projections/${projectionId}/unmatch`);
    },
    onSuccess: () => {
      toast({
        title: "Projection Unmatched",
        description: "The projection has been returned to unmatched status",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/projections/validation-report'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to unmatch projection",
        variant: "destructive",
      });
    },
  });

  const manualMatchMutation = useMutation({
    mutationFn: async ({ projectionId, poNumber }: { projectionId: number; poNumber: string }) => {
      await apiRequest('POST', `/api/projections/${projectionId}/match`, { poNumber });
    },
    onSuccess: () => {
      toast({
        title: "Projection Matched",
        description: "The projection has been manually matched to the PO",
      });
      setIsMatchDialogOpen(false);
      setMatchPoNumber("");
      setSelectedProjection(null);
      queryClient.invalidateQueries({ queryKey: ['/api/projections/validation-report'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to match projection",
        variant: "destructive",
      });
    },
  });

  const handleExportExcel = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.vendorId) params.append('vendorId', filters.vendorId.toString());
      if (filters.brand) params.append('brand', filters.brand);
      if (filters.year) params.append('year', filters.year.toString());
      if (filters.month) params.append('month', filters.month.toString());
      params.append('tab', activeTab);

      const res = await fetch(`/api/projections/export-excel?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to export');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `projections_${activeTab}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Export Complete",
        description: "Excel file downloaded successfully",
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export data",
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (cents: number | null) => {
    if (cents === null || cents === undefined) return "-";
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  };

  const formatDate = (year: number, month: number) => {
    return `${MONTH_NAMES[month - 1]} ${year}`;
  };

  const getStatusBadge = (daysUntilDue: number, isOverdue: boolean, orderType: string | null) => {
    const threshold = orderType === 'mto' ? 30 : 90;
    
    if (isOverdue) {
      return <Badge variant="destructive" data-testid={`badge-overdue-${Math.abs(daysUntilDue)}`}>Overdue by {Math.abs(daysUntilDue)}d</Badge>;
    }
    if (daysUntilDue <= threshold / 3) {
      return <Badge className="bg-red-500 hover:bg-red-600" data-testid="badge-critical">Critical: {daysUntilDue}d left</Badge>;
    }
    if (daysUntilDue <= threshold / 2) {
      return <Badge className="bg-orange-500 hover:bg-orange-600" data-testid="badge-urgent">Urgent: {daysUntilDue}d left</Badge>;
    }
    return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black" data-testid="badge-at-risk">At Risk: {daysUntilDue}d left</Badge>;
  };

  const getVarianceBadge = (variancePct: number | null) => {
    if (variancePct === null) return null;
    
    if (variancePct > 20) {
      return <Badge className="bg-blue-500 hover:bg-blue-600" data-testid="badge-over">+{variancePct}% Over</Badge>;
    }
    if (variancePct > 10) {
      return <Badge className="bg-blue-400 hover:bg-blue-500" data-testid="badge-slight-over">+{variancePct}% Over</Badge>;
    }
    if (variancePct < -20) {
      return <Badge variant="destructive" data-testid="badge-under">{variancePct}% Under</Badge>;
    }
    if (variancePct < -10) {
      return <Badge className="bg-orange-500 hover:bg-orange-600" data-testid="badge-slight-under">{variancePct}% Under</Badge>;
    }
    return <Badge className="bg-green-500 hover:bg-green-600" data-testid="badge-on-target">On Target</Badge>;
  };

  const hasActiveFilters = Object.values(filters).some(v => v !== undefined);

  const handleClearFilters = () => {
    setFilters({});
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">Projection Validation Report</h1>
            <p className="text-muted-foreground">Monitor client projection accuracy and follow up on discrepancies</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const summary = report?.summary || {
    totalProjections: 0,
    unmatched: 0,
    matched: 0,
    removed: 0,
    overdueCount: 0,
    atRiskCount: 0,
    withVariance: 0,
    spoTotal: 0,
    spoMatched: 0,
    spoUnmatched: 0
  };

  const spoProjections = report?.spo || [];
  const regularOverdue = (report?.overdue || []).filter(p => p.orderType !== 'mto');
  const regularVariances = (report?.variances || []).filter(p => p.orderType !== 'mto');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <AlertTriangle className="h-6 w-6" />
            Projection Validation Report
          </h1>
          <p className="text-muted-foreground">
            Monitor client projection accuracy - 90 day cycle for regular POs, 30 day cycle for MTO
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/projection-accuracy">
            <Button variant="default" data-testid="button-accuracy-report">
              <Target className="h-4 w-4 mr-2" />
              Accuracy Report
            </Button>
          </Link>
          <Button 
            variant="outline" 
            onClick={handleExportExcel}
            data-testid="button-export-excel"
          >
            <Download className="h-4 w-4 mr-2" />
            Export Excel
          </Button>
          <Button 
            variant="outline" 
            onClick={() => refetch()}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button 
            onClick={() => runMatchingMutation.mutate()}
            disabled={runMatchingMutation.isPending}
            data-testid="button-run-matching"
          >
            <Link2 className="h-4 w-4 mr-2" />
            {runMatchingMutation.isPending ? "Matching..." : "Run Matching"}
          </Button>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Filters</h3>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                data-testid="button-clear-filters"
              >
                <X className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Vendor</label>
              <Select
                value={filters.vendorId?.toString() || "all"}
                onValueChange={(value) =>
                  setFilters({
                    ...filters,
                    vendorId: value === "all" ? undefined : parseInt(value),
                  })
                }
              >
                <SelectTrigger data-testid="select-vendor">
                  <SelectValue placeholder="All Vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vendors</SelectItem>
                  {(filterOptions?.vendors || []).map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Brand</label>
              <Select
                value={filters.brand || "all"}
                onValueChange={(value) =>
                  setFilters({
                    ...filters,
                    brand: value === "all" ? undefined : value,
                  })
                }
              >
                <SelectTrigger data-testid="select-brand">
                  <SelectValue placeholder="All Brands" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {(filterOptions?.brands || []).map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Year</label>
              <Select
                value={filters.year?.toString() || "all"}
                onValueChange={(value) =>
                  setFilters({
                    ...filters,
                    year: value === "all" ? undefined : parseInt(value),
                  })
                }
              >
                <SelectTrigger data-testid="select-year">
                  <SelectValue placeholder="All Years" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Month</label>
              <Select
                value={filters.month?.toString() || "all"}
                onValueChange={(value) =>
                  setFilters({
                    ...filters,
                    month: value === "all" ? undefined : parseInt(value),
                  })
                }
              >
                <SelectTrigger data-testid="select-month">
                  <SelectValue placeholder="All Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {MONTH_NAMES.map((m, idx) => (
                    <SelectItem key={idx + 1} value={(idx + 1).toString()}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Projections</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold" data-testid="text-total-projections">
                {summary.totalProjections}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {summary.matched} matched, {summary.unmatched} pending
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Overdue Projections</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <span className="text-3xl font-bold text-red-600" data-testid="text-overdue-count">
                {summary.overdueCount}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Past target date without PO
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>At Risk</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              <span className="text-3xl font-bold text-orange-600" data-testid="text-at-risk-count">
                {summary.atRiskCount}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Within threshold without PO
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Volume Variances</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-blue-500" />
              <span className="text-3xl font-bold text-blue-600" data-testid="text-variance-count">
                {summary.withVariance}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Matched with &gt;10% difference
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>SPO/MTO Items</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-purple-500" />
              <span className="text-3xl font-bold text-purple-600" data-testid="text-spo-count">
                {summary.spoTotal}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {summary.spoMatched} matched, {summary.spoUnmatched} pending
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList data-testid="tabs-validation">
          <TabsTrigger value="overdue" data-testid="tab-overdue">
            Overdue & At Risk ({regularOverdue.length})
          </TabsTrigger>
          <TabsTrigger value="variances" data-testid="tab-variances">
            Volume Variances ({regularVariances.length})
          </TabsTrigger>
          <TabsTrigger value="spo" data-testid="tab-spo">
            SPO/MTO Projections ({spoProjections.length})
          </TabsTrigger>
          <TabsTrigger value="expired" data-testid="tab-expired">
            Expired ({expiredData?.summary?.pending || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overdue" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Regular Projections Without Orders</CardTitle>
              <CardDescription>
                Regular projections within 90-day threshold that don&apos;t have matching POs
              </CardDescription>
            </CardHeader>
            <CardContent>
              {regularOverdue.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mb-2 text-green-500" />
                  <p>All regular projections within threshold have matching orders</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Target Month</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {regularOverdue.map((proj) => (
                      <TableRow key={proj.id} data-testid={`row-overdue-${proj.id}`}>
                        <TableCell className="font-medium">{getVendorName(proj.vendorId, proj.vendorCode)}</TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{proj.sku}</div>
                            {proj.skuDescription && (
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {proj.skuDescription}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{proj.brand}</Badge>
                        </TableCell>
                        <TableCell>{formatDate(proj.year, proj.month)}</TableCell>
                        <TableCell className="text-right">{proj.quantity?.toLocaleString() || 0}</TableCell>
                        <TableCell className="text-right">{formatCurrency(proj.projectionValue)}</TableCell>
                        <TableCell>{getStatusBadge(proj.daysUntilDue, proj.isOverdue, proj.orderType)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedProjection(proj.id);
                                setIsMatchDialogOpen(true);
                              }}
                              title="Manually match to PO"
                              data-testid={`button-match-${proj.id}`}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedProjection(proj.id);
                                setIsRemoveDialogOpen(true);
                              }}
                              title="Mark as removed"
                              data-testid={`button-remove-${proj.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="variances" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Regular Volume Variances</CardTitle>
              <CardDescription>
                Matched regular projections where actual order quantity differs by more than 10% from projection
              </CardDescription>
            </CardHeader>
            <CardContent>
              {regularVariances.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mb-2 text-green-500" />
                  <p>All matched regular projections are within acceptable variance</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Target Month</TableHead>
                      <TableHead>Matched PO</TableHead>
                      <TableHead className="text-right">Projected Qty</TableHead>
                      <TableHead className="text-right">Actual Qty</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {regularVariances.map((proj) => (
                      <TableRow key={proj.id} data-testid={`row-variance-${proj.id}`}>
                        <TableCell className="font-medium">{getVendorName(proj.vendorId, proj.vendorCode)}</TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{proj.sku}</div>
                            {proj.skuDescription && (
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {proj.skuDescription}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{proj.brand}</Badge>
                        </TableCell>
                        <TableCell>{formatDate(proj.year, proj.month)}</TableCell>
                        <TableCell className="font-mono text-sm">{proj.matchedPoNumber}</TableCell>
                        <TableCell className="text-right">{proj.quantity?.toLocaleString() || 0}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {(proj.quantityVariance || 0) > 0 ? (
                              <TrendingUp className="h-4 w-4 text-blue-500" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-red-500" />
                            )}
                            {proj.actualQuantity?.toLocaleString() || 0}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {getVarianceBadge(proj.variancePct)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => unmatchProjectionMutation.mutate(proj.id)}
                            title="Unmatch this projection"
                            data-testid={`button-unmatch-${proj.id}`}
                          >
                            <Link2Off className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="spo" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                SPO/MTO Projections
              </CardTitle>
              <CardDescription>
                Made-to-Order (MTO) and Special Purchase Order (SPO) items tracked by collection. 
                These items have a 30-day threshold and reduce overall projection volume when matched.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {spoProjections.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mb-2 text-muted-foreground" />
                  <p>No SPO/MTO projections found</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Collection</TableHead>
                      <TableHead>SKU/Item</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Target Month</TableHead>
                      <TableHead className="text-right">Projected Qty</TableHead>
                      <TableHead className="text-right">Projected Value</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Matched PO</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {spoProjections.map((proj) => (
                      <TableRow key={proj.id} data-testid={`row-spo-${proj.id}`}>
                        <TableCell className="font-medium">{getVendorName(proj.vendorId, proj.vendorCode)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                            {proj.collection || 'N/A'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium text-sm">{proj.sku}</div>
                            {proj.skuDescription && (
                              <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                                {proj.skuDescription}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{proj.brand}</Badge>
                        </TableCell>
                        <TableCell>{formatDate(proj.year, proj.month)}</TableCell>
                        <TableCell className="text-right">{proj.quantity?.toLocaleString() || 0}</TableCell>
                        <TableCell className="text-right">{formatCurrency(proj.projectionValue)}</TableCell>
                        <TableCell>
                          {proj.matchStatus === 'matched' ? (
                            <Badge className="bg-green-500 hover:bg-green-600">Matched</Badge>
                          ) : proj.isOverdue ? (
                            <Badge variant="destructive">Overdue</Badge>
                          ) : proj.daysUntilDue !== undefined && proj.daysUntilDue <= 30 ? (
                            <Badge className="bg-orange-500 hover:bg-orange-600">At Risk</Badge>
                          ) : (
                            <Badge variant="outline">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {proj.matchedPoNumber || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {proj.matchStatus === 'matched' && proj.variancePct !== null ? (
                            getVarianceBadge(proj.variancePct)
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {proj.matchStatus !== 'matched' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setSelectedProjection(proj.id);
                                  setIsMatchDialogOpen(true);
                                }}
                                title="Manually match to PO"
                                data-testid={`button-match-spo-${proj.id}`}
                              >
                                <Link2 className="h-4 w-4" />
                              </Button>
                            )}
                            {proj.matchStatus === 'matched' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => unmatchProjectionMutation.mutate(proj.id)}
                                title="Unmatch this projection"
                                data-testid={`button-unmatch-spo-${proj.id}`}
                              >
                                <Link2Off className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedProjection(proj.id);
                                setIsRemoveDialogOpen(true);
                              }}
                              title="Mark as removed"
                              data-testid={`button-remove-spo-${proj.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expired" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Expired Projections - CBH Verification Required</CardTitle>
                  <CardDescription>
                    Projections that missed their order window (Regular: 90 days, SPO: 30 days before target month end).
                    Review with CBH to verify if still required.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  onClick={() => checkExpiredMutation.mutate()}
                  disabled={checkExpiredMutation.isPending}
                  data-testid="button-check-expired"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${checkExpiredMutation.isPending ? 'animate-spin' : ''}`} />
                  Check for Expired
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Summary Cards */}
              {expiredData?.summary && (
                <div className="grid grid-cols-5 gap-4 mb-6">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-2xl font-bold">{expiredData.summary.total}</div>
                      <p className="text-xs text-muted-foreground">Total Expired</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-2xl font-bold text-yellow-600">{expiredData.summary.pending}</div>
                      <p className="text-xs text-muted-foreground">Pending Review</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-2xl font-bold text-green-600">{expiredData.summary.verified}</div>
                      <p className="text-xs text-muted-foreground">Verified (No Longer Needed)</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-2xl font-bold text-red-600">{expiredData.summary.cancelled}</div>
                      <p className="text-xs text-muted-foreground">Cancelled</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-2xl font-bold text-blue-600">{expiredData.summary.restored}</div>
                      <p className="text-xs text-muted-foreground">Restored</p>
                    </CardContent>
                  </Card>
                </div>
              )}

              {!expiredData?.projections || expiredData.projections.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-12 w-12 mb-2" />
                  <p>No expired projections pending review</p>
                  <p className="text-sm">Click "Check for Expired" to scan for projections past their order window</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Target Month</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Days Overdue</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expiredData.projections.map((proj) => (
                      <TableRow key={proj.id} data-testid={`row-expired-${proj.id}`}>
                        <TableCell className="font-medium">{getVendorName(proj.vendorId, proj.vendorCode)}</TableCell>
                        <TableCell>
                          <div className="max-w-[150px] truncate" title={proj.skuDescription || proj.sku}>
                            {proj.sku}
                          </div>
                        </TableCell>
                        <TableCell>{proj.brand}</TableCell>
                        <TableCell>{MONTH_NAMES[proj.month - 1]} {proj.year}</TableCell>
                        <TableCell>
                          <Badge variant={proj.orderType === 'mto' ? 'secondary' : 'outline'}>
                            {proj.orderType === 'mto' ? 'SPO' : 'Regular'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{proj.quantity?.toLocaleString() || 0}</TableCell>
                        <TableCell className="text-right">${((proj.projectionValue || 0) / 100).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant="destructive">{proj.daysOverdue} days</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            proj.verificationStatus === 'pending' ? 'outline' :
                            proj.verificationStatus === 'verified' ? 'default' :
                            proj.verificationStatus === 'cancelled' ? 'destructive' : 'secondary'
                          }>
                            {proj.verificationStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {proj.verificationStatus === 'pending' && (
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => restoreExpiredMutation.mutate(proj.id)}
                                title="Restore to active projections"
                                data-testid={`button-restore-${proj.id}`}
                              >
                                <RefreshCw className="h-4 w-4 text-blue-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => verifyExpiredMutation.mutate({ expiredId: proj.id, status: 'verified' })}
                                title="Verify - No longer needed"
                                data-testid={`button-verify-${proj.id}`}
                              >
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => verifyExpiredMutation.mutate({ expiredId: proj.id, status: 'cancelled' })}
                                title="Cancel projection"
                                data-testid={`button-cancel-expired-${proj.id}`}
                              >
                                <XCircle className="h-4 w-4 text-red-600" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isRemoveDialogOpen} onOpenChange={setIsRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Projection</DialogTitle>
            <DialogDescription>
              Mark this projection as removed. This indicates the client is no longer planning to place this order.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Enter reason for removal (e.g., 'Client cancelled forecast', 'Replaced by different SKU', etc.)"
            value={removalReason}
            onChange={(e) => setRemovalReason(e.target.value)}
            className="min-h-[100px]"
            data-testid="input-removal-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRemoveDialogOpen(false)} data-testid="button-cancel-remove">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedProjection && removalReason) {
                  removeProjectionMutation.mutate({ projectionId: selectedProjection, reason: removalReason });
                }
              }}
              disabled={!removalReason || removeProjectionMutation.isPending}
              data-testid="button-confirm-remove"
            >
              {removeProjectionMutation.isPending ? "Removing..." : "Remove Projection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isMatchDialogOpen} onOpenChange={setIsMatchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Match</DialogTitle>
            <DialogDescription>
              Manually match this projection to an existing PO number
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">PO Number</label>
            <input
              type="text"
              placeholder="Enter PO number (e.g., 001-1234567)"
              value={matchPoNumber}
              onChange={(e) => setMatchPoNumber(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm"
              data-testid="input-po-number"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMatchDialogOpen(false)} data-testid="button-cancel-match">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedProjection && matchPoNumber) {
                  manualMatchMutation.mutate({ projectionId: selectedProjection, poNumber: matchPoNumber });
                }
              }}
              disabled={!matchPoNumber || manualMatchMutation.isPending}
              data-testid="button-confirm-match"
            >
              {manualMatchMutation.isPending ? "Matching..." : "Match to PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
