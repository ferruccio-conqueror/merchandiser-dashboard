import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUploadZone } from "@/components/FileUploadZone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertCircle, Download, FileSpreadsheet, Loader2, Upload, Database, Shield } from "lucide-react";
import { HelpButton } from "@/components/HelpButton";
import { DataTable } from "@/components/DataTable";
import { UnknownVendorReviewModal } from "@/components/UnknownVendorReviewModal";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { ImportHistory, Client } from "@shared/schema";

interface VendorReviewData {
  pendingImportId: string;
  unknownVendors: Array<{
    key: string;
    vendorCode: string;
    vendorName: string;
    rowCount: number;
    totalValue: number;
    rowDetails?: Array<{
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
    }>;
  }>;
  existingVendors: Array<{
    id: number;
    name: string;
    cbhVendorCode?: string;
  }>;
}

// LocalStorage key for persisting import state
const IMPORT_STATE_KEY = 'erp_import_state';

interface PersistedImportState {
  uploadProgress: number;
  progressMessage: string;
  fileName: string | null;
  vendorReviewData: VendorReviewData | null;
  startedAt: number;
}

export default function Import() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [vendorReviewData, setVendorReviewData] = useState<VendorReviewData | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const { toast } = useToast();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const queryClient = useQueryClient();

  const { data: importHistory = [], isLoading: historyLoading } = useQuery<ImportHistory[]>({
    queryKey: ["/api/import-history"],
  });

  // Fetch user's assigned clients for FURNITURE import
  const { data: userClients = [] } = useQuery<Client[]>({
    queryKey: ["/api/users/me/clients"],
  });
  
  // Check if selected file is a FURNITURE projection file
  const isFurnitureFile = selectedFile && /FURNITURE|HOME-?GOODS/i.test(selectedFile.name);

  // Persist import state to localStorage
  const persistState = (state: Partial<PersistedImportState>) => {
    try {
      const existing = localStorage.getItem(IMPORT_STATE_KEY);
      const current = existing ? JSON.parse(existing) : {};
      localStorage.setItem(IMPORT_STATE_KEY, JSON.stringify({ ...current, ...state }));
    } catch (e) {
      console.error('Failed to persist import state:', e);
    }
  };

  // Clear persisted state
  const clearPersistedState = () => {
    try {
      localStorage.removeItem(IMPORT_STATE_KEY);
    } catch (e) {
      console.error('Failed to clear import state:', e);
    }
  };

  // Restore state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(IMPORT_STATE_KEY);
      if (saved) {
        const state: PersistedImportState = JSON.parse(saved);
        
        // Check if the saved state is still valid (less than 30 minutes old for in-progress imports)
        const ageMinutes = (Date.now() - state.startedAt) / 60000;
        
        // If there's vendor review data, restore it regardless of age
        if (state.vendorReviewData) {
          setVendorReviewData(state.vendorReviewData);
          setUploadProgress(state.uploadProgress || 100);
          setProgressMessage(state.progressMessage || "Waiting for vendor review...");
        } 
        // If import was in progress and is less than 30 min old, show a notice
        else if (state.uploadProgress > 0 && state.uploadProgress < 100 && ageMinutes < 30) {
          setProgressMessage(`Previous import may still be processing. Check import history for results.`);
          setUploadProgress(0);
          // Clear the stale progress state but keep the notice
          clearPersistedState();
        }
        // If progress was 100% (complete), just clear the old state
        else if (state.uploadProgress === 100 || ageMinutes >= 30) {
          clearPersistedState();
        }
      }
    } catch (e) {
      console.error('Failed to restore import state:', e);
    }
  }, []);

  // Timer for elapsed time during import
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      // Auto-detect file type based on filename
      const isOS340 = /OS\s?340/i.test(file.name);
      const isOS630 = /OS\s?630/i.test(file.name);
      const isOS650 = /OS\s?650/i.test(file.name);
      const isSS551 = /SS\s?551|capacity\s*tracker/i.test(file.name);
      const isFurniture = /FURNITURE|HOME-?GOODS/i.test(file.name);
      
      // Add client_id for FURNITURE imports
      if (isFurniture && selectedClientId) {
        formData.append("clientId", selectedClientId);
      }
      
      const endpoint = isFurniture
        ? "/api/import/furniture-projections"
        : isSS551
        ? "/api/vendor-capacity/import"
        : isOS630 
        ? "/api/import/quality-data" 
        : isOS650 
        ? "/api/import/shipments" 
        : "/api/import/purchase-orders";

      // Large imports need extended timeout and show progress
      const isLargeImport = isOS630 || isOS340 || isOS650 || isFurniture;
      const timeoutMs = isOS340 ? 30 * 60 * 1000 : isLargeImport ? 15 * 60 * 1000 : 5 * 60 * 1000;

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Start progress animation and timer
      setUploadProgress(5);
      setElapsedTime(0);
      setProgressMessage("Uploading file...");
      
      // Persist import state for navigation recovery
      persistState({
        uploadProgress: 5,
        progressMessage: "Uploading file...",
        fileName: file.name,
        vendorReviewData: null,
        startedAt: Date.now()
      });
      
      // Start elapsed time counter for all imports
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);

      // Progress interval to slowly increment during server processing
      let progressIntervalId: NodeJS.Timeout | null = null;
      let currentProgress = 5;

      try {
        // Initial upload progress
        setTimeout(() => {
          setUploadProgress(15);
          setProgressMessage("Processing file headers...");
        }, 500);
        
        setTimeout(() => {
          setUploadProgress(25);
          setProgressMessage("Parsing data rows...");
        }, 1500);

        setTimeout(() => {
          setUploadProgress(35);
          const fileTypeLabel = isFurniture ? "projections" : isOS340 ? "purchase orders" : isOS630 ? "quality records" : isOS650 ? "shipments" : "records";
          setProgressMessage(`Importing ${fileTypeLabel}...`);
          currentProgress = 35;
          
          // Start slow progress increment (from 35% to 85% over ~3 minutes)
          progressIntervalId = setInterval(() => {
            if (currentProgress < 85) {
              currentProgress += 0.5;
              setUploadProgress(Math.round(currentProgress));
              
              // Update message based on progress
              if (currentProgress > 50 && currentProgress <= 60) {
                setProgressMessage("Processing database updates...");
              } else if (currentProgress > 60 && currentProgress <= 70) {
                setProgressMessage("Saving records to database...");
              } else if (currentProgress > 70 && currentProgress <= 80) {
                setProgressMessage("Finalizing import...");
              } else if (currentProgress > 80) {
                setProgressMessage("Almost done...");
              }
            }
          }, 2000); // Increment every 2 seconds
        }, 3000);

        const response = await fetch(endpoint, {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });

        // Clear all timers
        clearTimeout(timeoutId);
        if (progressIntervalId) {
          clearInterval(progressIntervalId);
        }
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        setUploadProgress(95);
        setProgressMessage("Processing response...");

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Upload failed");
        }

        setUploadProgress(100);
        setProgressMessage("Import complete!");
        const result = await response.json();
        
        // Check if the response requires vendor review
        if (result.needsReview && result.unknownVendors) {
          const reviewData = {
            pendingImportId: result.pendingImportId,
            unknownVendors: result.unknownVendors,
            existingVendors: result.existingVendors || []
          };
          setVendorReviewData(reviewData);
          setProgressMessage("Waiting for vendor review...");
          
          // Persist vendor review state for navigation recovery
          persistState({
            uploadProgress: 100,
            progressMessage: "Waiting for vendor review...",
            vendorReviewData: reviewData,
            startedAt: Date.now()
          });
          
          // Don't return the result as success yet - we need user action
          return { needsReview: true, ...result };
        }
        
        return result;
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (progressIntervalId) {
          clearInterval(progressIntervalId);
        }
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        if (error.name === 'AbortError') {
          throw new Error(`TIMEOUT: Import timed out after ${timeoutMs / 60000} minutes. The file is likely still processing on the server. Click "Check Import Status" below to verify when it completes.`);
        }
        if (error.message === 'Failed to fetch' || error.message === 'NetworkError when attempting to fetch resource.' || error.message === 'Load failed') {
          throw new Error(`TIMEOUT: The connection was interrupted because this is a large file. The import is still running on the server. Click "Check Import Status" below to verify when it completes.`);
        }
        throw error;
      }
    },
    onSuccess: (data: any) => {
      // If needsReview is true, don't reset state - wait for vendor review modal
      if (data?.needsReview) {
        return;
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/import-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/kpis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inspections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quality/kpis"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-capacity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendor-capacity/summaries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timelines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/po-tasks"] });
      setSelectedFile(null);
      setElapsedTime(0);
      
      // Clear persisted state on successful import
      clearPersistedState();
      
      setTimeout(() => {
        setUploadProgress(0);
        setProgressMessage("");
      }, 2000);
    },
    onError: () => {
      setUploadProgress(0);
      setProgressMessage("");
      setElapsedTime(0);
      
      // Clear persisted state on error
      clearPersistedState();
    },
  });

  // Mutation to complete pending import with vendor decisions
  const completeImportMutation = useMutation({
    mutationFn: async ({ pendingImportId, vendorDecisions }: { 
      pendingImportId: string; 
      vendorDecisions: Record<string, { action: string; vendorId?: number }> 
    }) => {
      const response = await fetch("/api/import/furniture-projections/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingImportId, vendorDecisions })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to complete import");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Import Completed",
        description: data.message || "Import completed successfully"
      });
      
      // Close the modal and reset state
      setVendorReviewData(null);
      setSelectedFile(null);
      setUploadProgress(0);
      setProgressMessage("");
      setElapsedTime(0);
      
      // Clear persisted state after successful vendor review completion
      clearPersistedState();
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["/api/import-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projections"] });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Import Failed",
        description: error.message
      });
    }
  });

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
  };

  const handleImport = () => {
    if (selectedFile) {
      importMutation.mutate(selectedFile);
    }
  };

  const handleVendorReviewComplete = (decisions: Record<string, { action: string; vendorId?: number }>) => {
    if (vendorReviewData) {
      completeImportMutation.mutate({
        pendingImportId: vendorReviewData.pendingImportId,
        vendorDecisions: decisions
      });
    }
  };

  const handleVendorReviewCancel = async () => {
    if (vendorReviewData) {
      // Cancel the pending import
      try {
        await fetch(`/api/import/furniture-projections/pending/${vendorReviewData.pendingImportId}`, {
          method: "DELETE"
        });
      } catch (e) {
        // Ignore errors on cancel
      }
    }
    setVendorReviewData(null);
    setSelectedFile(null);
    setUploadProgress(0);
    setProgressMessage("");
    setElapsedTime(0);
    
    // Clear persisted state on cancel
    clearPersistedState();
  };

  const historyColumns = [
    { 
      key: "fileName", 
      label: "File Name", 
      sortable: true,
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          <span>{value}</span>
        </div>
      ),
    },
    { key: "fileType", label: "Type", sortable: true },
    { key: "recordsImported", label: "Records", sortable: true },
    {
      key: "status",
      label: "Status",
      render: (value: string) => {
        const variant = value === "success" ? "default" : value === "partial" ? "secondary" : "destructive";
        const icon = value === "success" ? CheckCircle2 : AlertCircle;
        const Icon = icon;
        return (
          <Badge variant={variant} className="gap-1" data-testid={`badge-status-${value}`}>
            <Icon className="h-3 w-3" />
            {value}
          </Badge>
        );
      },
    },
    {
      key: "createdAt",
      label: "Uploaded",
      sortable: true,
      render: (value: Date) => format(new Date(value), "MM/dd/yyyy HH:mm"),
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-import-title">Import Data</h1>
          <p className="text-muted-foreground">Upload Excel or CSV files to import purchase orders, quality data (OS 630), shipment tracking (OS 650), or vendor capacity (SS 551)</p>
        </div>
        <HelpButton section="import" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">File Upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileUploadZone onFileSelect={handleFileSelect} />

          {selectedFile && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Ready to import: <strong>{selectedFile.name}</strong>
                </p>
              </div>
              
              {/* Client selector for FURNITURE/projection imports */}
              {isFurnitureFile && (
                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-md">
                  <Label htmlFor="client-select" className="text-sm font-medium whitespace-nowrap">
                    Import for Client:
                  </Label>
                  <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                    <SelectTrigger id="client-select" className="w-[280px]" data-testid="select-client">
                      <SelectValue placeholder="Select client..." />
                    </SelectTrigger>
                    <SelectContent>
                      {userClients.map((client) => (
                        <SelectItem key={client.id} value={String(client.id)} data-testid={`option-client-${client.id}`}>
                          {client.name} {client.code && `(${client.code})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!selectedClientId && (
                    <span className="text-xs text-amber-600">Please select a client before importing</span>
                  )}
                </div>
              )}
              
              <div className="flex justify-end">
                <Button 
                  onClick={handleImport} 
                  disabled={importMutation.isPending || (isFurnitureFile && !selectedClientId)}
                  data-testid="button-import"
                >
                  {importMutation.isPending ? "Importing..." : "Import Data"}
                </Button>
              </div>
            </div>
          )}

          {uploadProgress > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-2">
                  {uploadProgress < 100 && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span>{progressMessage || "Processing..."}</span>
                </div>
                <div className="flex items-center gap-3">
                  {elapsedTime > 0 && (
                    <span className="text-muted-foreground">
                      {Math.floor(elapsedTime / 60)}:{String(elapsedTime % 60).padStart(2, '0')}
                    </span>
                  )}
                  <span>{uploadProgress}%</span>
                </div>
              </div>
              <Progress value={uploadProgress} data-testid="progress-upload" />
              {elapsedTime > 5 && uploadProgress < 90 && (
                <p className="text-xs text-muted-foreground">
                  Large imports with 50,000+ records may take 2-3 minutes. Please wait...
                </p>
              )}
            </div>
          )}

          {importMutation.isSuccess && importMutation.data && (
            <Alert data-testid="alert-success">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                {importMutation.data.stats?.vendorsProcessed !== undefined ? (
                  // SS551 Vendor Capacity import
                  <>
                    {importMutation.data.message}
                    <ul className="list-disc pl-4 mt-2 text-sm">
                      <li>{importMutation.data.stats.vendorsProcessed} vendors processed</li>
                      <li>{importMutation.data.stats.totalRecords} capacity records imported</li>
                      <li>{importMutation.data.stats.summariesCreated} summary records created</li>
                    </ul>
                    {importMutation.data.stats.errors && importMutation.data.stats.errors.length > 0 && (
                      <div className="mt-2 text-xs text-amber-600">
                        <strong>Warnings:</strong>
                        <ul className="list-disc pl-4 mt-1">
                          {importMutation.data.stats.errors.slice(0, 3).map((error: string, i: number) => (
                            <li key={i}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : importMutation.data.recordsImported?.inspections !== undefined ? (
                  // OS 630 Quality Data import
                  <>
                    Successfully imported quality data from {importMutation.data.totalRows} rows:
                    <ul className="list-disc pl-4 mt-2 text-sm">
                      <li>{importMutation.data.recordsImported.inspections} inspection records</li>
                      <li>{importMutation.data.recordsImported.qualityTests} test/certification records</li>
                      <li>{importMutation.data.uniqueSkus} unique SKUs processed</li>
                    </ul>
                  </>
                ) : (
                  // OS 340 Purchase Orders or OS 650 Shipments import
                  <>
                    Successfully imported {importMutation.data.recordsImported} records out of {importMutation.data.totalRows} total rows.
                    {(importMutation.data.timelinesGenerated > 0 || importMutation.data.shipmentsImported > 0) && (
                      <ul className="list-disc pl-4 mt-2 text-sm">
                        {importMutation.data.shipmentsImported > 0 && (
                          <li>{importMutation.data.shipmentsImported} shipment records extracted</li>
                        )}
                        {importMutation.data.timelinesGenerated > 0 && (
                          <li>{importMutation.data.timelinesGenerated} timelines auto-generated ({importMutation.data.milestonesGenerated} milestones)</li>
                        )}
                      </ul>
                    )}
                    {importMutation.data.missingPoNumbers && importMutation.data.missingPoNumbers.length > 0 && (
                      <div className="mt-2 text-xs text-amber-600">
                        <strong>Note:</strong> {importMutation.data.missingPoNumbers.length} shipment(s) imported with PO numbers not found in database
                      </div>
                    )}
                  </>
                )}
                {importMutation.data.errors && importMutation.data.errors.length > 0 && (
                  <div className="mt-2 text-xs">
                    <strong>Errors:</strong>
                    <ul className="list-disc pl-4 mt-1">
                      {importMutation.data.errors.slice(0, 5).map((error: string, i: number) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {importMutation.data.warnings && importMutation.data.warnings.length > 0 && (
                  <div className="mt-2 text-xs text-amber-600">
                    <strong>Warnings:</strong>
                    <ul className="list-disc pl-4 mt-1">
                      {importMutation.data.warnings.slice(0, 3).map((warning: string, i: number) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {importMutation.isError && (
            <Alert 
              variant={importMutation.error?.message?.startsWith('TIMEOUT:') ? 'default' : 'destructive'} 
              data-testid="alert-error"
              className={importMutation.error?.message?.startsWith('TIMEOUT:') ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : ''}
            >
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {importMutation.error?.message?.startsWith('TIMEOUT:') ? (
                  <div className="space-y-2">
                    <p>{importMutation.error.message.replace('TIMEOUT: ', '')}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="button-check-import-status"
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/import-history');
                          if (!res.ok) {
                            toast({ title: "Still Processing", description: "The server is still busy processing the import. Try again in a minute." });
                            return;
                          }
                          const history = await res.json();
                          if (!Array.isArray(history) || history.length === 0) {
                            toast({ title: "No Import Records", description: "No import history found yet. The import may still be in progress." });
                            return;
                          }
                          const sorted = [...history].sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
                          const latest = sorted[0];
                          const importTime = new Date(latest.createdAt);
                          const minutesAgo = Math.round((Date.now() - importTime.getTime()) / 60000);
                          toast({
                            title: minutesAgo <= 15 ? "Import Completed" : "Last Import Found",
                            description: `${latest.fileName}: ${latest.recordsImported?.toLocaleString() || 0} records imported ${minutesAgo <= 1 ? 'just now' : minutesAgo + ' min ago'}. Status: ${latest.status || 'completed'}`,
                          });
                          if (minutesAgo <= 15) {
                            queryClient.invalidateQueries({ queryKey: ["/api/import-history"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/kpis"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/dashboard/header-kpis"] });
                          }
                        } catch {
                          toast({ title: "Still Processing", description: "The import appears to still be running. Try again in a minute." });
                        }
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Check Import Status
                    </Button>
                  </div>
                ) : (
                  importMutation.error?.message || "Failed to upload file"
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Import Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <p className="font-medium">Supported File Formats:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Excel (.xlsx, .xls)</li>
              <li>CSV (.csv)</li>
            </ul>
          </div>

          <div className="space-y-2 text-sm">
            <p className="font-medium">Supported Report Types:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li><strong>OS 340</strong> - Purchase order master data (PO Number required)</li>
              <li><strong>OS 630</strong> - Inspections and quality certifications (Style/SKU required)</li>
              <li><strong>OS 650</strong> - Shipment tracking and logistics data (PO Number required)</li>
              <li><strong>FURNITURE / HOME-GOODS</strong> - Monthly SKU projections with SPO/MTO items (received monthly around 4-6th)</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              The system automatically detects the report type based on the filename.
            </p>
          </div>

          <Button variant="outline" className="w-full" data-testid="button-download-template">
            <Download className="mr-2 h-4 w-4" />
            Download Import Template
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import History</CardTitle>
          <CardDescription>
            View recent file uploads and their import status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <DataTable
              columns={historyColumns}
              data={importHistory}
              searchPlaceholder="Search import history..."
              data-testid="table-import-history"
            />
          )}
        </CardContent>
      </Card>

      {vendorReviewData && (
        <UnknownVendorReviewModal
          isOpen={!!vendorReviewData}
          onClose={handleVendorReviewCancel}
          unknownVendors={vendorReviewData.unknownVendors}
          existingVendors={vendorReviewData.existingVendors}
          pendingImportId={vendorReviewData.pendingImportId}
          onComplete={handleVendorReviewComplete}
          isSubmitting={completeImportMutation.isPending}
        />
      )}
      
      {/* Data Backup & Restore Section */}
      <BackupRestoreSection />
    </div>
  );
}

// Backup & Restore Section Component
function BackupRestoreSection() {
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { data: backupSummary, isLoading: summaryLoading } = useQuery<{
    summary: Record<string, string>;
    totalRecords: number;
  }>({
    queryKey: ["/api/backup/summary"],
  });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/backup/export", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Failed to export backup");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `erp-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Backup Exported",
        description: "Your data has been exported successfully. Save this file for later restoration.",
      });
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error.message || "Failed to export backup",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("/api/backup/import", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to import backup");
      }
      
      toast({
        title: "Backup Restored",
        description: `Successfully restored ${result.totalImported} records from backup dated ${new Date(result.backupDate).toLocaleDateString()}`,
      });
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import backup",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Data Backup & Restore
        </CardTitle>
        <CardDescription>
          Export manually-entered data before upgrades and restore it after redeployment. 
          This preserves staff records, tasks, capacity data, and other non-imported information.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Export Section */}
          <div className="p-4 border rounded-lg space-y-3">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-blue-500" />
              <h4 className="font-medium">Export Backup</h4>
            </div>
            <p className="text-sm text-muted-foreground">
              Download a JSON file containing all manually-entered data. 
              Save this before deploying updates.
            </p>
            {summaryLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <p className="text-sm">
                <span className="font-medium">{backupSummary?.totalRecords?.toLocaleString() || 0}</span> records available for backup
              </p>
            )}
            <Button 
              onClick={handleExport} 
              disabled={isExporting}
              className="w-full"
              data-testid="button-export-backup"
            >
              {isExporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Export Backup
                </>
              )}
            </Button>
          </div>

          {/* Import Section */}
          <div className="p-4 border rounded-lg space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-green-500" />
              <h4 className="font-medium">Restore Backup</h4>
            </div>
            <p className="text-sm text-muted-foreground">
              Upload a previously exported backup file to restore your data after an upgrade or redeployment.
            </p>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Restoring will merge/replace existing data with the backup. Run OS imports after restoring.
              </AlertDescription>
            </Alert>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
              data-testid="input-restore-file"
            />
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isImporting}
              variant="outline"
              className="w-full"
              data-testid="button-restore-backup"
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload & Restore Backup
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Data Categories */}
        <div className="border-t pt-4">
          <p className="text-sm font-medium mb-2">Data included in backup:</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Staff Members</Badge>
            <Badge variant="secondary">Staff Goals</Badge>
            <Badge variant="secondary">PO Tasks</Badge>
            <Badge variant="secondary">Quality Tests</Badge>
            <Badge variant="secondary">Inspections</Badge>
            <Badge variant="secondary">Color Panels</Badge>
            <Badge variant="secondary">Vendor Capacity</Badge>
            <Badge variant="secondary">Vendor Aliases</Badge>
            <Badge variant="secondary">Clients</Badge>
            <Badge variant="secondary">Users</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
