import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { 
  ArrowLeft, User, Mail, Phone, Building2, Briefcase, Calendar, Shield,
  Target, Plus, ChevronDown, ChevronRight, Pencil, Trash2, Check, X,
  TrendingUp, AlertTriangle, Clock, Package, DollarSign, FileText
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import type { Staff, StaffGoal, GoalProgressEntry } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value / 100);
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case 'on_track': return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
    case 'at_risk': return 'bg-orange-500/10 text-orange-700 dark:text-orange-400';
    case 'not_met': return 'bg-red-500/10 text-red-700 dark:text-red-400';
    default: return 'bg-gray-500/10 text-gray-700 dark:text-gray-400';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'completed': return 'Completed';
    case 'on_track': return 'On Track';
    case 'at_risk': return 'At Risk';
    case 'not_met': return 'Not Met';
    case 'in_progress': return 'In Progress';
    default: return status;
  }
}

export default function StaffDetail() {
  const [, params] = useRoute("/staff/:id");
  const staffId = params?.id ? parseInt(params.id) : null;
  const { toast } = useToast();
  const { hasFullAccess } = useAuth();
  const goBack = useBackNavigation("/staff");
  
  const [expandedGoals, setExpandedGoals] = useState<Set<number>>(new Set());
  const [isAddGoalOpen, setIsAddGoalOpen] = useState(false);
  const [isAddProgressOpen, setIsAddProgressOpen] = useState(false);
  const [isEditGoalOpen, setIsEditGoalOpen] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<number | null>(null);
  const [editingGoal, setEditingGoal] = useState<StaffGoal | null>(null);
  
  const currentYear = new Date().getFullYear();

  const { data: staffMember, isLoading: staffLoading } = useQuery<Staff>({
    queryKey: ['/api/staff', String(staffId)],
    enabled: !!staffId,
  });

  const { data: metrics, isLoading: metricsLoading, error: metricsError } = useQuery<{
    // Header KPIs (matching Dashboard header)
    ytdSkusOrdered: number;
    newSkusYtd: number;
    ytdTotalSales: number;
    ytdShippedOrders: number;
    // Sales by SKU type
    ytdSalesNewSkus: number;
    ytdSalesExistingSkus: number;
    // Main KPIs (matching Dashboard main grid)
    otdOriginalPercentage: number;
    otdOriginalOrders: number;
    trueOtdPercentage: number;
    shippedOnTime: number;
    shippedTotal: number;
    qualityPassRate: number;
    avgLateDays: number;
    overdueUnshipped: number;
    // Vendor count
    assignedVendors: number;
    // SKU/PO metrics
    totalSkusManaged: number;
    totalSkusManagedPrevYear: number;
    newSkusManaged: number;
    newSkusManagedPrevYear: number;
    totalPOsManaged: number;
  }>({
    queryKey: ['/api/staff', String(staffId), 'metrics'],
    enabled: !!staffId,
    retry: false,
  });

  const { data: goals, isLoading: goalsLoading, error: goalsError } = useQuery<StaffGoal[]>({
    queryKey: ['/api/staff', String(staffId), 'goals'],
    enabled: !!staffId,
    retry: false,
  });
  
  // Check if access is denied (403 error)
  const isAccessDenied = metricsError?.message?.includes('403') || goalsError?.message?.includes('403');

  const createGoalMutation = useMutation({
    mutationFn: async (data: { title: string; description?: string; targetMetric?: string; category?: string }) => {
      return apiRequest('POST', `/api/staff/${staffId}/goals`, {
        ...data,
        reviewYear: currentYear,
        status: 'in_progress',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/staff', String(staffId), 'goals'] });
      setIsAddGoalOpen(false);
      toast({ title: "Goal created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error creating goal", description: error.message, variant: "destructive" });
    },
  });

  const updateGoalMutation = useMutation({
    mutationFn: async ({ goalId, data }: { goalId: number; data: Partial<StaffGoal> }) => {
      return apiRequest('PATCH', `/api/goals/${goalId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/staff', String(staffId), 'goals'] });
      setIsEditGoalOpen(false);
      setEditingGoal(null);
      toast({ title: "Goal updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error updating goal", description: error.message, variant: "destructive" });
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (goalId: number) => {
      return apiRequest('DELETE', `/api/goals/${goalId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/staff', String(staffId), 'goals'] });
      toast({ title: "Goal deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting goal", description: error.message, variant: "destructive" });
    },
  });

  const createProgressMutation = useMutation({
    mutationFn: async ({ goalId, data }: { goalId: number; data: { action: string; result?: string; entryDate?: string } }) => {
      return apiRequest('POST', `/api/goals/${goalId}/progress`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/goals', selectedGoalId, 'progress'] });
      setIsAddProgressOpen(false);
      setSelectedGoalId(null);
      toast({ title: "Progress entry added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error adding progress entry", description: error.message, variant: "destructive" });
    },
  });

  const toggleGoalExpanded = (goalId: number) => {
    const newExpanded = new Set(expandedGoals);
    if (newExpanded.has(goalId)) {
      newExpanded.delete(goalId);
    } else {
      newExpanded.add(goalId);
    }
    setExpandedGoals(newExpanded);
  };

  const handleAddProgress = (goalId: number) => {
    setSelectedGoalId(goalId);
    setIsAddProgressOpen(true);
  };

  const handleEditGoal = (goal: StaffGoal) => {
    setEditingGoal(goal);
    setIsEditGoalOpen(true);
  };

  if (staffLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!staffMember) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Staff member not found</p>
            <Button variant="outline" className="mt-4" onClick={goBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" data-testid="button-back" onClick={goBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-staff-name">{staffMember.name}</h1>
          <p className="text-muted-foreground">{staffMember.title || staffMember.role}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Contact Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <div className="w-20 h-20 rounded-lg bg-muted flex items-center justify-center border-2 border-dashed border-muted-foreground/30" data-testid="photo-placeholder">
                <User className="h-10 w-10 text-muted-foreground/50" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="font-semibold text-lg" data-testid="text-staff-name-card">{staffMember.name}</div>
                <div className="text-sm text-muted-foreground" data-testid="text-position">
                  {staffMember.title || staffMember.role || "Merchandiser"}
                </div>
              </div>
            </div>
            
            <div className="border-t pt-4 space-y-3">
              {staffMember.email && (
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <a href={`mailto:${staffMember.email}`} className="text-primary hover:underline text-sm" data-testid="link-email">
                    {staffMember.email}
                  </a>
                </div>
              )}
              {staffMember.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${staffMember.phone}`} className="text-primary hover:underline text-sm" data-testid="link-phone">
                    {staffMember.phone}
                  </a>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm" data-testid="text-hire-date">
                  Joined: {staffMember.hireDate 
                    ? format(new Date(staffMember.hireDate), 'MMM d, yyyy') 
                    : 'Not specified'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline" data-testid="badge-access-level">
                  {staffMember.accessLevel === 'full_access' ? 'Full Access' : 
                   staffMember.accessLevel === 'level_1' ? 'Level 1' : 'Level 2'}
                </Badge>
              </div>
              {staffMember.office && (
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm" data-testid="text-office">{staffMember.office}</span>
                </div>
              )}
              {staffMember.department && (
                <div className="flex items-center gap-3">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm" data-testid="text-department">{staffMember.department}</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                {/* GMM sees all vendors, Merchandising Managers see their team's vendors, others see their assigned vendors */}
                {staffMember.title?.toLowerCase().includes('general merchandising manager') || staffMember.name === 'Diah Mintarsih' ? (
                  <Link href="/vendors">
                    <span className="text-sm text-primary hover:underline cursor-pointer" data-testid="link-vendors-managed">
                      {metrics?.assignedVendors ?? 0} Total Vendors
                    </span>
                  </Link>
                ) : staffMember.role === 'merchandising_manager' || 
                    staffMember.title?.toLowerCase().includes('merchandising manager') ||
                    ['Ellise Trinh', 'Emma Zhang', 'Zoe Chen'].includes(staffMember.name) ? (
                  <Link href={`/vendors?merchandisingManager=${encodeURIComponent(staffMember.name)}`}>
                    <span className="text-sm text-primary hover:underline cursor-pointer" data-testid="link-vendors-managed">
                      {metrics?.assignedVendors ?? 0} Team Vendors
                    </span>
                  </Link>
                ) : (
                  <Link href={`/vendors?merchandiser=${encodeURIComponent(staffMember.name)}`}>
                    <span className="text-sm text-primary hover:underline cursor-pointer" data-testid="link-vendors-managed">
                      {metrics?.assignedVendors ?? 0} Vendors Managed
                    </span>
                  </Link>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Performance Metrics (YTD)
            </CardTitle>
            <CardDescription>
              {staffMember.title?.toLowerCase().includes('general merchandising manager') || staffMember.name === 'Diah Mintarsih'
                ? 'Full team performance metrics'
                : staffMember.role === 'merchandising_manager' || 
                  staffMember.title?.toLowerCase().includes('merchandising manager') ||
                  ['Ellise Trinh', 'Emma Zhang', 'Zoe Chen'].includes(staffMember.name)
                  ? `Team performance metrics for ${staffMember.name}'s team`
                  : `Operations dashboard KPIs filtered for ${staffMember.name}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : metricsError?.message?.includes('403') ? (
              <div className="text-center py-8" data-testid="metrics-access-denied">
                <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">You don't have permission to view this staff member's performance metrics.</p>
                <p className="text-sm text-muted-foreground mt-2">Only the staff member, their manager, or administrators can view these metrics.</p>
              </div>
            ) : metrics ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <DollarSign className="h-4 w-4" />
                      YTD Total Sales
                    </div>
                    <div className="text-2xl font-bold" data-testid="metric-total-sales">{formatCurrency(metrics.ytdTotalSales ?? 0)}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Plus className="h-4 w-4" />
                      Sales in New SKUs
                    </div>
                    <div className="text-2xl font-bold text-green-600" data-testid="metric-sales-new-skus">{formatCurrency(metrics.ytdSalesNewSkus ?? 0)}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Package className="h-4 w-4" />
                      Sales in Existing SKUs
                    </div>
                    <div className="text-2xl font-bold" data-testid="metric-sales-existing-skus">{formatCurrency(metrics.ytdSalesExistingSkus ?? 0)}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Package className="h-4 w-4" />
                      YTD Shipped Orders
                    </div>
                    <div className="text-2xl font-bold" data-testid="metric-shipped-orders">{metrics.ytdShippedOrders ?? 0}</div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <TrendingUp className="h-4 w-4" />
                      Original OTD %
                    </div>
                    <div className={`text-2xl font-bold ${(metrics.otdOriginalPercentage ?? 0) >= 60 ? 'text-green-600' : (metrics.otdOriginalPercentage ?? 0) >= 50 ? 'text-orange-600' : 'text-red-600'}`} data-testid="metric-otd-original">
                      {(metrics.otdOriginalPercentage ?? 0).toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">{metrics.otdOriginalOrders ?? 0} orders</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <TrendingUp className="h-4 w-4" />
                      Revised OTD %
                    </div>
                    <div className={`text-2xl font-bold ${(metrics.trueOtdPercentage ?? 0) >= 90 ? 'text-green-600' : (metrics.trueOtdPercentage ?? 0) >= 80 ? 'text-orange-600' : 'text-red-600'}`} data-testid="metric-true-otd">
                      {(metrics.trueOtdPercentage ?? 0).toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">{metrics.shippedOnTime ?? 0} / {metrics.shippedTotal ?? 0}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Check className="h-4 w-4" />
                      Quality Pass Rate
                    </div>
                    <div className={`text-2xl font-bold ${(metrics.qualityPassRate ?? 0) >= 90 ? 'text-green-600' : (metrics.qualityPassRate ?? 0) >= 80 ? 'text-orange-600' : 'text-red-600'}`} data-testid="metric-quality">
                      {(metrics.qualityPassRate ?? 0).toFixed(1)}%
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Clock className="h-4 w-4" />
                      Avg Late Days
                    </div>
                    <div className={`text-2xl font-bold ${(metrics.avgLateDays ?? 0) === 0 ? 'text-green-600' : (metrics.avgLateDays ?? 0) <= 5 ? 'text-orange-600' : 'text-red-600'}`} data-testid="metric-late-days">
                      {metrics.avgLateDays ?? 0} days
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Building2 className="h-4 w-4" />
                      Assigned Vendors
                    </div>
                    <div className="text-2xl font-bold" data-testid="metric-vendors">{metrics.assignedVendors ?? 0}</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <AlertTriangle className="h-4 w-4" />
                      Overdue Unshipped
                    </div>
                    <div className={`text-2xl font-bold ${(metrics.overdueUnshipped ?? 0) === 0 ? 'text-green-600' : 'text-red-600'}`} data-testid="metric-overdue">{metrics.overdueUnshipped ?? 0}</div>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Package className="h-4 w-4" />
                      SKUs Managed (YTD)
                    </div>
                    <div className="text-2xl font-bold" data-testid="metric-skus-managed">{metrics.totalSkusManaged ?? 0}</div>
                    <div className="text-xs text-muted-foreground">vs {metrics.totalSkusManagedPrevYear ?? 0} last year</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <Plus className="h-4 w-4" />
                      New SKUs Managed (YTD)
                    </div>
                    <div className="text-2xl font-bold text-green-600" data-testid="metric-new-skus-managed">{metrics.newSkusManaged ?? 0}</div>
                    <div className="text-xs text-muted-foreground">vs {metrics.newSkusManagedPrevYear ?? 0} last year</div>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                      <FileText className="h-4 w-4" />
                      POs Managed (YTD)
                    </div>
                    <div className="text-2xl font-bold" data-testid="metric-pos-managed">{metrics.totalPOsManaged ?? 0}</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">No metrics available</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Performance Goals ({currentYear})
              </CardTitle>
              <CardDescription>
                Annual review goals and progress tracking
              </CardDescription>
            </div>
            {hasFullAccess && goals && goals.length < 5 && (
              <Button onClick={() => setIsAddGoalOpen(true)} data-testid="button-add-goal">
                <Plus className="h-4 w-4 mr-2" />
                Add Goal
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {goalsLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : goalsError?.message?.includes('403') ? (
            <div className="text-center py-8" data-testid="goals-access-denied">
              <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">You don't have permission to view this staff member's goals.</p>
              <p className="text-sm text-muted-foreground mt-2">Only the staff member, their manager, or administrators can view these goals.</p>
            </div>
          ) : goals && goals.length > 0 ? (
            <div className="space-y-4">
              {goals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  isExpanded={expandedGoals.has(goal.id)}
                  onToggle={() => toggleGoalExpanded(goal.id)}
                  onEdit={() => handleEditGoal(goal)}
                  onDelete={() => deleteGoalMutation.mutate(goal.id)}
                  onAddProgress={() => handleAddProgress(goal.id)}
                  hasFullAccess={hasFullAccess}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No goals set for {currentYear}</p>
              {hasFullAccess && (
                <Button variant="outline" className="mt-4" onClick={() => setIsAddGoalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Goal
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AddGoalDialog
        isOpen={isAddGoalOpen}
        onClose={() => setIsAddGoalOpen(false)}
        onSubmit={(data) => createGoalMutation.mutate(data)}
        isLoading={createGoalMutation.isPending}
      />

      <EditGoalDialog
        isOpen={isEditGoalOpen}
        goal={editingGoal}
        onClose={() => { setIsEditGoalOpen(false); setEditingGoal(null); }}
        onSubmit={(data) => editingGoal && updateGoalMutation.mutate({ goalId: editingGoal.id, data })}
        isLoading={updateGoalMutation.isPending}
      />

      <AddProgressDialog
        isOpen={isAddProgressOpen}
        goalId={selectedGoalId}
        onClose={() => { setIsAddProgressOpen(false); setSelectedGoalId(null); }}
        onSubmit={(data) => selectedGoalId && createProgressMutation.mutate({ goalId: selectedGoalId, data })}
        isLoading={createProgressMutation.isPending}
      />
    </div>
  );
}

function GoalCard({ 
  goal, 
  isExpanded, 
  onToggle, 
  onEdit, 
  onDelete, 
  onAddProgress,
  hasFullAccess 
}: { 
  goal: StaffGoal; 
  isExpanded: boolean; 
  onToggle: () => void; 
  onEdit: () => void; 
  onDelete: () => void;
  onAddProgress: () => void;
  hasFullAccess: boolean;
}) {
  const { data: progressEntries } = useQuery<GoalProgressEntry[]>({
    queryKey: ['/api/goals', goal.id, 'progress'],
    enabled: isExpanded,
  });

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div className="border rounded-lg overflow-hidden">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-4 hover-elevate cursor-pointer" data-testid={`goal-row-${goal.id}`}>
            <div className="flex items-center gap-4 flex-1">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium" data-testid={`goal-title-${goal.id}`}>{goal.title}</span>
                  <Badge className={getStatusColor(goal.status)} data-testid={`goal-status-${goal.id}`}>
                    {getStatusLabel(goal.status)}
                  </Badge>
                  {goal.category && (
                    <Badge variant="outline">{goal.category}</Badge>
                  )}
                </div>
                {goal.targetMetric && (
                  <p className="text-sm text-muted-foreground mt-1">Target: {goal.targetMetric}</p>
                )}
              </div>
            </div>
            {hasFullAccess && (
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Button size="icon" variant="ghost" onClick={onEdit} data-testid={`button-edit-goal-${goal.id}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={onDelete} data-testid={`button-delete-goal-${goal.id}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 pt-0 border-t bg-muted/30">
            {goal.description && (
              <div className="pt-4 mb-4">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Description</h4>
                <p className="text-sm">{goal.description}</p>
              </div>
            )}
            {goal.managerNotes && (
              <div className="mb-4">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Manager Notes</h4>
                <p className="text-sm bg-muted/50 p-3 rounded-md">{goal.managerNotes}</p>
              </div>
            )}
            
            <div className="flex items-center justify-between mt-4 mb-3">
              <h4 className="text-sm font-medium text-muted-foreground">Progress Entries</h4>
              {hasFullAccess && (
                <Button size="sm" variant="outline" onClick={onAddProgress} data-testid={`button-add-progress-${goal.id}`}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add Entry
                </Button>
              )}
            </div>
            
            {progressEntries && progressEntries.length > 0 ? (
              <div className="space-y-3">
                {progressEntries.map((entry) => (
                  <div key={entry.id} className="p-3 bg-background rounded-md border" data-testid={`progress-entry-${entry.id}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(entry.entryDate), 'MMM d, yyyy')}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{entry.action}</p>
                    {entry.result && (
                      <p className="text-sm text-muted-foreground mt-1">Result: {entry.result}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No progress entries yet
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function AddGoalDialog({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isLoading 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSubmit: (data: { title: string; description?: string; targetMetric?: string; category?: string }) => void;
  isLoading: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetMetric, setTargetMetric] = useState('');
  const [category, setCategory] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      targetMetric: targetMetric.trim() || undefined,
      category: category || undefined,
    });
    setTitle('');
    setDescription('');
    setTargetMetric('');
    setCategory('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Performance Goal</DialogTitle>
          <DialogDescription>
            Create a new goal for the annual review. Maximum 5 goals per year.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="goal-title">Goal Title *</Label>
            <Input
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Source three new vendors for Outdoor furniture"
              data-testid="input-goal-title"
            />
          </div>
          <div>
            <Label htmlFor="goal-target">Target Metric</Label>
            <Input
              id="goal-target"
              value={targetMetric}
              onChange={(e) => setTargetMetric(e.target.value)}
              placeholder="e.g., 3 new vendors, 2% cost reduction"
              data-testid="input-goal-target"
            />
          </div>
          <div>
            <Label htmlFor="goal-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="goal-category" data-testid="select-goal-category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sourcing">Sourcing</SelectItem>
                <SelectItem value="cost_reduction">Cost Reduction</SelectItem>
                <SelectItem value="efficiency">Efficiency</SelectItem>
                <SelectItem value="quality">Quality</SelectItem>
                <SelectItem value="vendor_relations">Vendor Relations</SelectItem>
                <SelectItem value="professional_development">Professional Development</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="goal-description">Description</Label>
            <Textarea
              id="goal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the goal in more detail..."
              rows={3}
              data-testid="input-goal-description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || isLoading} data-testid="button-submit-goal">
            {isLoading ? 'Creating...' : 'Create Goal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditGoalDialog({ 
  isOpen, 
  goal,
  onClose, 
  onSubmit, 
  isLoading 
}: { 
  isOpen: boolean; 
  goal: StaffGoal | null;
  onClose: () => void; 
  onSubmit: (data: Partial<StaffGoal>) => void;
  isLoading: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetMetric, setTargetMetric] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [managerNotes, setManagerNotes] = useState('');

  useState(() => {
    if (goal) {
      setTitle(goal.title || '');
      setDescription(goal.description || '');
      setTargetMetric(goal.targetMetric || '');
      setCategory(goal.category || '');
      setStatus(goal.status || 'in_progress');
      setManagerNotes(goal.managerNotes || '');
    }
  });

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      targetMetric: targetMetric.trim() || null,
      category: category || null,
      status: status || 'in_progress',
      managerNotes: managerNotes.trim() || null,
    });
  };

  if (!goal) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Goal</DialogTitle>
          <DialogDescription>
            Update goal details and status
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="edit-goal-title">Goal Title *</Label>
            <Input
              id="edit-goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-edit-goal-title"
            />
          </div>
          <div>
            <Label htmlFor="edit-goal-status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="edit-goal-status" data-testid="select-goal-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="on_track">On Track</SelectItem>
                <SelectItem value="at_risk">At Risk</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="not_met">Not Met</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-goal-target">Target Metric</Label>
            <Input
              id="edit-goal-target"
              value={targetMetric}
              onChange={(e) => setTargetMetric(e.target.value)}
              data-testid="input-edit-goal-target"
            />
          </div>
          <div>
            <Label htmlFor="edit-goal-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="edit-goal-category" data-testid="select-edit-goal-category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sourcing">Sourcing</SelectItem>
                <SelectItem value="cost_reduction">Cost Reduction</SelectItem>
                <SelectItem value="efficiency">Efficiency</SelectItem>
                <SelectItem value="quality">Quality</SelectItem>
                <SelectItem value="vendor_relations">Vendor Relations</SelectItem>
                <SelectItem value="professional_development">Professional Development</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="edit-goal-description">Description</Label>
            <Textarea
              id="edit-goal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              data-testid="input-edit-goal-description"
            />
          </div>
          <div>
            <Label htmlFor="edit-goal-notes">Manager Notes</Label>
            <Textarea
              id="edit-goal-notes"
              value={managerNotes}
              onChange={(e) => setManagerNotes(e.target.value)}
              placeholder="Add notes about progress, feedback, etc."
              rows={3}
              data-testid="input-manager-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || isLoading} data-testid="button-update-goal">
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddProgressDialog({ 
  isOpen, 
  goalId,
  onClose, 
  onSubmit, 
  isLoading 
}: { 
  isOpen: boolean;
  goalId: number | null;
  onClose: () => void; 
  onSubmit: (data: { action: string; result?: string; entryDate?: string }) => void;
  isLoading: boolean;
}) {
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [entryDate, setEntryDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const handleSubmit = () => {
    if (!action.trim()) return;
    onSubmit({
      action: action.trim(),
      result: result.trim() || undefined,
      entryDate: entryDate || undefined,
    });
    setAction('');
    setResult('');
    setEntryDate(format(new Date(), 'yyyy-MM-dd'));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Progress Entry</DialogTitle>
          <DialogDescription>
            Record an action taken and its measurable result
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="progress-date">Date</Label>
            <Input
              id="progress-date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              data-testid="input-progress-date"
            />
          </div>
          <div>
            <Label htmlFor="progress-action">Action Taken *</Label>
            <Textarea
              id="progress-action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="Describe what was done..."
              rows={2}
              data-testid="input-progress-action"
            />
          </div>
          <div>
            <Label htmlFor="progress-result">Measurable Result</Label>
            <Textarea
              id="progress-result"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="What was the outcome? Include numbers if possible."
              rows={2}
              data-testid="input-progress-result"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!action.trim() || isLoading} data-testid="button-submit-progress">
            {isLoading ? 'Adding...' : 'Add Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
