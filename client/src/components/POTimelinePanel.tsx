import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, differenceInDays, isPast } from "date-fns";
import { 
  Lock, 
  Unlock, 
  RefreshCw, 
  Calendar, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  Info,
  Save
} from "lucide-react";

interface PoTimelineMilestone {
  id: number;
  timelineId: number;
  milestone: string;
  plannedDate: string | null;
  revisedDate: string | null;
  actualDate: string | null;
  actualSource: string | null;
  notes: string | null;
  sortOrder: number;
}

interface PoTimeline {
  id: number;
  poId: number;
  templateId: number | null;
  isLocked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
}

interface VendorTemplate {
  id: number;
  vendorId: number;
  name: string;
  productCategory: string | null;
}

interface TimelineData {
  timeline: PoTimeline | null;
  milestones: PoTimelineMilestone[];
}

interface POTimelinePanelProps {
  poId: number;
  poNumber: string;
  vendorId: number | null;
  poDate: string | null;
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

export function POTimelinePanel({ poId, poNumber, vendorId, poDate }: POTimelinePanelProps) {
  const { toast } = useToast();
  const [editingMilestone, setEditingMilestone] = useState<number | null>(null);
  const [editedDates, setEditedDates] = useState<{ revised?: string; actual?: string }>({});

  const { data: timelineData, isLoading } = useQuery<TimelineData>({
    queryKey: [`/api/purchase-orders/${poId}/timeline`],
  });

  const { data: templates } = useQuery<VendorTemplate[]>({
    queryKey: [`/api/vendors/${vendorId}/timeline-templates`],
    enabled: !!vendorId,
  });

  const initializeMutation = useMutation({
    mutationFn: async ({ templateId, date }: { templateId: number; date: string }) => {
      return apiRequest('POST', `/api/purchase-orders/${poId}/timeline`, {
        templateId,
        poDate: date,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}/timeline`] });
      toast({ title: "Timeline initialized", description: "Milestones have been set up from the template." });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const lockMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/purchase-orders/${poId}/timeline/lock`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}/timeline`] });
      toast({ title: "Timeline locked", description: "Planned dates are now locked." });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/purchase-orders/${poId}/timeline/sync`, {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}/timeline`] });
      const count = data?.updated?.length || 0;
      toast({ 
        title: "Sync complete", 
        description: count > 0 
          ? `Updated ${count} milestone(s) from shipment/inspection data.`
          : "No updates needed - all actuals are current."
      });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const updateMilestoneMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { revisedDate?: string | null; actualDate?: string | null; actualSource?: string } }) => {
      return apiRequest('PATCH', `/api/timeline-milestones/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${poId}/timeline`] });
      setEditingMilestone(null);
      setEditedDates({});
      toast({ title: "Milestone updated" });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const formatDate = (date: string | null) => {
    if (!date) return "-";
    return format(new Date(date), "MM/dd/yyyy");
  };

  type MilestoneStatus = 'complete' | 'late' | 'overdue' | 'at-risk' | 'pending';

  const getMilestoneStatus = (milestone: PoTimelineMilestone): { status: MilestoneStatus; daysInfo?: number } => {
    const now = new Date();
    const revisedDate = milestone.revisedDate ? new Date(milestone.revisedDate) : null;
    const plannedDate = milestone.plannedDate ? new Date(milestone.plannedDate) : null;
    const actualDate = milestone.actualDate ? new Date(milestone.actualDate) : null;
    const targetDate = revisedDate || plannedDate;

    if (actualDate) {
      if (targetDate && actualDate > targetDate) {
        const daysLate = differenceInDays(actualDate, targetDate);
        return { status: 'late', daysInfo: daysLate };
      }
      return { status: 'complete' };
    }

    if (targetDate && isPast(targetDate)) {
      const daysOverdue = differenceInDays(now, targetDate);
      return { status: 'overdue', daysInfo: daysOverdue };
    }

    if (targetDate) {
      const daysUntil = differenceInDays(targetDate, now);
      if (daysUntil <= 7) {
        return { status: 'at-risk', daysInfo: daysUntil };
      }
    }

    return { status: 'pending' };
  };

  const getStatusBadge = (milestone: PoTimelineMilestone) => {
    const { status, daysInfo } = getMilestoneStatus(milestone);

    switch (status) {
      case 'complete':
        return <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" data-testid={`badge-status-complete-${milestone.id}`}>On Time</Badge>;
      case 'late':
        return <Badge variant="destructive" className="text-xs" data-testid={`badge-status-late-${milestone.id}`}>{daysInfo}d Late</Badge>;
      case 'overdue':
        return <Badge variant="destructive" className="text-xs" data-testid={`badge-status-overdue-${milestone.id}`}>{daysInfo}d Overdue</Badge>;
      case 'at-risk':
        return <Badge className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100" data-testid={`badge-status-at-risk-${milestone.id}`}>Due in {daysInfo}d</Badge>;
      default:
        return <Badge variant="outline" className="text-xs" data-testid={`badge-status-pending-${milestone.id}`}>Pending</Badge>;
    }
  };

  const getRowClassName = (milestone: PoTimelineMilestone, index: number) => {
    const { status } = getMilestoneStatus(milestone);
    const baseClass = 'border-b transition-colors';
    
    switch (status) {
      case 'complete':
        return `${baseClass} bg-green-50 dark:bg-green-950/30`;
      case 'late':
      case 'overdue':
        return `${baseClass} bg-red-50 dark:bg-red-950/30`;
      case 'at-risk':
        return `${baseClass} bg-amber-50 dark:bg-amber-950/30`;
      default:
        return `${baseClass} ${index % 2 === 0 ? 'bg-muted/30' : ''}`;
    }
  };

  const handleStartEdit = (milestone: PoTimelineMilestone) => {
    setEditingMilestone(milestone.id);
    setEditedDates({
      revised: milestone.revisedDate ? milestone.revisedDate.split('T')[0] : '',
      actual: milestone.actualDate ? milestone.actualDate.split('T')[0] : '',
    });
  };

  const handleSaveEdit = (milestone: PoTimelineMilestone) => {
    const data: any = {};
    
    if (editedDates.revised !== undefined) {
      data.revisedDate = editedDates.revised || null;
    }
    if (editedDates.actual !== undefined) {
      data.actualDate = editedDates.actual || null;
      data.actualSource = editedDates.actual ? 'manual' : null;
    }

    updateMilestoneMutation.mutate({ id: milestone.id, data });
  };

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const handleInitialize = () => {
    if (!selectedTemplateId || !poDate) return;
    initializeMutation.mutate({ 
      templateId: parseInt(selectedTemplateId), 
      date: poDate 
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasTimeline = timelineData?.timeline && timelineData.milestones.length > 0;

  if (!hasTimeline) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Shipment Timeline
          </CardTitle>
          <CardDescription>
            Set up production and shipment milestones for this PO
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!vendorId ? (
            <div className="flex items-center gap-2 text-muted-foreground p-4 border rounded-md">
              <Info className="h-4 w-4" />
              <span>This PO is not linked to a vendor. Timeline templates are managed at the vendor level.</span>
            </div>
          ) : templates && templates.length > 0 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Select a Timeline Template</Label>
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger data-testid="select-template">
                    <SelectValue placeholder="Choose a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(template => (
                      <SelectItem key={template.id} value={template.id.toString()}>
                        {template.name}
                        {template.productCategory && ` (${template.productCategory})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button 
                onClick={handleInitialize}
                disabled={!selectedTemplateId || !poDate || initializeMutation.isPending}
                data-testid="button-initialize-timeline"
              >
                <Calendar className="h-4 w-4 mr-2" />
                Initialize Timeline
              </Button>
              {!poDate && (
                <p className="text-sm text-muted-foreground">
                  Note: This PO doesn't have a PO Date set. Please add a date before initializing the timeline.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">No Timeline Templates</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Create timeline templates on the vendor's page to set up production schedules for their POs.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const timeline = timelineData.timeline!;
  const milestones = timelineData.milestones;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Shipment Timeline
            </CardTitle>
            <CardDescription>
              Track production and shipment milestones for PO {poNumber}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              data-testid="button-sync-actuals"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              Sync Actuals
            </Button>
            {!timeline.isLocked && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => lockMutation.mutate()}
                disabled={lockMutation.isPending}
                data-testid="button-lock-timeline"
              >
                <Lock className="h-4 w-4 mr-2" />
                Lock Planned Dates
              </Button>
            )}
            {timeline.isLocked && (
              <Badge variant="secondary" className="flex items-center gap-1" data-testid="badge-locked">
                <Lock className="h-3 w-3" />
                Locked
                {timeline.lockedAt && ` on ${format(new Date(timeline.lockedAt), 'MM/dd/yy')}`}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-3 font-semibold">Milestone</th>
                <th className="text-center py-3 px-3 font-semibold">Planned</th>
                <th className="text-center py-3 px-3 font-semibold">Revised</th>
                <th className="text-center py-3 px-3 font-semibold">Actual</th>
                <th className="text-center py-3 px-3 font-semibold">Status</th>
                <th className="text-center py-3 px-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((milestone, index) => (
                <tr 
                  key={milestone.id} 
                  className={getRowClassName(milestone, index)}
                  data-testid={`row-milestone-${milestone.milestone}`}
                >
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      {milestone.actualDate ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : milestone.revisedDate && isPast(new Date(milestone.revisedDate)) ? (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">
                        {MILESTONE_LABELS[milestone.milestone] || milestone.milestone}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center text-muted-foreground" data-testid={`text-planned-${milestone.milestone}`}>
                    {formatDate(milestone.plannedDate)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {editingMilestone === milestone.id ? (
                      <Input
                        type="date"
                        value={editedDates.revised || ''}
                        onChange={(e) => setEditedDates(prev => ({ ...prev, revised: e.target.value }))}
                        className="w-36 mx-auto"
                        data-testid={`input-revised-${milestone.milestone}`}
                      />
                    ) : (
                      <span 
                        className={`font-medium ${
                          milestone.plannedDate && milestone.revisedDate && 
                          milestone.revisedDate !== milestone.plannedDate
                            ? 'text-amber-600'
                            : ''
                        }`}
                        data-testid={`text-revised-${milestone.milestone}`}
                      >
                        {formatDate(milestone.revisedDate)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {editingMilestone === milestone.id ? (
                      <Input
                        type="date"
                        value={editedDates.actual || ''}
                        onChange={(e) => setEditedDates(prev => ({ ...prev, actual: e.target.value }))}
                        className="w-36 mx-auto"
                        data-testid={`input-actual-${milestone.milestone}`}
                      />
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        <span 
                          className={`font-medium ${milestone.actualDate ? 'text-green-600' : ''}`}
                          data-testid={`text-actual-${milestone.milestone}`}
                        >
                          {formatDate(milestone.actualDate)}
                        </span>
                        {milestone.actualSource && (
                          <Badge variant="outline" className="text-xs ml-1" data-testid={`badge-source-${milestone.milestone}`}>
                            {milestone.actualSource}
                          </Badge>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {getStatusBadge(milestone)}
                  </td>
                  <td className="py-3 px-3 text-center">
                    {editingMilestone === milestone.id ? (
                      <div className="flex items-center justify-center gap-1">
                        <Button 
                          size="sm" 
                          onClick={() => handleSaveEdit(milestone)}
                          disabled={updateMilestoneMutation.isPending}
                          data-testid={`button-save-${milestone.milestone}`}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => {
                            setEditingMilestone(null);
                            setEditedDates({});
                          }}
                          data-testid={`button-cancel-${milestone.milestone}`}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => handleStartEdit(milestone)}
                        disabled={timeline.isLocked && !['hod', 'etd', 'inline_inspection', 'final_inspection'].includes(milestone.milestone)}
                        data-testid={`button-edit-${milestone.milestone}`}
                      >
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {timeline.isLocked && (
          <div className="mt-4 p-3 bg-muted/50 rounded-md text-sm text-muted-foreground">
            <Lock className="h-4 w-4 inline-block mr-2" />
            Planned dates are locked. You can still update revised and actual dates for tracking purposes.
            Actuals for HOD, ETD, and inspections sync automatically from shipment data.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
