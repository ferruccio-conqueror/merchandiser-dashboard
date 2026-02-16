import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { X, AlertTriangle, Clock, CheckCircle, Search, Download } from "lucide-react";
import { HelpButton } from "@/components/HelpButton";
import { format, differenceInDays } from "date-fns";
import { Link, useSearch, useLocation } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useClientContext } from "@/contexts/ClientContext";
import type { PurchaseOrder, PurchaseOrderWithComputedFields, Vendor } from "@shared/schema";

interface Filters {
  poNumber?: string;
  vendor?: string;
  office?: string;
  buyer?: string;
  merchandisingManager?: string;
  brand?: string;
  status?: string;
  otdStatus?: string;
  needsConfirming?: boolean;
}

export default function PurchaseOrders() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const { selectedClient } = useClientContext();
  
  // Parse URL parameters on mount
  const urlParams = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return {
      vendor: params.get('vendor') || undefined,
      otdStatus: params.get('otdStatus') || undefined,
    };
  }, [searchString]);

  const [filters, setFilters] = useState<Filters>({});
  const [initialized, setInitialized] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportType, setExportType] = useState<'sku' | 'po'>('sku');
  const [isExporting, setIsExporting] = useState(false);
  const [hideZeroValue, setHideZeroValue] = useState(true); // Hide sample POs by default
  const [hide8x8, setHide8x8] = useState(true); // Hide 8x8 component POs by default

  // Initialize filters from URL params only once
  useEffect(() => {
    if (!initialized) {
      const initialFilters: Filters = {};
      if (urlParams.vendor) initialFilters.vendor = urlParams.vendor;
      if (urlParams.otdStatus) initialFilters.otdStatus = urlParams.otdStatus;
      if (Object.keys(initialFilters).length > 0) {
        setFilters(initialFilters);
      }
      setInitialized(true);
    }
  }, [initialized, urlParams]);

  // Build API URL with client filter
  const poQueryKey = selectedClient?.shortName 
    ? `/api/purchase-orders?client=${encodeURIComponent(selectedClient.shortName)}`
    : "/api/purchase-orders";

  const { data: purchaseOrders = [], isLoading: posLoading } = useQuery<PurchaseOrderWithComputedFields[]>({
    queryKey: [poQueryKey],
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  // Extract unique values for filters
  const vendorNames = useMemo(() => {
    return Array.from(new Set(purchaseOrders.map(po => po.vendor).filter(Boolean)));
  }, [purchaseOrders]);

  const offices = useMemo(() => {
    return Array.from(new Set(purchaseOrders.map(po => po.office).filter(Boolean)));
  }, [purchaseOrders]);

  // Create vendor lookup maps
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

  // Get unique merchandisers from vendors assigned to POs in the current view
  const merchandisers = useMemo(() => {
    const vendorsInPOs = new Set(purchaseOrders.map(po => po.vendor).filter(Boolean));
    const merchSet = new Set<string>();
    vendors.forEach((v: any) => {
      if (v.merchandiser && vendorsInPOs.has(v.name)) {
        merchSet.add(v.merchandiser);
      }
    });
    return Array.from(merchSet).sort();
  }, [purchaseOrders, vendors]);

  // Get unique merchandising managers from vendors assigned to POs in the current view
  const merchandisingManagers = useMemo(() => {
    const vendorsInPOs = new Set(purchaseOrders.map(po => po.vendor).filter(Boolean));
    const mgrSet = new Set<string>();
    vendors.forEach((v: any) => {
      if (v.merchandisingManager && vendorsInPOs.has(v.name)) {
        mgrSet.add(v.merchandisingManager);
      }
    });
    return Array.from(mgrSet).sort();
  }, [purchaseOrders, vendors]);

  // Get unique brands (client divisions: CB, CB2, C&K) from POs
  // Filter out 'CBH' (it's the client/parent company, not a brand) and normalize 'CK' to 'C&K'
  const brands = useMemo(() => {
    return Array.from(new Set(
      purchaseOrders
        .map(po => po.clientDivision)
        .filter((b): b is string => Boolean(b) && b !== null && b.trim() !== '' && b.toUpperCase() !== 'CBH')
        .map(b => b === 'CK' ? 'C&K' : b)
    )).sort();
  }, [purchaseOrders]);

  const statuses = useMemo(() => {
    // Show all statuses including Shipped and Closed for historical viewing
    const allStatuses = purchaseOrders
      .map(po => po.status)
      .filter(status => status);
    return Array.from(new Set(allStatuses)).sort();
  }, [purchaseOrders]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value / 100);
  };

  const columns = [
    { 
      key: "poNumber", 
      label: "PO Number", 
      sortable: true,
      render: (value: string, row: PurchaseOrder) => {
        return (
          <Link href={`/purchase-orders/${row.id}`}>
            <span className="text-primary hover:underline cursor-pointer font-medium" data-testid={`link-po-${row.id}`}>
              {value}
            </span>
          </Link>
        );
      }
    },
    { key: "vendor", label: "Vendor", sortable: true },
    { 
      key: "status", 
      label: "Status", 
      sortable: true,
      render: (value: string) => {
        const variant = value.includes("Risk") ? "secondary" : "outline";
        return <Badge variant={variant} data-testid={`badge-status-${value}`}>{value}</Badge>;
      }
    },
    {
      key: "daysToConfirm",
      label: "Days to Confirm",
      sortable: true,
      render: (_value: any, row: any) => {
        const poDate = row.poDate ? new Date(row.poDate) : null;
        if (!poDate) return <span className="text-muted-foreground">-</span>;
        
        // For EDI/Initial: calculate days from PO date to now (live count)
        // For other statuses: use confirmation_date if available (locked count)
        const isEdiInitial = row.status === 'EDI/Initial';
        let days = 0;
        
        if (isEdiInitial) {
          days = differenceInDays(new Date(), poDate);
        } else if (row.confirmationDate) {
          days = differenceInDays(new Date(row.confirmationDate), poDate);
        } else {
          // Already confirmed but no confirmation_date recorded - show dash
          return <span className="text-muted-foreground">-</span>;
        }
        
        // Show warning badge if EDI/Initial and 7+ days
        const needsConfirming = isEdiInitial && days >= 7;
        
        return (
          <div className="flex items-center gap-2">
            <span className={needsConfirming ? "text-destructive font-semibold" : ""}>
              {days}
            </span>
            {needsConfirming && (
              <Badge variant="destructive" className="text-xs" data-testid="badge-needs-confirming">
                Needs Confirming
              </Badge>
            )}
          </div>
        );
      }
    },
    { 
      key: "revisedShipDate", 
      label: "Ship Date", 
      sortable: true,
      render: (value: Date | null) => {
        return value ? format(new Date(value), "MM/dd/yyyy") : "-";
      }
    },
    { key: "orderQuantity", label: "Quantity", sortable: true },
    { 
      key: "totalValue", 
      label: "PO Value", 
      sortable: true,
      render: (value: number) => {
        return <span className="font-medium">{formatCurrency(value)}</span>;
      }
    },
  ];

  // Helper function to determine OTD status for a PO
  // Consistent with dashboard logic: Late = past cancel date, At-Risk = no actual ship date
  const getOtdStatus = (po: PurchaseOrderWithComputedFields): 'on-time' | 'late' | 'at-risk' | 'pending' => {
    const now = new Date();
    const revisedCancelDate = po.revisedCancelDate ? new Date(po.revisedCancelDate) : null;
    
    if (!revisedCancelDate) {
      return 'pending';
    }
    
    // Check if past deadline - Late
    if (now > revisedCancelDate) {
      return 'late';
    }
    
    // Check if at-risk: no actual ship date recorded
    if (po.hasActualShipDate === false) {
      return 'at-risk';
    }
    
    return 'on-time';
  };

  // Filter table data based on all filters including OTD status
  const filteredTableData = useMemo(() => {
    let filtered = purchaseOrders
      // Exclude Closed and Shipped orders - these are handed over and don't need tracking
      .filter(po => po.status !== 'Closed' && po.status !== 'Shipped')
      .map(po => {
        // Calculate total value from quantity × unit_price to ensure accuracy
        // (stored total_value from OS340 import may have incorrect values)
        const calculatedTotal = (po.orderQuantity || 0) * (po.unitPrice || 0);
        return {
          ...po,
          shipDate: po.revisedShipDate || po.originalShipDate,
          otdStatus: getOtdStatus(po),
          // Use calculated total if available, fallback to stored value
          totalValue: calculatedTotal > 0 ? calculatedTotal : (po.totalValue || 0),
        };
      });

    // Filter out zero-value POs (samples) if enabled
    if (hideZeroValue) {
      filtered = filtered.filter(po => po.totalValue > 0);
    }

    // Filter out 8x8 component POs if enabled (program_description starts with "8X8 " - matching backend ILIKE '8X8 %')
    if (hide8x8) {
      filtered = filtered.filter(po => 
        !po.programDescription?.toUpperCase().startsWith('8X8 ')
      );
    }

    // Apply PO number filter
    if (filters.poNumber) {
      const searchTerm = filters.poNumber.toLowerCase();
      filtered = filtered.filter(po => 
        po.poNumber?.toLowerCase().includes(searchTerm) ||
        po.copNumber?.toLowerCase().includes(searchTerm)
      );
    }

    // Apply vendor filter
    if (filters.vendor) {
      filtered = filtered.filter(po => po.vendor === filters.vendor);
    }

    // Apply office filter
    if (filters.office) {
      filtered = filtered.filter(po => po.office === filters.office);
    }

    // Apply merchandiser filter (lookup via vendor)
    if (filters.buyer) {
      filtered = filtered.filter(po => {
        const vendorMerch = po.vendor ? vendorToMerchandiser.get(po.vendor) : null;
        return vendorMerch === filters.buyer;
      });
    }

    // Apply merchandising manager filter (lookup via vendor)
    if (filters.merchandisingManager) {
      filtered = filtered.filter(po => {
        const vendorMgr = po.vendor ? vendorToManager.get(po.vendor) : null;
        return vendorMgr === filters.merchandisingManager;
      });
    }

    // Apply brand filter (client division: CB, CB2, CK)
    if (filters.brand) {
      filtered = filtered.filter(po => po.clientDivision === filters.brand);
    }

    // Apply status filter
    if (filters.status) {
      filtered = filtered.filter(po => po.status === filters.status);
    }

    // Apply OTD status filter
    if (filters.otdStatus) {
      filtered = filtered.filter(po => po.otdStatus === filters.otdStatus);
    }

    // Apply needs confirming filter (EDI/Initial with 7+ days since PO date)
    if (filters.needsConfirming) {
      filtered = filtered.filter(po => {
        if (po.status !== 'EDI/Initial') return false;
        const poDate = po.poDate ? new Date(po.poDate) : null;
        if (!poDate) return false;
        const days = differenceInDays(new Date(), poDate);
        return days >= 7;
      });
    }

    return filtered;
  }, [purchaseOrders, filters, vendorToMerchandiser, vendorToManager, hideZeroValue, hide8x8]);

  // Calculate POs needing confirmation (EDI/Initial with 7+ days) from filtered data
  // Uses the same filters except needsConfirming to show accurate count
  const posNeedingConfirmation = useMemo(() => {
    let baseFiltered = purchaseOrders
      .filter(po => po.status !== 'Closed' && po.status !== 'Shipped')
      .map(po => {
        const calculatedTotal = (po.orderQuantity || 0) * (po.unitPrice || 0);
        return {
          ...po,
          shipDate: po.revisedShipDate || po.originalShipDate,
          otdStatus: getOtdStatus(po),
          totalValue: calculatedTotal > 0 ? calculatedTotal : (po.totalValue || 0),
        };
      });

    // Apply same filters as filteredTableData (except needsConfirming)
    if (hideZeroValue) {
      baseFiltered = baseFiltered.filter(po => po.totalValue > 0);
    }
    if (hide8x8) {
      baseFiltered = baseFiltered.filter(po => !po.programDescription?.toUpperCase().startsWith('8X8 '));
    }
    if (filters.poNumber) {
      const searchTerm = filters.poNumber.toLowerCase();
      baseFiltered = baseFiltered.filter(po => 
        po.poNumber?.toLowerCase().includes(searchTerm) || po.copNumber?.toLowerCase().includes(searchTerm)
      );
    }
    if (filters.vendor) {
      baseFiltered = baseFiltered.filter(po => po.vendor === filters.vendor);
    }
    if (filters.office) {
      baseFiltered = baseFiltered.filter(po => po.office === filters.office);
    }
    if (filters.buyer) {
      baseFiltered = baseFiltered.filter(po => {
        const vendorMerch = po.vendor ? vendorToMerchandiser.get(po.vendor) : null;
        return vendorMerch === filters.buyer;
      });
    }
    if (filters.merchandisingManager) {
      baseFiltered = baseFiltered.filter(po => {
        const vendorMgr = po.vendor ? vendorToManager.get(po.vendor) : null;
        return vendorMgr === filters.merchandisingManager;
      });
    }
    if (filters.brand) {
      baseFiltered = baseFiltered.filter(po => po.clientDivision === filters.brand);
    }
    if (filters.status) {
      baseFiltered = baseFiltered.filter(po => po.status === filters.status);
    }
    if (filters.otdStatus) {
      baseFiltered = baseFiltered.filter(po => po.otdStatus === filters.otdStatus);
    }

    // Now count POs needing confirmation
    return baseFiltered.filter(po => {
      if (po.status !== 'EDI/Initial') return false;
      const poDate = po.poDate ? new Date(po.poDate) : null;
      if (!poDate) return false;
      const days = differenceInDays(new Date(), poDate);
      return days >= 7;
    }).length;
  }, [purchaseOrders, filters, vendorToMerchandiser, vendorToManager, hideZeroValue, hide8x8]);

  const clearAllFilters = () => {
    setFilters({});
    // Also clear URL params
    setLocation('/purchase-orders');
  };

  const hasActiveFilters = Object.keys(filters).some(key => filters[key as keyof Filters] !== undefined);

  const handleExportClick = () => {
    setExportDialogOpen(true);
  };

  // Helper to calculate Days to Confirm for export
  const calculateDaysToConfirm = (po: any): string => {
    const poDate = po.poDate ? new Date(po.poDate) : null;
    if (!poDate) return '';
    
    const isEdiInitial = po.status === 'EDI/Initial';
    if (isEdiInitial) {
      return differenceInDays(new Date(), poDate).toString();
    } else if (po.confirmationDate) {
      return differenceInDays(new Date(po.confirmationDate), poDate).toString();
    }
    return '';
  };

  const executeExport = async () => {
    setIsExporting(true);
    try {
      let headers: string[];
      let rows: string[][];
      
      if (exportType === 'sku') {
        // SKU-level export needs API call for line item data
        // But we filter to only include PO numbers that are in filteredTableData
        const validPoNumbers = new Set(filteredTableData.map((po: any) => po.poNumber));
        
        const params = new URLSearchParams();
        if (filters.vendor) params.append('vendor', filters.vendor);
        if (filters.office) params.append('office', filters.office);
        if (filters.status) params.append('status', filters.status);
        if (selectedClient?.shortName) params.append('client', selectedClient.shortName);
        params.append('level', 'sku');
        
        const queryString = params.toString();
        const url = `/api/purchase-orders/export${queryString ? `?${queryString}` : ''}`;
        
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to fetch export data');
        
        const exportData = await response.json();
        
        // Only include SKUs for PO numbers that are in the filtered table
        // This ensures all frontend filters (merchandiser, manager, brand, needsConfirming, hide samples, hide 8x8) are applied
        const filteredExport = exportData.filter((sku: any) => validPoNumbers.has(sku.poNumber));
        
        headers = ['PO Number', 'COP Number', 'SKU Number', 'SKU Name', 'Vendor', 'Status', 'Days to Confirm', 'Ship Date', 'Cancel Date', 'Line Quantity', 'Line Value', 'Merchandiser', 'Office'];
        rows = filteredExport.map((po: any) => [
          po.poNumber || '',
          po.copNumber || '',
          po.skuNumber || '',
          po.skuName || '',
          po.vendor || '',
          po.status || '',
          calculateDaysToConfirm(po),
          po.revisedShipDate ? format(new Date(po.revisedShipDate), 'MM/dd/yyyy') : (po.originalShipDate ? format(new Date(po.originalShipDate), 'MM/dd/yyyy') : ''),
          po.revisedCancelDate ? format(new Date(po.revisedCancelDate), 'MM/dd/yyyy') : (po.originalCancelDate ? format(new Date(po.originalCancelDate), 'MM/dd/yyyy') : ''),
          po.lineQuantity?.toString() || '0',
          ((po.lineValue || 0) / 100).toFixed(2),
          po.buyer || '',
          po.office || '',
        ]);
      } else {
        // PO-level export uses filteredTableData directly - exports exactly what's shown in the table
        headers = ['PO Number', 'Vendor', 'Status', 'Days to Confirm', 'Ship Date', 'Quantity', 'PO Value'];
        rows = filteredTableData.map((po: any) => [
          po.poNumber || '',
          po.vendor || '',
          po.status || '',
          calculateDaysToConfirm(po),
          po.revisedShipDate ? format(new Date(po.revisedShipDate), 'MM/dd/yyyy') : (po.originalShipDate ? format(new Date(po.originalShipDate), 'MM/dd/yyyy') : ''),
          po.orderQuantity?.toString() || '0',
          ((po.totalValue || 0) / 100).toFixed(2),
        ]);
      }

      const csvContent = [headers, ...rows]
        .map((row: string[]) => row.map((cell: string) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const blobUrl = URL.createObjectURL(blob);
      link.setAttribute('href', blobUrl);
      const suffix = exportType === 'sku' ? 'sku-level' : 'po-level';
      link.setAttribute('download', `purchase-orders-${suffix}-${format(new Date(), 'yyyy-MM-dd')}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setExportDialogOpen(false);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-po-title">Purchase Orders</h1>
          <p className="text-muted-foreground">Manage and track all purchase orders</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportClick} data-testid="button-export">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <HelpButton section="purchase-orders" />
        </div>
      </div>

      {posNeedingConfirmation > 0 && !filters.needsConfirming && (
        <div 
          className="flex items-center gap-3 px-4 py-3 bg-destructive/10 border border-destructive/20 rounded-lg cursor-pointer hover:bg-destructive/15 transition-colors"
          onClick={() => setFilters(prev => ({ ...prev, needsConfirming: true }))}
          data-testid="banner-pos-need-confirming"
        >
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
          <div className="flex-1">
            <span className="font-medium text-destructive">{posNeedingConfirmation} Purchase Orders Need Confirming</span>
            <p className="text-sm text-muted-foreground mt-0.5">These orders have been in EDI/Initial status for 7+ days without vendor confirmation.</p>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            data-testid="button-view-needs-confirming"
          >
            View Orders
          </Button>
        </div>
      )}

      {filters.needsConfirming && (
        <div className="flex items-center gap-3 px-4 py-3 bg-muted border rounded-lg">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
          <span className="flex-1 font-medium">Showing orders that need confirmation (EDI/Initial for 7+ days)</span>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setFilters(prev => ({ ...prev, needsConfirming: undefined }))}
            data-testid="button-clear-needs-confirming"
          >
            <X className="h-4 w-4 mr-1" />
            Clear Filter
          </Button>
        </div>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px] max-w-[280px]">
            <Label htmlFor="po-search" className="text-xs text-muted-foreground mb-1.5 block">PO Number Lookup</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="po-search"
                placeholder="Search by PO or COP number..."
                value={filters.poNumber || ""}
                onChange={(e) => setFilters(prev => ({ ...prev, poNumber: e.target.value || undefined }))}
                className="h-9 pl-9"
                data-testid="input-po-search"
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
                  <SelectItem key={vendor} value={vendor || ''}>{vendor}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <Label htmlFor="office-filter" className="text-xs text-muted-foreground mb-1.5 block">Region</Label>
            <Select 
              value={filters.office || "all"} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, office: value === "all" ? undefined : value }))}
            >
              <SelectTrigger id="office-filter" className="h-9" data-testid="select-region">
                <SelectValue placeholder="All Regions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Regions</SelectItem>
                {offices.map((office) => (
                  <SelectItem key={office} value={office || ''}>{office}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <Label htmlFor="buyer-filter" className="text-xs text-muted-foreground mb-1.5 block">Merchandiser</Label>
            <Select 
              value={filters.buyer || "all"} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, buyer: value === "all" ? undefined : value }))}
            >
              <SelectTrigger id="buyer-filter" className="h-9" data-testid="select-merchandiser">
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
                {merchandisingManagers.map((manager) => (
                  <SelectItem key={manager} value={manager}>{manager}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[180px]">
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
                {brands.map((brand) => (
                  <SelectItem key={brand} value={brand}>{brand}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <Label htmlFor="status-filter" className="text-xs text-muted-foreground mb-1.5 block">Status</Label>
            <Select 
              value={filters.status || "all"} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, status: value === "all" ? undefined : value }))}
            >
              <SelectTrigger id="status-filter" className="h-9" data-testid="select-status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {statuses.map((status) => (
                  <SelectItem key={status} value={status || ''}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <Label htmlFor="otd-filter" className="text-xs text-muted-foreground mb-1.5 block">OTD Status</Label>
            <Select 
              value={filters.otdStatus || "all"} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, otdStatus: value === "all" ? undefined : value }))}
            >
              <SelectTrigger id="otd-filter" className="h-9" data-testid="select-otd-status">
                <SelectValue placeholder="All OTD Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All OTD Statuses</SelectItem>
                <SelectItem value="on-time">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    On Time
                  </div>
                </SelectItem>
                <SelectItem value="at-risk">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    At Risk
                  </div>
                </SelectItem>
                <SelectItem value="late">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-red-500" />
                    Late
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4 h-9">
            <div className="flex items-center gap-2">
              <Checkbox 
                id="hide-zero-value"
                checked={hideZeroValue}
                onCheckedChange={(checked) => setHideZeroValue(checked === true)}
                data-testid="checkbox-hide-zero-value"
              />
              <Label htmlFor="hide-zero-value" className="text-sm cursor-pointer">
                Hide samples
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox 
                id="hide-8x8"
                checked={hide8x8}
                onCheckedChange={(checked) => setHide8x8(checked === true)}
                data-testid="checkbox-hide-8x8"
              />
              <Label htmlFor="hide-8x8" className="text-sm cursor-pointer">
                Hide 8x8 components
              </Label>
            </div>
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

      {/* Filter indicator banner when URL params are applied */}
      {(filters.otdStatus || filters.vendor) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg">
          <span className="text-sm text-muted-foreground">Filtered by:</span>
          {filters.otdStatus && (
            <Badge variant="secondary" className="flex items-center gap-1" data-testid="badge-filter-otd">
              {filters.otdStatus === 'on-time' && <CheckCircle className="h-3 w-3 text-green-500" />}
              {filters.otdStatus === 'at-risk' && <AlertTriangle className="h-3 w-3 text-orange-500" />}
              {filters.otdStatus === 'late' && <Clock className="h-3 w-3 text-red-500" />}
              OTD: {filters.otdStatus}
            </Badge>
          )}
          {filters.vendor && (
            <Badge variant="secondary" data-testid="badge-filter-vendor">
              Vendor: {filters.vendor}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground ml-2">
            ({filteredTableData.length} of {purchaseOrders.length} orders)
          </span>
        </div>
      )}

      {posLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          columns={columns}
          data={filteredTableData}
          hideSearch={true}
          hideExport={true}
          data-testid="table-purchase-orders"
        />
      )}

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Purchase Orders</DialogTitle>
            <DialogDescription>
              Choose the level of detail for your export.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <RadioGroup value={exportType} onValueChange={(value) => setExportType(value as 'sku' | 'po')}>
              <div className="flex items-start space-x-3 p-3 rounded-lg border hover-elevate cursor-pointer" onClick={() => setExportType('sku')}>
                <RadioGroupItem value="sku" id="export-sku" data-testid="radio-export-sku" />
                <div className="flex-1">
                  <Label htmlFor="export-sku" className="font-medium cursor-pointer">SKU Level Export</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    One row per SKU/line item. Includes SKU Number, SKU Name, and line-level quantities and values.
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-3 p-3 rounded-lg border hover-elevate cursor-pointer mt-3" onClick={() => setExportType('po')}>
                <RadioGroupItem value="po" id="export-po" data-testid="radio-export-po" />
                <div className="flex-1">
                  <Label htmlFor="export-po" className="font-medium cursor-pointer">PO Level Export</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    One row per Purchase Order. Shows total order quantity and value at the PO header level.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)} data-testid="button-export-cancel">
              Cancel
            </Button>
            <Button onClick={executeExport} disabled={isExporting} data-testid="button-export-confirm">
              <Download className="w-4 h-4 mr-2" />
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
