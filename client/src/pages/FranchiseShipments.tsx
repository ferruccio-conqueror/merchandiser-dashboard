import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useClientContext } from "@/contexts/ClientContext";

interface ShipmentData {
  id: number;
  shipmentNumber: string;
  poNumber: string;
  poId: number;
  vendor: string;
  office: string;
  cargoReadyDate: Date | null;
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
}

interface Filters {
  search?: string;
  vendor?: string;
  office?: string;
  status?: string;
  shipmentStatus?: string;
}

export default function FranchiseShipments() {
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

  const [filters, setFilters] = useState<Filters>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized) {
      const initialFilters: Filters = {};
      if (urlParams.vendor) initialFilters.vendor = urlParams.vendor;
      if (urlParams.status) initialFilters.shipmentStatus = urlParams.status;
      if (Object.keys(initialFilters).length > 0) {
        setFilters(initialFilters);
      }
      setInitialized(true);
    }
  }, [initialized, urlParams]);

  const shipmentsQueryKey = selectedClient?.shortName 
    ? `/api/franchise-shipments?client=${encodeURIComponent(selectedClient.shortName)}`
    : "/api/franchise-shipments";

  const { data: rawShipments = [], isLoading } = useQuery<any[]>({
    queryKey: [shipmentsQueryKey, filters.vendor, filters.office],
  });

  const shipments: ShipmentData[] = useMemo(() => {
    return rawShipments.map((ship: any) => {
      const cargoReadyDate = (ship.cargoReadyDate || ship.cargo_ready_date) 
        ? new Date(ship.cargoReadyDate || ship.cargo_ready_date) 
        : null;
      
      const hodStatus = ship.hodStatus || ship.hod_status || null;
      const logisticStatus = ship.logisticStatus || ship.logistic_status || null;
      
      const soFirstSubmissionDate = (ship.soFirstSubmissionDate || ship.so_first_submission_date)
        ? new Date(ship.soFirstSubmissionDate || ship.so_first_submission_date)
        : null;
      
      let shipmentStatus: ShipmentData['shipmentStatus'] = 'pending';
      
      const atRiskStatus = ship.atRiskStatus || false;
      const atRiskReasons = ship.atRiskReasons || [];
      
      if (hodStatus === 'On Time' || hodStatus === 'On-Time' || logisticStatus === 'Delivered') {
        shipmentStatus = 'on-time';
      } else if (hodStatus === 'Late') {
        shipmentStatus = 'late';
      } else if (hodStatus === 'Shipped') {
        const poShipmentStatus = ship.po?.shipmentStatus || ship.po?.shipment_status;
        if (poShipmentStatus === 'On-Time') {
          shipmentStatus = 'on-time';
        } else if (poShipmentStatus === 'Late') {
          shipmentStatus = 'late';
        } else {
          shipmentStatus = 'on-time';
        }
      } else if (atRiskStatus) {
        shipmentStatus = 'at-risk';
      }
      
      const vendor = ship.vendor || ship.po?.vendor || null;
      const office = ship.office || ship.po?.office || null;
      
      return {
        id: ship.id,
        shipmentNumber: ship.shipmentNumber || ship.shipment_number || `SHP-${ship.id}`,
        poNumber: ship.poNumber || ship.po_number,
        poId: ship.poId || ship.po_id,
        vendor,
        office,
        cargoReadyDate,
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
      };
    });
  }, [rawShipments]);

  const vendorNames = useMemo(() => {
    return Array.from(new Set(shipments.map(s => s.vendor).filter(Boolean)));
  }, [shipments]);

  const offices = useMemo(() => {
    return Array.from(new Set(shipments.map(s => s.office).filter(Boolean)));
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
          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800" data-testid="badge-franchise-shipment-late">
            <Clock className="h-3 w-3 mr-1" />
            Late
          </Badge>
        );
      case 'at-risk':
        return (
          <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800" data-testid="badge-franchise-shipment-at-risk">
            <AlertTriangle className="h-3 w-3 mr-1" />
            At Risk
          </Badge>
        );
      case 'on-time':
        return (
          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800" data-testid="badge-franchise-shipment-on-time">
            <CheckCircle className="h-3 w-3 mr-1" />
            On Time
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" data-testid="badge-franchise-shipment-pending">
            Pending
          </Badge>
        );
    }
  };

  const columns = [
    { 
      key: "shipmentNumber", 
      label: "Shipment", 
      sortable: true,
      render: (value: string, row: ShipmentData) => {
        return (
          <Link href={`/shipments/${row.id}`}>
            <span className="text-primary hover:underline cursor-pointer font-medium" data-testid={`link-franchise-shipment-${row.id}`}>
              {value}
            </span>
          </Link>
        );
      }
    },
    { 
      key: "poNumber", 
      label: "PO Number", 
      sortable: true,
      render: (value: string, row: ShipmentData) => {
        return (
          <Link href={`/purchase-orders/${row.poId}`}>
            <span className="text-muted-foreground hover:text-primary hover:underline cursor-pointer text-sm" data-testid={`link-franchise-po-${row.poId}`}>
              {value}
            </span>
          </Link>
        );
      }
    },
    { key: "vendor", label: "Vendor", sortable: true },
    { 
      key: "shipmentStatus", 
      label: "Status", 
      render: (value: ShipmentData['shipmentStatus']) => getStatusBadge(value)
    },
    { 
      key: "cargoReadyDate", 
      label: "Cargo Ready", 
      sortable: true,
      render: (value: Date | null) => {
        return value ? format(new Date(value), "MM/dd/yyyy") : "-";
      }
    },
    { 
      key: "ptsNumber", 
      label: "PTS Number", 
      sortable: true,
      render: (value: string | null) => {
        return value ? <span className="font-mono text-sm">{value}</span> : "-";
      }
    },
    { 
      key: "soFirstSubmissionDate", 
      label: "PTS Submitted", 
      sortable: true,
      render: (value: Date | null) => {
        return value ? format(new Date(value), "MM/dd/yyyy") : "-";
      }
    },
    { 
      key: "vesselName", 
      label: "Vessel", 
      render: (value: string | null) => {
        if (!value) return "-";
        return (
          <div className="flex items-center gap-1">
            <Ship className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm">{value}</span>
          </div>
        );
      }
    },
  ];

  const filteredData = useMemo(() => {
    let filtered = [...shipments];

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

    if (filters.shipmentStatus) {
      filtered = filtered.filter(s => s.shipmentStatus === filters.shipmentStatus);
    }

    return filtered;
  }, [shipments, filters]);

  const statusCounts = useMemo(() => {
    const counts = { total: 0, onTime: 0, late: 0, atRisk: 0, pending: 0 };
    shipments.forEach(s => {
      counts.total++;
      switch (s.shipmentStatus) {
        case 'on-time': counts.onTime++; break;
        case 'late': counts.late++; break;
        case 'at-risk': counts.atRisk++; break;
        case 'pending': counts.pending++; break;
      }
    });
    return counts;
  }, [shipments]);

  const clearFilters = () => {
    setFilters({});
    setLocation('/franchise-shipments');
  };

  const hasActiveFilters = Object.values(filters).some(v => v !== undefined && v !== '');

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </Card>
          ))}
        </div>
        <Card className="p-6">
          <Skeleton className="h-96 w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-franchise-shipments-title">Franchise Shipments</h1>
            <p className="text-muted-foreground text-sm">
              Track shipments for franchise orders (PO prefix 089)
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4" data-testid="card-franchise-total">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Package className="h-4 w-4" />
            <span className="text-sm">Total Shipments</span>
          </div>
          <div className="text-2xl font-bold">{statusCounts.total}</div>
        </Card>
        <Card className="p-4" data-testid="card-franchise-on-time">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-1">
            <CheckCircle className="h-4 w-4" />
            <span className="text-sm">On Time</span>
          </div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{statusCounts.onTime}</div>
        </Card>
        <Card className="p-4" data-testid="card-franchise-late">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-1">
            <Clock className="h-4 w-4" />
            <span className="text-sm">Late</span>
          </div>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{statusCounts.late}</div>
        </Card>
        <Card className="p-4" data-testid="card-franchise-pending">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Anchor className="h-4 w-4" />
            <span className="text-sm">Pending</span>
          </div>
          <div className="text-2xl font-bold">{statusCounts.pending}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px] max-w-[280px]">
            <Label htmlFor="franchise-search" className="text-xs text-muted-foreground mb-1.5 block">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="franchise-search"
                placeholder="Search shipments, PO, vessel..."
                value={filters.search || ""}
                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value || undefined }))}
                className="h-9 pl-9"
                data-testid="input-franchise-search"
              />
            </div>
          </div>

          <div className="flex-1 min-w-[180px]">
            <Label htmlFor="franchise-vendor-filter" className="text-xs text-muted-foreground mb-1.5 block">Vendor</Label>
            <Select 
              value={filters.vendor || "all"} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, vendor: value === "all" ? undefined : value }))}
            >
              <SelectTrigger id="franchise-vendor-filter" className="h-9" data-testid="select-franchise-vendor">
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
            <Label htmlFor="franchise-office-filter" className="text-xs text-muted-foreground mb-1.5 block">Region</Label>
            <Select 
              value={filters.office || "all"} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, office: value === "all" ? undefined : value }))}
            >
              <SelectTrigger id="franchise-office-filter" className="h-9" data-testid="select-franchise-office">
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
            <Label htmlFor="franchise-status-filter" className="text-xs text-muted-foreground mb-1.5 block">Shipment Status</Label>
            <Select 
              value={filters.shipmentStatus || "all"} 
              onValueChange={(value) => setFilters(prev => ({ ...prev, shipmentStatus: value === "all" ? undefined : value }))}
            >
              <SelectTrigger id="franchise-status-filter" className="h-9" data-testid="select-franchise-status">
                <SelectValue placeholder="All Shipment Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Shipment Statuses</SelectItem>
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
                <SelectItem value="pending">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    Pending
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearFilters} 
              className="h-9"
              data-testid="button-franchise-clear-filters"
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
          {filters.shipmentStatus && (
            <Badge variant="secondary" className="flex items-center gap-1" data-testid="badge-franchise-filter-status">
              {filters.shipmentStatus === 'on-time' && <CheckCircle className="h-3 w-3 text-green-500" />}
              {filters.shipmentStatus === 'at-risk' && <AlertTriangle className="h-3 w-3 text-orange-500" />}
              {filters.shipmentStatus === 'late' && <Clock className="h-3 w-3 text-red-500" />}
              Status: {filters.shipmentStatus}
            </Badge>
          )}
          {filters.vendor && (
            <Badge variant="secondary" data-testid="badge-franchise-filter-vendor">
              Vendor: {filters.vendor}
            </Badge>
          )}
          {filters.office && (
            <Badge variant="secondary" data-testid="badge-franchise-filter-office">
              Region: {filters.office}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground ml-2">
            ({filteredData.length} of {shipments.length} shipments)
          </span>
        </div>
      )}

      <Card className="p-4">

        {filteredData.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No franchise shipments found</p>
            {hasActiveFilters && (
              <Button variant="ghost" onClick={clearFilters} className="mt-2">
                Clear all filters
              </Button>
            )}
          </div>
        ) : (
          <DataTable 
            columns={columns} 
            data={filteredData} 
            data-testid="table-franchise-shipments"
          />
        )}
      </Card>
    </div>
  );
}
