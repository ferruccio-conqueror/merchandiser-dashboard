import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  X, 
  AlertTriangle, 
  Clock, 
  CheckCircle, 
  Search, 
  Ship, 
  Package,
  Anchor,
  Calendar,
  Building2
} from "lucide-react";
import { format, differenceInDays, isAfter, isBefore, addDays } from "date-fns";
import { Link, useSearch, useLocation } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useClientContext } from "@/contexts/ClientContext";
import { ChevronDown } from "lucide-react";
import { HelpButton } from "@/components/HelpButton";

interface ShipmentData {
  id: number;
  shipmentNumber: string;
  poNumber: string;
  poId: number;
  vendor: string;
  office: string;
  merchandiser: string | null;
  merchandisingManager: string | null;
  latestShipDate: Date | null;
  latestHOD: Date | null;
  cargoReadyDate: Date | null;
  latestEndShipDate: Date | null;
  hodStatusText: string | null;
  reasonText: string | null;
  ptsNumber: string | null;
  ptsStatus: string | null;
  soFirstSubmissionDate: Date | null;
  etd: Date | null;
  hodStatus: string | null;
  vesselName: string | null;
  containerNumber: string | null;
  totalValue: number;
  orderQuantity: number;
  shippedValue: number;
  shipmentStatus: 'on-time' | 'late' | 'at-risk' | 'pending';
  atRiskReasons?: string[];
  actualShipDate: Date | null;
  revisedReason: string | null;
}

interface Filters {
  search?: string;
  vendor?: string;
  office?: string;
  status?: string;
  merchandiser?: string;
  merchandisingManager?: string;
  shipmentStatuses?: string[]; // Multi-select array
  includeShipped?: boolean;
}

// Default status filters - show at-risk, late, and pending (not shipped/on-time)
const DEFAULT_STATUS_FILTERS = ['at-risk', 'late', 'pending'];

export default function Shipments() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const { selectedClient } = useClientContext();
  
  const urlParams = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return {
      vendor: params.get('vendor') || undefined,
      status: params.get('status') || undefined,
    };
  }, [searchString]);

  // Initialize with default status filters and includeShipped=true to show data on load
  const [filters, setFilters] = useState<Filters>({
    shipmentStatuses: DEFAULT_STATUS_FILTERS,
    includeShipped: true
  });
  const [initialized, setInitialized] = useState(false);
  const [showFranchise, setShowFranchise] = useState(false);

  useEffect(() => {
    if (!initialized) {
      const initialFilters: Filters = { shipmentStatuses: DEFAULT_STATUS_FILTERS, includeShipped: true };
      if (urlParams.vendor) initialFilters.vendor = urlParams.vendor;
      if (urlParams.status) initialFilters.shipmentStatuses = [urlParams.status];
      setFilters(initialFilters);
      setInitialized(true);
    }
  }, [initialized, urlParams]);

  // Build API URL with all server-side filters (vendor, office, client, merchandiser, merchandisingManager)
  const shipmentsQueryKey = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedClient?.shortName) params.set('client', selectedClient.shortName);
    if (filters.vendor) params.set('vendor', filters.vendor);
    if (filters.office) params.set('office', filters.office);
    if (filters.merchandiser) params.set('merchandiser', filters.merchandiser);
    if (filters.merchandisingManager) params.set('merchandisingManager', filters.merchandisingManager);
    if (filters.includeShipped) params.set('includeShipped', 'true');
    const queryString = params.toString();
    return queryString ? `/api/shipments-page?${queryString}` : '/api/shipments-page';
  }, [selectedClient?.shortName, filters.vendor, filters.office, filters.merchandiser, filters.merchandisingManager, filters.includeShipped]);

  const { data: rawShipments = [], isLoading } = useQuery<any[]>({
    queryKey: [shipmentsQueryKey],
  });

  const shipments: ShipmentData[] = useMemo(() => {
    return rawShipments.map((ship: any) => {
      const now = new Date();
      // Support both camelCase and snake_case for cargo ready date
      const cargoReadyDate = (ship.cargoReadyDate || ship.cargo_ready_date) 
        ? new Date(ship.cargoReadyDate || ship.cargo_ready_date) 
        : null;
      
      // Get HOD status from shipment (support both cases)
      const hodStatus = ship.hodStatus || ship.hod_status || null;
      const logisticStatus = ship.logisticStatus || ship.logistic_status || null;
      
      // SO First Submission Date (when PTS was submitted)
      const soFirstSubmissionDate = (ship.soFirstSubmissionDate || ship.so_first_submission_date)
        ? new Date(ship.soFirstSubmissionDate || ship.so_first_submission_date)
        : null;
      
      let shipmentStatus: ShipmentData['shipmentStatus'] = 'pending';
      
      // Get at-risk status from backend calculation (based on inspection, QA, and PTS timing)
      const atRiskStatus = ship.atRiskStatus || false;
      const atRiskReasons = ship.atRiskReasons || [];
      
      // Determine shipment status based on explicit HOD status or timing
      // "On Time" or "On-Time" means shipped on time
      // "Late" means shipped late
      // "Shipped" without On Time/Late needs to check the linked PO's status
      if (hodStatus === 'On Time' || hodStatus === 'On-Time' || logisticStatus === 'Delivered') {
        shipmentStatus = 'on-time';
      } else if (hodStatus === 'Late') {
        shipmentStatus = 'late';
      } else if (hodStatus === 'Shipped') {
        // "Shipped" status - check PO's shipmentStatus from OS340 for true OTD
        // Support both camelCase and snake_case
        const poShipmentStatus = ship.po?.shipmentStatus || ship.po?.shipment_status;
        if (poShipmentStatus === 'On-Time') {
          shipmentStatus = 'on-time';
        } else if (poShipmentStatus === 'Late') {
          shipmentStatus = 'late';
        } else {
          // Default shipped to on-time if no OS340 status available
          shipmentStatus = 'on-time';
        }
      } else if (atRiskStatus) {
        // Backend calculated at-risk based on:
        // - Inline inspection not booked 2 weeks before HOD
        // - Final inspection not booked 1 week before HOD
        // - QA test report not available 45 days before HOD
        // - PTS not submitted 30 days (bulk) or 21 days (stock) before HOD
        shipmentStatus = 'at-risk';
      }
      
      // Vendor and office are inside the nested po object
      const vendor = ship.vendor || ship.po?.vendor || null;
      const office = ship.office || ship.po?.office || null;
      const merchandiser = ship.po?.buyer || null;
      const merchandisingManager = ship.po?.mrSection || ship.po?.mr_section || null;
      
      // Latest Ship Date - from PO's revised or original ship date
      const latestShipDate = (ship.po?.revisedShipDate || ship.po?.revised_ship_date || 
                              ship.po?.originalShipDate || ship.po?.original_ship_date)
        ? new Date(ship.po.revisedShipDate || ship.po.revised_ship_date || 
                   ship.po.originalShipDate || ship.po.original_ship_date)
        : null;
      
      // Latest HOD - from PO's revised or original cancel date
      const latestHOD = (ship.po?.revisedCancelDate || ship.po?.revised_cancel_date ||
                         ship.po?.originalCancelDate || ship.po?.original_cancel_date)
        ? new Date(ship.po.revisedCancelDate || ship.po.revised_cancel_date ||
                   ship.po.originalCancelDate || ship.po.original_cancel_date)
        : null;
      
      // Latest End Ship Date - from delivery date or ETA
      const latestEndShipDate = (ship.deliveryToConsolidator || ship.delivery_to_consolidator || 
                                 ship.eta)
        ? new Date(ship.deliveryToConsolidator || ship.delivery_to_consolidator || ship.eta)
        : null;
      
      // Reason - Late Reason Code from OS650
      const reasonText = ship.lateReasonCode || ship.late_reason_code || null;
      
      // Actual ship date from actualSailingDate
      const actualShipDate = (ship.actualSailingDate || ship.actual_sailing_date)
        ? new Date(ship.actualSailingDate || ship.actual_sailing_date)
        : null;
      
      // Revised reason from po_headers (OS340)
      const revisedReason = ship.revisedReason || ship.revised_reason || null;
      
      return {
        id: ship.id,
        shipmentNumber: ship.shipmentNumber || ship.shipment_number || `SHP-${ship.id}`,
        poNumber: ship.poNumber || ship.po_number,
        poId: ship.poId || ship.po_id,
        vendor,
        office,
        merchandiser,
        merchandisingManager,
        latestShipDate,
        latestHOD,
        cargoReadyDate,
        latestEndShipDate,
        hodStatusText: hodStatus,
        reasonText,
        ptsNumber: ship.ptsNumber || ship.pts_number || null,
        ptsStatus: ship.ptsStatus || ship.pts_status,
        soFirstSubmissionDate,
        etd: ship.etd ? new Date(ship.etd) : null,
        hodStatus,
        vesselName: ship.vesselName || ship.vessel_name,
        containerNumber: ship.containerNumber || ship.container_number,
        totalValue: ship.totalValue || ship.total_value || ship.po?.totalValue || 0,
        orderQuantity: ship.orderQuantity || ship.order_quantity || ship.po?.orderQuantity || 0,
        shippedValue: ship.shippedValue || ship.shipped_value || 0,
        shipmentStatus,
        atRiskReasons,
        actualShipDate,
        revisedReason,
      };
    });
  }, [rawShipments]);

  const vendorNames = useMemo(() => {
    return Array.from(new Set(shipments.map(s => s.vendor).filter(Boolean)));
  }, [shipments]);

  const offices = useMemo(() => {
    return Array.from(new Set(shipments.map(s => s.office).filter(Boolean)));
  }, [shipments]);

  const merchandisers = useMemo(() => {
    return Array.from(new Set(shipments.map(s => s.merchandiser).filter(Boolean))).sort();
  }, [shipments]);

  const merchandisingManagers = useMemo(() => {
    return Array.from(new Set(shipments.map(s => s.merchandisingManager).filter(Boolean))).sort();
  }, [shipments]);


  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value / 100);
  };

  const getStatusBadge = (status: ShipmentData['shipmentStatus']) => {
    switch (status) {
      case 'late':
        return (
          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800" data-testid="badge-shipment-late">
            <Clock className="h-3 w-3 mr-1" />
            Late
          </Badge>
        );
      case 'at-risk':
        return (
          <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800" data-testid="badge-shipment-at-risk">
            <AlertTriangle className="h-3 w-3 mr-1" />
            At Risk
          </Badge>
        );
      case 'on-time':
        return (
          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800" data-testid="badge-shipment-on-time">
            <CheckCircle className="h-3 w-3 mr-1" />
            On Time
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" data-testid="badge-shipment-pending">
            Pending
          </Badge>
        );
    }
  };

  const columns = [
    { 
      key: "poNumber", 
      label: "PO Number", 
      sortable: true,
      render: (value: string, row: ShipmentData) => {
        // IDs >= 1000000 are pending POs (not real shipments), link to PO detail
        const isPendingPO = row.id >= 1000000;
        const href = isPendingPO ? `/purchase-orders/${row.poId}` : `/shipments/${row.id}`;
        return (
          <Link href={href}>
            <span className="text-primary hover:underline cursor-pointer font-medium" data-testid={`link-shipment-${row.id}`}>
              {value}
            </span>
          </Link>
        );
      }
    },
    { 
      key: "vendor", 
      label: "Vendor", 
      sortable: true,
      render: (value: string | null) => {
        return value || <span className="text-muted-foreground">-</span>;
      }
    },
    { 
      key: "latestShipDate", 
      label: "Latest Ship Date", 
      sortable: true,
      render: (value: Date | null) => {
        return value ? format(new Date(value), "yyyy-MM-dd") : "-";
      }
    },
    { 
      key: "latestHOD", 
      label: "Latest HOD", 
      sortable: true,
      render: (value: Date | null) => {
        return value ? format(new Date(value), "yyyy-MM-dd") : "-";
      }
    },
    { 
      key: "cargoReadyDate", 
      label: "Cargo Ready Date", 
      sortable: true,
      render: (value: Date | null) => {
        return value ? format(new Date(value), "yyyy-MM-dd") : "-";
      }
    },
    { 
      key: "latestEndShipDate", 
      label: "Latest End Ship Date", 
      sortable: true,
      render: (value: Date | null) => {
        return value ? format(new Date(value), "yyyy-MM-dd") : "-";
      }
    },
    { 
      key: "hodStatusText", 
      label: "HOD Status", 
      sortable: true,
      render: (value: string | null, row: ShipmentData) => {
        if (!value) return <span className="text-muted-foreground">-</span>;
        const isLate = value === 'Late';
        const isOnTime = value === 'On Time' || value === 'On-Time';
        return (
          <span className={isLate ? 'text-red-600 dark:text-red-400 font-medium' : isOnTime ? 'text-green-600 dark:text-green-400' : ''}>
            {value}
          </span>
        );
      }
    },
    { 
      key: "actualShipDate", 
      label: "Actual Ship Date", 
      sortable: true,
      render: (value: Date | null) => {
        return value ? format(new Date(value), "yyyy-MM-dd") : "-";
      }
    },
    { 
      key: "revisedReason", 
      label: "Reason", 
      sortable: true,
      render: (value: string | null) => {
        if (!value) return <span className="text-muted-foreground">-</span>;
        return <span className="text-sm">{value}</span>;
      }
    },
  ];

  const filteredData = useMemo(() => {
    let filtered = [...shipments];

    // Filter by franchise mode - franchise POs have "089-" prefix
    if (showFranchise) {
      filtered = filtered.filter(s => s.poNumber?.startsWith('089-'));
    } else {
      filtered = filtered.filter(s => !s.poNumber?.startsWith('089-'));
    }

    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      filtered = filtered.filter(s => 
        s.shipmentNumber?.toLowerCase().includes(searchTerm) ||
        s.poNumber?.toLowerCase().includes(searchTerm) ||
        s.containerNumber?.toLowerCase().includes(searchTerm) ||
        s.vesselName?.toLowerCase().includes(searchTerm)
      );
    }

    if (filters.vendor) {
      filtered = filtered.filter(s => s.vendor === filters.vendor);
    }

    if (filters.office) {
      filtered = filtered.filter(s => s.office === filters.office);
    }


    if (filters.shipmentStatuses && filters.shipmentStatuses.length > 0) {
      filtered = filtered.filter(s => {
        // Check if this is a "shipped" record (hodStatus indicates delivery)
        const isShippedRecord = s.hodStatus === 'Shipped' || 
                                s.hodStatus === 'On Time' || 
                                s.hodStatus === 'On-Time' || 
                                s.hodStatus === 'Late';
        
        // If 'shipped' is selected, include all shipped records
        if (filters.shipmentStatuses!.includes('shipped') && isShippedRecord) {
          return true;
        }
        
        // If 'shipped' is NOT selected but this is a shipped record, exclude it
        if (!filters.shipmentStatuses!.includes('shipped') && isShippedRecord) {
          return false;
        }
        
        // For non-shipped records, match by computed shipmentStatus
        return filters.shipmentStatuses!.includes(s.shipmentStatus);
      });
    }

    return filtered;
  }, [shipments, filters, showFranchise]);

  const clearAllFilters = () => {
    setFilters({});
    setLocation('/shipments');
  };

  const hasActiveFilters = Object.keys(filters).some(key => {
    const value = filters[key as keyof Filters];
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined;
  });

  // Filter shipments by franchise mode for stats
  const baseFilteredShipments = useMemo(() => {
    if (showFranchise) {
      return shipments.filter(s => s.poNumber?.startsWith('089-'));
    }
    return shipments.filter(s => !s.poNumber?.startsWith('089-'));
  }, [shipments, showFranchise]);

  const shipmentStats = useMemo(() => {
    return {
      total: baseFilteredShipments.length,
      onTime: baseFilteredShipments.filter(s => s.shipmentStatus === 'on-time').length,
      atRisk: baseFilteredShipments.filter(s => s.shipmentStatus === 'at-risk').length,
      late: baseFilteredShipments.filter(s => s.shipmentStatus === 'late').length,
      pending: baseFilteredShipments.filter(s => s.shipmentStatus === 'pending').length,
    };
  }, [baseFilteredShipments]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-shipments-title">
              {showFranchise ? <Building2 className="h-6 w-6" /> : <Ship className="h-6 w-6" />}
              {showFranchise ? 'Franchise Shipments' : 'Shipments'}
            </h1>
            <Button
              variant={showFranchise ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFranchise(!showFranchise)}
              className="flex items-center gap-1.5"
              data-testid="button-toggle-franchise"
            >
              <Building2 className="h-4 w-4" />
              {showFranchise ? 'Viewing Franchise' : 'Show Franchise'}
            </Button>
          </div>
          <p className="text-muted-foreground">
            {showFranchise 
              ? 'Track franchise partner shipments (089- orders)' 
              : 'Track and manage all shipments with logistics details'}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Tabs defaultValue="shipments" className="w-auto">
          <TabsList>
            <TabsTrigger value="po" asChild>
              <Link href="/purchase-orders">
                <a className="flex items-center gap-1.5" data-testid="tab-purchase-orders">
                  <Package className="h-4 w-4" />
                  Purchase Orders
                </a>
              </Link>
            </TabsTrigger>
            <TabsTrigger value="shipments" data-testid="tab-shipments">
              <Ship className="h-4 w-4 mr-1.5" />
              Shipments
            </TabsTrigger>
          </TabsList>
          </Tabs>
          <HelpButton section="shipments" />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Total Shipments</div>
          <div className="text-2xl font-semibold mt-1" data-testid="stat-total-shipments">{shipmentStats.total}</div>
        </Card>
        <Card className="p-4 border-green-200 dark:border-green-800">
          <div className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
            <CheckCircle className="h-4 w-4" />
            On Time
          </div>
          <div className="text-2xl font-semibold mt-1 text-green-600 dark:text-green-400" data-testid="stat-on-time">{shipmentStats.onTime}</div>
        </Card>
        <Card className="p-4 border-orange-200 dark:border-orange-800">
          <div className="text-sm text-orange-600 dark:text-orange-400 flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            At Risk
          </div>
          <div className="text-2xl font-semibold mt-1 text-orange-600 dark:text-orange-400" data-testid="stat-at-risk">{shipmentStats.atRisk}</div>
        </Card>
        <Card className="p-4 border-red-200 dark:border-red-800">
          <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
            <Clock className="h-4 w-4" />
            Late
          </div>
          <div className="text-2xl font-semibold mt-1 text-red-600 dark:text-red-400" data-testid="stat-late">{shipmentStats.late}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px] max-w-[280px]">
            <Label htmlFor="shipment-search" className="text-xs text-muted-foreground mb-1.5 block">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="shipment-search"
                placeholder="Search shipments, PO, vessel..."
                value={filters.search || ""}
                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value || undefined }))}
                className="h-9 pl-9"
                data-testid="input-shipment-search"
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
                {merchandisers.map((merchandiser) => (
                  <SelectItem key={merchandiser} value={merchandiser || ''}>{merchandiser}</SelectItem>
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
              <SelectTrigger id="mm-filter" className="h-9" data-testid="select-merchandising-manager">
                <SelectValue placeholder="All Merch Managers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Merch Managers</SelectItem>
                {merchandisingManagers.map((manager) => (
                  <SelectItem key={manager} value={manager || ''}>{manager}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 min-w-[140px]">
            <div className="flex flex-col gap-1">
              <Label htmlFor="include-shipped" className="text-xs text-muted-foreground">Include Shipped</Label>
              <div className="flex items-center h-9 gap-2">
                <Switch
                  id="include-shipped"
                  checked={filters.includeShipped || false}
                  onCheckedChange={(checked) => setFilters(prev => ({ ...prev, includeShipped: checked || undefined }))}
                  data-testid="switch-include-shipped"
                />
                <span className="text-sm text-muted-foreground">{filters.includeShipped ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-[180px]">
            <Label htmlFor="shipment-status-filter" className="text-xs text-muted-foreground mb-1.5 block">Shipment Status</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="h-9 w-full justify-between font-normal"
                  data-testid="select-shipment-status"
                >
                  {filters.shipmentStatuses && filters.shipmentStatuses.length > 0
                    ? `${filters.shipmentStatuses.length} selected`
                    : "All Shipment Statuses"}
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0" align="start">
                <div className="p-2 space-y-2">
                  <div 
                    className="flex items-center gap-2 p-2 hover-elevate rounded cursor-pointer"
                    onClick={() => setFilters(prev => ({ ...prev, shipmentStatuses: undefined }))}
                    data-testid="checkbox-all-statuses"
                  >
                    <Checkbox 
                      checked={!filters.shipmentStatuses || filters.shipmentStatuses.length === 0}
                      onCheckedChange={() => setFilters(prev => ({ ...prev, shipmentStatuses: undefined }))}
                    />
                    <span className="text-sm">All Shipment Statuses</span>
                  </div>
                  <div className="border-t my-1" />
                  {[
                    { value: 'on-time', label: 'On Time', icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
                    { value: 'at-risk', label: 'At Risk', icon: <AlertTriangle className="h-4 w-4 text-orange-500" /> },
                    { value: 'late', label: 'Late', icon: <Clock className="h-4 w-4 text-red-500" /> },
                    { value: 'pending', label: 'Pending', icon: <Calendar className="h-4 w-4 text-muted-foreground" /> },
                    { value: 'shipped', label: 'Shipped', icon: <Ship className="h-4 w-4 text-blue-500" /> },
                  ].map((status) => {
                    const isChecked = filters.shipmentStatuses?.includes(status.value) || false;
                    return (
                      <div 
                        key={status.value}
                        className="flex items-center gap-2 p-2 hover-elevate rounded cursor-pointer"
                        onClick={() => {
                          setFilters(prev => {
                            const current = prev.shipmentStatuses || [];
                            if (isChecked) {
                              const updated = current.filter(s => s !== status.value);
                              return { ...prev, shipmentStatuses: updated.length > 0 ? updated : undefined };
                            } else {
                              return { ...prev, shipmentStatuses: [...current, status.value] };
                            }
                          });
                        }}
                        data-testid={`checkbox-status-${status.value}`}
                      >
                        <Checkbox checked={isChecked} />
                        {status.icon}
                        <span className="text-sm">{status.label}</span>
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
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
        <div className="flex items-center gap-2 flex-wrap px-4 py-2 bg-muted rounded-lg">
          <span className="text-sm text-muted-foreground">Filtered by:</span>
          {filters.shipmentStatuses && filters.shipmentStatuses.length > 0 && filters.shipmentStatuses.map(status => (
            <Badge key={status} variant="secondary" className="flex items-center gap-1" data-testid={`badge-filter-status-${status}`}>
              {status === 'on-time' && <CheckCircle className="h-3 w-3 text-green-500" />}
              {status === 'at-risk' && <AlertTriangle className="h-3 w-3 text-orange-500" />}
              {status === 'late' && <Clock className="h-3 w-3 text-red-500" />}
              {status === 'pending' && <Calendar className="h-3 w-3 text-muted-foreground" />}
              {status === 'shipped' && <Ship className="h-3 w-3 text-blue-500" />}
              {status}
              <X 
                className="h-3 w-3 ml-1 cursor-pointer hover:text-destructive" 
                onClick={() => {
                  const updated = filters.shipmentStatuses?.filter(s => s !== status);
                  setFilters(prev => ({ ...prev, shipmentStatuses: updated && updated.length > 0 ? updated : undefined }));
                }}
              />
            </Badge>
          ))}
          {filters.vendor && (
            <Badge variant="secondary" data-testid="badge-filter-vendor">
              Vendor: {filters.vendor}
            </Badge>
          )}
          {filters.office && (
            <Badge variant="secondary" data-testid="badge-filter-office">
              Region: {filters.office}
            </Badge>
          )}
          {filters.merchandiser && (
            <Badge variant="secondary" data-testid="badge-filter-merchandiser">
              Merchandiser: {filters.merchandiser}
            </Badge>
          )}
          {filters.merchandisingManager && (
            <Badge variant="secondary" data-testid="badge-filter-merchandising-manager">
              Manager: {filters.merchandisingManager}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground ml-2">
            ({filteredData.length} of {shipments.length} shipments)
          </span>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          columns={columns}
          data={filteredData}
          searchPlaceholder="Search shipments..."
          onExport={() => console.log("Exporting shipment data...")}
          data-testid="table-shipments"
        />
      )}
    </div>
  );
}
