import { useParams, Link, useSearch } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  ArrowLeft, 
  Package, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Building2,
  Calendar,
  FileText,
  User,
  DollarSign,
  Truck,
  ShieldCheck,
  Clock,
  Home,
  Ban
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { DataTable } from "@/components/DataTable";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ActivityLogSection } from "@/components/ActivityLogSection";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SkuSummary {
  skuCode: string;
  description: string | null;
  style: string | null;
  totalInspections: number;
  passedCount: number;
  failedCount: number;
  firstTimePassRate: number;
  vendors: string[];
  skuId: number | null;
  status: string;
  discontinuedAt: string | null;
  discontinuedReason: string | null;
}

interface InspectionRecord {
  id: number;
  poNumber: string;
  inspectionType: string;
  inspectionDate: string | null;
  result: string | null;
  notes: string | null;
  vendorName: string | null;
  inspector: string | null;
  inspectionCompany: string | null;
}

interface YoYSalesData {
  year: number;
  month: number;
  monthName: string;
  totalSales: number;
  orderCount: number;
}

interface ShipmentHistoryRecord {
  id: number;
  poNumber: string;
  vendor: string | null;
  orderQuantity: number;
  unitPrice: number;
  totalValue: number;
  poDate: string | null;
  revisedShipDate: string | null;
  status: string;
  shipmentStatus: string | null;
}

interface ComplianceRecord {
  id: number;
  poNumber: string;
  testType: string | null;
  testCategory: string | null;
  reportDate: string | null;
  result: string | null;
  expiryDate: string | null;
  status: string;
}

interface ShippingStats {
  firstShippedDate: string | null;
  lastShippedDate: string | null;
  totalShippedSales: number;
  totalShippedOrders: number;
  totalShippedQuantity: number;
  salesThisYear: number;
  salesLastYear: number;
}

export default function SkuDetail() {
  const params = useParams();
  const skuCode = decodeURIComponent(params.skuCode || "");
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const fromQuality = searchParams.get("from") === "quality";
  const goBack = useBackNavigation(fromQuality ? "/quality" : "/sku-summary");

  const { data: skuSummary, isLoading: summaryLoading } = useQuery<SkuSummary>({
    queryKey: [`/api/skus/${skuCode}/detail`],
    enabled: !!skuCode,
  });

  const { data: inspections = [], isLoading: inspectionsLoading } = useQuery<InspectionRecord[]>({
    queryKey: [`/api/skus/${skuCode}/inspections`],
    enabled: !!skuCode,
  });

  const { data: yoySales = [], isLoading: yoySalesLoading } = useQuery<YoYSalesData[]>({
    queryKey: [`/api/skus/${skuCode}/yoy-sales`],
    enabled: !!skuCode,
  });

  const { data: shipmentHistory = [], isLoading: shipmentLoading } = useQuery<ShipmentHistoryRecord[]>({
    queryKey: [`/api/skus/${skuCode}/shipment-history`],
    enabled: !!skuCode,
  });

  const { data: complianceData = [], isLoading: complianceLoading } = useQuery<ComplianceRecord[]>({
    queryKey: [`/api/skus/${skuCode}/compliance`],
    enabled: !!skuCode,
  });

  const { data: shippingStats, isLoading: shippingStatsLoading } = useQuery<ShippingStats>({
    queryKey: [`/api/skus/${skuCode}/shipping-stats`],
    enabled: !!skuCode,
  });

  const { toast } = useToast();

  const updateStatusMutation = useMutation({
    mutationFn: async ({ skuId, status }: { skuId: number; status: string }) => {
      return apiRequest(`/api/skus/${skuId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/skus/${skuCode}/detail`] });
      toast({
        title: "Status Updated",
        description: "SKU status has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update SKU status.",
        variant: "destructive",
      });
    },
  });

  const handleStatusChange = (newStatus: string) => {
    if (skuSummary?.skuId) {
      updateStatusMutation.mutate({ skuId: skuSummary.skuId, status: newStatus });
    }
  };

  const inspectionColumns = [
    {
      key: "inspectionDate",
      label: "Date",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm">
          {value ? format(new Date(value), "MM/dd/yyyy") : "N/A"}
        </span>
      ),
    },
    {
      key: "inspectionType",
      label: "Type",
      sortable: true,
      render: (value: string) => (
        <Badge variant="outline" className="font-normal" data-testid={`badge-type-${value}`}>
          {value}
        </Badge>
      ),
    },
    {
      key: "result",
      label: "Result",
      sortable: true,
      render: (value: string | null, row: InspectionRecord) => {
        const isPassed = value?.toLowerCase() === "passed";
        const isFailed = value?.toLowerCase() === "failed";
        return (
          <div className="flex items-center gap-2">
            {isPassed && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            {isFailed && <XCircle className="h-4 w-4 text-red-500" />}
            {!isPassed && !isFailed && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
            <Badge 
              variant={isPassed ? "default" : isFailed ? "destructive" : "secondary"}
              data-testid={`badge-result-${row.id}`}
            >
              {value || "Pending"}
            </Badge>
          </div>
        );
      },
    },
    {
      key: "poNumber",
      label: "PO Number",
      sortable: true,
      render: (value: string) => (
        <span className="font-mono text-sm" data-testid={`text-po-${value}`}>{value}</span>
      ),
    },
    {
      key: "vendorName",
      label: "Vendor",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm">{value || "N/A"}</span>
      ),
    },
    {
      key: "notes",
      label: "Notes / Failure Reason",
      render: (value: string | null, row: InspectionRecord) => {
        const isFailed = row.result?.toLowerCase() === "failed";
        return (
          <div className={`text-sm max-w-[300px] ${isFailed ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>
            {value ? (
              <span title={value} className="line-clamp-2">
                {value}
              </span>
            ) : (
              <span className="text-muted-foreground italic">
                {isFailed ? "No failure reason recorded" : "—"}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "inspector",
      label: "Inspector",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm text-muted-foreground">{value || "N/A"}</span>
      ),
    },
  ];

  const shipmentColumns = [
    {
      key: "poNumber",
      label: "PO Number",
      sortable: true,
      render: (value: string, row: ShipmentHistoryRecord) => (
        <Link href={`/purchase-orders/${row.id}`}>
          <span className="font-mono text-sm text-primary hover:underline cursor-pointer" data-testid={`link-po-${value}`}>
            {value}
          </span>
        </Link>
      ),
    },
    {
      key: "vendor",
      label: "Vendor",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm">{value || "N/A"}</span>
      ),
    },
    {
      key: "orderQuantity",
      label: "Qty",
      sortable: true,
      render: (value: number) => (
        <span className="text-sm font-medium">{value.toLocaleString()}</span>
      ),
    },
    {
      key: "unitPrice",
      label: "FOB Price",
      sortable: true,
      render: (value: number) => (
        <span className="font-mono text-sm">${(value / 100).toFixed(2)}</span>
      ),
    },
    {
      key: "totalValue",
      label: "Total Value",
      sortable: true,
      render: (value: number) => (
        <Badge variant="secondary" className="font-mono">${(value / 100).toLocaleString()}</Badge>
      ),
    },
    {
      key: "poDate",
      label: "PO Date",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm text-muted-foreground">
          {value ? format(new Date(value), "MM/dd/yyyy") : "N/A"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (value: string) => {
        // Map Closed/Shipped to "Handed Over" for display
        const displayStatus = (value === "Closed" || value === "Shipped") ? "Handed Over" : value;
        return <Badge variant={displayStatus === "Handed Over" ? "default" : "outline"}>{displayStatus}</Badge>;
      },
    },
  ];

  const complianceColumns = [
    {
      key: "testType",
      label: "Test Type",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm font-medium">{value || "Unknown"}</span>
      ),
    },
    {
      key: "testCategory",
      label: "Category",
      sortable: true,
      render: (value: string | null) => (
        <Badge variant="outline">{value || "N/A"}</Badge>
      ),
    },
    {
      key: "poNumber",
      label: "POs",
      sortable: true,
      render: (value: string) => (
        <span className="text-sm text-muted-foreground">{value}</span>
      ),
    },
    {
      key: "reportDate",
      label: "Report Date",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm text-muted-foreground">
          {value ? format(new Date(value), "MM/dd/yyyy") : "N/A"}
        </span>
      ),
    },
    {
      key: "result",
      label: "Result",
      sortable: true,
      render: (value: string | null) => {
        const isPassed = value?.toLowerCase() === "passed" || value?.toLowerCase() === "pass";
        const isFailed = value?.toLowerCase() === "failed" || value?.toLowerCase() === "fail";
        return (
          <div className="flex items-center gap-2">
            {isPassed && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            {isFailed && <XCircle className="h-4 w-4 text-red-500" />}
            {!isPassed && !isFailed && <Clock className="h-4 w-4 text-yellow-500" />}
            <Badge variant={isPassed ? "default" : isFailed ? "destructive" : "secondary"}>
              {value || "Pending"}
            </Badge>
          </div>
        );
      },
    },
    {
      key: "expiryDate",
      label: "Expiry Date",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm text-muted-foreground">
          {value ? format(new Date(value), "MM/dd/yyyy") : "N/A"}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (value: string) => {
        const getStatusColor = (status: string) => {
          switch (status) {
            case "Valid": return "default";
            case "Expired": return "destructive";
            case "Expiring Soon": return "secondary";
            case "Failed": return "destructive";
            default: return "outline";
          }
        };
        return <Badge variant={getStatusColor(value)}>{value}</Badge>;
      },
    },
  ];

  // Filter failed inspections for highlighting
  const failedInspections = inspections.filter(i => i.result?.toLowerCase() === "failed");

  if (summaryLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!skuSummary) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" data-testid="button-back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-medium">SKU Not Found</h2>
            <p className="text-muted-foreground mt-2">
              The requested SKU "{skuCode}" could not be found in the system.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const passRate = skuSummary.firstTimePassRate;
  const passRateVariant = passRate >= 85 ? "default" : passRate >= 70 ? "secondary" : "destructive";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" data-testid="button-back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3 flex-wrap" data-testid="text-sku-title">
            <Package className="h-6 w-6" />
            <span>SKU: {skuSummary.skuCode}</span>
            {skuSummary.description && (
              <span className="text-lg font-normal text-muted-foreground" data-testid="text-sku-description">
                — {skuSummary.description}
              </span>
            )}
            {skuSummary.status === 'discontinued' && (
              <Badge variant="destructive" className="ml-2" data-testid="badge-discontinued">
                <Ban className="h-3 w-3 mr-1" />
                Discontinued
              </Badge>
            )}
          </h1>
          {skuSummary.style && (
            <p className="text-sm text-muted-foreground mt-1">
              Style: {skuSummary.style}
            </p>
          )}
          {skuSummary.discontinuedReason && skuSummary.status === 'discontinued' && (
            <p className="text-sm text-red-500 mt-1">
              Reason: {skuSummary.discontinuedReason}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <Select 
            value={skuSummary.status} 
            onValueChange={handleStatusChange}
            disabled={!skuSummary.skuId || updateStatusMutation.isPending}
          >
            <SelectTrigger className="w-[150px]" data-testid="select-sku-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="discontinued">Discontinued</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Inspections</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-total-inspections">
              {skuSummary.totalInspections.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pass Rate</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Progress value={passRate} className="flex-1 h-2" />
              <Badge variant={passRateVariant} data-testid="badge-pass-rate">
                {passRate.toFixed(1)}%
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Passed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="text-3xl font-bold text-green-600 dark:text-green-400" data-testid="text-passed-count">
                {skuSummary.passedCount.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <span className="text-3xl font-bold text-red-600 dark:text-red-400" data-testid="text-failed-count">
                {skuSummary.failedCount.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Shipping Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              First Shipped Date
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shippingStatsLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-xl font-semibold" data-testid="text-first-shipped-date">
                {shippingStats?.firstShippedDate 
                  ? format(new Date(shippingStats.firstShippedDate), "MMM dd, yyyy")
                  : "Not Yet Shipped"}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Total Sales to Date
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shippingStatsLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-xl font-semibold text-green-600 dark:text-green-400" data-testid="text-total-shipped-sales">
                ${((shippingStats?.totalShippedSales || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Truck className="h-3 w-3" />
              Shipped Orders
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shippingStatsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-xl font-semibold" data-testid="text-shipped-orders-count">
                {(shippingStats?.totalShippedOrders || 0).toLocaleString()}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Package className="h-3 w-3" />
              Total Quantity Shipped
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shippingStatsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-xl font-semibold" data-testid="text-shipped-quantity">
                {(shippingStats?.totalShippedQuantity || 0).toLocaleString()}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Last Shipment Date
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shippingStatsLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-xl font-semibold" data-testid="text-last-shipped-date">
                {shippingStats?.lastShippedDate 
                  ? format(new Date(shippingStats.lastShippedDate), "MMM dd, yyyy")
                  : "No Shipments"}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Sales This Year ({new Date().getFullYear()})
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shippingStatsLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-xl font-semibold text-green-600 dark:text-green-400" data-testid="text-sales-this-year">
                ${((shippingStats?.salesThisYear || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Sales Last Year ({new Date().getFullYear() - 1})
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shippingStatsLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-xl font-semibold text-muted-foreground" data-testid="text-sales-last-year">
                ${((shippingStats?.salesLastYear || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {skuSummary.vendors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Associated Vendors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {skuSummary.vendors.map((vendor, idx) => (
                <Badge key={idx} variant="outline" data-testid={`badge-vendor-${idx}`}>
                  {vendor}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Year-over-Year Sales Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Year-over-Year Sales by Month
          </CardTitle>
          <CardDescription>Total sales comparison across years for this SKU</CardDescription>
        </CardHeader>
        <CardContent>
          {yoySalesLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : yoySales.length > 0 ? (
            (() => {
              const years = Array.from(new Set(yoySales.map(d => d.year))).sort();
              const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              const chartData = months.map((month, idx) => {
                const monthNum = idx + 1;
                const point: any = { month };
                years.forEach(year => {
                  const dataPoint = yoySales.find(d => d.year === year && d.month === monthNum);
                  point[`sales_${year}`] = dataPoint?.totalSales || 0;
                });
                return point;
              });
              const colors = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))'];
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    {years.map(year => {
                      const yearTotal = yoySales
                        .filter(d => d.year === year)
                        .reduce((sum, d) => sum + d.totalSales, 0);
                      const yearOrders = yoySales
                        .filter(d => d.year === year)
                        .reduce((sum, d) => sum + d.orderCount, 0);
                      return (
                        <div key={year} className="text-center p-3 bg-muted/50 rounded-lg">
                          <p className="text-sm text-muted-foreground">{year}</p>
                          <p className="text-xl font-bold" data-testid={`text-year-sales-${year}`}>
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
            <p className="text-sm text-muted-foreground text-center py-8">No sales data available for this SKU</p>
          )}
        </CardContent>
      </Card>

      {failedInspections.length > 0 && (
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-red-600 dark:text-red-400">
              <XCircle className="h-4 w-4" />
              Failed Inspections ({failedInspections.length})
            </CardTitle>
            <CardDescription>
              Inspections that did not pass quality requirements
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {failedInspections.slice(0, 10).map((inspection) => (
                <div 
                  key={inspection.id} 
                  className="flex items-start gap-4 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900"
                  data-testid={`card-failed-${inspection.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="destructive">{inspection.inspectionType}</Badge>
                      <span className="text-sm text-muted-foreground">
                        {inspection.inspectionDate 
                          ? format(new Date(inspection.inspectionDate), "MMM dd, yyyy")
                          : "No date"}
                      </span>
                      <span className="text-sm font-mono">{inspection.poNumber}</span>
                    </div>
                    <div className="mt-2">
                      <p className="text-sm font-medium text-red-700 dark:text-red-300">
                        {inspection.notes || "No failure reason recorded"}
                      </p>
                    </div>
                    {(inspection.vendorName || inspection.inspector) && (
                      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                        {inspection.vendorName && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {inspection.vendorName}
                          </span>
                        )}
                        {inspection.inspector && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {inspection.inspector}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {failedInspections.length > 10 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Showing 10 of {failedInspections.length} failed inspections. See full table below.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Complete Inspection History
          </CardTitle>
          <CardDescription>
            All inspection records for this SKU, sorted by date (newest first)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inspectionsLoading ? (
            <Skeleton className="h-64" />
          ) : inspections.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No inspection records found for this SKU.</p>
            </div>
          ) : (
            <DataTable
              columns={inspectionColumns}
              data={inspections}
              searchPlaceholder="Search inspections..."
            />
          )}
        </CardContent>
      </Card>

      {/* PO Shipment History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Truck className="h-5 w-5" />
            PO Shipment History
          </CardTitle>
          <CardDescription>
            Purchase orders for this SKU with shipment status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shipmentLoading ? (
            <Skeleton className="h-64" />
          ) : shipmentHistory.length === 0 ? (
            <div className="text-center py-12">
              <Truck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No purchase order history found for this SKU.</p>
            </div>
          ) : (
            <DataTable
              columns={shipmentColumns}
              data={shipmentHistory}
              searchPlaceholder="Search PO history..."
            />
          )}
        </CardContent>
      </Card>

      {/* Compliance Report Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Compliance Report Status
          </CardTitle>
          <CardDescription>
            Quality tests and certifications for this SKU
          </CardDescription>
        </CardHeader>
        <CardContent>
          {complianceLoading ? (
            <Skeleton className="h-64" />
          ) : complianceData.length === 0 ? (
            <div className="text-center py-12">
              <ShieldCheck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No compliance records found for this SKU.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="text-center p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-100 dark:border-green-900">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {complianceData.filter(c => c.status === "Valid").length}
                  </p>
                  <p className="text-xs text-muted-foreground">Valid</p>
                </div>
                <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg border border-yellow-100 dark:border-yellow-900">
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {complianceData.filter(c => c.status === "Expiring Soon").length}
                  </p>
                  <p className="text-xs text-muted-foreground">Expiring Soon</p>
                </div>
                <div className="text-center p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-100 dark:border-red-900">
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {complianceData.filter(c => c.status === "Expired" || c.status === "Failed").length}
                  </p>
                  <p className="text-xs text-muted-foreground">Expired/Failed</p>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg border">
                  <p className="text-2xl font-bold">
                    {complianceData.filter(c => c.status === "Pending").length}
                  </p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
              </div>
              <DataTable
                columns={complianceColumns}
                data={complianceData}
                searchPlaceholder="Search compliance records..."
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Activity Log Section */}
      <ActivityLogSection 
        entityType="sku" 
        entityId={skuCode} 
        title="Activity Log & Notes"
      />
    </div>
  );
}
