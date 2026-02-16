import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Palette, 
  Calendar, 
  AlertTriangle, 
  Clock, 
  Mail, 
  CheckCircle, 
  XCircle,
  RefreshCw,
  Send,
  Bot,
  Eye,
  ArrowUpRight,
  Filter
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { differenceInDays, format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PanelRenewalData {
  panel: {
    id: number;
    vendorId: number | null;
    merchandiserId: number | null;
    brand: string | null;
    vendorName: string | null;
    collection: string | null;
    material: string | null;
    finishName: string | null;
    currentMcpNumber: string | null;
    currentExpirationDate: string | null;
    status: string | null;
    skuCount: number;
  };
  workflow: {
    id: number;
    status: string;
    reminderCount: number;
    lastReminderDate: string | null;
    assignedTo: number | null;
    isAiGenerated: boolean;
  } | null;
  linkedSkus: Array<{ id: number; sku: string; description: string | null }>;
  vendor: { id: number; name: string; email: string | null } | null;
  daysUntilExpiry: number;
  requiresAction: boolean;
}

export default function MCPManagement() {
  const [daysFilter, setDaysFilter] = useState<string>("90");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [tab, setTab] = useState<string>("all");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: renewalData, isLoading } = useQuery<PanelRenewalData[]>({
    queryKey: ["/api/mcp-management/due-for-renewal", { daysUntilExpiry: daysFilter }],
  });

  const { data: vendors } = useQuery<any[]>({
    queryKey: ["/api/vendors"],
  });

  const getWorkflowStatus = (workflow: PanelRenewalData["workflow"]) => {
    if (!workflow) {
      return { label: "Not Started", variant: "secondary" as const, icon: Clock };
    }
    
    switch (workflow.status) {
      case "idle":
        return { label: "Idle", variant: "secondary" as const, icon: Clock };
      case "reminder_pending":
        return { label: "Reminder Pending", variant: "default" as const, icon: Mail };
      case "reminder_sent":
        return { label: "Reminder Sent", variant: "secondary" as const, icon: Mail };
      case "awaiting_response":
        return { label: "Awaiting Response", variant: "default" as const, icon: Clock };
      case "follow_up_required":
        return { label: "Follow-up Required", variant: "destructive" as const, icon: AlertTriangle };
      case "escalated":
        return { label: "Escalated", variant: "destructive" as const, icon: AlertTriangle };
      case "renewed":
        return { label: "Renewed", variant: "secondary" as const, icon: CheckCircle };
      case "closed":
        return { label: "Closed", variant: "secondary" as const, icon: XCircle };
      default:
        return { label: workflow.status, variant: "secondary" as const, icon: Clock };
    }
  };

  const getExpiryBadge = (daysUntilExpiry: number) => {
    if (daysUntilExpiry < 0) {
      return { label: `${Math.abs(daysUntilExpiry)}d overdue`, variant: "destructive" as const };
    } else if (daysUntilExpiry <= 14) {
      return { label: `${daysUntilExpiry}d left`, variant: "destructive" as const };
    } else if (daysUntilExpiry <= 30) {
      return { label: `${daysUntilExpiry}d left`, variant: "default" as const };
    } else if (daysUntilExpiry <= 60) {
      return { label: `${daysUntilExpiry}d left`, variant: "secondary" as const };
    } else {
      return { label: `${daysUntilExpiry}d left`, variant: "secondary" as const };
    }
  };

  const filteredData = renewalData?.filter((item) => {
    if (vendorFilter !== "all" && item.vendor?.id?.toString() !== vendorFilter) return false;
    
    if (tab === "requires-action" && !item.requiresAction) return false;
    if (tab === "awaiting-response" && item.workflow?.status !== "awaiting_response") return false;
    if (tab === "not-started" && item.workflow) return false;
    
    return true;
  }) || [];

  const stats = {
    total: renewalData?.length || 0,
    requiresAction: renewalData?.filter(d => d.requiresAction).length || 0,
    awaitingResponse: renewalData?.filter(d => d.workflow?.status === "awaiting_response").length || 0,
    notStarted: renewalData?.filter(d => !d.workflow).length || 0,
    overdue: renewalData?.filter(d => d.daysUntilExpiry < 0).length || 0,
  };

  const uniqueVendors = Array.from(
    new Set(renewalData?.map(d => d.vendor?.id).filter(Boolean))
  ).map(id => vendors?.find(v => v.id === id)).filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="heading-mcp-management">
          MCP Management Center
        </h1>
        <p className="text-muted-foreground">
          Monitor and manage Master Color Panel renewals with AI-assisted communication
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className={tab === "all" ? "ring-2 ring-primary" : ""}>
          <CardContent className="p-4 cursor-pointer" onClick={() => setTab("all")}>
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Due</span>
            </div>
            <div className="text-2xl font-bold mt-1">{stats.total}</div>
          </CardContent>
        </Card>
        
        <Card className={tab === "requires-action" ? "ring-2 ring-destructive" : ""}>
          <CardContent className="p-4 cursor-pointer" onClick={() => setTab("requires-action")}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-muted-foreground">Action Required</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-destructive">{stats.requiresAction}</div>
          </CardContent>
        </Card>
        
        <Card className={tab === "awaiting-response" ? "ring-2 ring-amber-500" : ""}>
          <CardContent className="p-4 cursor-pointer" onClick={() => setTab("awaiting-response")}>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-amber-500 dark:text-amber-400" />
              <span className="text-sm text-muted-foreground">Awaiting Response</span>
            </div>
            <div className="text-2xl font-bold mt-1">{stats.awaitingResponse}</div>
          </CardContent>
        </Card>
        
        <Card className={tab === "not-started" ? "ring-2 ring-blue-500" : ""}>
          <CardContent className="p-4 cursor-pointer" onClick={() => setTab("not-started")}>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-500 dark:text-blue-400" />
              <span className="text-sm text-muted-foreground">Not Started</span>
            </div>
            <div className="text-2xl font-bold mt-1">{stats.notStarted}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-muted-foreground">Overdue</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-destructive">{stats.overdue}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[160px] max-w-[200px]">
            <Label htmlFor="days-filter" className="text-xs text-muted-foreground mb-1.5 block">Days Until Expiry</Label>
            <Select value={daysFilter} onValueChange={setDaysFilter}>
              <SelectTrigger id="days-filter" className="h-9" data-testid="select-days-filter">
                <SelectValue placeholder="Days until expiry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Next 30 days</SelectItem>
                <SelectItem value="60">Next 60 days</SelectItem>
                <SelectItem value="90">Next 90 days</SelectItem>
                <SelectItem value="180">Next 180 days</SelectItem>
                <SelectItem value="365">Next 365 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[180px] max-w-[220px]">
            <Label htmlFor="vendor-filter" className="text-xs text-muted-foreground mb-1.5 block">Vendor</Label>
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger id="vendor-filter" className="h-9" data-testid="select-vendor-filter">
                <SelectValue placeholder="All Vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vendors</SelectItem>
                {uniqueVendors.map((vendor: any) => (
                  <SelectItem key={vendor.id} value={vendor.id.toString()}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {vendorFilter !== "all" && (
            <Button 
              variant="ghost" 
              size="default" 
              onClick={() => setVendorFilter("all")} 
              data-testid="button-clear-filters"
            >
              <XCircle className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Panels Due for Renewal ({filteredData.length})
          </CardTitle>
          <CardDescription>
            {tab === "all" && "All panels expiring within the selected timeframe"}
            {tab === "requires-action" && "Panels requiring immediate attention - follow-up needed or escalated"}
            {tab === "awaiting-response" && "Panels where renewal reminders have been sent and awaiting vendor response"}
            {tab === "not-started" && "Panels without an active renewal workflow - no communication started yet"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading renewal data...</p>
          ) : filteredData.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MCP#</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Material / Finish</TableHead>
                    <TableHead>SKUs</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Workflow Status</TableHead>
                    <TableHead>Reminders</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((item) => {
                    const workflowStatus = getWorkflowStatus(item.workflow);
                    const expiryBadge = getExpiryBadge(item.daysUntilExpiry);
                    const StatusIcon = workflowStatus.icon;
                    
                    return (
                      <TableRow 
                        key={item.panel.id} 
                        className={`cursor-pointer hover-elevate ${item.requiresAction ? "bg-destructive/5" : ""}`}
                        data-testid={`mcp-renewal-row-${item.panel.id}`}
                      >
                        <TableCell className="font-mono font-medium">
                          <Link href={`/color-panels/${item.panel.id}`}>
                            <Button variant="ghost" className="p-0 h-auto font-mono">
                              {item.panel.currentMcpNumber || `Panel #${item.panel.id}`}
                              <ArrowUpRight className="h-3 w-3 ml-1" />
                            </Button>
                          </Link>
                        </TableCell>
                        <TableCell>
                          {item.vendor ? (
                            <Link href={`/vendors/${item.vendor.id}`}>
                              <Button variant="ghost" className="p-0 h-auto font-normal text-left justify-start">
                                <span className="max-w-[150px] truncate block">{item.vendor.name}</span>
                              </Button>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{item.panel.vendorName || "N/A"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[200px]">
                            <div className="truncate font-medium" title={item.panel.material || ""}>
                              {item.panel.material || "N/A"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate" title={item.panel.finishName || ""}>
                              {item.panel.finishName || "N/A"}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">
                            {item.panel.skuCount} SKUs
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant={expiryBadge.variant}>
                              {expiryBadge.label}
                            </Badge>
                            {item.panel.currentExpirationDate && (
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(item.panel.currentExpirationDate), "MMM d, yyyy")}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <StatusIcon className="h-4 w-4" />
                            <Badge variant={workflowStatus.variant}>
                              {workflowStatus.label}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.workflow ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-sm">{item.workflow.reminderCount} sent</span>
                              {item.workflow.lastReminderDate && (
                                <span className="text-xs text-muted-foreground">
                                  Last: {format(new Date(item.workflow.lastReminderDate), "MMM d")}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Link href={`/color-panels/${item.panel.id}`}>
                              <Button size="sm" variant="ghost" data-testid={`view-panel-${item.panel.id}`}>
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            {!item.workflow && (
                              <Button size="sm" variant="outline" data-testid={`start-workflow-${item.panel.id}`}>
                                <Bot className="h-4 w-4 mr-1" />
                                Start
                              </Button>
                            )}
                            {item.workflow?.status === "awaiting_response" && (
                              <Button size="sm" variant="outline" data-testid={`follow-up-${item.panel.id}`}>
                                <Send className="h-4 w-4 mr-1" />
                                Follow-up
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8">
              <Palette className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mt-2">
                {tab === "all" 
                  ? "No panels expiring within the selected timeframe"
                  : `No panels matching the "${tab}" filter`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
