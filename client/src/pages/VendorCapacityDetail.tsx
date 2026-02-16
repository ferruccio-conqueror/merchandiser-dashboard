import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useClientContext } from "@/contexts/ClientContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Gauge, TrendingUp, Package, DollarSign, ExternalLink, Calendar, AlertCircle, CheckCircle, Pencil, Check, X, Printer, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Line,
  ComposedChart
} from "recharts";
import type { VendorCapacityData, VendorCapacitySummary, Vendor } from "@shared/schema";

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Dynamic year options: current year - 2 to current year + 1 (for 3-year rolling + future planning)
const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1];

export default function VendorCapacityDetail() {
  const { vendorCode } = useParams<{ vendorCode: string }>();
  const [, setLocation] = useLocation();
  const goBack = useBackNavigation("/capacity");
  const decodedVendorCode = decodeURIComponent(vendorCode || '');
  const encodedVendorCode = encodeURIComponent(decodedVendorCode);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedBrands, setSelectedBrands] = useState<string[]>(["CB", "CB2", "C&K"]);
  const [editingMonth, setEditingMonth] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const { selectedClientId } = useClientContext();
  
  const BRAND_OPTIONS = [
    { value: "CB", label: "CB" },
    { value: "CB2", label: "CB2" },
    { value: "C&K", label: "C&K" },
  ];
  
  const toggleBrand = (brand: string) => {
    setSelectedBrands(prev => 
      prev.includes(brand) 
        ? prev.filter(b => b !== brand) 
        : [...prev, brand]
    );
  };
  
  const getBrandLabel = () => {
    if (selectedBrands.length === 0) return "No brands";
    if (selectedBrands.length === BRAND_OPTIONS.length) return "All Brands";
    if (selectedBrands.length === 1) return selectedBrands[0];
    return `${selectedBrands.length} brands`;
  };

  const { data: capacityData = [], isLoading: dataLoading } = useQuery<VendorCapacityData[]>({
    queryKey: [`/api/vendor-capacity/vendor/${encodedVendorCode}`, { year: selectedYear, clientId: selectedClientId }],
    enabled: !!decodedVendorCode,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<VendorCapacitySummary>({
    queryKey: [`/api/vendor-capacity/summary/${encodedVendorCode}/${selectedYear}`],
    enabled: !!decodedVendorCode,
  });

  type OS340MonthlyData = {
    month: number;
    confirmed: number;
    shipped: number;
    CB: number;
    CB2: number;
    'C&K': number;
    cbShipped: number;
    cb2Shipped: number;
    ckShipped: number;
    total: number;
  };
  
  const { data: os340Data = [] } = useQuery<OS340MonthlyData[]>({
    queryKey: [`/api/vendor-capacity/os340-shipped/${encodedVendorCode}/${selectedYear}`],
    enabled: !!decodedVendorCode,
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors"],
  });

  type ExpiredProjection = {
    id: number;
    sku: string;
    description: string | null;
    brand: string;
    year: number;
    month: number;
    projection_quantity: number;
    projection_value: number;
    order_type: string;
    match_status: string;
    expired_at: string | null;
    updated_at: string | null;
    vendor_name: string;
  };

  const { data: expiredProjections = [] } = useQuery<ExpiredProjection[]>({
    queryKey: [`/api/vendor-capacity/expired-projections/${encodedVendorCode}/${selectedYear}`, { clientId: selectedClientId }],
    enabled: !!decodedVendorCode,
  });

  const { toast } = useToast();

  const verifyProjectionMutation = useMutation({
    mutationFn: async (projectionId: number) => {
      await apiRequest("PATCH", `/api/projections/${projectionId}/verify`, { 
        verifiedBy: 'admin',
        notes: 'Verified as unmatched from capacity page - no order placed' 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-capacity/expired-projections/${encodedVendorCode}/${selectedYear}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-capacity/vendor/${encodedVendorCode}`] });
      toast({
        title: "Projection verified",
        description: "Marked as verified unmatched - recorded for accuracy tracking.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to verify projection",
        variant: "destructive",
      });
    },
  });

  // Mutation for updating reserved capacity
  const updateCapacityMutation = useMutation({
    mutationFn: async ({ month, reservedCapacity }: { month: number; reservedCapacity: number }) => {
      await apiRequest("PATCH", `/api/vendor-capacity/${encodedVendorCode}/${selectedYear}/${month}`, { 
        reservedCapacity 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-capacity/vendor/${encodedVendorCode}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/vendor-capacity/summary/${encodedVendorCode}/${selectedYear}`] });
      setEditingMonth(null);
      setEditValue("");
      toast({
        title: "Capacity Updated",
        description: "Reserved capacity has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update capacity",
        variant: "destructive",
      });
    },
  });

  const handleEditClick = (month: number, currentValue: number) => {
    setEditingMonth(month);
    setEditValue((currentValue / 100).toString()); // Convert cents to dollars for editing
  };

  const handleSaveEdit = () => {
    if (editingMonth !== null) {
      const value = parseFloat(editValue) || 0;
      updateCapacityMutation.mutate({ month: editingMonth, reservedCapacity: value });
    }
  };

  const handleCancelEdit = () => {
    setEditingMonth(null);
    setEditValue("");
  };

  const findMatchingVendor = (vendorCode: string, vendorName: string): Vendor | undefined => {
    const code = vendorCode.toLowerCase();
    const name = vendorName.toLowerCase();
    
    return vendors.find(v => {
      const vName = v.name.toLowerCase();
      const firstWord = vName.split(/[\s,.-]+/)[0];
      return vName.includes(code) || 
             firstWord === code ||
             (name && vName.includes(name.split(' ')[0].toLowerCase()));
    });
  };

  const matchedVendor = findMatchingVendor(decodedVendorCode, summary?.vendorName || '');

  const isLoading = dataLoading || summaryLoading;

  // Values are stored in cents - convert to dollars for display
  // Format in hundreds of thousands with K suffix (e.g., $350.5K)
  const formatValue = (value: number, showZero = false) => {
    if (value === 0 && !showZero) return '';
    const dollars = value / 100; // Convert cents to dollars
    if (dollars >= 1000000) return `$${(dollars / 1000000).toFixed(1)}M`;
    if (dollars >= 1000) {
      const thousands = dollars / 1000;
      // Show one decimal place for values under 1000K, round for larger
      return thousands >= 100 ? `$${Math.round(thousands)}K` : `$${thousands.toFixed(1)}K`;
    }
    return `$${Math.round(dollars)}`;
  };

  const formatPercent = (value: number) => {
    if (value === 0) return '';
    return `${value.toFixed(1)}%`;
  };

  const getMonthData = (monthIndex: number) => {
    const monthNum = monthIndex + 1;
    const monthRecords = capacityData.filter(d => d.month === monthNum);
    
    // Data sources:
    // - Orders on Hand (totalShipment): From OS340 purchase orders (unshipped orders)
    // - Shipped Orders (shippedOrders): Historical shipped orders from OS340
    // - Projections (totalProjection): From FURNITURE/HOME-GOODS imports (active_projections)
    // - MTO Projections (mtoProjection): Make-To-Order/SPO projections (displayed in purple)
    // - Expired Projections (expiredProjection): Past order window - for RED bars on chart
    // - Reserved Capacity: From vendor capacity allocations
    let cbShipped = 0, cb2Shipped = 0, ckShipped = 0;
    let cbShippedOrders = 0, cb2ShippedOrders = 0, ckShippedOrders = 0;
    let cbProjection = 0, cb2Projection = 0, ckProjection = 0;
    let cbMtoProjection = 0, cb2MtoProjection = 0, ckMtoProjection = 0;
    let cbExpiredProjection = 0, cb2ExpiredProjection = 0, ckExpiredProjection = 0;
    let totalReserved = 0;
    let capacityDataProjection = 0; // Combined projection from CAPACITY_DATA row (fallback)
    let capacityDataMtoProjection = 0; // MTO from CAPACITY_DATA
    let capacityDataExpiredProjection = 0; // Expired from CAPACITY_DATA
    
    monthRecords.forEach(r => {
      const client = (r.client || '').toUpperCase();
      // @ts-ignore - expiredProjection, mtoProjection, and shippedOrders come from updated API
      const expiredProj = r.expiredProjection || 0;
      // @ts-ignore
      const mtoProj = r.mtoProjection || 0;
      // @ts-ignore
      const shippedOrd = r.shippedOrders || 0;
      
      if (client === 'CB' || (client.includes('CRATE') && !client.includes('KIDS'))) {
        cbShipped += r.totalShipment || 0;
        cbShippedOrders += shippedOrd;
        cbProjection += r.totalProjection || 0;
        cbMtoProjection += mtoProj;
        cbExpiredProjection += expiredProj;
      } else if (client === 'CB2') {
        cb2Shipped += r.totalShipment || 0;
        cb2ShippedOrders += shippedOrd;
        cb2Projection += r.totalProjection || 0;
        cb2MtoProjection += mtoProj;
        cb2ExpiredProjection += expiredProj;
      } else if (client === 'C&K' || client === 'CK' || client.includes('KIDS')) {
        ckShipped += r.totalShipment || 0;
        ckShippedOrders += shippedOrd;
        ckProjection += r.totalProjection || 0;
        ckMtoProjection += mtoProj;
        ckExpiredProjection += expiredProj;
      } else if (client === 'CAPACITY_DATA') {
        // CAPACITY_DATA contains the lump sum reserved capacity and combined projections
        totalReserved += r.reservedCapacity || 0;
        capacityDataProjection += r.totalProjection || 0;
        capacityDataMtoProjection += mtoProj;
        capacityDataExpiredProjection += expiredProj;
      }
    });
    
    // Apply multi-brand filter based on selectedBrands array
    let filteredShipped = 0;
    let filteredShippedOrders = 0;
    let filteredProjection = 0;
    let filteredMtoProjection = 0;
    let filteredExpiredProjection = 0;
    
    // Sum values for each selected brand
    if (selectedBrands.includes('CB')) {
      filteredShipped += cbShipped;
      filteredShippedOrders += cbShippedOrders;
      filteredProjection += cbProjection;
      filteredMtoProjection += cbMtoProjection;
      filteredExpiredProjection += cbExpiredProjection;
    }
    if (selectedBrands.includes('CB2')) {
      filteredShipped += cb2Shipped;
      filteredShippedOrders += cb2ShippedOrders;
      filteredProjection += cb2Projection;
      filteredMtoProjection += cb2MtoProjection;
      filteredExpiredProjection += cb2ExpiredProjection;
    }
    if (selectedBrands.includes('C&K')) {
      filteredShipped += ckShipped;
      filteredShippedOrders += ckShippedOrders;
      filteredProjection += ckProjection;
      filteredMtoProjection += ckMtoProjection;
      filteredExpiredProjection += ckExpiredProjection;
    }
    
    // If all brands selected and no brand-specific data, fall back to CAPACITY_DATA
    if (selectedBrands.length === BRAND_OPTIONS.length) {
      if (filteredProjection === 0) filteredProjection = capacityDataProjection;
      if (filteredMtoProjection === 0) filteredMtoProjection = capacityDataMtoProjection;
      if (filteredExpiredProjection === 0) filteredExpiredProjection = capacityDataExpiredProjection;
    }
    
    return {
      cbShipped,
      cb2Shipped,
      ckShipped,
      totalShipped: filteredShipped,
      totalShippedOrders: filteredShippedOrders,
      cbProjection,
      cb2Projection,
      ckProjection,
      totalProjection: filteredProjection,
      cbMtoProjection,
      cb2MtoProjection,
      ckMtoProjection,
      totalMtoProjection: filteredMtoProjection,
      totalExpiredProjection: filteredExpiredProjection,
      cbReserved: 0, // Reserved is lump sum, not by brand
      cb2Reserved: 0,
      ckReserved: 0,
      totalReserved,
      totalShipmentPlusProjection: filteredShipped + filteredProjection + filteredMtoProjection,
      balance: totalReserved - (filteredShipped + filteredProjection + filteredMtoProjection),
      utilization: totalReserved > 0 ? ((filteredShipped + filteredProjection + filteredMtoProjection) / totalReserved) * 100 : 0
    };
  };

  const monthlyTableData = MONTHS.map((_, i) => ({
    ...getMonthData(i),
    month: i + 1, // 1-indexed month for API calls
  }));

  const totals = {
    cbShipped: monthlyTableData.reduce((sum, m) => sum + m.cbShipped, 0),
    cb2Shipped: monthlyTableData.reduce((sum, m) => sum + m.cb2Shipped, 0),
    ckShipped: monthlyTableData.reduce((sum, m) => sum + m.ckShipped, 0),
    totalShipped: monthlyTableData.reduce((sum, m) => sum + m.totalShipped, 0),
    totalShippedOrders: monthlyTableData.reduce((sum, m) => sum + m.totalShippedOrders, 0),
    cbProjection: monthlyTableData.reduce((sum, m) => sum + m.cbProjection, 0),
    cb2Projection: monthlyTableData.reduce((sum, m) => sum + m.cb2Projection, 0),
    ckProjection: monthlyTableData.reduce((sum, m) => sum + m.ckProjection, 0),
    totalProjection: monthlyTableData.reduce((sum, m) => sum + m.totalProjection, 0),
    cbMtoProjection: monthlyTableData.reduce((sum, m) => sum + m.cbMtoProjection, 0),
    cb2MtoProjection: monthlyTableData.reduce((sum, m) => sum + m.cb2MtoProjection, 0),
    ckMtoProjection: monthlyTableData.reduce((sum, m) => sum + m.ckMtoProjection, 0),
    totalMtoProjection: monthlyTableData.reduce((sum, m) => sum + m.totalMtoProjection, 0),
    totalExpiredProjection: monthlyTableData.reduce((sum, m) => sum + m.totalExpiredProjection, 0),
    cbReserved: monthlyTableData.reduce((sum, m) => sum + m.cbReserved, 0),
    cb2Reserved: monthlyTableData.reduce((sum, m) => sum + m.cb2Reserved, 0),
    ckReserved: monthlyTableData.reduce((sum, m) => sum + m.ckReserved, 0),
    // Always calculate from monthly data to ensure consistency (summary table can be stale)
    totalReserved: monthlyTableData.reduce((sum, m) => sum + m.totalReserved, 0),
    totalShipmentPlusProjection: monthlyTableData.reduce((sum, m) => sum + m.totalShipmentPlusProjection, 0),
    balance: 0,
    utilization: 0
  };
  totals.balance = totals.totalReserved - totals.totalShipmentPlusProjection;
  totals.utilization = totals.totalReserved > 0 ? (totals.totalShipmentPlusProjection / totals.totalReserved) * 100 : 0;

  // Calculate rolling balance - carries forward negative balances to show when vendor will recover
  // If a month has negative balance, the deficit carries forward to subsequent months
  const rollingBalances: number[] = [];
  let runningBalance = 0;
  monthlyTableData.forEach((m, i) => {
    // Add this month's balance to the running total
    // If previous month was negative, we carry that deficit forward
    runningBalance = runningBalance + m.balance;
    rollingBalances.push(runningBalance);
  });
  
  // Find recovery month (first month where rolling balance becomes positive after being negative)
  let recoveryMonthIndex: number | null = null;
  let wasNegative = false;
  for (let i = 0; i < rollingBalances.length; i++) {
    if (rollingBalances[i] < 0) {
      wasNegative = true;
    } else if (wasNegative && rollingBalances[i] >= 0) {
      recoveryMonthIndex = i;
      break;
    }
  }

  // Chart data - convert cents to thousands of dollars (K)
  // Planning view: Orders on Hand, Projections, MTO/SPO Projections, and Expired Projections
  const monthlyChartData = MONTHS.map((month, index) => {
    const data = monthlyTableData[index];
    return {
      month,
      shipped: data.totalShipped / 100000, // cents to $K - orders on hand (unshipped)
      projection: data.totalProjection / 100000, // cents to $K - active regular projections
      mtoProjection: data.totalMtoProjection / 100000, // cents to $K - MTO/SPO projections (purple)
      expiredProjection: data.totalExpiredProjection / 100000, // cents to $K (RED bars)
      reserved: data.totalReserved / 100000, // cents to $K
    };
  });

  // Format currency from cents to display value
  const formatCurrency = (value: number) => {
    const dollars = value / 100; // Convert cents to dollars
    if (dollars >= 1000000) return `$${(dollars / 1000000).toFixed(1)}M`;
    if (dollars >= 1000) return `$${(dollars / 1000).toFixed(0)}K`;
    return `$${dollars.toFixed(0)}`;
  };

  const cellClass = "text-right px-2 py-1 text-xs font-mono";
  const headerClass = "text-right px-2 py-1 text-xs font-semibold bg-muted/50";
  const sectionHeaderClass = "px-2 py-1 text-xs font-bold bg-muted";
  const rowLabelClass = "px-2 py-1 text-xs font-medium whitespace-nowrap";
  const totalRowClass = "bg-yellow-50 dark:bg-yellow-900/20 font-bold";
  const subtotalRowClass = "bg-gray-50 dark:bg-gray-800/50 font-semibold";
  const balancePositiveClass = "text-green-600 dark:text-green-400";
  const balanceNegativeClass = "text-red-600 dark:text-red-400";

  return (
    <div className="space-y-6 print-report">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={goBack}
            className="no-print"
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2 print-title" data-testid="text-vendor-title">
              <Gauge className="h-6 w-6 no-print" />
              {summary?.vendorName || decodedVendorCode}
              {matchedVendor && (
                <Link href={`/vendors/${matchedVendor.id}`} className="no-print">
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="ml-2"
                    data-testid="link-vendor-profile"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    View Vendor Profile
                  </Button>
                </Link>
              )}
            </h1>
            <p className="text-muted-foreground print-subtitle">
              Capacity Report for {selectedYear}
              <span className="print-only"> | {getBrandLabel()} | Generated {new Date().toLocaleDateString()}</span>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 no-print">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-36 justify-between" data-testid="dropdown-brand">
                <span className="truncate">{getBrandLabel()}</span>
                <ChevronDown className="h-4 w-4 ml-2 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {BRAND_OPTIONS.map((brand) => (
                <DropdownMenuCheckboxItem
                  key={brand.value}
                  checked={selectedBrands.includes(brand.value)}
                  onCheckedChange={() => toggleBrand(brand.value)}
                  data-testid={`checkbox-brand-${brand.value}`}
                >
                  {brand.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Select
              value={String(selectedYear)}
              onValueChange={(value) => setSelectedYear(Number(value))}
            >
              <SelectTrigger className="w-28" data-testid="select-year">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {YEAR_OPTIONS.map((year) => (
                  <SelectItem key={year} value={String(year)} data-testid={`select-year-${year}`}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="default"
            onClick={() => window.print()}
            data-testid="button-print-pdf"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print as PDF
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print-kpi-row">
            <Card className="print-kpi-card">
              <CardHeader className="pb-2 print-kpi-header">
                <CardDescription>Annual Reserved Capacity</CardDescription>
              </CardHeader>
              <CardContent className="print-kpi-content">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-blue-500 print-kpi-icon" />
                  <span className="text-2xl font-bold print-kpi-value" data-testid="text-reserved-capacity">
                    {totals.totalReserved > 0 ? formatCurrency(totals.totalReserved) : '--'}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="print-kpi-card">
              <CardHeader className="pb-2 print-kpi-header">
                <CardDescription>Orders on Hand</CardDescription>
              </CardHeader>
              <CardContent className="print-kpi-content">
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-green-500 print-kpi-icon" />
                  <span className="text-2xl font-bold text-green-600 print-kpi-value" data-testid="text-ytd-shipped">
                    {totals.totalShipped > 0 ? formatCurrency(totals.totalShipped) : '--'}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="print-kpi-card">
              <CardHeader className="pb-2 print-kpi-header">
                <CardDescription>YTD Projections</CardDescription>
              </CardHeader>
              <CardContent className="print-kpi-content">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-purple-500 print-kpi-icon" />
                  <span className="text-2xl font-bold text-purple-600 print-kpi-value" data-testid="text-ytd-projected">
                    {totals.totalProjection > 0 ? formatCurrency(totals.totalProjection) : '--'}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="print-kpi-card">
              <CardHeader className="pb-2 print-kpi-header">
                <CardDescription>Avg Utilization</CardDescription>
              </CardHeader>
              <CardContent className="print-kpi-content">
                <div className="space-y-2">
                  <span className="text-2xl font-bold print-kpi-value" data-testid="text-avg-utilization">
                    {totals.utilization > 0 ? `${totals.utilization.toFixed(0)}%` : '--'}
                  </span>
                  <Progress value={Math.min(totals.utilization, 100)} className="h-2" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Rolling Forecast - Orders vs Capacity</CardTitle>
              <CardDescription>
                Orders on hand (confirmed) + projections (pending) vs reserved capacity for {selectedYear}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" className="text-xs" />
                    <YAxis 
                      tickFormatter={(value) => `$${value}K`}
                      className="text-xs"
                    />
                    <Tooltip 
                      formatter={(value: number, name: string) => [
                        `$${value.toFixed(0)}K`, 
                        name
                      ]}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="shipped" stackId="orders" fill="#2563eb" name="Orders on Hand" />
                    <Bar dataKey="projection" stackId="orders" fill="#93c5fd" name="Projections (Pending)" />
                    <Bar dataKey="mtoProjection" stackId="orders" fill="#60a5fa" name="MTO/SPO Projections" />
                    <Bar dataKey="expiredProjection" stackId="orders" fill="#dc2626" name="Expired (Needs Verification)" />
                    <Line 
                      type="monotone" 
                      dataKey="reserved" 
                      stroke="#6366f1" 
                      strokeWidth={3}
                      strokeDasharray="5 5"
                      dot={{ fill: '#6366f1', r: 4 }}
                      name="Reserved Capacity"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                Vendor Capacity Breakdown
                <Badge variant="outline" className="text-xs">
                  {selectedYear}
                </Badge>
              </CardTitle>
              <CardDescription>
                Monthly capacity data by brand and month
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse" data-testid="table-capacity-breakdown">
                  <thead>
                    <tr className="border-b">
                      <th className={`${sectionHeaderClass} text-left sticky left-0 bg-muted z-10 min-w-[180px]`}>BY FOB (US$)</th>
                      <th className={headerClass}>New/Re-buy</th>
                      {MONTHS.map((m) => (
                        <th key={m} className={headerClass}>{m}</th>
                      ))}
                      <th className={`${headerClass} bg-yellow-100 dark:bg-yellow-900/30`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b bg-blue-50/50 dark:bg-blue-900/10">
                      <td colSpan={15} className={`${sectionHeaderClass} text-blue-700 dark:text-blue-300`}>
                        ORDERS ON HAND
                      </td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>CB</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.cbShipped)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.cbShipped)}</td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>CB2</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.cb2Shipped)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.cb2Shipped)}</td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>C&amp;K</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.ckShipped)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.ckShipped)}</td>
                    </tr>
                    
                    <tr className={`border-b ${subtotalRowClass}`}>
                      <td className={`${rowLabelClass} sticky left-0 bg-gray-50 dark:bg-gray-800/50`}>Total ORDERS ON HAND US$</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.totalShipped)}</td>
                      ))}
                      <td className={`${cellClass} ${totalRowClass}`}>{formatValue(totals.totalShipped)}</td>
                    </tr>

                    <tr className="border-b bg-purple-50/50 dark:bg-purple-900/10">
                      <td colSpan={15} className={`${sectionHeaderClass} text-purple-700 dark:text-purple-300`}>
                        PROJECTIONS
                      </td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>CB</td>
                      <td className={cellClass}>Re-buy</td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.cbProjection)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.cbProjection)}</td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>CB2</td>
                      <td className={cellClass}>Re-buy</td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.cb2Projection)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.cb2Projection)}</td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>C&amp;K</td>
                      <td className={cellClass}>Re-buy</td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.ckProjection)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.ckProjection)}</td>
                    </tr>
                    
                    <tr className={`border-b ${subtotalRowClass}`}>
                      <td className={`${rowLabelClass} sticky left-0 bg-gray-50 dark:bg-gray-800/50`}>TOTAL US$</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.totalProjection)}</td>
                      ))}
                      <td className={`${cellClass} ${totalRowClass}`}>{formatValue(totals.totalProjection)}</td>
                    </tr>

                    <tr className="border-b bg-violet-50/50 dark:bg-violet-900/10">
                      <td colSpan={15} className={`${sectionHeaderClass} text-violet-700 dark:text-violet-300`}>
                        MTO/SPO PROJECTIONS
                      </td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>CB</td>
                      <td className={cellClass}>MTO</td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={`${cellClass} ${m.cbMtoProjection > 0 ? 'text-violet-600 dark:text-violet-400 font-medium' : ''}`}>{formatValue(m.cbMtoProjection)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.cbMtoProjection)}</td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>CB2</td>
                      <td className={cellClass}>MTO</td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={`${cellClass} ${m.cb2MtoProjection > 0 ? 'text-violet-600 dark:text-violet-400 font-medium' : ''}`}>{formatValue(m.cb2MtoProjection)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.cb2MtoProjection)}</td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>C&amp;K</td>
                      <td className={cellClass}>MTO</td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={`${cellClass} ${m.ckMtoProjection > 0 ? 'text-violet-600 dark:text-violet-400 font-medium' : ''}`}>{formatValue(m.ckMtoProjection)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.ckMtoProjection)}</td>
                    </tr>
                    
                    <tr className={`border-b ${subtotalRowClass}`}>
                      <td className={`${rowLabelClass} sticky left-0 bg-gray-50 dark:bg-gray-800/50`}>TOTAL MTO US$</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={`${cellClass} ${m.totalMtoProjection > 0 ? 'text-violet-600 dark:text-violet-400 font-semibold' : ''}`}>{formatValue(m.totalMtoProjection)}</td>
                      ))}
                      <td className={`${cellClass} ${totalRowClass}`}>{formatValue(totals.totalMtoProjection)}</td>
                    </tr>

                    <tr className={`border-b ${totalRowClass}`}>
                      <td className={`${rowLabelClass} sticky left-0 bg-yellow-50 dark:bg-yellow-900/20`}>TOTAL SHIPMENT + PROJECTION</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.totalShipmentPlusProjection)}</td>
                      ))}
                      <td className={`${cellClass} ${totalRowClass}`}>{formatValue(totals.totalShipmentPlusProjection)}</td>
                    </tr>

                    <tr className="border-b bg-red-50/50 dark:bg-red-900/10">
                      <td colSpan={15} className={`${sectionHeaderClass} text-red-700 dark:text-red-300`}>
                        RESERVED CAPACITY
                      </td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>CB</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.cbReserved)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.cbReserved)}</td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>CB2</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.cb2Reserved)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.cb2Reserved)}</td>
                    </tr>
                    
                    <tr className="border-b hover:bg-muted/30">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>C&amp;K</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={cellClass}>{formatValue(m.ckReserved)}</td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20`}>{formatValue(totals.ckReserved)}</td>
                    </tr>
                    
                    <tr className={`border-b ${subtotalRowClass}`}>
                      <td className={`${rowLabelClass} sticky left-0 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-1`}>
                        TOTAL RESERVED US$
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td 
                          key={i} 
                          className={`${cellClass} cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20`}
                          onClick={() => handleEditClick(m.month, m.totalReserved)}
                          data-testid={`cell-reserved-month-${m.month}`}
                        >
                          {editingMonth === m.month ? (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="w-20 h-6 text-xs p-1"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveEdit();
                                  if (e.key === 'Escape') handleCancelEdit();
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="h-5 w-5"
                                onClick={(e) => { e.stopPropagation(); handleSaveEdit(); }}
                                disabled={updateCapacityMutation.isPending}
                              >
                                <Check className="h-3 w-3 text-green-600" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="h-5 w-5"
                                onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                              >
                                <X className="h-3 w-3 text-red-600" />
                              </Button>
                            </div>
                          ) : (
                            formatValue(m.totalReserved)
                          )}
                        </td>
                      ))}
                      <td className={`${cellClass} ${totalRowClass}`}>{formatValue(totals.totalReserved)}</td>
                    </tr>

                    <tr className="border-b">
                      <td className={`${rowLabelClass} sticky left-0 bg-background font-bold`}>BALANCE</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={`${cellClass} ${m.balance >= 0 ? balancePositiveClass : balanceNegativeClass}`}>
                          {m.balance !== 0 ? formatValue(m.balance, true) : ''}
                        </td>
                      ))}
                      <td className={`${cellClass} font-bold ${totals.balance >= 0 ? balancePositiveClass : balanceNegativeClass} bg-yellow-50 dark:bg-yellow-900/20`}>
                        {formatValue(totals.balance, true)}
                      </td>
                    </tr>

                    <tr className="border-b bg-slate-50 dark:bg-slate-800/50">
                      <td className={`${rowLabelClass} sticky left-0 bg-slate-50 dark:bg-slate-800/50 font-bold`}>
                        ROLLING BALANCE
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(cumulative)</span>
                      </td>
                      <td className={cellClass}></td>
                      {rollingBalances.map((rb, i) => {
                        const isRecoveryMonth = recoveryMonthIndex === i;
                        return (
                          <td 
                            key={i} 
                            className={`${cellClass} font-semibold ${rb >= 0 ? balancePositiveClass : balanceNegativeClass} ${isRecoveryMonth ? 'bg-green-100 dark:bg-green-900/30 ring-2 ring-green-500 ring-inset' : ''}`}
                          >
                            {rb !== 0 ? formatValue(rb, true) : ''}
                            {isRecoveryMonth && (
                              <span className="ml-1 text-[10px] text-green-600 dark:text-green-400">RECOVERY</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={`${cellClass} font-bold ${rollingBalances[11] >= 0 ? balancePositiveClass : balanceNegativeClass} bg-yellow-50 dark:bg-yellow-900/20`}>
                        {formatValue(rollingBalances[11] || 0, true)}
                      </td>
                    </tr>
                    
                    <tr className="border-b">
                      <td className={`${rowLabelClass} sticky left-0 bg-background`}>UTILIZED CAPACITY</td>
                      <td className={cellClass}></td>
                      {monthlyTableData.map((m, i) => (
                        <td key={i} className={`${cellClass} ${m.utilization > 100 ? 'text-red-600' : m.utilization > 80 ? 'text-amber-600' : ''}`}>
                          {formatPercent(m.utilization)}
                        </td>
                      ))}
                      <td className={`${cellClass} font-bold bg-yellow-50 dark:bg-yellow-900/20 ${totals.utilization > 100 ? 'text-red-600' : totals.utilization > 80 ? 'text-amber-600' : ''}`}>
                        {formatPercent(totals.utilization)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Expired Projections Verification Section */}
          {expiredProjections.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-amber-500" />
                      Expired Projections for Verification
                    </CardTitle>
                    <CardDescription>
                      These projections have passed their order window and are excluded from capacity calculations. 
                      Mark as verified to confirm no order was placed - data will be kept for accuracy tracking and reporting.
                    </CardDescription>
                  </div>
                  <Link href="/projections">
                    <Button variant="outline" size="sm" data-testid="button-view-all-expired">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View in Projections Dashboard
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Expired</TableHead>
                        <TableHead className="text-center">Verify</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expiredProjections.map((proj) => (
                        <TableRow key={proj.id} data-testid={`row-expired-projection-${proj.id}`}>
                          <TableCell className="font-mono text-sm">{proj.sku}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{proj.description || '-'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{proj.brand}</Badge>
                          </TableCell>
                          <TableCell>{MONTHS[proj.month - 1]} {proj.year}</TableCell>
                          <TableCell className="text-right font-mono">{proj.projection_quantity?.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(proj.projection_value || 0)}</TableCell>
                          <TableCell>
                            <Badge variant={proj.order_type === 'mto' ? 'secondary' : 'outline'}>
                              {proj.order_type === 'mto' ? 'SPO/MTO' : 'Regular'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {proj.expired_at ? new Date(proj.expired_at).toLocaleDateString() : '-'}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => verifyProjectionMutation.mutate(proj.id)}
                              disabled={verifyProjectionMutation.isPending}
                              data-testid={`button-verify-projection-${proj.id}`}
                              title="Mark as verified (no order placed) - keeps for accuracy tracking"
                            >
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-4 text-sm text-muted-foreground">
                  Total expired: {expiredProjections.length} projections, 
                  {' '}{formatCurrency(expiredProjections.reduce((sum, p) => sum + (Number(p.projection_value) || 0), 0))} value
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

    </div>
  );
}
