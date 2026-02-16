import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { ArrowLeft, FileText, Calendar, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ActivityLogSection } from "@/components/ActivityLogSection";
import { POTimelinePanel } from "@/components/POTimelinePanel";
import { POTasksPanel } from "@/components/POTasksPanel";

interface Timeline {
  id: number;
  milestone: string;
  plannedDate: Date | null;
  actualDate: Date | null;
  status: string;
}

interface LineItem {
  id: number;
  poHeaderId: number;
  poNumber: string;
  lineSequence: number;
  sku: string | null;
  style: string | null;
  sellerStyle: string | null;
  newSku: string | null;
  newStyle: string | null;
  bigBets: string | null;
  cbxItem: string | null;
  orderQuantity: number;
  balanceQuantity: number | null;
  unitPrice: number;
  lineTotal: number;
}

interface Shipment {
  id: number;
  poId: number | null;
  poNumber: string;
  lineItemId: string | null;
  style: string | null;
  qtyShipped: number;
  shippedValue: number;
  actualSailingDate: Date | null;
  eta: Date | null;
  deliveryToConsolidator: Date | null;
  actualPortOfLoading: string | null;
  actualShipMode: string | null;
  vesselFlight: string | null;
  poe: string | null;
  cargoReadyDate: Date | null;
  loadType: string | null;
  ptsNumber: string | null;
  logisticStatus: string | null;
  lateReasonCode: string | null;
  hodStatus: string | null;
  soFirstSubmissionDate: Date | null;
  ptsStatus: string | null;
  cargoReceiptStatus: string | null;
}

interface PurchaseOrderDetail {
  id: number;
  poNumber: string;
  copNumber: string | null;
  vendor: string | null;
  vendorId: number | null;
  buyer: string | null;
  merchandiser: string | null;
  merchandisingManager: string | null;
  client: string | null;
  clientDivision: string | null;
  factory: string | null;
  sku: string | null;
  style: string | null;
  sellerStyle: string | null;
  productGroup: string | null;
  productCategory: string | null;
  season: string | null;
  office: string | null;
  status: string;
  shipmentStatus: string | null;
  poDate: Date | null;
  originalShipDate: Date | null;
  originalCancelDate: Date | null;
  revisedShipDate: Date | null;
  revisedCancelDate: Date | null;
  revisedReason: string | null;
  revisedBy: string | null;
  orderQuantity: number;
  balanceQuantity: number | null;
  unitPrice: number;
  totalValue: number;
  programDescription: string | null;
  // PTS data from po_headers (OS650)
  ptsNumber: string | null;
  ptsDate: Date | null;
  ptsStatus: string | null;
  logisticStatus: string | null;
  // Inspection dates (estimated from cancel dates, actual from OS 630)
  estimatedInlineDate: Date | null;
  estimatedFinalDate: Date | null;
  actualInlineDate: Date | null;
  actualFinalDate: Date | null;
  inlineResult: string | null;
  finalResult: string | null;
  timelines: Timeline[];
  lineItems: LineItem[];
  shipments: Shipment[];
}

export default function PurchaseOrderDetail() {
  const [, params] = useRoute("/purchase-orders/:id");
  const poId = params?.id;
  const goBack = useBackNavigation("/purchase-orders");

  const { data: po, isLoading } = useQuery<PurchaseOrderDetail>({
    queryKey: ["/api/purchase-orders", poId],
    enabled: !!poId,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!po) {
    return (
      <div className="text-center py-12">
        <h2 className="text-2xl font-semibold mb-2">Purchase Order Not Found</h2>
        <p className="text-muted-foreground mb-4">The requested purchase order could not be found.</p>
        <Button variant="outline" data-testid="button-back-to-pos" onClick={goBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value / 100); // Assuming values stored in cents
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "-";
    return format(new Date(date), "MM/dd/yyyy");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" data-testid="button-back" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-po-number">
              PO {po.poNumber}
            </h1>
            <p className="text-muted-foreground">
              {po.vendor} {po.copNumber && `• COP ${po.copNumber}`}
            </p>
          </div>
        </div>
        <Badge variant={(po.status === "Shipped" || po.status === "Closed") ? "default" : "outline"} data-testid="badge-status">
          {(po.status === "Shipped" || po.status === "Closed") ? "Handed Over" : po.status}
        </Badge>
      </div>

      {/* Tabs for Details and Timeline */}
      <Tabs defaultValue="details" className="w-full">
        <TabsList className="mb-4" data-testid="tabs-list">
          <TabsTrigger value="details" className="flex items-center gap-2" data-testid="tab-details">
            <FileText className="h-4 w-4" />
            Details
          </TabsTrigger>
          <TabsTrigger value="timeline" className="flex items-center gap-2" data-testid="tab-timeline">
            <Calendar className="h-4 w-4" />
            Shipment Timeline
          </TabsTrigger>
          <TabsTrigger value="tasks" className="flex items-center gap-2" data-testid="tab-tasks">
            <ClipboardList className="h-4 w-4" />
            Tasks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Client:</span>
              <span className="font-medium" data-testid="text-client">{po.client || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Division:</span>
              <span className="font-medium" data-testid="text-client-division">{po.clientDivision || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vendor:</span>
              <span className="font-medium" data-testid="text-vendor">{po.vendor || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Merchandiser:</span>
              <span className="font-medium" data-testid="text-merchandiser">{po.merchandiser || po.buyer || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Office:</span>
              <span className="font-medium" data-testid="text-office">{po.office || "-"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">PO Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">PO Number:</span>
              <span className="font-medium" data-testid="text-po-number-info">{po.poNumber || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">PO Date:</span>
              <span className="font-medium" data-testid="text-po-date">{formatDate(po.poDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Category:</span>
              <span className="font-medium" data-testid="text-category">{po.productCategory || po.productGroup || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Season:</span>
              <span className="font-medium" data-testid="text-season">{po.season || "-"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Status:</span>
              <Badge variant="outline" data-testid="text-po-status">{po.status || "-"}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Ship Status:</span>
              <Badge 
                variant={po.shipmentStatus === "On-Time" ? "default" : po.shipmentStatus === "Late" ? "destructive" : "outline"}
                data-testid="text-ship-status"
              >
                {po.shipmentStatus || "Pending"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">PTS Number:</span>
              <span className="font-medium" data-testid="text-pts-number">
                {po.ptsNumber || po.shipments?.find(s => s.ptsNumber)?.ptsNumber || "-"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Logistic Status:</span>
              <span className="font-medium" data-testid="text-logistic-status">
                {po.logisticStatus || "-"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Key Dates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Original Ship Date:</span>
              <span className="text-muted-foreground" data-testid="text-orig-ship-date">{formatDate(po.originalShipDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Original Cancel Date:</span>
              <span className="text-muted-foreground" data-testid="text-orig-cancel-date">{formatDate(po.originalCancelDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Revised Ship Date:</span>
              <span className="font-medium" data-testid="text-ship-date">{formatDate(po.revisedShipDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Revised Cancel Date:</span>
              <span className="font-medium" data-testid="text-cancel-date">{formatDate(po.revisedCancelDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Actual Ship Date:</span>
              <span className="font-medium" data-testid="text-actual-ship-date">
                {(() => {
                  // Get earliest actual ship date from shipments (delivery_to_consolidator or actual_sailing_date)
                  const actualShipDates = po.shipments
                    ?.map(s => s.deliveryToConsolidator || s.actualSailingDate)
                    .filter(Boolean)
                    .map(d => new Date(d as string | Date))
                    .sort((a, b) => a.getTime() - b.getTime());
                  return actualShipDates?.length ? formatDate(actualShipDates[0]) : '-';
                })()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">PTS Date:</span>
              <span className="font-medium" data-testid="text-pts-date">
                {(() => {
                  // Check po_headers first, then fall back to shipments
                  const ptsDate = po.ptsDate || po.shipments?.find(s => s.soFirstSubmissionDate)?.soFirstSubmissionDate;
                  return ptsDate ? formatDate(ptsDate) : '-';
                })()}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PO Line Items - from OS340 data (SKU breakdown) */}
      {po.lineItems && po.lineItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>SKU Line Items</CardTitle>
            <CardDescription>Product breakdown for this purchase order</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-semibold">SKU / Style</th>
                    <th className="text-left py-2 px-3 font-semibold">Description</th>
                    <th className="text-right py-2 px-3 font-semibold">Quantity</th>
                    <th className="text-right py-2 px-3 font-semibold">Unit Price</th>
                    <th className="text-right py-2 px-3 font-semibold">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lineItems.map((item: LineItem, index: number) => {
                    const displaySku = item.sku || item.style || "-";
                    // sellerStyle contains the product description from OS340
                    const description = item.sellerStyle || po.productCategory || "-";
                    const qty = item.orderQuantity || 0;
                    const unitPrice = item.unitPrice || 0;
                    const lineTotal = item.lineTotal || (qty * unitPrice);
                    
                    return (
                      <tr key={item.id} className="border-b" data-testid={`row-line-item-${index}`}>
                        <td className="py-2 px-3" data-testid={`text-line-sku-${index}`}>
                          {displaySku !== "-" ? (
                            <Link 
                              href={`/sku-summary/${encodeURIComponent(displaySku)}`}
                              className="font-medium text-primary hover:underline"
                              data-testid={`link-sku-${index}`}
                            >
                              {displaySku}
                            </Link>
                          ) : (
                            <div className="font-medium">{displaySku}</div>
                          )}
                          {item.style && item.style !== displaySku && (
                            <div className="text-xs text-muted-foreground">Style: {item.style}</div>
                          )}
                        </td>
                        <td className="py-2 px-3" data-testid={`text-line-program-${index}`}>
                          <div>{description}</div>
                        </td>
                        <td className="text-right py-2 px-3" data-testid={`text-line-qty-${index}`}>
                          {qty.toLocaleString()}
                        </td>
                        <td className="text-right py-2 px-3" data-testid={`text-line-unit-price-${index}`}>
                          {formatCurrency(unitPrice)}
                        </td>
                        <td className="text-right py-2 px-3 font-medium" data-testid={`text-line-total-${index}`}>
                          {formatCurrency(lineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/50">
                  <tr className="border-t-2">
                    <td colSpan={4} className="py-3 px-3 text-right font-semibold">
                      Order Total:
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-lg" data-testid="text-order-total">
                      {formatCurrency(po.lineItems.reduce((sum: number, item: LineItem) => sum + (item.lineTotal || (item.orderQuantity || 0) * (item.unitPrice || 0)), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dates & Revisions */}
      <Card>
        <CardHeader>
          <CardTitle>Dates & Revisions</CardTitle>
          <CardDescription>Shipment timeline and date changes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Original Dates</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ship Date:</span>
                  <span data-testid="text-original-ship-date">{formatDate(po.originalShipDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cancel Date:</span>
                  <span data-testid="text-original-cancel-date">{formatDate(po.originalCancelDate)}</span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Revised Dates</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ship Date:</span>
                  <span className="font-medium" data-testid="text-revised-ship-date">{formatDate(po.revisedShipDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cancel Date:</span>
                  <span className="font-medium" data-testid="text-revised-cancel-date">{formatDate(po.revisedCancelDate)}</span>
                </div>
                {po.revisedReason && (
                  <div className="pt-2 border-t">
                    <div className="text-muted-foreground mb-1">Reason for Revision:</div>
                    <div className="font-medium" data-testid="text-revised-reason">{po.revisedReason}</div>
                    {po.revisedBy && (
                      <div className="text-xs text-muted-foreground mt-1">Revised by: {po.revisedBy}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Inspection Dates Section */}
          <div className="border-t mt-6 pt-6">
            <h3 className="font-semibold text-sm mb-4">Inspection Dates</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="text-sm text-muted-foreground">Estimated (Based on Cancel Date)</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Inline Inspection:</span>
                    <span data-testid="text-estimated-inline-date">{formatDate(po.estimatedInlineDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Final Inspection:</span>
                    <span data-testid="text-estimated-final-date">{formatDate(po.estimatedFinalDate)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm text-muted-foreground">Actual (From OS 630)</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Inline Inspection:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium" data-testid="text-actual-inline-date">{formatDate(po.actualInlineDate)}</span>
                      {po.inlineResult && (
                        <Badge 
                          variant={po.inlineResult.toLowerCase().includes('pass') ? 'default' : 'destructive'}
                          className="text-xs"
                          data-testid="badge-inline-result"
                        >
                          {po.inlineResult}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Final Inspection:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium" data-testid="text-actual-final-date">{formatDate(po.actualFinalDate)}</span>
                      {po.finalResult && (
                        <Badge 
                          variant={po.finalResult.toLowerCase().includes('pass') ? 'default' : 'destructive'}
                          className="text-xs"
                          data-testid="badge-final-result"
                        >
                          {po.finalResult}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shipments & Logistics */}
      {po.shipments && po.shipments.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Shipments & Logistics</h2>
            <Badge variant="outline" data-testid="badge-shipment-count">
              {po.shipments.length} {po.shipments.length === 1 ? 'shipment' : 'shipments'}
            </Badge>
          </div>
          
          <div className="grid grid-cols-1 gap-4">
            {po.shipments.map((shipment, index) => (
              <Card key={shipment.id} data-testid={`card-shipment-${index}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">
                        {shipment.lineItemId ? `Line Item: ${shipment.lineItemId}` : `Shipment ${index + 1}`}
                      </CardTitle>
                      {shipment.logisticStatus && (
                        <Badge 
                          variant={shipment.logisticStatus === "Shipped" ? "default" : "secondary"}
                          data-testid={`badge-logistic-status-${index}`}
                        >
                          {shipment.logisticStatus}
                        </Badge>
                      )}
                      {shipment.hodStatus && (
                        <Badge variant="outline" data-testid={`badge-hod-status-${index}`}>
                          HOD: {shipment.hodStatus}
                        </Badge>
                      )}
                    </div>
                    <div className="text-right">
                      {shipment.qtyShipped > 0 && (
                        <div className="text-sm font-medium" data-testid={`text-shipment-qty-${index}`}>
                          {shipment.qtyShipped.toLocaleString()} units
                        </div>
                      )}
                      {shipment.shippedValue > 0 && (
                        <div className="text-xs text-muted-foreground" data-testid={`text-shipment-value-${index}`}>
                          {formatCurrency(shipment.shippedValue)}
                        </div>
                      )}
                    </div>
                  </div>
                  {shipment.style && (
                    <CardDescription>Style: {shipment.style}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                    {shipment.loadType && (
                      <div>
                        <span className="text-muted-foreground">Load Type:</span>
                        <span className="ml-2 font-medium" data-testid={`text-load-type-${index}`}>{shipment.loadType}</span>
                      </div>
                    )}
                    {shipment.ptsNumber && (
                      <div>
                        <span className="text-muted-foreground">PTS Number:</span>
                        <span className="ml-2 font-medium" data-testid={`text-pts-number-${index}`}>{shipment.ptsNumber}</span>
                      </div>
                    )}
                    {shipment.soFirstSubmissionDate && (
                      <div>
                        <span className="text-muted-foreground">PTS Date:</span>
                        <span className="ml-2 font-medium" data-testid={`text-pts-date-${index}`}>{formatDate(shipment.soFirstSubmissionDate)}</span>
                      </div>
                    )}
                    {shipment.ptsStatus && (
                      <div>
                        <span className="text-muted-foreground">PTS Status:</span>
                        <span className="ml-2 font-medium" data-testid={`text-pts-status-${index}`}>{shipment.ptsStatus}</span>
                      </div>
                    )}
                    {shipment.cargoReceiptStatus && (
                      <div>
                        <span className="text-muted-foreground">Cargo Receipt:</span>
                        <span className="ml-2 font-medium" data-testid={`text-cargo-receipt-${index}`}>{shipment.cargoReceiptStatus}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm pt-2 border-t">
                    {shipment.cargoReadyDate && (
                      <div>
                        <span className="text-muted-foreground">Cargo Ready:</span>
                        <span className="ml-2 font-medium" data-testid={`text-cargo-ready-${index}`}>{formatDate(shipment.cargoReadyDate)}</span>
                      </div>
                    )}
                    {shipment.actualSailingDate && (
                      <div>
                        <span className="text-muted-foreground">Sailing Date:</span>
                        <span className="ml-2 font-medium" data-testid={`text-sailing-date-${index}`}>{formatDate(shipment.actualSailingDate)}</span>
                      </div>
                    )}
                    {shipment.eta && (
                      <div>
                        <span className="text-muted-foreground">ETA:</span>
                        <span className="ml-2 font-medium" data-testid={`text-eta-${index}`}>{formatDate(shipment.eta)}</span>
                      </div>
                    )}
                    {shipment.deliveryToConsolidator && (
                      <div>
                        <span className="text-muted-foreground">Delivered:</span>
                        <span className="ml-2 font-medium" data-testid={`text-delivered-${index}`}>{formatDate(shipment.deliveryToConsolidator)}</span>
                      </div>
                    )}
                    {shipment.soFirstSubmissionDate && (
                      <div>
                        <span className="text-muted-foreground">SO Submitted:</span>
                        <span className="ml-2 font-medium" data-testid={`text-so-submitted-${index}`}>{formatDate(shipment.soFirstSubmissionDate)}</span>
                      </div>
                    )}
                  </div>

                  {(shipment.vesselFlight || shipment.actualPortOfLoading || shipment.poe || shipment.actualShipMode) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm pt-2 border-t">
                      {shipment.vesselFlight && (
                        <div>
                          <span className="text-muted-foreground">Vessel/Flight:</span>
                          <span className="ml-2 font-medium" data-testid={`text-vessel-${index}`}>{shipment.vesselFlight}</span>
                        </div>
                      )}
                      {shipment.actualShipMode && (
                        <div>
                          <span className="text-muted-foreground">Ship Mode:</span>
                          <span className="ml-2 font-medium" data-testid={`text-ship-mode-${index}`}>{shipment.actualShipMode}</span>
                        </div>
                      )}
                      {shipment.actualPortOfLoading && (
                        <div>
                          <span className="text-muted-foreground">Port of Loading:</span>
                          <span className="ml-2 font-medium" data-testid={`text-port-loading-${index}`}>{shipment.actualPortOfLoading}</span>
                        </div>
                      )}
                      {shipment.poe && (
                        <div>
                          <span className="text-muted-foreground">POE:</span>
                          <span className="ml-2 font-medium" data-testid={`text-poe-${index}`}>{shipment.poe}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {shipment.lateReasonCode && (
                    <div className="pt-2 border-t">
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground text-sm">Late Reason:</span>
                        <span className="text-sm font-medium text-amber-600" data-testid={`text-late-reason-${index}`}>
                          {shipment.lateReasonCode}
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Activity Log Section */}
      <ActivityLogSection 
        entityType="po" 
        entityId={po.poNumber} 
        title="Activity Log & Notes"
      />
        </TabsContent>

        <TabsContent value="timeline" className="space-y-6">
          <POTimelinePanel 
            poId={po.id}
            poNumber={po.poNumber}
            vendorId={po.vendorId}
            poDate={po.poDate ? String(po.poDate) : null}
          />
          
          {/* Activity Log for Timeline context */}
          <ActivityLogSection 
            entityType="po" 
            entityId={po.poNumber} 
            title="Timeline Notes"
          />
        </TabsContent>

        <TabsContent value="tasks" className="space-y-6">
          <POTasksPanel poNumber={po.poNumber} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
