import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertCircle, Plus, Link2, Ban, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from "lucide-react";

interface RowDetail {
  sku: string;
  skuDescription: string;
  brand: string;
  collection: string;
  year: number | null;
  month: number | null;
  projectionValue: number;
  orderType: string;
  skuExists: boolean;
  vendorExists: boolean;
}

interface UnknownVendor {
  key: string;
  vendorCode: string;
  vendorName: string;
  rowCount: number;
  totalValue: number;
  rowDetails?: RowDetail[];
}

interface ExistingVendor {
  id: number;
  name: string;
  cbhVendorCode?: string;
}

interface VendorDecision {
  action: 'createNew' | 'mapToExisting' | 'skip';
  vendorId?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  unknownVendors: UnknownVendor[];
  existingVendors: ExistingVendor[];
  pendingImportId: string;
  onComplete: (decisions: Record<string, VendorDecision>) => void;
  isSubmitting?: boolean;
}

export function UnknownVendorReviewModal({
  isOpen,
  onClose,
  unknownVendors,
  existingVendors,
  pendingImportId,
  onComplete,
  isSubmitting = false
}: Props) {
  const [decisions, setDecisions] = useState<Record<string, VendorDecision>>(() => {
    const initial: Record<string, VendorDecision> = {};
    unknownVendors.forEach(v => {
      initial[v.key] = { action: 'createNew' };
    });
    return initial;
  });

  const handleActionChange = (key: string, action: 'createNew' | 'mapToExisting' | 'skip') => {
    setDecisions(prev => ({
      ...prev,
      [key]: { action, vendorId: action === 'mapToExisting' ? prev[key]?.vendorId : undefined }
    }));
  };

  const handleVendorSelect = (key: string, vendorId: number) => {
    setDecisions(prev => ({
      ...prev,
      [key]: { action: 'mapToExisting', vendorId }
    }));
  };

  const handleSubmit = () => {
    onComplete(decisions);
  };

  // Check if all decisions are valid (mapToExisting must have vendorId)
  const hasInvalidDecisions = unknownVendors.some(vendor => {
    const decision = decisions[vendor.key];
    return decision?.action === 'mapToExisting' && !decision?.vendorId;
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const totalRows = unknownVendors.reduce((sum, v) => sum + v.rowCount, 0);
  const totalValue = unknownVendors.reduce((sum, v) => sum + v.totalValue, 0);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Unknown Vendors Found
          </DialogTitle>
          <DialogDescription>
            {unknownVendors.length} vendor(s) were not found in the system. 
            Please decide how to handle each one before completing the import.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/50 rounded-md p-3 mb-4">
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Total rows affected:</span>{" "}
              <span className="font-medium">{totalRows.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total value:</span>{" "}
              <span className="font-medium">{formatCurrency(totalValue)}</span>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {unknownVendors.map((vendor) => {
              const rowDetails = vendor.rowDetails || [];
              const hasRowDetails = rowDetails.length > 0;
              const unmatchedSkuCount = rowDetails.filter(r => !r.skuExists).length;
              
              return (
              <div key={vendor.key} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium">{vendor.vendorName || 'Unknown'}</h4>
                    {vendor.vendorCode && (
                      <p className="text-sm text-muted-foreground">Code: {vendor.vendorCode}</p>
                    )}
                    <div className="flex gap-2 mt-1">
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        No Matching Vendor
                      </Badge>
                      {unmatchedSkuCount > 0 && (
                        <Badge variant="outline" className="text-xs border-amber-500 text-amber-600">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {unmatchedSkuCount} SKU(s) not found
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary">{vendor.rowCount} rows</Badge>
                    <p className="text-sm font-medium mt-1">{formatCurrency(vendor.totalValue)}</p>
                  </div>
                </div>
                
                {hasRowDetails && (
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" data-testid={`toggle-details-${vendor.key}`}>
                        <ChevronRight className="h-4 w-4 mr-1 transition-transform [[data-state=open]_&]:rotate-90" />
                        View {rowDetails.length} projection record(s)
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 border rounded-md overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left p-2 font-medium">SKU</th>
                              <th className="text-left p-2 font-medium">Description</th>
                              <th className="text-left p-2 font-medium">Brand</th>
                              <th className="text-left p-2 font-medium">Period</th>
                              <th className="text-right p-2 font-medium">Value</th>
                              <th className="text-center p-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rowDetails.map((row, idx) => (
                              <tr key={idx} className="border-t">
                                <td className="p-2 font-mono">{row.sku}</td>
                                <td className="p-2 max-w-[150px] truncate" title={row.skuDescription}>{row.skuDescription}</td>
                                <td className="p-2">{row.brand}</td>
                                <td className="p-2">{row.year}/{String(row.month).padStart(2, '0')}</td>
                                <td className="p-2 text-right">{formatCurrency(row.projectionValue)}</td>
                                <td className="p-2 text-center">
                                  {row.skuExists ? (
                                    <span title="SKU exists in system">
                                      <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                                    </span>
                                  ) : (
                                    <span title="SKU not found in system">
                                      <AlertTriangle className="h-4 w-4 text-amber-500 inline" />
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                <RadioGroup
                  value={decisions[vendor.key]?.action || 'createNew'}
                  onValueChange={(value) => handleActionChange(vendor.key, value as 'createNew' | 'mapToExisting' | 'skip')}
                  className="flex flex-col gap-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="createNew" id={`${vendor.key}-create`} data-testid={`radio-create-${vendor.key}`} />
                    <Label htmlFor={`${vendor.key}-create`} className="flex items-center gap-2 cursor-pointer">
                      <Plus className="h-4 w-4 text-green-600" />
                      Create as new vendor
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="mapToExisting" id={`${vendor.key}-map`} data-testid={`radio-map-${vendor.key}`} />
                    <Label htmlFor={`${vendor.key}-map`} className="flex items-center gap-2 cursor-pointer">
                      <Link2 className="h-4 w-4 text-blue-600" />
                      Map to existing vendor
                    </Label>
                  </div>

                  {decisions[vendor.key]?.action === 'mapToExisting' && (
                    <div className="ml-6">
                      <Select
                        value={decisions[vendor.key]?.vendorId?.toString() || ''}
                        onValueChange={(value) => handleVendorSelect(vendor.key, parseInt(value))}
                      >
                        <SelectTrigger className="w-full" data-testid={`select-vendor-${vendor.key}`}>
                          <SelectValue placeholder="Select a vendor..." />
                        </SelectTrigger>
                        <SelectContent>
                          {existingVendors.map((v) => (
                            <SelectItem key={v.id} value={v.id.toString()}>
                              {v.name} {v.cbhVendorCode && `(${v.cbhVendorCode})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="skip" id={`${vendor.key}-skip`} data-testid={`radio-skip-${vendor.key}`} />
                    <Label htmlFor={`${vendor.key}-skip`} className="flex items-center gap-2 cursor-pointer text-muted-foreground">
                      <Ban className="h-4 w-4" />
                      Don't import these records
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-4 gap-2 flex-col items-stretch sm:flex-row">
          {hasInvalidDecisions && (
            <p className="text-sm text-destructive flex-1">
              Please select an existing vendor for all "Map to existing" choices
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting} data-testid="button-cancel-review">
              Cancel Import
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || hasInvalidDecisions} data-testid="button-complete-import">
              {isSubmitting ? "Processing..." : "Complete Import"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
