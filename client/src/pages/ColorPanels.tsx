import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Palette, Calendar, AlertTriangle, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/DataTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { differenceInDays, format } from "date-fns";
import { useClientContext } from "@/contexts/ClientContext";

export default function ColorPanels() {
  const [, setLocation] = useLocation();
  const { selectedClient } = useClientContext();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");

  const panelsUrl = selectedClient?.shortName
    ? `/api/color-panels?client=${encodeURIComponent(selectedClient.shortName)}`
    : "/api/color-panels";

  const { data: panels, isLoading: panelsLoading } = useQuery<any[]>({
    queryKey: [panelsUrl],
  });

  const vendorsUrl = selectedClient?.shortName
    ? `/api/vendors?client=${encodeURIComponent(selectedClient.shortName)}`
    : "/api/vendors";

  const { data: vendors } = useQuery<any[]>({
    queryKey: [vendorsUrl],
  });

  const brandAssignmentsUrl = selectedClient?.shortName
    ? `/api/brand-assignments?client=${encodeURIComponent(selectedClient.shortName)}`
    : "/api/brand-assignments";

  const { data: brandAssignments } = useQuery<any[]>({
    queryKey: [brandAssignmentsUrl],
  });

  const getExpirationStatus = (expirationDate: string | null) => {
    if (!expirationDate) return { label: "No Expiration", variant: "secondary" as const, daysRemaining: null };
    
    const expDate = new Date(expirationDate);
    const today = new Date();
    const daysRemaining = differenceInDays(expDate, today);
    
    if (daysRemaining < 0) {
      return { label: "Expired", variant: "destructive" as const, daysRemaining };
    } else if (daysRemaining <= 30) {
      return { label: "Expiring Soon", variant: "default" as const, daysRemaining };
    } else if (daysRemaining <= 90) {
      return { label: "Active", variant: "secondary" as const, daysRemaining };
    } else {
      return { label: "Active", variant: "secondary" as const, daysRemaining };
    }
  };

  const filteredPanels = panels?.filter((panel) => {
    if (statusFilter !== "all" && panel.status !== statusFilter) return false;
    if (brandFilter !== "all" && panel.brand !== brandFilter) return false;
    if (vendorFilter !== "all" && panel.vendorId?.toString() !== vendorFilter) return false;
    return true;
  }) || [];

  // Filter out 'CBH' (it's the client/parent company, not a brand) and normalize 'CK' to 'C&K'
  const uniqueBrands = Array.from(new Set(
    panels?.map((p) => p.brand)
      .filter((b): b is string => Boolean(b) && b.toUpperCase() !== 'CBH')
      .map(b => b === 'CK' ? 'C&K' : b)
  )).sort() as string[];
  const panelVendors = vendors?.filter((v) => panels?.some((p) => p.vendorId === v.id)) || [];

  const hasActiveFilters = statusFilter !== "all" || brandFilter !== "all" || vendorFilter !== "all";

  const clearAllFilters = () => {
    setStatusFilter("all");
    setBrandFilter("all");
    setVendorFilter("all");
  };

  const columns = [
    {
      key: "brand",
      label: "Brand",
      sortable: true,
      render: (value: string | null) => (
        <span className="font-medium">{value || <span className="text-muted-foreground">N/A</span>}</span>
      ),
    },
    {
      key: "vendorName",
      label: "Vendor",
      sortable: true,
      render: (value: string | null, row: any) => {
        const vendor = vendors?.find((v) => v.id === row.vendorId);
        return vendor ? (
          <Link href={`/vendors/${vendor.id}`}>
            <span className="text-primary hover:underline cursor-pointer" data-testid={`link-vendor-${vendor.id}`}>
              {vendor.name}
            </span>
          </Link>
        ) : (
          <span className="text-muted-foreground">N/A</span>
        );
      },
    },
    {
      key: "material",
      label: "Material",
      sortable: true,
      render: (value: string | null) => (
        <div className="max-w-[200px] truncate" title={value || ''}>
          {value || <span className="text-muted-foreground">N/A</span>}
        </div>
      ),
    },
    {
      key: "finishName",
      label: "Finish",
      sortable: true,
      render: (value: string | null) => (
        <div className="max-w-[150px] truncate" title={value || ''}>
          {value || <span className="text-muted-foreground">N/A</span>}
        </div>
      ),
    },
    {
      key: "currentMcpNumber",
      label: "Current MCP#",
      sortable: true,
      render: (value: string | null) => (
        <span className="font-mono text-sm">{value || <span className="text-muted-foreground">N/A</span>}</span>
      ),
    },
    {
      key: "skuCount",
      label: "SKUs",
      sortable: true,
      render: (value: number | null, row: any) => (
        <Badge variant="outline" data-testid={`badge-sku-count-${row.id}`}>
          {value || 0} SKU{value === 1 ? '' : 's'}
        </Badge>
      ),
    },
    {
      key: "currentExpirationDate",
      label: "Expiration",
      sortable: true,
      render: (value: string | null, row: any) => {
        const expirationStatus = getExpirationStatus(value);
        return (
          <div className="flex flex-col gap-1">
            {value ? (
              <>
                <div className="text-sm">
                  {format(new Date(value), 'MMM d, yyyy')}
                </div>
                {expirationStatus.daysRemaining !== null && expirationStatus.daysRemaining <= 90 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {expirationStatus.daysRemaining < 0 ? (
                      <>
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                        <span>{Math.abs(expirationStatus.daysRemaining)} days overdue</span>
                      </>
                    ) : (
                      <>
                        <Calendar className="h-3 w-3" />
                        <span>{expirationStatus.daysRemaining} days left</span>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <span className="text-muted-foreground text-sm">Not set</span>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (value: string | null, row: any) => {
        const expirationStatus = getExpirationStatus(row.currentExpirationDate);
        return (
          <Badge variant={expirationStatus.variant} data-testid={`badge-expiration-${row.id}`}>
            {expirationStatus.label}
          </Badge>
        );
      },
    },
    {
      key: "actions",
      label: "Actions",
      render: (_: any, row: any) => (
        <Link href={`/color-panels/${row.id}`}>
          <Button variant="outline" size="sm" data-testid={`button-view-${row.id}`}>
            View Details
          </Button>
        </Link>
      ),
    },
  ];

  const tableData = filteredPanels.map((panel: any) => ({
    ...panel,
    vendorName: vendors?.find((v) => v.id === panel.vendorId)?.name || null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="heading-color-panels">Master Color Panel Library</h1>
          <p className="text-muted-foreground">
            Track material specifications, finish details, and renewal history for all color panels
          </p>
        </div>
        <Link href="/mcp-setup">
          <Button data-testid="button-setup-new-mcp">
            <Plus className="h-4 w-4 mr-2" />
            Set up New MCP
          </Button>
        </Link>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[180px]">
            <Label htmlFor="status-filter" className="text-xs text-muted-foreground mb-1.5 block">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="status-filter" className="h-9" data-testid="select-status-filter">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="status-option-all">All Statuses</SelectItem>
                <SelectItem value="active" data-testid="status-option-active">Active</SelectItem>
                <SelectItem value="expiring" data-testid="status-option-expiring">Expiring Soon</SelectItem>
                <SelectItem value="pending_renewal" data-testid="status-option-pending">Pending Renewal</SelectItem>
                <SelectItem value="expired" data-testid="status-option-expired">Expired</SelectItem>
                <SelectItem value="archived" data-testid="status-option-archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <Label htmlFor="brand-filter" className="text-xs text-muted-foreground mb-1.5 block">Brand</Label>
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger id="brand-filter" className="h-9" data-testid="select-brand-filter">
                <SelectValue placeholder="All Brands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="brand-option-all">All Brands</SelectItem>
                {uniqueBrands.map((brand) => (
                  <SelectItem key={brand} value={brand} data-testid={`brand-option-${brand}`}>
                    {brand}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <Label htmlFor="vendor-filter" className="text-xs text-muted-foreground mb-1.5 block">Vendor</Label>
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger id="vendor-filter" className="h-9" data-testid="select-vendor-filter">
                <SelectValue placeholder="All Vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="vendor-option-all">All Vendors</SelectItem>
                {panelVendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id.toString()} data-testid={`vendor-option-${vendor.id}`}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearAllFilters} 
              className="h-9"
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </Card>

      {hasActiveFilters && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg">
          <span className="text-sm text-muted-foreground">Filtered by:</span>
          {statusFilter !== "all" && (
            <Badge variant="secondary" data-testid="badge-filter-status">
              Status: {statusFilter}
            </Badge>
          )}
          {brandFilter !== "all" && (
            <Badge variant="secondary" data-testid="badge-filter-brand">
              Brand: {brandFilter}
            </Badge>
          )}
          {vendorFilter !== "all" && (
            <Badge variant="secondary" data-testid="badge-filter-vendor">
              Vendor: {panelVendors.find(v => v.id.toString() === vendorFilter)?.name || vendorFilter}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground ml-2">
            ({filteredPanels.length} of {panels?.length || 0} panels)
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Color Panels ({filteredPanels.length})
          </CardTitle>
          <CardDescription>
            View color panel specifications, expiration dates, and version history
          </CardDescription>
        </CardHeader>
        <CardContent>
          {panelsLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : filteredPanels.length > 0 ? (
            <DataTable 
              columns={columns} 
              data={tableData}
              onRowClick={(row) => setLocation(`/color-panels/${row.id}`)}
            />
          ) : (
            <div className="text-center py-8">
              <Palette className="h-12 w-12 mx-auto mb-4 opacity-50 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">No color panels found</p>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  className="mt-2"
                  onClick={clearAllFilters}
                >
                  Clear all filters
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
