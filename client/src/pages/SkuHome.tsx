import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/DataTable";
import { 
  Package, 
  Search,
  Building2,
  TrendingUp,
  ExternalLink,
  X
} from "lucide-react";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { useClientContext } from "@/contexts/ClientContext";

interface Vendor {
  id: number;
  name: string;
  merchandiser?: string | null;
  merchandisingManager?: string | null;
}

interface Filters {
  skuSearch?: string;
  vendor?: string;
  brand?: string;
  merchandiser?: string;
  merchandisingManager?: string;
}

interface SkuWithMetrics {
  skuCode: string;
  description: string | null;
  supplier: string | null;
  lastOrderFobPrice: number;
  totalSalesYtd: number;
  totalOrdersYtd: number;
  lastOrderDate: string | null;
}

export default function SkuHome() {
  const [filters, setFilters] = useState<Filters>({});
  const { selectedClient } = useClientContext();

  // Build URL with filters
  const skusUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedClient?.shortName) params.set('client', selectedClient.shortName);
    if (filters.brand) params.set('brand', filters.brand);
    const queryString = params.toString();
    return queryString ? `/api/skus-with-metrics?${queryString}` : "/api/skus-with-metrics";
  }, [selectedClient, filters.brand]);

  const { data: skuList = [], isLoading } = useQuery<SkuWithMetrics[]>({
    queryKey: ["/api/skus-with-metrics", selectedClient?.shortName, filters.brand],
    queryFn: () => fetch(skusUrl).then(r => r.json()),
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  // Create vendor lookup maps for merchandiser/manager
  const vendorToMerchandiser = useMemo(() => {
    const map = new Map<string, string>();
    vendors.forEach((v: any) => {
      if (v.name && v.merchandiser) map.set(v.name, v.merchandiser);
    });
    return map;
  }, [vendors]);

  const vendorToManager = useMemo(() => {
    const map = new Map<string, string>();
    vendors.forEach((v: any) => {
      if (v.name && v.merchandisingManager) map.set(v.name, v.merchandisingManager);
    });
    return map;
  }, [vendors]);

  // Get unique vendors (suppliers) from SKU data
  const vendorNames = useMemo(() => {
    return Array.from(new Set(skuList.map(sku => sku.supplier).filter((s): s is string => Boolean(s)))).sort();
  }, [skuList]);

  // Get unique merchandisers from vendors that appear in SKU data
  const merchandisers = useMemo(() => {
    const suppliersInSkus = new Set(skuList.map(sku => sku.supplier).filter(Boolean));
    const merchSet = new Set<string>();
    vendors.forEach((v: any) => {
      if (v.merchandiser && suppliersInSkus.has(v.name)) {
        merchSet.add(v.merchandiser);
      }
    });
    return Array.from(merchSet).sort();
  }, [skuList, vendors]);

  // Get unique merchandising managers from vendors that appear in SKU data
  const merchandisingManagers = useMemo(() => {
    const suppliersInSkus = new Set(skuList.map(sku => sku.supplier).filter(Boolean));
    const mgrSet = new Set<string>();
    vendors.forEach((v: any) => {
      if (v.merchandisingManager && suppliersInSkus.has(v.name)) {
        mgrSet.add(v.merchandisingManager);
      }
    });
    return Array.from(mgrSet).sort();
  }, [skuList, vendors]);

  // Apply all filters
  const filteredSkus = useMemo(() => {
    let filtered = [...skuList];

    // SKU search
    if (filters.skuSearch) {
      const search = filters.skuSearch.toLowerCase();
      filtered = filtered.filter(sku =>
        sku.skuCode.toLowerCase().includes(search) ||
        (sku.description?.toLowerCase().includes(search) ?? false)
      );
    }

    // Vendor filter
    if (filters.vendor) {
      filtered = filtered.filter(sku => sku.supplier === filters.vendor);
    }

    // Merchandiser filter (lookup via vendor)
    if (filters.merchandiser) {
      filtered = filtered.filter(sku => {
        const vendorMerch = sku.supplier ? vendorToMerchandiser.get(sku.supplier) : null;
        return vendorMerch === filters.merchandiser;
      });
    }

    // Merchandising Manager filter (lookup via vendor)
    if (filters.merchandisingManager) {
      filtered = filtered.filter(sku => {
        const vendorMgr = sku.supplier ? vendorToManager.get(sku.supplier) : null;
        return vendorMgr === filters.merchandisingManager;
      });
    }

    return filtered;
  }, [skuList, filters, vendorToMerchandiser, vendorToManager]);

  const clearAllFilters = () => {
    setFilters({});
  };

  const hasActiveFilters = Object.keys(filters).some(key => filters[key as keyof Filters] !== undefined);

  const columns = [
    {
      key: "skuCode",
      label: "SKU",
      sortable: true,
      render: (value: string) => (
        <Link href={`/sku-summary/${encodeURIComponent(value)}`}>
          <span 
            className="font-mono text-primary hover:underline cursor-pointer flex items-center gap-1"
            data-testid={`link-sku-${value}`}
          >
            {value}
            <ExternalLink className="h-3 w-3" />
          </span>
        </Link>
      ),
    },
    {
      key: "description",
      label: "Description",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm max-w-[300px] truncate block" title={value || ""}>
          {value || <span className="text-muted-foreground italic">No description</span>}
        </span>
      ),
    },
    {
      key: "supplier",
      label: "Supplier",
      sortable: true,
      render: (value: string | null) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">
            {value || <span className="text-muted-foreground italic">Unknown</span>}
          </span>
        </div>
      ),
    },
    {
      key: "lastOrderFobPrice",
      label: "Last FOB Price",
      sortable: true,
      render: (value: number) => (
        <span className="font-mono text-sm" data-testid="text-fob-price">
          ${(value / 100).toFixed(2)}
        </span>
      ),
    },
    {
      key: "totalSalesYtd",
      label: "YTD Sales",
      sortable: true,
      render: (value: number) => (
        <Badge variant="secondary" className="font-mono" data-testid="badge-ytd-sales">
          ${(value / 100).toLocaleString()}
        </Badge>
      ),
    },
    {
      key: "totalOrdersYtd",
      label: "YTD Orders",
      sortable: true,
      render: (value: number) => (
        <span className="text-sm font-medium" data-testid="text-ytd-orders">
          {value.toLocaleString()}
        </span>
      ),
    },
    {
      key: "lastOrderDate",
      label: "Last Order",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm text-muted-foreground">
          {value ? format(new Date(value), "MMM dd, yyyy") : "N/A"}
        </span>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3" data-testid="text-page-title">
            <Package className="h-6 w-6" />
            SKU Home
          </h1>
          <p className="text-muted-foreground mt-1">
            View all SKUs with supplier information, pricing, and sales metrics
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                SKU Catalog
              </CardTitle>
              <CardDescription>
                Click on any SKU to view detailed information including sales trends, shipment history, and compliance status
              </CardDescription>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid="button-clear-filters">
                <X className="h-4 w-4 mr-1" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-4 bg-muted/30 rounded-lg border">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="sku-search" className="text-xs text-muted-foreground mb-1.5 block">SKU Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="sku-search"
                    placeholder="Search by SKU or description"
                    value={filters.skuSearch || ""}
                    onChange={(e) => setFilters(prev => ({ ...prev, skuSearch: e.target.value || undefined }))}
                    className="pl-10 h-9"
                    data-testid="input-search-sku"
                  />
                </div>
              </div>

              <div className="flex-1 min-w-[180px]">
                <Label htmlFor="vendor-filter" className="text-xs text-muted-foreground mb-1.5 block">Vendor</Label>
                <Select 
                  value={filters.vendor || "all"} 
                  onValueChange={(value) => setFilters(prev => ({ ...prev, vendor: value === "all" ? undefined : value }))}
                >
                  <SelectTrigger id="vendor-filter" className="h-9" data-testid="select-vendor">
                    <SelectValue placeholder="All Vendors" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Vendors</SelectItem>
                    {vendorNames.map((vendor) => (
                      <SelectItem key={vendor} value={vendor}>{vendor}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[180px]">
                <Label htmlFor="merchandiser-filter" className="text-xs text-muted-foreground mb-1.5 block">Merchandiser</Label>
                <Select 
                  value={filters.merchandiser || "all"} 
                  onValueChange={(value) => setFilters(prev => ({ ...prev, merchandiser: value === "all" ? undefined : value }))}
                >
                  <SelectTrigger id="merchandiser-filter" className="h-9" data-testid="select-merchandiser">
                    <SelectValue placeholder="All Merchandisers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Merchandisers</SelectItem>
                    {merchandisers.map((merch) => (
                      <SelectItem key={merch} value={merch}>{merch}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[180px]">
                <Label htmlFor="mm-filter" className="text-xs text-muted-foreground mb-1.5 block">Merchandising Manager</Label>
                <Select 
                  value={filters.merchandisingManager || "all"} 
                  onValueChange={(value) => setFilters(prev => ({ ...prev, merchandisingManager: value === "all" ? undefined : value }))}
                >
                  <SelectTrigger id="mm-filter" className="h-9" data-testid="select-merch-manager">
                    <SelectValue placeholder="All Managers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Managers</SelectItem>
                    {merchandisingManagers.map((mgr) => (
                      <SelectItem key={mgr} value={mgr}>{mgr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[120px]">
                <Label htmlFor="brand-filter" className="text-xs text-muted-foreground mb-1.5 block">Brand</Label>
                <Select 
                  value={filters.brand || "all"} 
                  onValueChange={(value) => setFilters(prev => ({ ...prev, brand: value === "all" ? undefined : value }))}
                >
                  <SelectTrigger id="brand-filter" className="h-9" data-testid="select-brand">
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
            </div>
          </div>

          {filteredSkus.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {hasActiveFilters ? "No SKUs match your filter criteria" : "No SKUs found in the system"}
              </p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={filteredSkus}
              hideSearch
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
