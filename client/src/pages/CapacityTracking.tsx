import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Gauge, Building2, AlertTriangle, CheckCircle2, TrendingUp, ChevronRight, Upload, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClientContext } from "@/contexts/ClientContext";
import type { VendorCapacitySummary } from "@shared/schema";

interface EnrichedCapacitySummary extends VendorCapacitySummary {
  displayVendorName?: string;
  linkedVendorId?: number | null;
  canonicalVendorName?: string;
  canonicalVendorId?: number;
  capacityIssueStatus?: string | null;
}

export default function CapacityTracking() {
  const [, setLocation] = useLocation();
  const { selectedClient } = useClientContext();
  const currentYear = new Date().getFullYear();

  // Build URL with client filter - capacity data will be filtered by client for dashboard KPIs
  const summariesUrl = selectedClient?.shortName
    ? `/api/vendor-capacity/summaries?client=${encodeURIComponent(selectedClient.shortName)}`
    : "/api/vendor-capacity/summaries";

  const { data: summaries = [], isLoading } = useQuery<EnrichedCapacitySummary[]>({
    queryKey: [summariesUrl],
  });

  const activeVendors = summaries.length;
  
  // Only include vendors with capacity set for utilization metrics
  const vendorsWithCapacity = summaries.filter(s => 
    (s.totalReservedCapacityAnnual || 0) > 0 && s.capacityIssueStatus !== 'No Set Capacity'
  );
  const highUtilization = vendorsWithCapacity.filter(s => (s.avgUtilizationPct || 0) > 80).length;
  const availableCapacity = summaries.filter(s => (s.avgUtilizationPct || 0) < 60).length;
  const avgUtilization = vendorsWithCapacity.length > 0 
    ? Math.round(vendorsWithCapacity.reduce((sum, s) => sum + (s.avgUtilizationPct || 0), 0) / vendorsWithCapacity.length)
    : 0;

  const getUtilizationColor = (utilization: number) => {
    if (utilization >= 90) return "text-red-600";
    if (utilization >= 80) return "text-orange-600";
    if (utilization >= 60) return "text-yellow-600";
    return "text-green-600";
  };

  const getStatusBadge = (utilization: number, capacityIssueStatus?: string | null) => {
    // Prioritize monthly capacity issues over utilization-based status
    // All issue badges have consistent width and centered text for better alignment
    const badgeStyles = "w-[90px] flex justify-center items-center text-center leading-tight py-1";
    if (capacityIssueStatus === 'Capacity Issue') {
      return <Badge variant="destructive" className={badgeStyles}>Capacity<br />Issue</Badge>;
    }
    if (capacityIssueStatus === 'Potential Risk') {
      return <Badge className={`${badgeStyles} bg-orange-500 hover:bg-orange-600`}>Potential<br />Risk</Badge>;
    }
    if (capacityIssueStatus === 'No Set Capacity') {
      return <Badge variant="secondary" className={badgeStyles}>No Set<br />Capacity</Badge>;
    }
    // Fall back to utilization-based status
    if (utilization >= 90) return <Badge variant="destructive" className={badgeStyles}>At<br />Capacity</Badge>;
    if (utilization >= 80) return <Badge className={`${badgeStyles} bg-orange-500 hover:bg-orange-600`}>High<br />Utilization</Badge>;
    if (utilization >= 60) return <Badge className={`${badgeStyles} bg-yellow-500 hover:bg-yellow-600 text-black`}>Moderate<br />Utilization</Badge>;
    if (utilization > 0) return <Badge className={`${badgeStyles} bg-green-500 hover:bg-green-600`}>Available<br />Capacity</Badge>;
    return <Badge variant="secondary" className={badgeStyles}>No<br />Data</Badge>;
  };

  const handleVendorClick = (vendorCode: string) => {
    setLocation(`/capacity/${encodeURIComponent(vendorCode)}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-capacity-title">
            <Gauge className="h-6 w-6" />
            Vendor Capacity Tracking
          </h1>
          <p className="text-muted-foreground">Monitor vendor production capacity and utilization</p>
        </div>
        <Button variant="outline" onClick={() => setLocation("/import")} data-testid="button-import-capacity">
          <Upload className="h-4 w-4 mr-2" />
          Import Capacity Data
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Vendors</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-500" />
              <span className="text-3xl font-bold" data-testid="text-active-vendors">
                {activeVendors}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">With capacity data for {currentYear}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>High Utilization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <span className="text-3xl font-bold text-orange-600" data-testid="text-high-utilization">
                {highUtilization}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Above 80% (of {vendorsWithCapacity.length} with capacity)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Available Capacity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="text-3xl font-bold text-green-600" data-testid="text-available-capacity">
                {availableCapacity}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Vendors below 60% utilization</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Utilization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              <span className="text-3xl font-bold" data-testid="text-avg-utilization">
                {avgUtilization}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Vendors with capacity set ({vendorsWithCapacity.length})
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vendor Capacity Overview</CardTitle>
          <CardDescription>Click on a vendor to view detailed monthly capacity breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : summaries.length > 0 ? (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Vendor</TableHead>
                    <TableHead className="text-right font-semibold">Annual Capacity</TableHead>
                    <TableHead className="text-right font-semibold">Orders on Hand</TableHead>
                    <TableHead className="text-right font-semibold">YTD Projected</TableHead>
                    <TableHead className="font-semibold">Utilization</TableHead>
                    <TableHead className="text-right font-semibold">Status</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaries.map((summary) => {
                    const utilization = summary.avgUtilizationPct || 0;
                    const vendorId = summary.linkedVendorId || summary.canonicalVendorId;
                    const displayName = summary.displayVendorName || summary.canonicalVendorName || summary.vendorName || summary.vendorCode;
                    return (
                      <TableRow 
                        key={summary.id} 
                        className="cursor-pointer hover-elevate"
                        onClick={() => handleVendorClick(summary.vendorCode)}
                        data-testid={`row-vendor-${summary.vendorCode}`}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{displayName}</span>
                            {vendorId && (
                              <Link 
                                href={`/vendors/${vendorId}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-6 w-6"
                                  data-testid={`link-vendor-db-${summary.vendorCode}`}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                              </Link>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {summary.totalReservedCapacityAnnual ? `$${(summary.totalReservedCapacityAnnual / 100000000).toFixed(2)}M` : '--'}
                        </TableCell>
                        <TableCell className="text-right">
                          {summary.totalShipmentAnnual ? `$${(summary.totalShipmentAnnual / 100000000).toFixed(2)}M` : '--'}
                        </TableCell>
                        <TableCell className="text-right">
                          {summary.totalProjectionAnnual ? `$${(summary.totalProjectionAnnual / 100000000).toFixed(2)}M` : '--'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress 
                              value={Math.min(utilization, 100)} 
                              className="flex-1 h-2"
                            />
                            <span className={`text-sm w-12 text-right font-medium ${getUtilizationColor(utilization)}`}>
                              {utilization.toFixed(0)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {getStatusBadge(utilization, summary.capacityIssueStatus)}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Gauge className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No Capacity Data Available</h3>
              <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                Import the SS 551 Capacity Tracker Excel file to populate vendor capacity data.
                Each sheet in the file represents a vendor's monthly capacity allocation.
              </p>
              <Button 
                className="mt-4" 
                onClick={() => setLocation("/import")}
                data-testid="button-import-empty"
              >
                <Upload className="h-4 w-4 mr-2" />
                Import Capacity Data
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
