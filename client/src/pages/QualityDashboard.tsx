import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { KPICard } from "@/components/KPICard";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, ReferenceLine, Label } from "recharts";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { AlertCircle, TrendingUp, TrendingDown, Users, Package, ExternalLink, Bell, Calendar, ShieldX, FileWarning, Clock, Filter, X } from "lucide-react";
import { HelpButton } from "@/components/HelpButton";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { useClientContext } from "@/contexts/ClientContext";

type AlertType = 'booking' | 'inline' | 'missingFinal' | 'failed' | 'expiring';

interface FilterOptions {
  merchandisers: string[];
  managers: string[];
  vendors: string[];
}

interface QualityKPIs {
  posDueNext2Weeks: number;
  scheduledInspections: number;
  completedInspectionsThisMonth: number;
  expiringCertifications: number;
  failedFinalInspections: number;
  inspectionsOutsideWindow: number;
  pendingQABeyond45Days: number;
  lateMaterialsAtFactory: number;
}

interface AtRiskPO {
  id: number;
  po_number: string;
  vendor: string | null;
  status: string;
  risk_criteria: string[];
  days_until_hod: number;
}

interface BusinessMetrics {
  totalInspections: number;
  firstTimePassRate: number;
  inlineFirstTimePassRate: number;
  avgInspectionsPerShipment: number;
  avgInlinePerPoSku: number;
  avgFinalPerPoSku: number;
  failureAnalysis: Array<{ 
    inspectionType: string; 
    failedCount: number; 
    totalCount: number; 
    failureRate: number;
  }>;
}

interface SkuMetrics {
  skuId: number;
  sku: string;
  description: string | null;
  vendorName: string | null;
  totalInspections: number;
  firstTimePassRate: number;
  avgInspectionsPerShipment: number;
  failedCount: number;
}

interface VendorMetrics {
  vendorId: number | null;
  vendorName: string;
  totalInspections: number;
  firstTimePassRate: number;
  avgInspectionsPerShipment: number;
  failedCount: number;
}

interface YOYPassRate {
  year: number;
  month: number;
  monthName: string;
  firstTimePassRate: number;
  totalInspections: number;
  passedFirstTime: number;
}

interface DelayCorrelation {
  year: number;
  month: number;
  monthName: string;
  failedInspections: number;
  lateShipments: number;
  correlatedDelays: number;
}

interface AlertCounts {
  bookingConfirmedNeedingInspection: number;
  missingInlineInspections: number;
  missingFinalInspections: number;
  failedInspections: number;
  expiringCertificates: number;
}

interface BookingNeedingInspection {
  id: number;
  po_number: string;
  vendor: string | null;
  sku: string | null;
  revised_cancel_date: string | null;
  status: string;
  days_until_ship: number | null;
  needed_inspections: string[];
}

interface MissingInlineInspection {
  id: number;
  po_number: string;
  vendor: string | null;
  sku: string | null;
  cargo_ready_date: string | null;
  days_until_crd: number | null;
  status: string;
}

interface MissingFinalInspection {
  id: number;
  po_number: string;
  vendor: string | null;
  sku: string | null;
  revised_ship_date: string | null;
  days_until_ship: number | null;
  status: string;
}

interface FailedInspection {
  id: number;
  po_id: number | null;
  po_number: string;
  vendor_name: string | null;
  sku: string | null;
  inspection_type: string;
  result: string | null;
  inspection_date: string | null;
  notes: string | null;
}

interface ExpiringCertificate {
  id: number;
  po_id: number | null;
  po_number: string;
  sku: string | null;
  sku_description: string | null;
  test_type: string;
  result: string | null;
  status: string | null;
  expiry_date: string | null;
  ship_date: string | null;
  days_until_expiry: number | null;
}

interface TestStatusBuckets {
  valid: number;
  validWaiver: number;
  expired: number;
  outstanding: number;
  notRequired: number;
  expiringIn60Days: number;
  grandTotal: number;
}

interface QualityTestReport {
  filterOptions: {
    clientDivisions: string[];
    clientDepartments: string[];
  };
  mandatoryTest: TestStatusBuckets;
  performanceTest: TestStatusBuckets;
}

interface InspectionStatusBuckets {
  onTime: number;
  late: number;
  pending: number;
  total: number;
}

interface InspectionStatusReport {
  finalInspection: InspectionStatusBuckets;
  inlineInspection: InspectionStatusBuckets;
  vendors: string[];
}

export default function QualityDashboard() {
  const [, navigate] = useLocation();
  const { selectedClient } = useClientContext();
  const [selectedInspector, setSelectedInspector] = useState<string>("all");
  const [selectedAlertType, setSelectedAlertType] = useState<AlertType>('booking');
  const [selectedVendor, setSelectedVendor] = useState<string>("all");
  const [selectedMerchandiser, setSelectedMerchandiser] = useState<string>("all");
  const [selectedManager, setSelectedManager] = useState<string>("all");
  
  // Initialize date filters with current year defaults (Jan 1 to Dec 31)
  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState<string>(() => {
    return new Date(currentYear, 0, 1).toISOString().split('T')[0]; // Jan 1 of current year
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date(currentYear, 11, 31).toISOString().split('T')[0]; // Dec 31 of current year
  });
  
  // Test Report filters
  const [selectedDivision, setSelectedDivision] = useState<string>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");

  const handleRowClick = (row: { id: number; po_id?: number | null }) => {
    const poId = row.po_id ?? row.id;
    if (poId) {
      navigate(`/purchase-orders/${poId}`);
    }
  };

  // Build base query params with optional client filter
  const buildBaseParams = () => {
    const params = new URLSearchParams();
    if (selectedClient?.shortName) params.append("client", selectedClient.shortName);
    return params;
  };

  const inspectorFilter = (() => {
    const params = buildBaseParams();
    if (selectedInspector !== "all") params.append("inspector", selectedInspector);
    return params.toString() ? `?${params.toString()}` : "";
  })();

  // Build filter query string for compliance alerts
  const buildFilterParams = () => {
    const params = buildBaseParams();
    if (selectedVendor !== "all") params.append("vendor", selectedVendor);
    if (selectedMerchandiser !== "all") params.append("merchandiser", selectedMerchandiser);
    if (selectedManager !== "all") params.append("merchandisingManager", selectedManager);
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    return params.toString() ? `?${params.toString()}` : "";
  };
  
  const filterParams = buildFilterParams();
  const hasActiveFilters = selectedVendor !== "all" || selectedMerchandiser !== "all" || selectedManager !== "all" || startDate || endDate;

  const clearAllFilters = () => {
    setSelectedVendor("all");
    setSelectedMerchandiser("all");
    setSelectedManager("all");
    // Reset to current year defaults instead of empty
    setStartDate(new Date(currentYear, 0, 1).toISOString().split('T')[0]);
    setEndDate(new Date(currentYear, 11, 31).toISOString().split('T')[0]);
  };

  // Build URL with filters for fetch calls 
  const filterOptionsUrl = selectedClient?.shortName 
    ? `/api/dashboard/filter-options?client=${encodeURIComponent(selectedClient.shortName)}`
    : '/api/dashboard/filter-options';
  
  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: [filterOptionsUrl],
  });

  const inspectorsUrl = selectedClient?.shortName 
    ? `/api/inspections/inspectors?client=${encodeURIComponent(selectedClient.shortName)}`
    : '/api/inspections/inspectors';

  const { data: inspectors, isLoading: inspectorsLoading } = useQuery<string[]>({
    queryKey: [inspectorsUrl],
  });

  const kpisUrl = `/api/quality/kpis${inspectorFilter}`;
  const { data: kpis, isLoading: kpisLoading } = useQuery<QualityKPIs>({
    queryKey: [kpisUrl],
  });

  const atRiskUrl = `/api/quality/at-risk-pos${inspectorFilter}`;
  const { data: atRiskPOs, isLoading: atRiskLoading } = useQuery<AtRiskPO[]>({
    queryKey: [atRiskUrl],
  });

  const businessMetricsUrl = `/api/inspections/metrics/business${inspectorFilter}`;
  const { data: businessMetrics, isLoading: businessLoading } = useQuery<BusinessMetrics>({
    queryKey: [businessMetricsUrl],
  });

  const skuMetricsUrl = `/api/inspections/metrics/sku${inspectorFilter}`;
  const { data: skuMetrics, isLoading: skuLoading } = useQuery<SkuMetrics[]>({
    queryKey: [skuMetricsUrl],
  });

  const vendorMetricsUrl = `/api/inspections/metrics/vendor${inspectorFilter}`;
  const { data: vendorMetrics, isLoading: vendorLoading } = useQuery<VendorMetrics[]>({
    queryKey: [vendorMetricsUrl],
  });

  const yoyPassRateUrl = `/api/inspections/metrics/yoy-pass-rate${inspectorFilter}`;
  const { data: yoyPassRate, isLoading: yoyLoading } = useQuery<YOYPassRate[]>({
    queryKey: [yoyPassRateUrl],
  });

  const delayCorrelationUrl = `/api/inspections/metrics/delay-correlation${inspectorFilter}`;
  const { data: delayCorrelation, isLoading: correlationLoading } = useQuery<DelayCorrelation[]>({
    queryKey: [delayCorrelationUrl],
  });

  // Quality Test Report Query (with division/department filters and client context)
  const buildTestReportParams = () => {
    const params = new URLSearchParams();
    if (selectedClient?.shortName) params.append("client", selectedClient.shortName);
    if (selectedDivision !== "all") params.append("clientDivision", selectedDivision);
    if (selectedDepartment !== "all") params.append("clientDepartment", selectedDepartment);
    if (selectedMerchandiser !== "all") params.append("merchandiser", selectedMerchandiser);
    if (selectedManager !== "all") params.append("merchandisingManager", selectedManager);
    return params.toString() ? `?${params.toString()}` : "";
  };
  const testReportParams = buildTestReportParams();
  const testReportUrl = `/api/quality/test-report${testReportParams}`;
  const { data: testReport, isLoading: testReportLoading } = useQuery<QualityTestReport>({
    queryKey: [testReportUrl],
  });

  // Inspection Status Report Query (Final/Inline lateness based on ship dates)
  const buildInspectionStatusParams = () => {
    const params = new URLSearchParams();
    if (selectedClient?.shortName) params.append("client", selectedClient.shortName);
    if (selectedVendor !== "all") params.append("vendor", selectedVendor);
    if (selectedMerchandiser !== "all") params.append("merchandiser", selectedMerchandiser);
    if (selectedManager !== "all") params.append("merchandisingManager", selectedManager);
    return params.toString() ? `?${params.toString()}` : "";
  };
  const inspectionStatusParams = buildInspectionStatusParams();
  const inspectionStatusUrl = `/api/quality/inspection-status${inspectionStatusParams}`;
  const { data: inspectionStatus, isLoading: inspectionStatusLoading } = useQuery<InspectionStatusReport>({
    queryKey: [inspectionStatusUrl],
  });

  // Compliance Alert System Queries (with filters including client)
  const alertCountsUrl = `/api/quality-compliance/alert-counts${filterParams}`;
  const { data: alertCounts, isLoading: alertCountsLoading } = useQuery<AlertCounts>({
    queryKey: [alertCountsUrl],
  });

  const bookingUrl = `/api/quality-compliance/booking-confirmed-needing-inspection${filterParams}`;
  const { data: bookingNeedingInspection, isLoading: bookingLoading } = useQuery<BookingNeedingInspection[]>({
    queryKey: [bookingUrl],
  });

  const missingInlineUrl = `/api/quality-compliance/missing-inline-inspections${filterParams}`;
  const { data: missingInlineInspections, isLoading: missingInlineLoading } = useQuery<MissingInlineInspection[]>({
    queryKey: [missingInlineUrl],
  });

  const missingFinalUrl = `/api/quality-compliance/missing-final-inspections${filterParams}`;
  const { data: missingFinalInspections, isLoading: missingFinalLoading } = useQuery<MissingFinalInspection[]>({
    queryKey: [missingFinalUrl],
  });

  const failedInspectionsUrl = `/api/quality-compliance/failed-inspections${filterParams}`;
  const { data: failedInspections, isLoading: failedInspectionsLoading } = useQuery<FailedInspection[]>({
    queryKey: [failedInspectionsUrl],
  });

  const expiringCertsUrl = `/api/quality-compliance/expiring-certificates${filterParams}`;
  const { data: expiringCertificates, isLoading: expiringCertsLoading } = useQuery<ExpiringCertificate[]>({
    queryKey: [expiringCertsUrl],
  });

  const totalAlerts = (alertCounts?.bookingConfirmedNeedingInspection || 0) +
    (alertCounts?.missingInlineInspections || 0) +
    (alertCounts?.failedInspections || 0) +
    (alertCounts?.expiringCertificates || 0);

  // At Risk POs Table Columns
  const atRiskColumns = [
    {
      key: "po_number",
      label: "PO Number",
      sortable: true,
      render: (value: string, row: AtRiskPO) => (
        <Link href={`/purchase-orders/${row.id}`}>
          <span className="text-primary hover:underline cursor-pointer font-medium" data-testid={`link-po-${row.id}`}>
            {value}
          </span>
        </Link>
      ),
    },
    {
      key: "vendor",
      label: "Vendor",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (value: string, row: AtRiskPO) => (
        <Badge variant="secondary" data-testid={`badge-status-${row.id}`}>
          {value}
        </Badge>
      ),
    },
    {
      key: "risk_criteria",
      label: "Risk Criteria",
      render: (value: string[], row: AtRiskPO) => (
        <div className="flex flex-wrap gap-1" data-testid={`criteria-${row.id}`}>
          {value && value.length > 0 ? value.map((criterion, idx) => (
            <Badge key={idx} variant="outline" className="text-xs">
              {criterion}
            </Badge>
          )) : "—"}
        </div>
      ),
    },
    {
      key: "days_until_hod",
      label: "Days Until HOD",
      sortable: true,
      render: (value: number, row: AtRiskPO) => {
        const variant = value < 0 ? "destructive" : value <= 7 ? "secondary" : "outline";
        return (
          <Badge variant={variant} data-testid={`badge-days-${row.id}`}>
            {value < 0 ? `${Math.abs(value)}d late` : `${value}d`}
          </Badge>
        );
      },
    },
  ];

  // SKU Metrics Table Columns - SKU is clickable for drill-down
  const [, setLocation] = useLocation();
  
  const skuColumns = [
    {
      key: "sku",
      label: "SKU",
      sortable: true,
      render: (value: string, row: SkuMetrics) => (
        <button
          onClick={() => setLocation(`/quality/sku/${encodeURIComponent(value)}?from=quality`)}
          className="flex flex-col items-start text-left hover-elevate p-1 -m-1 rounded-md transition-colors group"
          data-testid={`link-sku-${value}`}
        >
          <span className="font-medium text-primary flex items-center gap-1 group-hover:underline">
            {value}
            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
          {row.description && (
            <span className="text-xs text-muted-foreground truncate max-w-[250px]">{row.description}</span>
          )}
        </button>
      ),
    },
    {
      key: "vendorName",
      label: "Vendor",
      sortable: true,
      render: (value: string | null, row: SkuMetrics) => (
        <span className="text-sm" data-testid={`text-vendor-sku-${row.sku}`}>
          {value || "—"}
        </span>
      ),
    },
    {
      key: "totalInspections",
      label: "Total Inspections",
      sortable: true,
      render: (value: number) => value.toLocaleString(),
    },
    {
      key: "firstTimePassRate",
      label: "First-Time Pass Rate",
      sortable: true,
      render: (value: number, row: SkuMetrics) => {
        const variant = value >= 85 ? "success" : value >= 70 ? "warning" : "destructive";
        return (
          <div className="flex items-center gap-2">
            <Progress value={value} className="w-16 h-2" />
            <Badge variant={variant === "success" ? "default" : variant === "warning" ? "secondary" : "destructive"} data-testid={`badge-pass-rate-sku-${row.skuId}`}>
              {value.toFixed(1)}%
            </Badge>
          </div>
        );
      },
    },
    {
      key: "avgInspectionsPerShipment",
      label: "Avg Insp/Ship",
      sortable: true,
      render: (value: number) => value.toFixed(2),
    },
    {
      key: "failedCount",
      label: "Failed",
      sortable: true,
      render: (value: number, row: SkuMetrics) => (
        <Badge variant={value > 0 ? "destructive" : "outline"} data-testid={`badge-failed-sku-${row.skuId}`}>
          {value}
        </Badge>
      ),
    },
  ];

  // Vendor Metrics Table Columns
  const vendorColumns = [
    {
      key: "vendorName",
      label: "Vendor",
      sortable: true,
      render: (value: string, row: VendorMetrics) => (
        <span className="font-medium" data-testid={`text-vendor-${row.vendorId || 'unknown'}`}>{value}</span>
      ),
    },
    {
      key: "totalInspections",
      label: "Total Inspections",
      sortable: true,
      render: (value: number) => value.toLocaleString(),
    },
    {
      key: "firstTimePassRate",
      label: "First-Time Pass Rate",
      sortable: true,
      render: (value: number, row: VendorMetrics) => {
        const variant = value >= 85 ? "success" : value >= 70 ? "warning" : "destructive";
        return (
          <div className="flex items-center gap-2">
            <Progress value={value} className="w-16 h-2" />
            <Badge variant={variant === "success" ? "default" : variant === "warning" ? "secondary" : "destructive"} data-testid={`badge-pass-rate-vendor-${row.vendorId || 'unknown'}`}>
              {value.toFixed(1)}%
            </Badge>
          </div>
        );
      },
    },
    {
      key: "avgInspectionsPerShipment",
      label: "Avg Insp/Ship",
      sortable: true,
      render: (value: number) => value.toFixed(2),
    },
    {
      key: "failedCount",
      label: "Failed",
      sortable: true,
      render: (value: number, row: VendorMetrics) => (
        <Badge variant={value > 0 ? "destructive" : "outline"} data-testid={`badge-failed-vendor-${row.vendorId || 'unknown'}`}>
          {value}
        </Badge>
      ),
    },
  ];

  // Compliance Alert Table Columns
  const bookingNeedingInspectionColumns = [
    {
      key: "po_number",
      label: "PO Number",
      sortable: true,
      render: (value: string, row: BookingNeedingInspection) => (
        <Link href={`/purchase-orders/${row.id}`}>
          <span className="text-primary hover:underline cursor-pointer font-medium" data-testid={`link-booking-po-${row.id}`}>
            {value}
          </span>
        </Link>
      ),
    },
    {
      key: "vendor",
      label: "Vendor",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "sku",
      label: "SKU",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "needed_inspections",
      label: "Inspections Needed",
      sortable: false,
      render: (value: string[], row: BookingNeedingInspection) => {
        const inspections = value || ['Inline', 'Final'];
        return (
          <div className="flex gap-1 flex-wrap">
            {inspections.map((type) => (
              <Badge key={type} variant="outline" className="text-xs" data-testid={`badge-inspection-${row.id}-${type.toLowerCase()}`}>
                {type}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: "revised_cancel_date",
      label: "Ship Date",
      sortable: true,
      render: (value: string | null) => {
        if (!value) return "—";
        try {
          return format(new Date(value), "MMM dd, yyyy");
        } catch {
          return value;
        }
      },
    },
    {
      key: "days_until_ship",
      label: "Days Until Ship",
      sortable: true,
      render: (value: number | null, row: BookingNeedingInspection) => {
        const days = value ?? 0;
        const variant = days <= 0 ? "destructive" : days <= 7 ? "secondary" : "outline";
        return (
          <Badge variant={variant} data-testid={`badge-days-ship-${row.id}`}>
            {days <= 0 ? "Today/Past Due" : `${days}d`}
          </Badge>
        );
      },
    },
  ];

  const missingInlineColumns = [
    {
      key: "po_number",
      label: "PO Number",
      sortable: true,
      render: (value: string, row: MissingInlineInspection) => (
        <Link href={`/purchase-orders/${row.id}`}>
          <span className="text-primary hover:underline cursor-pointer font-medium" data-testid={`link-missing-po-${row.id}`}>
            {value}
          </span>
        </Link>
      ),
    },
    {
      key: "vendor",
      label: "Vendor",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "sku",
      label: "SKU",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "cargo_ready_date",
      label: "CRD",
      sortable: true,
      render: (value: string | null) => {
        if (!value) return "—";
        try {
          return format(new Date(value), "MMM dd, yyyy");
        } catch {
          return value;
        }
      },
    },
    {
      key: "days_until_crd",
      label: "Days Until CRD",
      sortable: true,
      render: (value: number | null, row: MissingInlineInspection) => {
        const days = value ?? 0;
        const variant = days <= 3 ? "destructive" : "secondary";
        return (
          <Badge variant={variant} data-testid={`badge-days-crd-${row.id}`}>
            {days <= 0 ? "Today/Past Due" : `${days}d`}
          </Badge>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (value: string) => (
        <Badge variant="outline">{value}</Badge>
      ),
    },
  ];

  const missingFinalColumns = [
    {
      key: "po_number",
      label: "PO Number",
      sortable: true,
      render: (value: string, row: MissingFinalInspection) => (
        <Link href={`/purchase-orders/${row.id}`}>
          <span className="text-primary hover:underline cursor-pointer font-medium" data-testid={`link-missing-final-po-${row.id}`}>
            {value}
          </span>
        </Link>
      ),
    },
    {
      key: "vendor",
      label: "Vendor",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "sku",
      label: "SKU",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "revised_ship_date",
      label: "Ship Date",
      sortable: true,
      render: (value: string | null) => {
        if (!value) return "—";
        try {
          return format(new Date(value), "MMM dd, yyyy");
        } catch {
          return value;
        }
      },
    },
    {
      key: "days_until_ship",
      label: "Days Until Ship",
      sortable: true,
      render: (value: number | null, row: MissingFinalInspection) => {
        const days = value ?? 0;
        const variant = days <= 3 ? "destructive" : days <= 7 ? "secondary" : "outline";
        return (
          <Badge variant={variant} data-testid={`badge-days-ship-${row.id}`}>
            {days <= 0 ? "Today/Past Due" : `${days}d`}
          </Badge>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (value: string) => (
        <Badge variant="outline">{value}</Badge>
      ),
    },
  ];

  const failedInspectionsColumns = [
    {
      key: "po_number",
      label: "PO Number",
      sortable: true,
      render: (value: string, row: FailedInspection) => (
        <span className="font-medium" data-testid={`text-failed-po-${row.id}`}>
          {value}
        </span>
      ),
    },
    {
      key: "vendor_name",
      label: "Vendor",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "sku",
      label: "SKU",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "inspection_type",
      label: "Inspection Type",
      sortable: true,
      render: (value: string) => (
        <Badge variant="outline">{value}</Badge>
      ),
    },
    {
      key: "result",
      label: "Result",
      sortable: true,
      render: (value: string | null, row: FailedInspection) => (
        <Badge variant="destructive" data-testid={`badge-result-${row.id}`}>
          {value || "Failed"}
        </Badge>
      ),
    },
    {
      key: "inspection_date",
      label: "Date",
      sortable: true,
      render: (value: string | null) => {
        if (!value) return "—";
        try {
          return format(new Date(value), "MMM dd, yyyy");
        } catch {
          return value;
        }
      },
    },
  ];

  const expiringCertificatesColumns = [
    {
      key: "po_number",
      label: "PO Number",
      sortable: true,
      render: (value: string) => (
        <span className="font-medium">{value}</span>
      ),
    },
    {
      key: "sku",
      label: "SKU",
      sortable: true,
      render: (value: string | null) => value || "—",
    },
    {
      key: "sku_description",
      label: "Description",
      sortable: true,
      render: (value: string | null) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px]" title={value || ""}>
          {value || "—"}
        </span>
      ),
    },
    {
      key: "test_type",
      label: "Test Type",
      sortable: true,
      render: (value: string) => (
        <span className="text-sm">{value}</span>
      ),
    },
    {
      key: "result",
      label: "Result",
      sortable: true,
      render: (value: string | null, row: ExpiringCertificate) => (
        <Badge 
          variant={value === "Passed" ? "default" : value === "Failed" ? "destructive" : "secondary"}
          data-testid={`badge-cert-result-${row.id}`}
        >
          {value || "Pending"}
        </Badge>
      ),
    },
    {
      key: "expiry_date",
      label: "Expiry Date",
      sortable: true,
      render: (value: string | null) => {
        if (!value) return "—";
        try {
          return format(new Date(value), "MMM dd, yyyy");
        } catch {
          return value;
        }
      },
    },
    {
      key: "days_until_expiry",
      label: "Days Until Expiry",
      sortable: true,
      render: (value: number | null, row: ExpiringCertificate) => {
        const days = value ?? 0;
        const variant = days <= 14 ? "destructive" : days <= 30 ? "secondary" : "outline";
        return (
          <Badge variant={variant} data-testid={`badge-expiry-days-${row.id}`}>
            {days <= 0 ? "Expired" : `${days}d`}
          </Badge>
        );
      },
    },
    {
      key: "ship_date",
      label: "Ship Date",
      sortable: true,
      render: (value: string | null) => {
        if (!value) return "—";
        try {
          return format(new Date(value), "MMM dd, yyyy");
        } catch {
          return value;
        }
      },
    },
  ];

  // Process YOY data for chart
  const processYOYData = () => {
    if (!yoyPassRate || yoyPassRate.length === 0) return [];
    
    // Group by year
    const yearMap = new Map<number, Map<string, number>>();
    yoyPassRate.forEach(item => {
      if (!yearMap.has(item.year)) {
        yearMap.set(item.year, new Map());
      }
      yearMap.get(item.year)!.set(item.monthName, item.firstTimePassRate);
    });

    // Get all unique months in order
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const years = Array.from(yearMap.keys()).sort();
    
    return months.map(month => {
      const dataPoint: { month: string; [key: string]: string | number } = { month };
      years.forEach(year => {
        const rate = yearMap.get(year)?.get(month);
        if (rate !== undefined) {
          dataPoint[year.toString()] = parseFloat(rate.toFixed(1));
        }
      });
      return dataPoint;
    });
  };

  const chartData = processYOYData();
  const years = Array.from(new Set(yoyPassRate?.map(d => d.year) || [])).sort();
  const colors = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))'];
  const strokeDashArrays = ['0', '5 5', '10 5', '15 5 5 5'];
  
  // Calculate dynamic Y-axis range for better visualization
  const calculateYAxisDomain = () => {
    if (!chartData || chartData.length === 0) return [90, 100];
    
    let minValue = 100;
    chartData.forEach(dataPoint => {
      years.forEach(year => {
        const value = dataPoint[year.toString()];
        if (typeof value === 'number' && value < minValue) {
          minValue = value;
        }
      });
    });
    
    // Round down to nearest 5 for cleaner axis, minimum 80%
    const yMin = Math.max(80, Math.floor(minValue / 5) * 5 - 5);
    return [yMin, 100];
  };
  
  const yAxisDomain = calculateYAxisDomain();

  // Process correlation data for chart
  const processCorrelationData = () => {
    if (!delayCorrelation || delayCorrelation.length === 0) return [];
    
    return delayCorrelation.map(item => ({
      label: `${item.monthName} ${item.year}`,
      failedInspections: item.failedInspections,
      lateShipments: item.lateShipments,
      correlatedDelays: item.correlatedDelays,
    }));
  };

  const correlationData = processCorrelationData();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-quality-dashboard-title">Quality & Inspection Dashboard</h1>
          <p className="text-muted-foreground">Comprehensive inspection analytics and compliance tracking</p>
        </div>
        
        <div className="flex items-center gap-2">
          <HelpButton section="quality" />
          <span className="text-sm text-muted-foreground">Inspector:</span>
          <Select value={selectedInspector} onValueChange={setSelectedInspector}>
            <SelectTrigger className="w-[200px]" data-testid="select-inspector">
              <SelectValue placeholder="All Inspectors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Inspectors</SelectItem>
              {inspectorsLoading ? (
                <SelectItem value="loading" disabled>Loading...</SelectItem>
              ) : (
                inspectors?.map(inspector => (
                  <SelectItem key={inspector} value={inspector}>
                    {inspector}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="compliance-alerts" className="space-y-4">
        <TabsList data-testid="tabs-quality-dashboard">
          <TabsTrigger value="compliance-alerts" data-testid="tab-compliance-alerts" className="relative">
            <Bell className="h-4 w-4 mr-1" />
            Compliance Alerts
            {totalAlerts > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
                {totalAlerts > 99 ? "99+" : totalAlerts > 0 ? "!" : ""}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="sku-analysis" data-testid="tab-sku-analysis">SKU Analysis</TabsTrigger>
          <TabsTrigger value="vendor-analysis" data-testid="tab-vendor-analysis">Vendor Analysis</TabsTrigger>
          <TabsTrigger value="trends" data-testid="tab-trends">Trends & Correlation</TabsTrigger>
          <TabsTrigger value="at-risk" data-testid="tab-at-risk">At Risk POs</TabsTrigger>
        </TabsList>

        <TabsContent value="compliance-alerts" className="space-y-6">
          {/* Filter Bar */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Filters:</span>
                </div>
                
                <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                  <SelectTrigger className="w-[180px]" data-testid="select-vendor-filter">
                    <SelectValue placeholder="All Vendors" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Vendors</SelectItem>
                    {filterOptions?.vendors.map(vendor => (
                      <SelectItem key={vendor} value={vendor}>{vendor}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedMerchandiser} onValueChange={setSelectedMerchandiser}>
                  <SelectTrigger className="w-[180px]" data-testid="select-merchandiser-filter">
                    <SelectValue placeholder="All Merchandisers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Merchandisers</SelectItem>
                    {filterOptions?.merchandisers.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedManager} onValueChange={setSelectedManager}>
                  <SelectTrigger className="w-[180px]" data-testid="select-manager-filter">
                    <SelectValue placeholder="All Managers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Managers</SelectItem>
                    {filterOptions?.managers.map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">From:</span>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-[140px]"
                    data-testid="input-start-date"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">To:</span>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-[140px]"
                    data-testid="input-end-date"
                  />
                </div>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="text-muted-foreground"
                    data-testid="button-clear-filters"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Clear All
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quality Test Report - Pivot Table Style */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle>Quality Test Status Report</CardTitle>
                  <CardDescription>Product Lab Test status by test type (Booked-to-ship POs)</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Select value={selectedDivision} onValueChange={setSelectedDivision}>
                    <SelectTrigger className="w-[140px]" data-testid="select-division-filter">
                      <SelectValue placeholder="All Divisions" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Divisions</SelectItem>
                      {(testReport?.filterOptions?.clientDivisions ?? []).map(div => (
                        <SelectItem key={div} value={div}>{div}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                    <SelectTrigger className="w-[200px]" data-testid="select-department-filter">
                      <SelectValue placeholder="All Departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {(testReport?.filterOptions?.clientDepartments ?? []).map(dept => (
                        <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {testReportLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-test-report">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-semibold">Test Type</th>
                        <th className="text-right py-2 px-3 font-semibold text-green-600 dark:text-green-400">Valid</th>
                        <th className="text-right py-2 px-3 font-semibold text-blue-600 dark:text-blue-400">Valid (Waiver)</th>
                        <th className="text-right py-2 px-3 font-semibold text-red-600 dark:text-red-400">Expired</th>
                        <th className="text-right py-2 px-3 font-semibold text-amber-600 dark:text-amber-400">Outstanding</th>
                        <th className="text-right py-2 px-3 font-semibold text-muted-foreground">Not Required</th>
                        <th className="text-right py-2 px-3 font-semibold text-orange-600 dark:text-orange-400">Expiring (60d)</th>
                        <th className="text-right py-2 px-3 font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">Mandatory Test</td>
                        <td className="text-right py-2 px-3 text-green-600 dark:text-green-400" data-testid="text-mandatory-valid">
                          {(testReport?.mandatoryTest?.valid ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-blue-600 dark:text-blue-400" data-testid="text-mandatory-waiver">
                          {(testReport?.mandatoryTest?.validWaiver ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-red-600 dark:text-red-400" data-testid="text-mandatory-expired">
                          {(testReport?.mandatoryTest?.expired ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-amber-600 dark:text-amber-400" data-testid="text-mandatory-outstanding">
                          {(testReport?.mandatoryTest?.outstanding ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-muted-foreground" data-testid="text-mandatory-not-required">
                          {(testReport?.mandatoryTest?.notRequired ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-orange-600 dark:text-orange-400" data-testid="text-mandatory-expiring">
                          {(testReport?.mandatoryTest?.expiringIn60Days ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 font-semibold" data-testid="text-mandatory-total">
                          {(testReport?.mandatoryTest?.grandTotal ?? 0).toLocaleString()}
                        </td>
                      </tr>
                      <tr className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">Performance Test</td>
                        <td className="text-right py-2 px-3 text-green-600 dark:text-green-400" data-testid="text-performance-valid">
                          {(testReport?.performanceTest?.valid ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-blue-600 dark:text-blue-400" data-testid="text-performance-waiver">
                          {(testReport?.performanceTest?.validWaiver ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-red-600 dark:text-red-400" data-testid="text-performance-expired">
                          {(testReport?.performanceTest?.expired ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-amber-600 dark:text-amber-400" data-testid="text-performance-outstanding">
                          {(testReport?.performanceTest?.outstanding ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-muted-foreground" data-testid="text-performance-not-required">
                          {(testReport?.performanceTest?.notRequired ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-orange-600 dark:text-orange-400" data-testid="text-performance-expiring">
                          {(testReport?.performanceTest?.expiringIn60Days ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 font-semibold" data-testid="text-performance-total">
                          {(testReport?.performanceTest?.grandTotal ?? 0).toLocaleString()}
                        </td>
                      </tr>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="py-2 px-3">Grand Total</td>
                        <td className="text-right py-2 px-3 text-green-600 dark:text-green-400">
                          {((testReport?.mandatoryTest?.valid ?? 0) + (testReport?.performanceTest?.valid ?? 0)).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-blue-600 dark:text-blue-400">
                          {((testReport?.mandatoryTest?.validWaiver ?? 0) + (testReport?.performanceTest?.validWaiver ?? 0)).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-red-600 dark:text-red-400">
                          {((testReport?.mandatoryTest?.expired ?? 0) + (testReport?.performanceTest?.expired ?? 0)).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-amber-600 dark:text-amber-400">
                          {((testReport?.mandatoryTest?.outstanding ?? 0) + (testReport?.performanceTest?.outstanding ?? 0)).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-muted-foreground">
                          {((testReport?.mandatoryTest?.notRequired ?? 0) + (testReport?.performanceTest?.notRequired ?? 0)).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-orange-600 dark:text-orange-400">
                          {((testReport?.mandatoryTest?.expiringIn60Days ?? 0) + (testReport?.performanceTest?.expiringIn60Days ?? 0)).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3" data-testid="text-grand-total">
                          {((testReport?.mandatoryTest?.grandTotal ?? 0) + (testReport?.performanceTest?.grandTotal ?? 0)).toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Inspection Status Report - Final/Inline lateness based on ship dates */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle>Inspection Status Report</CardTitle>
                  <CardDescription>
                    Final (5 days before ship) and Inline (8 days before ship) inspection status for pending POs
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {inspectionStatusLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-inspection-status">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-semibold">Inspection Type</th>
                        <th className="text-right py-2 px-3 font-semibold text-green-600 dark:text-green-400">On Time / Passed</th>
                        <th className="text-right py-2 px-3 font-semibold text-red-600 dark:text-red-400">Late</th>
                        <th className="text-right py-2 px-3 font-semibold text-amber-600 dark:text-amber-400">Pending</th>
                        <th className="text-right py-2 px-3 font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">Final Inspection</td>
                        <td className="text-right py-2 px-3 text-green-600 dark:text-green-400" data-testid="text-final-ontime">
                          {(inspectionStatus?.finalInspection?.onTime ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-red-600 dark:text-red-400" data-testid="text-final-late">
                          {(inspectionStatus?.finalInspection?.late ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-amber-600 dark:text-amber-400" data-testid="text-final-pending">
                          {(inspectionStatus?.finalInspection?.pending ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 font-semibold" data-testid="text-final-total">
                          {(inspectionStatus?.finalInspection?.total ?? 0).toLocaleString()}
                        </td>
                      </tr>
                      <tr className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">Inline Inspection</td>
                        <td className="text-right py-2 px-3 text-green-600 dark:text-green-400" data-testid="text-inline-ontime">
                          {(inspectionStatus?.inlineInspection?.onTime ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-red-600 dark:text-red-400" data-testid="text-inline-late">
                          {(inspectionStatus?.inlineInspection?.late ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-amber-600 dark:text-amber-400" data-testid="text-inline-pending">
                          {(inspectionStatus?.inlineInspection?.pending ?? 0).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 font-semibold" data-testid="text-inline-total">
                          {(inspectionStatus?.inlineInspection?.total ?? 0).toLocaleString()}
                        </td>
                      </tr>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="py-2 px-3">Grand Total</td>
                        <td className="text-right py-2 px-3 text-green-600 dark:text-green-400">
                          {((inspectionStatus?.finalInspection?.onTime ?? 0) + (inspectionStatus?.inlineInspection?.onTime ?? 0)).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-red-600 dark:text-red-400">
                          {((inspectionStatus?.finalInspection?.late ?? 0) + (inspectionStatus?.inlineInspection?.late ?? 0)).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3 text-amber-600 dark:text-amber-400">
                          {((inspectionStatus?.finalInspection?.pending ?? 0) + (inspectionStatus?.inlineInspection?.pending ?? 0)).toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3" data-testid="text-inspection-grand-total">
                          {((inspectionStatus?.finalInspection?.total ?? 0) + (inspectionStatus?.inlineInspection?.total ?? 0)).toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Alert Type Selector - Compact Pills */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedAlertType === 'booking' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedAlertType('booking')}
              className="gap-2"
              data-testid="button-alert-booking"
            >
              <Calendar className="h-4 w-4" />
              Need Inspection ({alertCounts?.bookingConfirmedNeedingInspection.toLocaleString() || 0})
            </Button>
            <Button
              variant={selectedAlertType === 'inline' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedAlertType('inline')}
              className="gap-2"
              data-testid="button-alert-inline"
            >
              <Clock className="h-4 w-4" />
              Missing Inline ({alertCounts?.missingInlineInspections.toLocaleString() || 0})
            </Button>
            <Button
              variant={selectedAlertType === 'missingFinal' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedAlertType('missingFinal')}
              className="gap-2"
              data-testid="button-alert-missing-final"
            >
              <Clock className="h-4 w-4" />
              Missing Final ({alertCounts?.missingFinalInspections.toLocaleString() || 0})
            </Button>
            <Button
              variant={selectedAlertType === 'failed' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedAlertType('failed')}
              className="gap-2"
              data-testid="button-alert-failed"
            >
              <ShieldX className="h-4 w-4" />
              Failed ({alertCounts?.failedInspections.toLocaleString() || 0})
            </Button>
            <Button
              variant={selectedAlertType === 'expiring' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedAlertType('expiring')}
              className="gap-2"
              data-testid="button-alert-expiring"
            >
              <FileWarning className="h-4 w-4" />
              Expiring ({alertCounts?.expiringCertificates.toLocaleString() || 0})
            </Button>
          </div>

          {/* Dynamic Table Based on Selected KPI */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                {selectedAlertType === 'booking' && (
                  <>
                    <Calendar className="h-5 w-5 text-amber-500" />
                    Booking Confirmed - Need Inspection
                  </>
                )}
                {selectedAlertType === 'inline' && (
                  <>
                    <Clock className="h-5 w-5 text-orange-500" />
                    Missing Inline Inspection (7-Day Warning)
                  </>
                )}
                {selectedAlertType === 'missingFinal' && (
                  <>
                    <Clock className="h-5 w-5 text-blue-500" />
                    Missing Final Inspection (7-Day Warning)
                  </>
                )}
                {selectedAlertType === 'failed' && (
                  <>
                    <ShieldX className="h-5 w-5 text-red-500" />
                    Failed Inspections
                  </>
                )}
                {selectedAlertType === 'expiring' && (
                  <>
                    <FileWarning className="h-5 w-5 text-purple-500" />
                    Expiring Certificates (90-Day Watchlist)
                  </>
                )}
              </CardTitle>
              <CardDescription>
                {selectedAlertType === 'booking' && 'POs with "Booked-to-ship" status that have no inspections scheduled'}
                {selectedAlertType === 'inline' && 'POs within 7 days of CRD/HOD with no inline inspection scheduled'}
                {selectedAlertType === 'missingFinal' && 'POs with inline inspection completed but no final inspection scheduled within 7 days of ship date'}
                {selectedAlertType === 'failed' && 'Recent inspection failures requiring attention'}
                {selectedAlertType === 'expiring' && 'Certificates expiring before PO ship dates'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedAlertType === 'booking' && (
                bookingLoading ? (
                  <Skeleton className="h-64" />
                ) : (
                  <DataTable
                    columns={bookingNeedingInspectionColumns}
                    data={bookingNeedingInspection || []}
                    searchPlaceholder="Search POs..."
                    onRowClick={handleRowClick}
                    data-testid="table-booking-needing-inspection"
                  />
                )
              )}
              {selectedAlertType === 'inline' && (
                missingInlineLoading ? (
                  <Skeleton className="h-64" />
                ) : (
                  <DataTable
                    columns={missingInlineColumns}
                    data={missingInlineInspections || []}
                    searchPlaceholder="Search POs..."
                    onRowClick={handleRowClick}
                    data-testid="table-missing-inline"
                  />
                )
              )}
              {selectedAlertType === 'missingFinal' && (
                missingFinalLoading ? (
                  <Skeleton className="h-64" />
                ) : (
                  <DataTable
                    columns={missingFinalColumns}
                    data={missingFinalInspections || []}
                    searchPlaceholder="Search POs..."
                    onRowClick={handleRowClick}
                    data-testid="table-missing-final"
                  />
                )
              )}
              {selectedAlertType === 'failed' && (
                failedInspectionsLoading ? (
                  <Skeleton className="h-64" />
                ) : (
                  <DataTable
                    columns={failedInspectionsColumns}
                    data={failedInspections || []}
                    searchPlaceholder="Search inspections..."
                    onRowClick={handleRowClick}
                    data-testid="table-failed-inspections"
                  />
                )
              )}
              {selectedAlertType === 'expiring' && (
                expiringCertsLoading ? (
                  <Skeleton className="h-64" />
                ) : (
                  <DataTable
                    columns={expiringCertificatesColumns}
                    data={expiringCertificates || []}
                    searchPlaceholder="Search certificates..."
                    onRowClick={handleRowClick}
                    data-testid="table-expiring-certificates"
                  />
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {businessLoading ? (
              <>
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </>
            ) : (
              <>
                <KPICard
                  title="Final Pass Rate"
                  value={`${(businessMetrics?.firstTimePassRate ?? 0).toFixed(1)}%`}
                  subtitle="Finals passed first attempt"
                  variant={(businessMetrics?.firstTimePassRate ?? 0) >= 85 ? "success" : (businessMetrics?.firstTimePassRate ?? 0) >= 70 ? "neutral" : "danger"}
                />
                <KPICard
                  title="Inline Pass Rate"
                  value={`${(businessMetrics?.inlineFirstTimePassRate ?? 0).toFixed(1)}%`}
                  subtitle="Inlines passed first attempt"
                  variant={(businessMetrics?.inlineFirstTimePassRate ?? 0) >= 85 ? "success" : (businessMetrics?.inlineFirstTimePassRate ?? 0) >= 70 ? "neutral" : "danger"}
                />
                <KPICard
                  title="Avg Inline/PO-SKU"
                  value={(businessMetrics?.avgInlinePerPoSku ?? 0).toFixed(2)}
                  subtitle="Inline inspections per PO/SKU"
                  variant="neutral"
                />
                <KPICard
                  title="Avg Final/PO-SKU"
                  value={(businessMetrics?.avgFinalPerPoSku ?? 0).toFixed(2)}
                  subtitle="Final inspections per PO/SKU"
                  variant="neutral"
                />
              </>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {businessLoading ? (
              <>
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </>
            ) : (
              <>
                <KPICard
                  title="Total Inspections"
                  value={(businessMetrics?.totalInspections ?? 0).toLocaleString()}
                  subtitle={selectedInspector !== "all" ? `By ${selectedInspector}` : "All inspectors"}
                  variant="neutral"
                />
                <KPICard
                  title="Avg Inspections/Shipment"
                  value={(businessMetrics?.avgInspectionsPerShipment ?? 0).toFixed(2)}
                  subtitle="Per purchase order"
                  variant="neutral"
                />
                <KPICard
                  title="Expiring Certifications"
                  value={kpis?.expiringCertifications ?? 0}
                  subtitle="Next 3 months"
                  variant={(kpis?.expiringCertifications ?? 0) === 0 ? "success" : "neutral"}
                />
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                Failure Analysis by Inspection Type
              </CardTitle>
              <CardDescription>Breakdown of failed inspections across different types</CardDescription>
            </CardHeader>
            <CardContent>
              {businessLoading ? (
                <Skeleton className="h-48" />
              ) : businessMetrics?.failureAnalysis && businessMetrics.failureAnalysis.length > 0 ? (
                <div className="space-y-4">
                  {businessMetrics.failureAnalysis.map((item) => (
                    <div key={item.inspectionType} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.inspectionType || "Unknown"}</span>
                          <Badge variant="outline" className="text-xs">
                            {item.failedCount}/{item.totalCount}
                          </Badge>
                        </div>
                        <Badge 
                          variant={item.failureRate < 10 ? "default" : item.failureRate < 25 ? "secondary" : "destructive"}
                          data-testid={`badge-failure-rate-${item.inspectionType}`}
                        >
                          {item.failureRate.toFixed(1)}% failure
                        </Badge>
                      </div>
                      <Progress 
                        value={100 - item.failureRate} 
                        className="h-2"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No failure data available
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {kpisLoading ? (
              <>
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </>
            ) : (
              <>
                <KPICard
                  title="POs Due Soon"
                  value={kpis?.posDueNext2Weeks ?? 0}
                  subtitle="Next 2 weeks"
                  variant={(kpis?.posDueNext2Weeks ?? 0) <= 10 ? "success" : "neutral"}
                />
                <KPICard
                  title="Scheduled Inspections"
                  value={kpis?.scheduledInspections ?? 0}
                  subtitle="Awaiting inspection"
                  variant={(kpis?.scheduledInspections ?? 0) <= 20 ? "success" : "neutral"}
                />
                <KPICard
                  title="Completed"
                  value={kpis?.completedInspectionsThisMonth ?? 0}
                  subtitle="This month"
                  variant="success"
                />
                <KPICard
                  title="Failed Finals"
                  value={kpis?.failedFinalInspections ?? 0}
                  subtitle="Requiring re-inspection"
                  variant={(kpis?.failedFinalInspections ?? 0) === 0 ? "success" : "danger"}
                />
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="sku-analysis" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                SKU-Level Inspection Performance
              </CardTitle>
              <CardDescription>Inspection metrics broken down by SKU, showing pass rates and failure patterns</CardDescription>
            </CardHeader>
            <CardContent>
              {skuLoading ? (
                <Skeleton className="h-96" />
              ) : (
                <DataTable
                  columns={skuColumns}
                  data={skuMetrics || []}
                  searchPlaceholder="Search SKUs..."
                  data-testid="table-sku-metrics"
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vendor-analysis" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Vendor-Level Inspection Performance
              </CardTitle>
              <CardDescription>Inspection metrics broken down by vendor, identifying quality performance patterns</CardDescription>
            </CardHeader>
            <CardContent>
              {vendorLoading ? (
                <Skeleton className="h-96" />
              ) : (
                <DataTable
                  columns={vendorColumns}
                  data={vendorMetrics || []}
                  searchPlaceholder="Search vendors..."
                  data-testid="table-vendor-metrics"
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Year-over-Year First-Time Pass Rate
              </CardTitle>
              <CardDescription>Monthly comparison of first-time pass rates across years</CardDescription>
            </CardHeader>
            <CardContent>
              {yoyLoading ? (
                <Skeleton className="h-96" />
              ) : chartData.length > 0 ? (
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis 
                        dataKey="month" 
                        tick={{ fontSize: 12 }}
                        tickMargin={8}
                      />
                      <YAxis 
                        domain={yAxisDomain} 
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fontSize: 12 }}
                        tickCount={6}
                      />
                      <ReferenceLine 
                        y={95} 
                        stroke="hsl(var(--muted-foreground))" 
                        strokeDasharray="8 4"
                        strokeOpacity={0.5}
                      >
                        <Label 
                          value="95% Target" 
                          position="insideTopRight" 
                          fill="hsl(var(--muted-foreground))"
                          fontSize={11}
                        />
                      </ReferenceLine>
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
                        formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, `${name} Pass Rate`]}
                      />
                      <Legend 
                        wrapperStyle={{ paddingTop: 10 }}
                        formatter={(value) => <span style={{ color: 'hsl(var(--foreground))' }}>{value}</span>}
                      />
                      {years.map((year, idx) => (
                        <Line
                          key={year}
                          type="monotone"
                          dataKey={year.toString()}
                          name={year.toString()}
                          stroke={colors[idx % colors.length]}
                          strokeWidth={idx === years.length - 1 ? 3 : 2}
                          strokeDasharray={strokeDashArrays[idx % strokeDashArrays.length]}
                          dot={{ r: idx === years.length - 1 ? 5 : 4, strokeWidth: 2 }}
                          activeDot={{ r: 7, strokeWidth: 2 }}
                          label={idx === years.length - 1 ? {
                            position: 'top',
                            fontSize: 10,
                            fill: colors[idx % colors.length],
                            formatter: (value: number) => `${value.toFixed(0)}%`
                          } : undefined}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No year-over-year data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-destructive" />
                Inspection-to-Delay Correlation
              </CardTitle>
              <CardDescription>Relationship between failed inspections and late shipments over time</CardDescription>
            </CardHeader>
            <CardContent>
              {correlationLoading ? (
                <Skeleton className="h-80" />
              ) : correlationData.length > 0 ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={correlationData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
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
                      <Legend />
                      <Bar 
                        dataKey="failedInspections" 
                        name="Failed Inspections" 
                        fill="hsl(var(--chart-1))" 
                      />
                      <Bar 
                        dataKey="lateShipments" 
                        name="Late Shipments" 
                        fill="hsl(var(--chart-2))" 
                      />
                      <Bar 
                        dataKey="correlatedDelays" 
                        name="Correlated Delays" 
                        fill="hsl(var(--chart-3))" 
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No correlation data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="at-risk" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                At Risk Purchase Orders
              </CardTitle>
              <CardDescription>POs flagged for quality concerns requiring attention</CardDescription>
            </CardHeader>
            <CardContent>
              {atRiskLoading ? (
                <Skeleton className="h-96" />
              ) : (
                <DataTable
                  columns={atRiskColumns}
                  data={atRiskPOs || []}
                  searchPlaceholder="Search at-risk orders..."
                  data-testid="table-at-risk-pos"
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
