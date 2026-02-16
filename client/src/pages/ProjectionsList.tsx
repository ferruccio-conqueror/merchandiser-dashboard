import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, Clock, AlertTriangle, ChevronLeft, ChevronRight, Package, TrendingUp, TrendingDown, Download, Filter, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Projection {
  id: number;
  vendorId: number;
  vendorName: string;
  sku: string;
  skuDescription: string | null;
  collection: string | null;
  brand: string;
  year: number;
  month: number;
  orderType: string | null;
  quantity: number;
  projectionValue: number;
  fob: number | null;
  matchStatus: string;
  matchedPoNumber: string | null;
  matchedAt: string | null;
  actualQuantity: number | null;
  actualValue: number | null;
  quantityVariance: number | null;
  valueVariance: number | null;
  variancePct: number | null;
  importBatchId: number | null;
  createdAt: string;
  projectionRunDate: string | null;
  sourceFile: string | null;
}

interface ProjectionsResponse {
  projections: Projection[];
  total: number;
  stats: Record<string, { count: number; value: number }>;
  year: number;
  limit: number;
  offset: number;
}

interface Vendor {
  id: number;
  name: string;
}

const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const MATCH_STATUSES = [
  { value: "all", label: "All Statuses" },
  { value: "matched", label: "Matched" },
  { value: "partial", label: "Partial Match" },
  { value: "unmatched", label: "Unmatched" },
  { value: "expired", label: "Expired" },
  { value: "verified_unmatched", label: "Verified Unmatched" },
];

const ORDER_TYPES = [
  { value: "all", label: "All Types" },
  { value: "regular", label: "Regular" },
  { value: "mto", label: "MTO" },
  { value: "spo", label: "SPO" },
];

const BRANDS = [
  { value: "all", label: "All Brands" },
  { value: "C&K", label: "C&K" },
  { value: "CB", label: "CB" },
  { value: "CB2", label: "CB2" },
];

const PRODUCT_CLASSES = [
  "ACCENT TABLES",
  "BABY BEDROOM",
  "BEDROOM",
  "CANDLELIGHT",
  "CB2 ACCENT & STORAGE",
  "CB2 BEDROOM",
  "CB2 DECORATIVE ACCESSORIES",
  "CB2 DINING",
  "CB2 LIGHTING",
  "CB2 OUTDOOR",
  "CB2 OUTDOOR ACCESSORIES",
  "CB2 UPHOLSTERY",
  "DECORATIVE OBJECTS",
  "DINING",
  "HOME ACCENTS",
  "HOME OFFICE",
  "KID BEDROOM",
  "KID DECOR",
  "KID LIGHTING",
  "KID ORGANIZATION",
  "KID PLAY FURNITURE",
  "KID WORKSPACE & STORAGE",
  "LIGHTING",
  "OUTDOOR FURNITURE",
  "OUTDOOR LIVING",
  "SERVING",
  "STORAGE",
  "UPHOLSTERY",
  "WALL DECOR",
];

function getMonthName(month: number): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[month - 1] || "Unknown";
}

function formatRunMonth(projectionRunDate: string | null, sourceFile: string | null): string {
  if (projectionRunDate) {
    const date = new Date(projectionRunDate);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  }
  if (sourceFile) {
    const match = sourceFile.match(/(\d{1,2})[-_.](\d{1,2})[-_.](\d{2,4})/);
    if (match) {
      const month = parseInt(match[1]);
      const year = parseInt(match[3]);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${months[month - 1]} ${year > 100 ? year : 2000 + year}`;
    }
  }
  return "-";
}

function formatCurrency(cents: number | null): string {
  if (cents === null || cents === undefined) return "-";
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatNumber(num: number | null): string {
  if (num === null || num === undefined) return "-";
  return new Intl.NumberFormat('en-US').format(num);
}

function getOrderTypeBadge(orderType: string | null) {
  switch (orderType?.toLowerCase()) {
    case "mto":
      return (
        <Badge variant="outline" className="border-blue-500 text-blue-600" data-testid="badge-order-mto">
          MTO
        </Badge>
      );
    case "spo":
      return (
        <Badge variant="outline" className="border-orange-500 text-orange-600" data-testid="badge-order-spo">
          SPO
        </Badge>
      );
    case "regular":
    default:
      return (
        <Badge variant="outline" className="border-muted-foreground text-muted-foreground" data-testid="badge-order-regular">
          Regular
        </Badge>
      );
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "matched":
      return (
        <Badge variant="default" className="bg-green-600 text-white" data-testid="badge-status-matched">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Matched
        </Badge>
      );
    case "partial":
      return (
        <Badge variant="default" className="bg-yellow-600 text-white" data-testid="badge-status-partial">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Partial
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="default" className="bg-red-600 text-white" data-testid="badge-status-expired">
          <Clock className="w-3 h-3 mr-1" />
          Expired
        </Badge>
      );
    case "verified_unmatched":
      return (
        <Badge variant="default" className="bg-purple-600 text-white" data-testid="badge-status-verified">
          <XCircle className="w-3 h-3 mr-1" />
          Verified
        </Badge>
      );
    case "unmatched":
    default:
      return (
        <Badge variant="secondary" data-testid="badge-status-unmatched">
          <Package className="w-3 h-3 mr-1" />
          Unmatched
        </Badge>
      );
  }
}

export default function ProjectionsList() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [vendorId, setVendorId] = useState<string>("all");
  const [month, setMonth] = useState<string>("all");
  const [runMonth, setRunMonth] = useState<string>("all");
  const [matchStatus, setMatchStatus] = useState<string>("all");
  const [orderType, setOrderType] = useState<string>("all");
  const [brand, setBrand] = useState<string>("all");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showHistoric, setShowHistoric] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  const queryParams = new URLSearchParams({
    year: year.toString(),
    limit: limit.toString(),
    offset: offset.toString(),
    showHistoric: showHistoric.toString(),
  });
  if (vendorId !== "all") queryParams.set("vendorId", vendorId);
  if (month !== "all") queryParams.set("month", month);
  if (runMonth !== "all") queryParams.set("runMonth", runMonth);
  if (matchStatus !== "all") queryParams.set("matchStatus", matchStatus);
  if (orderType !== "all") queryParams.set("orderType", orderType);
  if (brand !== "all") queryParams.set("brand", brand);
  if (selectedCategories.length > 0) queryParams.set("productClasses", selectedCategories.join(","));

  const { data, isLoading, isError } = useQuery<ProjectionsResponse>({
    queryKey: ["/api/projections/list", year, vendorId, month, runMonth, matchStatus, orderType, brand, selectedCategories, showHistoric, offset],
    queryFn: async () => {
      const response = await fetch(`/api/projections/list?${queryParams.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch projections");
      return response.json();
    },
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const currentPage = Math.floor(offset / limit) + 1;

  const handlePrevPage = () => {
    setOffset(Math.max(0, offset - limit));
  };

  const handleNextPage = () => {
    if (data && offset + limit < data.total) {
      setOffset(offset + limit);
    }
  };

  const handleFilterChange = () => {
    setOffset(0);
  };

  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Build query params matching current filters but without pagination
      const exportParams = new URLSearchParams({
        year: year.toString(),
        limit: "100000", // Get all records
        offset: "0",
        showHistoric: showHistoric.toString(),
      });
      if (vendorId !== "all") exportParams.set("vendorId", vendorId);
      if (month !== "all") exportParams.set("month", month);
      if (runMonth !== "all") exportParams.set("runMonth", runMonth);
      if (matchStatus !== "all") exportParams.set("matchStatus", matchStatus);
      if (orderType !== "all") exportParams.set("orderType", orderType);
      if (brand !== "all") exportParams.set("brand", brand);
      if (selectedCategories.length > 0) exportParams.set("productClasses", selectedCategories.join(","));

      const response = await fetch(`/api/projections/list?${exportParams.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch projections for export");
      
      const result: ProjectionsResponse = await response.json();
      const projections = result.projections;

      if (projections.length === 0) {
        toast({ title: "No data to export", description: "No projections match your current filters." });
        return;
      }

      // Build CSV content
      const headers = [
        "Vendor", "SKU", "Description", "Collection", "Brand", "Year", "Month",
        "Order Type", "Quantity", "Projected Value", "Match Status", "Matched PO",
        "Actual Quantity", "Actual Value", "Quantity Variance", "Value Variance", "Variance %",
        "Projection Month", "Source File"
      ];

      const rows = projections.map(p => [
        p.vendorName,
        p.sku,
        p.skuDescription || "",
        p.collection || "",
        p.brand,
        p.year,
        getMonthName(p.month),
        p.orderType || "Regular",
        p.quantity,
        (p.projectionValue / 100).toFixed(2),
        p.matchStatus,
        p.matchedPoNumber || "",
        p.actualQuantity ?? "",
        p.actualValue ? (p.actualValue / 100).toFixed(2) : "",
        p.quantityVariance ?? "",
        p.valueVariance ? (p.valueVariance / 100).toFixed(2) : "",
        p.variancePct ? p.variancePct.toFixed(1) + "%" : "",
        formatRunMonth(p.projectionRunDate, p.sourceFile),
        p.sourceFile || ""
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(cell => 
          typeof cell === "string" && (cell.includes(",") || cell.includes('"')) 
            ? `"${cell.replace(/"/g, '""')}"` 
            : cell
        ).join(","))
      ].join("\n");

      // Create and download file
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `projections_${year}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({ title: "Export complete", description: `Exported ${projections.length} projections to CSV.` });
    } catch (error: any) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Projections List</h1>
          <p className="text-muted-foreground">View all SKU projections with match status</p>
        </div>
        <Button 
          onClick={handleExport} 
          disabled={exporting || isLoading}
          data-testid="button-export"
        >
          <Download className="h-4 w-4 mr-2" />
          {exporting ? "Exporting..." : "Export to Excel"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label>Year</Label>
              <Select value={year.toString()} onValueChange={(v) => { setYear(parseInt(v)); handleFilterChange(); }}>
                <SelectTrigger className="w-[120px]" data-testid="select-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                    <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Vendor</Label>
              <Select value={vendorId} onValueChange={(v) => { setVendorId(v); handleFilterChange(); }}>
                <SelectTrigger className="w-[200px]" data-testid="select-vendor">
                  <SelectValue placeholder="All Vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vendors</SelectItem>
                  {vendors?.map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Target Month</Label>
              <Select value={month} onValueChange={(v) => { setMonth(v); handleFilterChange(); }}>
                <SelectTrigger className="w-[150px]" data-testid="select-month">
                  <SelectValue placeholder="All Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Projection Month</Label>
              <Select value={runMonth} onValueChange={(v) => { setRunMonth(v); handleFilterChange(); }}>
                <SelectTrigger className="w-[150px]" data-testid="select-run-month">
                  <SelectValue placeholder="All Projection Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projection Months</SelectItem>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Match Status</Label>
              <Select value={matchStatus} onValueChange={(v) => { setMatchStatus(v); handleFilterChange(); }}>
                <SelectTrigger className="w-[180px]" data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATCH_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Order Type</Label>
              <Select value={orderType} onValueChange={(v) => { setOrderType(v); handleFilterChange(); }}>
                <SelectTrigger className="w-[130px]" data-testid="select-order-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Brand</Label>
              <Select value={brand} onValueChange={(v) => { setBrand(v); handleFilterChange(); }}>
                <SelectTrigger className="w-[120px]" data-testid="select-brand">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BRANDS.map((b) => (
                    <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[180px] justify-between"
                    data-testid="button-category-filter"
                  >
                    <span className="truncate">
                      {selectedCategories.length === 0
                        ? "All Categories"
                        : selectedCategories.length === 1
                        ? selectedCategories[0]
                        : `${selectedCategories.length} selected`}
                    </span>
                    <Filter className="h-4 w-4 ml-2 flex-shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <div className="flex items-center justify-between p-3 border-b">
                    <span className="text-sm font-medium">Select Categories</span>
                    {selectedCategories.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setSelectedCategories([]); handleFilterChange(); }}
                        className="h-6 px-2 text-xs"
                        data-testid="button-clear-categories"
                      >
                        <X className="h-3 w-3 mr-1" />
                        Clear
                      </Button>
                    )}
                  </div>
                  <ScrollArea className="h-[300px]">
                    <div className="p-2 space-y-1">
                      {PRODUCT_CLASSES.map((category) => (
                        <label
                          key={category}
                          className="flex items-center space-x-2 p-2 rounded hover-elevate cursor-pointer"
                          data-testid={`checkbox-category-${category.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          <Checkbox
                            checked={selectedCategories.includes(category)}
                            onCheckedChange={(checked) => {
                              setSelectedCategories(prev =>
                                checked
                                  ? [...prev, category]
                                  : prev.filter(c => c !== category)
                              );
                              handleFilterChange();
                            }}
                          />
                          <span className="text-sm">{category}</span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-center space-x-2 pb-1">
              <Switch
                id="historic-toggle"
                checked={showHistoric}
                onCheckedChange={(v) => { setShowHistoric(v); handleFilterChange(); }}
                data-testid="switch-historic"
              />
              <Label htmlFor="historic-toggle">Show Historic</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {data?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Matched</p>
                  <p className="text-2xl font-bold text-green-600" data-testid="text-stat-matched">{formatNumber(data.stats.matched?.count || 0)}</p>
                  <p className="text-xs text-muted-foreground">{formatCurrency(data.stats.matched?.value || 0)}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Partial</p>
                  <p className="text-2xl font-bold text-yellow-600" data-testid="text-stat-partial">{formatNumber(data.stats.partial?.count || 0)}</p>
                  <p className="text-xs text-muted-foreground">{formatCurrency(data.stats.partial?.value || 0)}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-yellow-600" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Unmatched</p>
                  <p className="text-2xl font-bold text-muted-foreground" data-testid="text-stat-unmatched">{formatNumber(data.stats.unmatched?.count || 0)}</p>
                  <p className="text-xs text-muted-foreground">{formatCurrency(data.stats.unmatched?.value || 0)}</p>
                </div>
                <Package className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Expired</p>
                  <p className="text-2xl font-bold text-red-600" data-testid="text-stat-expired">{formatNumber(data.stats.expired?.count || 0)}</p>
                  <p className="text-xs text-muted-foreground">{formatCurrency(data.stats.expired?.value || 0)}</p>
                </div>
                <Clock className="h-8 w-8 text-red-600" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold" data-testid="text-stat-total">{formatNumber(data.total)}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-lg">Projections</CardTitle>
          {data && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Showing {offset + 1}-{Math.min(offset + limit, data.total)} of {data.total}</span>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevPage}
                disabled={offset === 0}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span>Page {currentPage} of {totalPages}</span>
              <Button
                variant="outline"
                size="icon"
                onClick={handleNextPage}
                disabled={!data || offset + limit >= data.total}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-8 text-red-500">
              Failed to load projections. Please try again.
            </div>
          ) : data?.projections.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No projections found matching your filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>SKU Name</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Projection Month</TableHead>
                    <TableHead>Ship Month</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Projected Value</TableHead>
                    <TableHead className="text-right">Actual Value</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>PO Number</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.projections.map((p) => (
                    <TableRow key={p.id} data-testid={`row-projection-${p.id}`}>
                      <TableCell>{getStatusBadge(p.matchStatus)}</TableCell>
                      <TableCell className="font-medium">{p.vendorName || `Vendor ${p.vendorId}`}</TableCell>
                      <TableCell className="font-mono text-sm">{p.sku}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={p.skuDescription || ""}>
                        {p.skuDescription || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.brand || "CB"}</Badge>
                      </TableCell>
                      <TableCell>{getOrderTypeBadge(p.orderType)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatRunMonth(p.projectionRunDate, p.sourceFile)}</TableCell>
                      <TableCell>{getMonthName(p.month)} {p.year}</TableCell>
                      <TableCell className="text-right">{formatNumber(p.quantity)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(p.projectionValue)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(p.actualValue)}</TableCell>
                      <TableCell className="text-right">
                        {p.variancePct !== null && (
                          <span className={p.variancePct > 0 ? "text-green-600" : p.variancePct < 0 ? "text-red-600" : ""}>
                            {p.variancePct > 0 ? "+" : ""}{p.variancePct}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.matchedPoNumber || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
