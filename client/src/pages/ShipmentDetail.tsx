import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ArrowLeft, 
  Ship, 
  Package, 
  Calendar, 
  MapPin, 
  Clock,
  AlertTriangle,
  CheckCircle,
  Anchor,
  FileText
} from "lucide-react";
import { format, differenceInDays, isAfter } from "date-fns";
import { AIEmailSummaryPanel } from "@/components/AIEmailSummaryPanel";

interface ShipmentLineItem {
  id: number;
  shipmentNumber: number | null;
  style: string | null;
  qtyShipped: number | null;
  shippedValue: number | null;
  cargoReadyDate: string | null;
  deliveryToConsolidator: string | null;
  eta: string | null;
  hodStatus: string | null;
  logisticStatus: string | null;
}

interface ShipmentDetail {
  shipment: {
    id: number;
    shipmentNumber: string;
    poNumber: string;
    cargoReadyDate: string | null;
    pts: string | null;
    ptsStatus: string | null;
    etd: string | null;
    eta: string | null;
    hodStatus: string | null;
    logisticStatus: string | null;
    vesselName: string | null;
    vesselVoyage: string | null;
    containerNumber: string | null;
    containerType: string | null;
    portOfLoading: string | null;
    portOfDischarge: string | null;
    deliveryToConsolidator: string | null;
    finalDestination: string | null;
    style: string | null;
    qtyShipped: number | null;
    shippedValue: number | null;
  } | null;
  po: {
    id: number;
    poNumber: string;
    vendor: string;
    office: string;
    buyer: string;
    status: string;
    revisedShipDate: string | null;
    revisedCancelDate: string | null;
    totalValue: number;
    orderQuantity: number;
  } | null;
  allShipments: ShipmentLineItem[];
}

export default function ShipmentDetail() {
  const [, params] = useRoute("/shipments/:id");
  const shipmentId = parseInt(params?.id || "0");
  const goBack = useBackNavigation("/shipments");

  const { data, isLoading, error } = useQuery<ShipmentDetail>({
    queryKey: [`/api/shipments-page/${shipmentId}`],
    enabled: shipmentId > 0,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !data?.shipment) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" data-testid="button-back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Card className="p-6">
          <p className="text-muted-foreground">Shipment not found or failed to load.</p>
        </Card>
      </div>
    );
  }

  const { shipment, po, allShipments } = data;
  const now = new Date();
  const eta = shipment.eta ? new Date(shipment.eta) : null;
  
  let shipmentStatus: 'on-time' | 'late' | 'at-risk' | 'pending' = 'pending';
  if (shipment.hodStatus === 'On-Time' || shipment.logisticStatus === 'Delivered') {
    shipmentStatus = 'on-time';
  } else if (shipment.hodStatus === 'Late' || (eta && isAfter(now, eta))) {
    shipmentStatus = 'late';
  } else if (eta && differenceInDays(eta, now) <= 7) {
    shipmentStatus = 'at-risk';
  }

  const getStatusBadge = (status: typeof shipmentStatus) => {
    switch (status) {
      case 'late':
        return (
          <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" data-testid="badge-status-late">
            <Clock className="h-3 w-3 mr-1" />
            Late
          </Badge>
        );
      case 'at-risk':
        return (
          <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" data-testid="badge-status-at-risk">
            <AlertTriangle className="h-3 w-3 mr-1" />
            At Risk
          </Badge>
        );
      case 'on-time':
        return (
          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" data-testid="badge-status-on-time">
            <CheckCircle className="h-3 w-3 mr-1" />
            On Time
          </Badge>
        );
      default:
        return <Badge variant="outline" data-testid="badge-status-pending">Pending</Badge>;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return format(new Date(dateStr), "MMM dd, yyyy");
    } catch {
      return "-";
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value / 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" data-testid="button-back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <Ship className="h-6 w-6" />
            <h1 className="text-2xl font-semibold" data-testid="text-shipment-title">
              Shipment {shipment.shipmentNumber}
            </h1>
            {getStatusBadge(shipmentStatus)}
          </div>
          <p className="text-muted-foreground mt-1">
            PO: <Link href={`/purchase-orders/${po?.id}`}>
              <span className="text-primary hover:underline cursor-pointer" data-testid="link-po">
                {shipment.poNumber}
              </span>
            </Link>
            {po && ` • ${po.vendor}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Key Shipping Dates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Cargo Ready Date</p>
                  <p className="font-medium" data-testid="text-cargo-ready-date">{formatDate(shipment.cargoReadyDate)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">PTS Date</p>
                  <p className="font-medium" data-testid="text-pts">{formatDate(shipment.pts)}</p>
                  {shipment.ptsStatus && (
                    <Badge variant="outline" className="text-xs">{shipment.ptsStatus}</Badge>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">ETD</p>
                  <p className="font-medium" data-testid="text-etd">{formatDate(shipment.etd)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">ETA</p>
                  <p className="font-medium" data-testid="text-eta">{formatDate(shipment.eta)}</p>
                  {eta && !isAfter(now, eta) && (
                    <span className="text-xs text-muted-foreground">
                      ({differenceInDays(eta, now)} days away)
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Anchor className="h-4 w-4" />
                Vessel & Container Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Vessel Name</p>
                  <p className="font-medium" data-testid="text-vessel-name">{shipment.vesselName || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Voyage</p>
                  <p className="font-medium" data-testid="text-voyage">{shipment.vesselVoyage || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Container</p>
                  <p className="font-medium" data-testid="text-container">{shipment.containerNumber || "-"}</p>
                  {shipment.containerType && (
                    <Badge variant="outline" className="text-xs">{shipment.containerType}</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Routing Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Port of Loading</p>
                  <p className="font-medium" data-testid="text-port-loading">{shipment.portOfLoading || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Port of Discharge</p>
                  <p className="font-medium" data-testid="text-port-discharge">{shipment.portOfDischarge || "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Delivery to Consolidator</p>
                  <p className="font-medium" data-testid="text-consolidator">{formatDate(shipment.deliveryToConsolidator)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Final Destination</p>
                  <p className="font-medium" data-testid="text-destination">{shipment.finalDestination || "-"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <AIEmailSummaryPanel
            entityType="shipment"
            entityId={shipmentId}
            poNumber={data?.po?.poNumber}
            testIdPrefix="shipment-ai-summary"
          />
        </div>

        <div className="space-y-6">
          {po && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Purchase Order
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">PO Number</span>
                  <Link href={`/purchase-orders/${po.id}`}>
                    <span className="text-sm text-primary hover:underline cursor-pointer" data-testid="link-po-detail">
                      {po.poNumber}
                    </span>
                  </Link>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Vendor</span>
                  <span className="text-sm font-medium">{po.vendor}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge variant="outline">{po.status}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Merchandiser</span>
                  <span className="text-sm">{po.buyer || "-"}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Order Value</span>
                  <span className="text-sm font-medium">{formatCurrency(po.totalValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Quantity</span>
                  <span className="text-sm">{po.orderQuantity?.toLocaleString() || "-"}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* SKU Line Items for this PO */}
          {allShipments && allShipments.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  SKU Line Items ({allShipments.filter(s => s.style).length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <div className="space-y-2">
                    {allShipments
                      .filter(s => s.style) // Only show rows with a style/SKU
                      .map((s) => (
                        <div key={s.id} className="p-3 rounded-md border bg-muted/30" data-testid={`line-item-${s.id}`}>
                          <div className="flex justify-between items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <Link href={`/skus?search=${s.style}`}>
                                <span className="text-sm font-medium text-primary hover:underline cursor-pointer" data-testid={`link-sku-${s.style}`}>
                                  SKU: {s.style}
                                </span>
                              </Link>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                                <span>Qty: {s.qtyShipped?.toLocaleString() || 0}</span>
                                <span>Value: {formatCurrency(s.shippedValue || 0)}</span>
                              </div>
                            </div>
                            <Badge variant={s.hodStatus === 'Shipped' ? 'outline' : s.hodStatus === 'Late' ? 'destructive' : 'secondary'} className="text-xs shrink-0">
                              {s.hodStatus || 'Pending'}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                            {s.cargoReadyDate && <span>CRD: {formatDate(s.cargoReadyDate)}</span>}
                            {s.deliveryToConsolidator && <span>Delivered: {formatDate(s.deliveryToConsolidator)}</span>}
                          </div>
                        </div>
                      ))}
                    {allShipments.filter(s => s.style).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No SKU line items found</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Status Tracking
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">HOD Status</span>
                <Badge variant={shipment.hodStatus === 'On-Time' ? 'outline' : 'secondary'}>
                  {shipment.hodStatus || "Pending"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Logistic Status</span>
                <Badge variant="outline">{shipment.logisticStatus || "Pending"}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">PTS Status</span>
                <Badge variant="outline">{shipment.ptsStatus || "Pending"}</Badge>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
