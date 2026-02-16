import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format, differenceInDays, addDays } from "date-fns";
import { 
  ClipboardList, 
  Check, 
  Clock, 
  AlertTriangle, 
  Calendar, 
  Package, 
  ShieldCheck,
  ExternalLink,
  Palette,
  Target,
  X
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { HelpButton } from "@/components/HelpButton";
import type { ActivityLog, PurchaseOrder } from "@shared/schema";
import { useClientContext } from "@/contexts/ClientContext";

interface ExpiringMCP {
  id: number;
  brand: string | null;
  collection: string | null;
  vendorName: string | null;
  currentMcpNumber: string | null;
  expirationDate: Date;
  daysUntilExpiry: number;
  skuCount: number;
  workflowStatus: string | null;
}

interface PendingAction extends ActivityLog {
  entityType: string;
  entityId: string;
}

interface UpcomingDeadline {
  id: number;
  poNumber: string;
  vendor: string | null;
  revisedCancelDate: Date;
  daysUntilDue: number;
  status: string;
}

interface ExpiringCertification {
  id: number;
  poNumber: string;
  sku: string | null;
  testType: string | null;
  expirationDate: Date;
  daysUntilExpiry: number;
  vendor: string | null;
}

interface QualityTestResponse {
  id: number;
  poNumber: string;
  sku: string | null;
  testType: string;
  expirationDate: string | null;
  result: string | null;
  status: string | null;
  vendorName: string | null;
}

interface UnmatchedProjectionByMerchandiser {
  merchandiser: string;
  projection_count: number;
  total_value: number;
  vendor_count: number;
}

interface AtRiskMilestone {
  id: number;
  milestone: string;
  poId: number;
  poNumber: string;
  vendor: string | null;
  targetDate: string;
  daysUntilDue: number;
  status: 'at-risk' | 'overdue';
}

interface MissingInspection {
  id: number;
  poNumber: string;
  vendor: string | null;
  merchandiser: string | null;
  revisedShipDate: string | null;
  daysUntilHod: number;
  missingInlineInspection: boolean;
  missingFinalInspection: boolean;
  totalValue: number | null;
}

const MILESTONE_LABELS: Record<string, string> = {
  'po_confirmation': 'PO Confirmation',
  'raw_materials_ordered': 'Raw Materials Ordered',
  'raw_materials_delivered': 'Raw Materials Delivered',
  'production_start': 'Production Start',
  'shipment_booking': 'Shipment Booking',
  'inline_inspection': 'Inline Inspection',
  'production_finish': 'Production Finish',
  'final_inspection': 'Final Inspection',
  'hod': 'HOD (Hand Over Date)',
  'etd': 'ETD (Est. Departure)',
};

interface TodoDismissal {
  itemType: string;
  itemId: string;
}

interface NeedsConfirmationPO {
  id: number;
  poNumber: string;
  vendor: string | null;
  status: string;
  copNumber: string | null;
  orderDate: string | null;
  revisedCancelDate: string | null;
  totalOrderValue: number | null;
  clientDivision: string | null;
  confirmationDate: string | null;
  daysSincePo: number | null;
  missingCop: boolean;
}

export default function ToDoList() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { selectedClient } = useClientContext();
  const [location, setLocation] = useLocation();
  
  // Parse URL params for filter state persistence
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = urlParams.get('tab') || 'actions';
  const initialMerchandiser = urlParams.get('merchandiser') || 'all';
  const initialShowDismissed = urlParams.get('showDismissed') === 'true';
  
  const [selectedMerchandiser, setSelectedMerchandiser] = useState<string>(initialMerchandiser);
  const [showDismissed, setShowDismissed] = useState(initialShowDismissed);
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // Sync filter state to URL for preservation when navigating back
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== 'actions') params.set('tab', activeTab);
    if (selectedMerchandiser !== 'all') params.set('merchandiser', selectedMerchandiser);
    if (showDismissed) params.set('showDismissed', 'true');
    const newUrl = params.toString() ? `/todo?${params.toString()}` : '/todo';
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(null, '', newUrl);
    }
  }, [activeTab, selectedMerchandiser, showDismissed]);

  // Helper to generate drill-down URL with return path
  const getDrillDownUrl = (path: string) => {
    const returnParams = new URLSearchParams();
    if (activeTab !== 'actions') returnParams.set('tab', activeTab);
    if (selectedMerchandiser !== 'all') returnParams.set('merchandiser', selectedMerchandiser);
    if (showDismissed) returnParams.set('showDismissed', 'true');
    const returnUrl = encodeURIComponent(`/todo${returnParams.toString() ? '?' + returnParams.toString() : ''}`);
    return `${path}?returnTo=${returnUrl}`;
  };

  // Navigate to drill-down with preserved filter state
  const navigateToDrillDown = (path: string) => {
    setLocation(getDrillDownUrl(path));
  };

  // Fetch dismissed items for current user
  const { data: dismissedItems = [] } = useQuery<TodoDismissal[]>({
    queryKey: ['/api/todo-dismissals'],
  });

  // Create a set of dismissed item keys for quick lookup
  const dismissedSet = new Set(dismissedItems.map(d => `${d.itemType}:${d.itemId}`));

  // Mutation for dismissing items
  const dismissMutation = useMutation({
    mutationFn: async ({ itemType, itemId }: { itemType: string; itemId: string }) => {
      return apiRequest('POST', '/api/todo-dismissals', { itemType, itemId });
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['/api/todo-dismissals'] });
      toast({ title: "Item checked off" });
    },
  });

  // Mutation for restoring items
  const restoreMutation = useMutation({
    mutationFn: async ({ itemType, itemId }: { itemType: string; itemId: string }) => {
      return apiRequest('DELETE', '/api/todo-dismissals', { itemType, itemId });
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['/api/todo-dismissals'] });
      toast({ title: "Item restored to list" });
    },
  });

  const handleDismissToggle = (itemType: string, itemId: string, isDismissed: boolean) => {
    if (isDismissed) {
      restoreMutation.mutate({ itemType, itemId });
    } else {
      dismissMutation.mutate({ itemType, itemId });
    }
  };

  const atRiskUrl = selectedClient?.shortName
    ? `/api/timeline-milestones/at-risk?client=${encodeURIComponent(selectedClient.shortName)}`
    : '/api/timeline-milestones/at-risk';

  const { data: atRiskMilestones = [], isLoading: milestonesLoading } = useQuery<AtRiskMilestone[]>({
    queryKey: [atRiskUrl],
  });

  const { data: pendingActions = [], isLoading: actionsLoading } = useQuery<PendingAction[]>({
    queryKey: ['/api/my-tasks'],
  });

  const { data: purchaseOrders = [], isLoading: posLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['/api/purchase-orders'],
  });

  const { data: qualityTests = [], isLoading: testsLoading } = useQuery<QualityTestResponse[]>({
    queryKey: ['/api/quality-tests'],
  });

  const { data: staff = [] } = useQuery<{ id: number; name: string; role: string }[]>({
    queryKey: ['/api/staff'],
  });

  const { data: vendors = [] } = useQuery<{ id: number; name: string; merchandiser: string | null }[]>({
    queryKey: ['/api/vendors'],
  });

  const { data: mcpRenewals = [], isLoading: mcpLoading } = useQuery<any[]>({
    queryKey: ['/api/mcp-renewals'],
  });

  const { data: needsConfirmationPOs = [], isLoading: needsConfirmationLoading } = useQuery<NeedsConfirmationPO[]>({
    queryKey: ['/api/purchase-orders/needs-confirmation', { client: selectedClient?.shortName || 'all' }],
    queryFn: async () => {
      const url = selectedClient?.shortName
        ? `/api/purchase-orders/needs-confirmation?client=${encodeURIComponent(selectedClient.shortName)}`
        : '/api/purchase-orders/needs-confirmation';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch needs confirmation POs');
      return response.json();
    },
  });

  // Create a vendor name to merchandiser map for filtering
  const vendorMerchandiserMap = new Map<string, string>();
  vendors.forEach(v => {
    if (v.name && v.merchandiser) {
      vendorMerchandiserMap.set(v.name.toLowerCase(), v.merchandiser);
    }
  });

  const currentYear = new Date().getFullYear();
  const projectionsUrl = selectedClient?.shortName
    ? `/api/projections/unmatched-by-merchandiser?year=${currentYear}&client=${encodeURIComponent(selectedClient.shortName)}`
    : `/api/projections/unmatched-by-merchandiser?year=${currentYear}`;
  const { data: unmatchedProjections = [], isLoading: projectionsLoading } = useQuery<UnmatchedProjectionByMerchandiser[]>({
    queryKey: [projectionsUrl],
  });

  // Missing Inspections - POs missing inline inspection (within 14 days of HOD) or final inspection (within 7 days of HOD)
  const missingInspectionsUrl = selectedClient?.shortName
    ? `/api/missing-inspections?client=${encodeURIComponent(selectedClient.shortName)}`
    : '/api/missing-inspections';
  const { data: missingInspections = [], isLoading: inspectionsLoading } = useQuery<MissingInspection[]>({
    queryKey: [missingInspectionsUrl],
  });

  const completeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('PATCH', `/api/activity-logs/${id}/complete`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/my-tasks'] });
      toast({ title: "Action marked as complete" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to complete action", description: error.message, variant: "destructive" });
    },
  });

  const merchandisers = staff
    .filter(s => s.role === 'merchandiser' || s.role === 'Merchandiser')
    .map(s => s.name);

  const today = new Date();
  const next14Days = addDays(today, 14);

  // Helper function to check if a vendor matches the selected merchandiser
  const matchesMerchandiser = (vendorName: string | null | undefined): boolean => {
    if (selectedMerchandiser === "all") return true;
    if (!vendorName) return false;
    const merchandiser = vendorMerchandiserMap.get(vendorName.toLowerCase());
    return merchandiser === selectedMerchandiser;
  };

  // Helper function to check if an item is dismissed
  const isDismissed = (itemType: string, itemId: string): boolean => {
    return dismissedSet.has(`${itemType}:${itemId}`);
  };

  // Helper function to filter dismissed items (show dismissed if toggle is on, hide if off)
  const shouldShowItem = (itemType: string, itemId: string): boolean => {
    const dismissed = isDismissed(itemType, itemId);
    if (showDismissed) return true; // Show all items when toggle is on
    return !dismissed; // Hide dismissed items when toggle is off
  };

  // Deduplicate by PO number since each PO can have multiple SKU rows
  const seenPoNumbers = new Set<string>();
  const upcomingDeadlines: UpcomingDeadline[] = purchaseOrders
    .filter(po => {
      if (!po.revisedCancelDate) return false;
      // Exclude handed over (Closed/Shipped) and cancelled orders
      if (po.status === 'Shipped' || po.status === 'Closed' || po.status === 'Cancelled') return false;
      const dueDate = new Date(po.revisedCancelDate);
      if (!(dueDate >= today && dueDate <= next14Days)) return false;
      // Filter by merchandiser
      if (!matchesMerchandiser(po.vendor)) return false;
      // Deduplicate by PO number
      if (seenPoNumbers.has(po.poNumber)) return false;
      seenPoNumbers.add(po.poNumber);
      // Filter by dismissal status
      if (!shouldShowItem('deadline', po.poNumber)) return false;
      return true;
    })
    .map(po => ({
      id: po.id,
      poNumber: po.poNumber,
      vendor: po.vendor,
      revisedCancelDate: new Date(po.revisedCancelDate!),
      daysUntilDue: differenceInDays(new Date(po.revisedCancelDate!), today),
      status: po.status,
    }))
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  const next30Days = addDays(today, 30);
  const next90Days = addDays(today, 90);

  const expiringMCPs: ExpiringMCP[] = mcpRenewals
    .filter((mcp: any) => {
      if (!mcp.panel?.currentExpirationDate) return false;
      const expDate = new Date(mcp.panel.currentExpirationDate);
      if (!(expDate >= today && expDate <= next90Days)) return false;
      // Filter by merchandiser - check vendor's merchandiser
      const vendorName = mcp.vendor?.name || mcp.panel.vendorName;
      if (!matchesMerchandiser(vendorName)) return false;
      // Filter by dismissal status
      if (!shouldShowItem('mcp', String(mcp.panel.id))) return false;
      return true;
    })
    .map((mcp: any) => ({
      id: mcp.panel.id,
      brand: mcp.panel.brand,
      collection: mcp.panel.collection,
      vendorName: mcp.vendor?.name || mcp.panel.vendorName,
      currentMcpNumber: mcp.panel.currentMcpNumber,
      expirationDate: new Date(mcp.panel.currentExpirationDate),
      daysUntilExpiry: mcp.daysUntilExpiry,
      skuCount: mcp.panel.skuCount || 0,
      workflowStatus: mcp.workflow?.status || null,
    }))
    .sort((a: ExpiringMCP, b: ExpiringMCP) => a.daysUntilExpiry - b.daysUntilExpiry);

  // Deduplicate certifications by test ID to avoid counting duplicates
  const seenTestIds = new Set<number>();
  const expiringCertifications: ExpiringCertification[] = qualityTests
    .filter(test => {
      if (!test.expirationDate) return false;
      const expDate = new Date(test.expirationDate);
      if (!(expDate >= today && expDate <= next30Days)) return false;
      // Filter by merchandiser
      if (!matchesMerchandiser(test.vendorName)) return false;
      // Deduplicate by test ID
      if (seenTestIds.has(test.id)) return false;
      seenTestIds.add(test.id);
      // Filter by dismissal status
      if (!shouldShowItem('cert', String(test.id))) return false;
      return true;
    })
    .map(test => ({
      id: test.id,
      poNumber: test.poNumber || '',
      sku: test.sku,
      testType: test.testType,
      expirationDate: new Date(test.expirationDate!),
      daysUntilExpiry: differenceInDays(new Date(test.expirationDate!), today),
      vendor: test.vendorName,
    }))
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  const getDaysLeftBadge = (days: number) => {
    if (days === 0) {
      return <Badge variant="destructive">Today</Badge>;
    } else if (days === 1) {
      return <Badge variant="destructive">Tomorrow</Badge>;
    } else if (days <= 3) {
      return <Badge variant="destructive">{days} days</Badge>;
    } else if (days <= 7) {
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{days} days</Badge>;
    } else {
      return <Badge variant="secondary">{days} days</Badge>;
    }
  };

  // Filter milestones by merchandiser and dismissal status
  const filteredMilestones = atRiskMilestones.filter(m => {
    if (!matchesMerchandiser(m.vendor)) return false;
    if (!shouldShowItem('milestone', String(m.id))) return false;
    return true;
  });

  // Filter projections by merchandiser and dismissal status
  const filteredProjections = unmatchedProjections.filter(p => {
    if (selectedMerchandiser !== "all" && p.merchandiser !== selectedMerchandiser) return false;
    // Use merchandiser as the unique identifier for projections
    if (!shouldShowItem('projection', p.merchandiser)) return false;
    return true;
  });

  // Filter POs needing confirmation by merchandiser and dismissal status
  const filteredNeedsConfirmationPOs = needsConfirmationPOs.filter(po => {
    if (!matchesMerchandiser(po.vendor)) return false;
    if (!shouldShowItem('needs-confirmation', po.poNumber)) return false;
    return true;
  });

  // Filter missing inspections by merchandiser and dismissal status
  const filteredMissingInspections = missingInspections.filter(mi => {
    if (selectedMerchandiser !== "all" && mi.merchandiser !== selectedMerchandiser) return false;
    if (!shouldShowItem('missing-inspection', mi.poNumber)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-todo-title">
            <ClipboardList className="h-6 w-6" />
            To-Do List
          </h1>
          <p className="text-muted-foreground">Track pending actions, upcoming deadlines, and expiring certifications</p>
        </div>
        <HelpButton section="todo" />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[180px] max-w-[250px]">
            <Label htmlFor="merchandiser-filter" className="text-xs text-muted-foreground mb-1.5 block">Merchandiser</Label>
            <Select value={selectedMerchandiser} onValueChange={setSelectedMerchandiser}>
              <SelectTrigger id="merchandiser-filter" className="h-9" data-testid="select-merchandiser">
                <SelectValue placeholder="All Merchandisers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Merchandisers</SelectItem>
                {merchandisers.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedMerchandiser !== "all" && (
            <Button 
              variant="ghost" 
              size="default" 
              onClick={() => setSelectedMerchandiser("all")} 
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <Switch
              id="show-dismissed"
              checked={showDismissed}
              onCheckedChange={setShowDismissed}
              data-testid="switch-show-dismissed"
            />
            <Label htmlFor="show-dismissed" className="text-sm cursor-pointer">
              Show checked-off items
            </Label>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <Card 
          className={`cursor-pointer hover-elevate ${activeTab === 'actions' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('actions')}
          data-testid="kpi-tile-actions"
        >
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground truncate">Pending Actions</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" data-testid="text-pending-count">
                {pendingActions.length}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer hover-elevate ${activeTab === 'needs-confirmation' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('needs-confirmation')}
          data-testid="kpi-tile-needs-confirmation"
        >
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground truncate">Needs Confirmation</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" data-testid="text-needs-confirmation-count">
                {filteredNeedsConfirmationPOs.length}
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card 
          className={`cursor-pointer hover-elevate ${activeTab === 'certifications' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('certifications')}
          data-testid="kpi-tile-certifications"
        >
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground truncate">Expiring Certs</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" data-testid="text-cert-count">
                {expiringCertifications.length}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer hover-elevate ${activeTab === 'milestones' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('milestones')}
          data-testid="kpi-tile-milestones"
        >
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground truncate">At-Risk Milestones</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" data-testid="text-milestone-count">
                {filteredMilestones.length}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer hover-elevate ${activeTab === 'missing-inspections' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('missing-inspections')}
          data-testid="kpi-tile-missing-inspections"
        >
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground truncate">Missing Inspections</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" data-testid="text-missing-inspections-count">
                {filteredMissingInspections.length}
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card 
          className={`cursor-pointer hover-elevate ${activeTab === 'deadlines' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('deadlines')}
          data-testid="kpi-tile-deadlines"
        >
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground truncate">POs Due (14d)</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" data-testid="text-deadline-count">
                {upcomingDeadlines.length}
              </span>
            </div>
          </CardContent>
        </Card>
        
        <Card 
          className={`cursor-pointer hover-elevate ${activeTab === 'mcp' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('mcp')}
          data-testid="kpi-tile-mcp"
        >
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground truncate">MCP Renewals</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" data-testid="text-mcp-count">
                {expiringMCPs.length}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card 
          className={`cursor-pointer hover-elevate ${activeTab === 'projections' ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setActiveTab('projections')}
          data-testid="kpi-tile-projections"
        >
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground truncate">Projections</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold" data-testid="text-projections-count">
                {filteredProjections.length}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">

        <TabsContent value="actions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pending Actions</CardTitle>
              <CardDescription>Actions logged on POs and SKUs that require follow-up</CardDescription>
            </CardHeader>
            <CardContent>
              {actionsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : pendingActions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Check className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">All caught up!</p>
                  <p className="text-sm">No pending actions at this time</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Entity</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead>Created By</TableHead>
                        <TableHead className="w-[100px]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingActions.map((action) => (
                        <TableRow 
                          key={action.id} 
                          data-testid={`row-action-${action.id}`}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigateToDrillDown(action.entityType === 'po' ? `/purchase-orders/${action.entityId}` : `/skus/${action.entityId}`)}
                        >
                          <TableCell>
                            <Badge variant="outline">
                              {action.entityType === 'po' ? 'PO' : 'SKU'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="text-primary flex items-center gap-1">
                              {action.entityId}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[300px] truncate">{action.description}</TableCell>
                          <TableCell>
                            {action.dueDate ? (
                              <span className={`text-sm ${
                                new Date(action.dueDate) < today 
                                  ? 'text-red-600 font-medium' 
                                  : ''
                              }`}>
                                {format(new Date(action.dueDate), 'MMM d, yyyy')}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{action.createdBy || '—'}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => completeMutation.mutate(action.id)}
                              disabled={completeMutation.isPending}
                              className="h-7"
                              data-testid={`button-complete-${action.id}`}
                            >
                              <Check className="h-3 w-3 mr-1" />
                              Done
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="milestones" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">At-Risk Timeline Milestones</CardTitle>
              <CardDescription>Production milestones due within 7 days or overdue</CardDescription>
            </CardHeader>
            <CardContent>
              {milestonesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : filteredMilestones.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">All milestones on track</p>
                  <p className="text-sm">No at-risk or overdue milestones</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Milestone</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[80px]">View</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMilestones.map((milestone) => {
                        const isChecked = isDismissed('milestone', String(milestone.id));
                        return (
                          <TableRow 
                            key={milestone.id} 
                            className={`cursor-pointer hover:bg-muted/50 ${milestone.status === 'overdue' ? 'bg-red-50 dark:bg-red-950/30' : 'bg-amber-50 dark:bg-amber-950/30'} ${isChecked ? 'opacity-50' : ''}`}
                            data-testid={`row-milestone-${milestone.id}`}
                            onClick={() => navigateToDrillDown(`/purchase-orders/${milestone.poId}`)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDismissToggle('milestone', String(milestone.id), isChecked)}
                                disabled={dismissMutation.isPending}
                                className="h-7"
                                data-testid={`button-done-milestone-${milestone.id}`}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Done
                              </Button>
                            </TableCell>
                            <TableCell className={`font-medium ${isChecked ? 'line-through' : ''}`}>{milestone.poNumber}</TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{MILESTONE_LABELS[milestone.milestone] || milestone.milestone}</TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{milestone.vendor || '—'}</TableCell>
                            <TableCell>{format(new Date(milestone.targetDate), 'MMM d, yyyy')}</TableCell>
                            <TableCell>
                              {milestone.status === 'overdue' ? (
                                <Badge variant="destructive">{Math.abs(milestone.daysUntilDue)}d Overdue</Badge>
                              ) : (
                                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">
                                  Due in {milestone.daysUntilDue}d
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="missing-inspections" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Missing Inspections</CardTitle>
              <CardDescription>POs missing inline inspection (within 14 days of HOD) or final inspection (within 7 days of HOD)</CardDescription>
            </CardHeader>
            <CardContent>
              {inspectionsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : filteredMissingInspections.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">All inspections booked</p>
                  <p className="text-sm">No POs with missing inspection bookings</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Merchandiser</TableHead>
                        <TableHead>HOD</TableHead>
                        <TableHead>Days Until HOD</TableHead>
                        <TableHead>Missing</TableHead>
                        <TableHead className="w-[80px]">View</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMissingInspections.map((inspection) => {
                        const isChecked = isDismissed('missing-inspection', inspection.poNumber);
                        return (
                          <TableRow 
                            key={inspection.id}
                            className={`cursor-pointer hover:bg-muted/50 ${inspection.daysUntilHod <= 7 ? 'bg-red-50 dark:bg-red-950/30' : 'bg-amber-50 dark:bg-amber-950/30'} ${isChecked ? 'opacity-50' : ''}`}
                            data-testid={`row-missing-inspection-${inspection.id}`}
                            onClick={() => navigateToDrillDown(`/purchase-orders/${inspection.id}`)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDismissToggle('missing-inspection', inspection.poNumber, isChecked)}
                                disabled={dismissMutation.isPending}
                                className="h-7"
                                data-testid={`button-done-inspection-${inspection.id}`}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Done
                              </Button>
                            </TableCell>
                            <TableCell className={`font-medium ${isChecked ? 'line-through' : ''}`}>{inspection.poNumber}</TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{inspection.vendor || '—'}</TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{inspection.merchandiser || '—'}</TableCell>
                            <TableCell>{inspection.revisedShipDate ? format(new Date(inspection.revisedShipDate), 'MMM d, yyyy') : '—'}</TableCell>
                            <TableCell>
                              {inspection.daysUntilHod <= 7 ? (
                                <Badge variant="destructive">{inspection.daysUntilHod}d</Badge>
                              ) : (
                                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">
                                  {inspection.daysUntilHod}d
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {inspection.missingInlineInspection && (
                                  <Badge variant="outline" className="text-xs">Inline</Badge>
                                )}
                                {inspection.missingFinalInspection && (
                                  <Badge variant="outline" className="text-xs">Final</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deadlines" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Upcoming PO Deadlines</CardTitle>
              <CardDescription>Purchase orders with cancel dates in the next 14 days</CardDescription>
            </CardHeader>
            <CardContent>
              {posLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : upcomingDeadlines.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No urgent deadlines</p>
                  <p className="text-sm">No PO cancel dates in the next 14 days</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Cancel Date</TableHead>
                        <TableHead>Time Left</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[80px]">View</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {upcomingDeadlines.map((deadline) => {
                        const isChecked = isDismissed('deadline', deadline.poNumber);
                        return (
                          <TableRow 
                            key={deadline.id} 
                            data-testid={`row-deadline-${deadline.id}`}
                            className={`cursor-pointer hover:bg-muted/50 ${isChecked ? 'opacity-50' : ''}`}
                            onClick={() => navigateToDrillDown(`/purchase-orders/${deadline.id}`)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDismissToggle('deadline', deadline.poNumber, isChecked)}
                                disabled={dismissMutation.isPending}
                                className="h-7"
                                data-testid={`button-done-deadline-${deadline.id}`}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Done
                              </Button>
                            </TableCell>
                            <TableCell className={`font-medium ${isChecked ? 'line-through' : ''}`}>{deadline.poNumber}</TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{deadline.vendor || '—'}</TableCell>
                            <TableCell>{format(deadline.revisedCancelDate, 'MMM d, yyyy')}</TableCell>
                            <TableCell>{getDaysLeftBadge(deadline.daysUntilDue)}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{deadline.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certifications" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Expiring Certifications</CardTitle>
              <CardDescription>Quality tests and certifications expiring in the next 30 days</CardDescription>
            </CardHeader>
            <CardContent>
              {testsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : expiringCertifications.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No expiring certifications</p>
                  <p className="text-sm">No certifications expiring in the next 30 days</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>PO Number</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Test Type</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Expiration</TableHead>
                        <TableHead>Time Left</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expiringCertifications.map((cert) => {
                        const isChecked = isDismissed('cert', String(cert.id));
                        return (
                          <TableRow 
                            key={cert.id} 
                            data-testid={`row-cert-${cert.id}`}
                            className={`cursor-pointer hover:bg-muted/50 ${isChecked ? 'opacity-50' : ''}`}
                            onClick={() => cert.poNumber && navigateToDrillDown(`/purchase-orders/${cert.poNumber}`)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDismissToggle('cert', String(cert.id), isChecked)}
                                disabled={dismissMutation.isPending}
                                className="h-7"
                                data-testid={`button-done-cert-${cert.id}`}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Done
                              </Button>
                            </TableCell>
                            <TableCell className={`font-medium ${isChecked ? 'line-through' : ''}`}>{cert.poNumber || '—'}</TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{cert.sku || '—'}</TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{cert.testType || '—'}</TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{cert.vendor || '—'}</TableCell>
                            <TableCell>{format(cert.expirationDate, 'MMM d, yyyy')}</TableCell>
                            <TableCell>{getDaysLeftBadge(cert.daysUntilExpiry)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mcp" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">MCP Renewals</CardTitle>
              <CardDescription>Master Color Panels expiring in the next 90 days</CardDescription>
            </CardHeader>
            <CardContent>
              {mcpLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : expiringMCPs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Palette className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No expiring MCPs</p>
                  <p className="text-sm">No Master Color Panels expiring in the next 90 days</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>MCP#</TableHead>
                        <TableHead>Brand</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>SKUs</TableHead>
                        <TableHead>Expiration</TableHead>
                        <TableHead>Time Left</TableHead>
                        <TableHead>Workflow</TableHead>
                        <TableHead className="w-[100px]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expiringMCPs.map((mcp) => {
                        const isChecked = isDismissed('mcp', String(mcp.id));
                        return (
                          <TableRow 
                            key={mcp.id} 
                            data-testid={`row-mcp-${mcp.id}`}
                            className={`cursor-pointer hover:bg-muted/50 ${isChecked ? 'opacity-50' : ''}`}
                            onClick={() => navigateToDrillDown(`/color-panels/${mcp.id}`)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDismissToggle('mcp', String(mcp.id), isChecked)}
                                disabled={dismissMutation.isPending}
                                className="h-7"
                                data-testid={`button-done-mcp-${mcp.id}`}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Done
                              </Button>
                            </TableCell>
                            <TableCell className={`font-mono font-medium ${isChecked ? 'line-through' : ''}`}>
                              {mcp.currentMcpNumber || '—'}
                            </TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{mcp.brand || '—'}</TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{mcp.vendorName || '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{mcp.skuCount} SKU{mcp.skuCount !== 1 ? 's' : ''}</Badge>
                            </TableCell>
                            <TableCell>{format(mcp.expirationDate, 'MMM d, yyyy')}</TableCell>
                            <TableCell>{getDaysLeftBadge(mcp.daysUntilExpiry)}</TableCell>
                            <TableCell>
                              {mcp.workflowStatus ? (
                                <Badge variant={
                                  mcp.workflowStatus === 'follow_up_required' || mcp.workflowStatus === 'escalated' 
                                    ? 'destructive' 
                                    : 'secondary'
                                }>
                                  {mcp.workflowStatus.replace(/_/g, ' ')}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-sm">Not started</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projections" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Unmatched Projections by Merchandiser
              </CardTitle>
              <CardDescription>
                Merchandisers with projections that need attention (no matching PO orders)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {projectionsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : filteredProjections.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No unmatched projections found for {currentYear}
                </p>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>Merchandiser</TableHead>
                        <TableHead className="text-center">Vendors</TableHead>
                        <TableHead className="text-right">Projections</TableHead>
                        <TableHead className="text-right">Total Value</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProjections.map((item) => {
                        const isChecked = isDismissed('projection', item.merchandiser);
                        return (
                          <TableRow 
                            key={item.merchandiser} 
                            data-testid={`row-projection-${item.merchandiser}`}
                            className={`cursor-pointer hover:bg-muted/50 ${isChecked ? 'opacity-50' : ''}`}
                            onClick={() => navigateToDrillDown('/projections')}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDismissToggle('projection', item.merchandiser, isChecked)}
                                disabled={dismissMutation.isPending}
                                className="h-7"
                                data-testid={`button-done-projection-${item.merchandiser}`}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Done
                              </Button>
                            </TableCell>
                            <TableCell className={`font-medium ${isChecked ? 'line-through' : ''}`}>{item.merchandiser}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="secondary">{item.vendor_count}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge variant="destructive">{Number(item.projection_count).toLocaleString()}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${(Number(item.total_value) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </TableCell>
                            <TableCell>
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="needs-confirmation" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Orders Needing Confirmation</CardTitle>
              <CardDescription>
                Purchase orders in EDI/Initial status that need to be confirmed to Booked-to-ship
              </CardDescription>
            </CardHeader>
            <CardContent>
              {needsConfirmationLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : filteredNeedsConfirmationPOs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Check className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">All caught up!</p>
                  <p className="text-sm">No POs need confirmation</p>
                </div>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>COP #</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Order Date</TableHead>
                        <TableHead>Cancel Date</TableHead>
                        <TableHead className="text-right">Order Value</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredNeedsConfirmationPOs.map((po) => {
                        const isChecked = isDismissed('needs-confirmation', po.poNumber);
                        return (
                          <TableRow 
                            key={po.id} 
                            data-testid={`row-needs-confirmation-${po.id}`}
                            className={`cursor-pointer hover:bg-muted/50 ${isChecked ? 'opacity-50' : ''}`}
                            onClick={() => navigateToDrillDown(`/purchase-orders/${po.poNumber}`)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDismissToggle('needs-confirmation', po.poNumber, isChecked)}
                                disabled={dismissMutation.isPending}
                                className="h-7"
                                data-testid={`button-done-needs-confirmation-${po.id}`}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Done
                              </Button>
                            </TableCell>
                            <TableCell className={`font-medium ${isChecked ? 'line-through' : ''}`}>
                              {po.poNumber}
                            </TableCell>
                            <TableCell className={isChecked ? 'line-through' : ''}>{po.vendor || '—'}</TableCell>
                            <TableCell>
                              {po.copNumber ? (
                                <span className="text-green-600">{po.copNumber}</span>
                              ) : (
                                <Badge variant="outline" className="text-amber-600 border-amber-300">Missing</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="text-destructive font-medium">{po.daysSincePo ?? '—'}</span>
                            </TableCell>
                            <TableCell>
                              {po.orderDate ? format(new Date(po.orderDate), 'MMM d, yyyy') : '—'}
                            </TableCell>
                            <TableCell>
                              {po.revisedCancelDate ? format(new Date(po.revisedCancelDate), 'MMM d, yyyy') : '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {po.totalOrderValue ? `$${(Number(po.totalOrderValue) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
                            </TableCell>
                            <TableCell>
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
