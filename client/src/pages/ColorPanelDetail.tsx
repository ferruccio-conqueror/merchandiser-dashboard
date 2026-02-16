import { useParams, Link } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft,
  Palette, 
  Building2, 
  Calendar, 
  Clock, 
  AlertTriangle, 
  CheckCircle2,
  Mail,
  Bot,
  MessageSquare,
  ExternalLink,
  Send,
  Flag,
  Plus,
  XCircle,
  RefreshCw,
  ArrowUpRight
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PanelDetail {
  panel: {
    id: number;
    vendorId: number | null;
    merchandiserId: number | null;
    brand: string | null;
    vendorName: string | null;
    collection: string | null;
    skuDescription: string | null;
    material: string | null;
    finishName: string | null;
    sheenLevel: string | null;
    finishSystem: string | null;
    paintSupplier: string | null;
    validityMonths: number | null;
    currentMcpNumber: string | null;
    currentApprovalDate: string | null;
    currentExpirationDate: string | null;
    status: string | null;
    notes: string | null;
    skuCount: number;
  };
  vendor: { id: number; name: string; email: string | null } | null;
  history: Array<{
    id: number;
    versionNumber: number;
    mcpNumber: string | null;
    approvalDate: string | null;
    expirationDate: string | null;
  }>;
  linkedSkus: Array<{ id: number; sku: string; description: string | null }>;
  workflow: {
    id: number;
    status: string;
    reminderCount: number;
    lastReminderDate: string | null;
    assignedTo: number | null;
    isAiGenerated: boolean;
    nextReminderDate: string | null;
    notes: string | null;
  } | null;
  communications: Array<{
    id: number;
    communicationType: string;
    subject: string | null;
    status: string;
    createdAt: string;
  }>;
  aiEvents: Array<{
    id: number;
    eventType: string;
    inputData: any;
    outputData: any;
    status: string;
    createdAt: string;
  }>;
  issues: Array<{
    id: number;
    issueType: string;
    severity: string;
    title: string;
    description: string | null;
    status: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
}

export default function ColorPanelDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const goBack = useBackNavigation("/color-panels");

  const { data: detail, isLoading } = useQuery<PanelDetail>({
    queryKey: ["/api/color-panels", id, "detail"],
    enabled: !!id,
  });

  const { data: brandAssignments = [] } = useQuery<any[]>({
    queryKey: ["/api/brand-assignments"],
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Color panel not found</p>
      </div>
    );
  }

  const { panel, vendor, history, linkedSkus, workflow, communications, aiEvents, issues } = detail;
  const brandAssignment = brandAssignments.find((ba: any) => ba.brandCode === panel.brand);

  const getExpirationStatus = (expirationDate: string | null) => {
    if (!expirationDate) return { label: "No Expiration Set", variant: "secondary" as const, icon: Calendar };
    
    const expDate = new Date(expirationDate);
    const today = new Date();
    const daysRemaining = differenceInDays(expDate, today);
    
    if (daysRemaining < 0) {
      return { 
        label: `Expired ${Math.abs(daysRemaining)} days ago`, 
        variant: "destructive" as const, 
        icon: AlertTriangle,
        daysRemaining 
      };
    } else if (daysRemaining <= 30) {
      return { 
        label: `Expires in ${daysRemaining} days`, 
        variant: "default" as const, 
        icon: AlertTriangle,
        daysRemaining 
      };
    } else if (daysRemaining <= 90) {
      return { 
        label: `Expires in ${daysRemaining} days`, 
        variant: "secondary" as const, 
        icon: Calendar,
        daysRemaining 
      };
    } else {
      return { 
        label: `Valid for ${daysRemaining} days`, 
        variant: "secondary" as const, 
        icon: CheckCircle2,
        daysRemaining 
      };
    }
  };

  const getWorkflowStatus = (status: string | undefined) => {
    if (!status) return { label: "Not Started", variant: "secondary" as const, icon: Clock };
    
    switch (status) {
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
        return { label: "Renewed", variant: "secondary" as const, icon: CheckCircle2 };
      case "closed":
        return { label: "Closed", variant: "secondary" as const, icon: XCircle };
      default:
        return { label: status, variant: "secondary" as const, icon: Clock };
    }
  };

  const expirationStatus = getExpirationStatus(panel.currentExpirationDate);
  const workflowStatus = workflow ? getWorkflowStatus(workflow.status) : getWorkflowStatus(undefined);
  const WorkflowIcon = workflowStatus.icon;

  const sortedHistory = [...history].sort((a, b) => a.versionNumber - b.versionNumber);
  const openIssues = issues.filter(i => i.status !== "resolved" && i.status !== "closed");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="heading-color-panel-detail">
            <Palette className="h-8 w-8" />
            Master Color Panel
          </h1>
          <p className="text-muted-foreground">
            {panel.brand} • {panel.collection || 'No Collection'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" data-testid="button-back" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="workflow" data-testid="tab-workflow">
            Workflow
            {workflow?.status === "follow_up_required" || workflow?.status === "escalated" ? (
              <Badge variant="destructive" className="ml-2 h-5 px-1">!</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="issues" data-testid="tab-issues">
            Issues
            {openIssues.length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 px-1">{openIssues.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Panel Information</CardTitle>
                <CardDescription>Basic specifications and details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Brand</p>
                    <p className="font-medium" data-testid="text-brand">{panel.brand || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Collection</p>
                    <p className="font-medium" data-testid="text-collection">{panel.collection || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">SKU Description</p>
                    <p className="font-medium" data-testid="text-sku-description">{panel.skuDescription || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Material</p>
                    <p className="font-medium" data-testid="text-material">{panel.material || 'N/A'}</p>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Finish Name</p>
                    <p className="font-medium" data-testid="text-finish-name">{panel.finishName || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Sheen Level</p>
                    <p className="font-medium" data-testid="text-sheen-level">{panel.sheenLevel || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Finish System</p>
                    <p className="font-medium" data-testid="text-finish-system">{panel.finishSystem || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Paint Supplier</p>
                    <p className="font-medium" data-testid="text-paint-supplier">{panel.paintSupplier || 'N/A'}</p>
                  </div>
                </div>

                {panel.notes && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm text-muted-foreground">Notes</p>
                      <p className="text-sm mt-1" data-testid="text-notes">{panel.notes}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current Status</CardTitle>
                <CardDescription>Validity and expiration tracking</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Current MCP#</p>
                    <p className="font-mono font-medium text-lg" data-testid="text-current-mcp">
                      {panel.currentMcpNumber || 'Not Assigned'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Validity Period</p>
                    <p className="font-medium" data-testid="text-validity">{panel.validityMonths || 12} months</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Approval Date</p>
                    <p className="font-medium" data-testid="text-approval-date">
                      {panel.currentApprovalDate ? format(new Date(panel.currentApprovalDate), 'MMM d, yyyy') : 'Not Set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Expiration Date</p>
                    <p className="font-medium" data-testid="text-expiration-date">
                      {panel.currentExpirationDate ? format(new Date(panel.currentExpirationDate), 'MMM d, yyyy') : 'Not Set'}
                    </p>
                  </div>
                </div>

                <Separator />

                <div>
                  <p className="text-sm text-muted-foreground mb-2">Expiration Status</p>
                  <div className="flex items-center gap-2">
                    <expirationStatus.icon className="h-4 w-4" />
                    <Badge variant={expirationStatus.variant} data-testid="badge-expiration-status">
                      {expirationStatus.label}
                    </Badge>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Vendor</p>
                    {vendor ? (
                      <Link href={`/vendors/${vendor.id}`}>
                        <Button variant="ghost" className="p-0 h-auto font-normal justify-start" data-testid="link-vendor">
                          <Building2 className="h-4 w-4 mr-2" />
                          {vendor.name}
                          <ArrowUpRight className="h-3 w-3 ml-1" />
                        </Button>
                      </Link>
                    ) : (
                      <p className="font-medium">{panel.vendorName || 'N/A'}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Merchandiser</p>
                    <p className="font-medium" data-testid="text-merchandiser">
                      {brandAssignment?.merchandiserName || 'Not Assigned'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>Linked SKUs ({linkedSkus.length})</span>
              </CardTitle>
              <CardDescription>
                Product SKUs currently using this Master Color Panel finish specification
              </CardDescription>
            </CardHeader>
            <CardContent>
              {linkedSkus.length > 0 ? (
                <div className="flex gap-2 flex-wrap">
                  {linkedSkus.map((sku) => (
                    <Link key={sku.id} href={`/sku-summary/${sku.sku}`}>
                      <Badge 
                        variant="secondary" 
                        className="text-sm font-mono cursor-pointer hover-elevate"
                        data-testid={`badge-sku-${sku.id}`}
                      >
                        {sku.sku}
                        <ArrowUpRight className="h-3 w-3 ml-1" />
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-muted-foreground text-sm">No SKUs linked to this color panel</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    SKU links are automatically created during color panel import
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Version History
              </CardTitle>
              <CardDescription>
                Complete timeline of all MCP versions and renewals
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sortedHistory.length > 0 ? (
                <div className="space-y-4">
                  {sortedHistory.map((version, index) => (
                    <div key={version.id} className="flex gap-4" data-testid={`version-${version.versionNumber}`}>
                      <div className="flex flex-col items-center">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                          index === sortedHistory.length - 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        }`}>
                          {version.versionNumber}
                        </div>
                        {index < sortedHistory.length - 1 && (
                          <div className="w-0.5 flex-1 bg-border mt-2 mb-2" style={{ minHeight: '20px' }} />
                        )}
                      </div>
                      <div className="flex-1 pb-6">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium">
                            {version.versionNumber === 1 ? 'Original MCP' : `${version.versionNumber}${
                              version.versionNumber === 2 ? 'nd' : 
                              version.versionNumber === 3 ? 'rd' : 'th'
                            } MCP Renewal`}
                          </p>
                          {index === sortedHistory.length - 1 && (
                            <Badge variant="secondary" className="text-xs">Current</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground font-mono mb-2">
                          MCP# {version.mcpNumber}
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Approved: </span>
                            <span className="font-medium">
                              {version.approvalDate ? format(new Date(version.approvalDate), 'MMM d, yyyy') : 'N/A'}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Expired: </span>
                            <span className="font-medium">
                              {version.expirationDate ? format(new Date(version.expirationDate), 'MMM d, yyyy') : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground text-sm">No version history available</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    Historical versions will appear here once the panel has been renewed
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workflow" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Renewal Workflow Status
              </CardTitle>
              <CardDescription>
                Track the progress of MCP renewal communications and approvals
              </CardDescription>
            </CardHeader>
            <CardContent>
              {workflow ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <WorkflowIcon className="h-6 w-6" />
                      <div>
                        <Badge variant={workflowStatus.variant} className="text-sm">
                          {workflowStatus.label}
                        </Badge>
                        {workflow.isAiGenerated && (
                          <Badge variant="outline" className="ml-2">
                            <Bot className="h-3 w-3 mr-1" />
                            AI Assisted
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" data-testid="button-send-reminder">
                        <Send className="h-4 w-4 mr-2" />
                        Send Reminder
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Reminders Sent</p>
                      <p className="font-medium text-lg">{workflow.reminderCount}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Last Reminder</p>
                      <p className="font-medium">
                        {workflow.lastReminderDate 
                          ? format(new Date(workflow.lastReminderDate), 'MMM d, yyyy')
                          : 'None sent'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Next Reminder</p>
                      <p className="font-medium">
                        {workflow.nextReminderDate 
                          ? format(new Date(workflow.nextReminderDate), 'MMM d, yyyy')
                          : 'Not scheduled'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <p className="font-medium capitalize">{workflow.status.replace(/_/g, ' ')}</p>
                    </div>
                  </div>

                  {workflow.notes && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Notes</p>
                        <p className="text-sm">{workflow.notes}</p>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <RefreshCw className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground mt-2">No renewal workflow started</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    Start the workflow to begin tracking renewal communications
                  </p>
                  <Button className="mt-4" data-testid="button-start-workflow">
                    <Bot className="h-4 w-4 mr-2" />
                    Start AI-Assisted Renewal
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Communication History
              </CardTitle>
              <CardDescription>
                Email threads and messages related to this MCP renewal
              </CardDescription>
            </CardHeader>
            <CardContent>
              {communications.length > 0 ? (
                <div className="space-y-4">
                  {communications.map((comm) => (
                    <div 
                      key={comm.id} 
                      className="flex items-start gap-3 p-3 rounded-lg border hover-elevate cursor-pointer"
                      data-testid={`communication-${comm.id}`}
                    >
                      <Mail className="h-5 w-5 mt-0.5 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{comm.subject || 'No Subject'}</p>
                          <Badge variant={comm.status === 'sent' ? 'secondary' : 'default'}>
                            {comm.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(comm.createdAt), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  <Mail className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground text-sm mt-2">No communications yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Activity Log
              </CardTitle>
              <CardDescription>
                Track AI-generated emails, analysis, and automated actions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {aiEvents.length > 0 ? (
                <div className="space-y-4">
                  {aiEvents.map((event) => (
                    <div 
                      key={event.id} 
                      className="flex items-start gap-3 p-3 rounded-lg border"
                      data-testid={`ai-event-${event.id}`}
                    >
                      <Bot className="h-5 w-5 mt-0.5 text-primary" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium capitalize">{event.eventType.replace(/_/g, ' ')}</p>
                          <Badge variant={event.status === 'completed' ? 'secondary' : 'default'}>
                            {event.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(event.createdAt), 'MMM d, yyyy h:mm a')}
                        </p>
                        {event.outputData?.summary && (
                          <p className="text-sm mt-2">{event.outputData.summary}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Bot className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground mt-2">No AI activity recorded</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    AI activity will appear here when using AI-assisted renewal workflows
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="issues" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flag className="h-5 w-5" />
                Issues & Blockers
              </CardTitle>
              <CardDescription>
                Track issues that may affect MCP renewal or quality
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end mb-4">
                <Button variant="outline" size="sm" data-testid="button-add-issue">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Issue
                </Button>
              </div>

              {issues.length > 0 ? (
                <div className="space-y-4">
                  {issues.map((issue) => (
                    <div 
                      key={issue.id} 
                      className={`flex items-start gap-3 p-4 rounded-lg border ${
                        issue.status === 'open' && issue.severity === 'critical' 
                          ? 'border-destructive bg-destructive/5' 
                          : ''
                      }`}
                      data-testid={`issue-${issue.id}`}
                    >
                      <Flag className={`h-5 w-5 mt-0.5 ${
                        issue.severity === 'critical' ? 'text-destructive' :
                        issue.severity === 'high' ? 'text-amber-500' :
                        'text-muted-foreground'
                      }`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{issue.title}</p>
                          <Badge variant={
                            issue.severity === 'critical' ? 'destructive' :
                            issue.severity === 'high' ? 'default' :
                            'secondary'
                          }>
                            {issue.severity}
                          </Badge>
                          <Badge variant={issue.status === 'open' ? 'default' : 'secondary'}>
                            {issue.status}
                          </Badge>
                        </div>
                        {issue.description && (
                          <p className="text-sm text-muted-foreground mt-1">{issue.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          Created {format(new Date(issue.createdAt), 'MMM d, yyyy')}
                          {issue.resolvedAt && ` • Resolved ${format(new Date(issue.resolvedAt), 'MMM d, yyyy')}`}
                        </p>
                      </div>
                      {issue.status === 'open' && (
                        <Button variant="ghost" size="sm" data-testid={`resolve-issue-${issue.id}`}>
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Flag className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground mt-2">No issues reported</p>
                  <p className="text-muted-foreground text-sm mt-1">
                    Issues and blockers will appear here when flagged
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
