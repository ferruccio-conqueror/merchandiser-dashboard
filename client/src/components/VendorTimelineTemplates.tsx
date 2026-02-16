import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Plus, 
  Calendar, 
  Edit, 
  Trash2, 
  ChevronDown, 
  ChevronUp,
  GripVertical,
  Save
} from "lucide-react";

interface VendorTemplateMilestone {
  id: number;
  templateId: number;
  milestone: string;
  daysFromPoDate: number;
  dependsOnMilestone: string | null;
  daysFromDependency: number | null;
  sortOrder: number;
}

interface VendorTimelineTemplate {
  id: number;
  vendorId: number;
  name: string;
  productCategory: string | null;
  isActive: boolean;
}

interface TemplateWithMilestones {
  template: VendorTimelineTemplate;
  milestones: VendorTemplateMilestone[];
}

interface VendorTimelineTemplatesProps {
  vendorId: number;
  vendorName: string;
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

const MILESTONE_ORDER = [
  'po_confirmation',
  'raw_materials_ordered',
  'raw_materials_delivered',
  'production_start',
  'shipment_booking',
  'inline_inspection',
  'production_finish',
  'final_inspection',
  'hod',
  'etd',
];

const PRODUCT_CATEGORIES = [
  'Furniture',
  'Upholstery',
  'Outdoor',
  'Lighting',
  'Rugs',
  'Decorative Accessories',
  'Bedding',
  'Kitchen',
  'Storage',
  'Other',
];

export function VendorTimelineTemplates({ vendorId, vendorName }: VendorTimelineTemplatesProps) {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [expandedTemplate, setExpandedTemplate] = useState<number | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<number | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateCategory, setNewTemplateCategory] = useState("");
  const [editedMilestones, setEditedMilestones] = useState<Record<string, number>>({});

  const { data: templates = [], isLoading } = useQuery<VendorTimelineTemplate[]>({
    queryKey: [`/api/vendors/${vendorId}/timeline-templates`],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; productCategory: string | null; milestones: any[] }) => {
      return apiRequest('POST', `/api/vendors/${vendorId}/timeline-templates`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendors/${vendorId}/timeline-templates`] });
      setIsCreateOpen(false);
      setNewTemplateName("");
      setNewTemplateCategory("");
      toast({ title: "Template created", description: "Timeline template has been created successfully." });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return apiRequest('PATCH', `/api/timeline-templates/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendors/${vendorId}/timeline-templates`] });
      setEditingTemplate(null);
      setEditedMilestones({});
      toast({ title: "Template updated" });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/timeline-templates/${id}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vendors/${vendorId}/timeline-templates`] });
      toast({ title: "Template deleted" });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });

  const handleCreateTemplate = () => {
    if (!newTemplateName.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Please enter a template name." });
      return;
    }

    const defaultMilestones = MILESTONE_ORDER.map((milestone, index) => ({
      milestone,
      daysFromPoDate: (index + 1) * 7,
      dependsOnMilestone: index > 0 ? MILESTONE_ORDER[index - 1] : null,
      daysFromDependency: 7,
      sortOrder: index,
    }));

    createMutation.mutate({
      name: newTemplateName.trim(),
      productCategory: newTemplateCategory || null,
      milestones: defaultMilestones,
    });
  };

  const handleSaveMilestones = (templateId: number, milestones: VendorTemplateMilestone[]) => {
    const updatedMilestones = milestones.map(m => ({
      ...m,
      daysFromPoDate: editedMilestones[`${m.id}_days`] !== undefined 
        ? editedMilestones[`${m.id}_days`] 
        : m.daysFromPoDate,
    }));

    updateMutation.mutate({
      id: templateId,
      data: { milestones: updatedMilestones },
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
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Timeline Templates
            </CardTitle>
            <CardDescription>
              Production timeline templates for {vendorName}
            </CardDescription>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-template">
                <Plus className="h-4 w-4 mr-2" />
                New Template
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Timeline Template</DialogTitle>
                <DialogDescription>
                  Create a new production timeline template for this vendor.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Template Name</Label>
                  <Input
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="e.g., Standard Furniture, Quick Turn"
                    data-testid="input-template-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Product Category (Optional)</Label>
                  <Select value={newTemplateCategory} onValueChange={setNewTemplateCategory}>
                    <SelectTrigger data-testid="select-category">
                      <SelectValue placeholder="Select a category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUCT_CATEGORIES.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button 
                  onClick={handleCreateTemplate}
                  disabled={createMutation.isPending || !newTemplateName.trim()}
                  data-testid="button-confirm-create"
                >
                  Create Template
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-medium mb-2">No Timeline Templates</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
              Create timeline templates to define standard production schedules for this vendor's purchase orders.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {templates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                vendorId={vendorId}
                isExpanded={expandedTemplate === template.id}
                isEditing={editingTemplate === template.id}
                editedMilestones={editedMilestones}
                onToggleExpand={() => setExpandedTemplate(
                  expandedTemplate === template.id ? null : template.id
                )}
                onStartEdit={() => setEditingTemplate(template.id)}
                onCancelEdit={() => {
                  setEditingTemplate(null);
                  setEditedMilestones({});
                }}
                onMilestoneChange={(key, value) => setEditedMilestones(prev => ({ ...prev, [key]: value }))}
                onSave={handleSaveMilestones}
                onDelete={() => deleteMutation.mutate(template.id)}
                isSaving={updateMutation.isPending}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TemplateCardProps {
  template: VendorTimelineTemplate;
  vendorId: number;
  isExpanded: boolean;
  isEditing: boolean;
  editedMilestones: Record<string, number>;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onMilestoneChange: (key: string, value: number) => void;
  onSave: (templateId: number, milestones: VendorTemplateMilestone[]) => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
}

function TemplateCard({
  template,
  vendorId,
  isExpanded,
  isEditing,
  editedMilestones,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onMilestoneChange,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
}: TemplateCardProps) {
  const { data: templateDetails } = useQuery<TemplateWithMilestones>({
    queryKey: ['/api/timeline-templates', template.id],
    enabled: isExpanded,
  });

  const milestones = templateDetails?.milestones || [];

  return (
    <div className="border rounded-lg" data-testid={`template-card-${template.id}`}>
      <div 
        className="flex items-center justify-between p-4 cursor-pointer hover-elevate"
        onClick={onToggleExpand}
      >
        <div className="flex items-center gap-3">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="font-medium">{template.name}</h3>
            {template.productCategory && (
              <Badge variant="outline" className="text-xs mt-1">
                {template.productCategory}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Milestones</h4>
            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); onCancelEdit(); }}
                  >
                    Cancel
                  </Button>
                  <Button 
                    size="sm"
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      onSave(template.id, milestones);
                    }}
                    disabled={isSaving}
                    data-testid="button-save-milestones"
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
                    data-testid="button-edit-template"
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                  <Button 
                    size="sm" 
                    variant="destructive"
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    disabled={isDeleting}
                    data-testid="button-delete-template"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          </div>

          {milestones.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-semibold">Milestone</th>
                    <th className="text-center py-2 px-3 font-semibold">Days from PO Date</th>
                    <th className="text-center py-2 px-3 font-semibold">Depends On</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((m, index) => (
                    <tr key={m.id} className={`border-b ${index % 2 === 0 ? 'bg-muted/30' : ''}`}>
                      <td className="py-2 px-3">
                        {MILESTONE_LABELS[m.milestone] || m.milestone}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editedMilestones[`${m.id}_days`] !== undefined 
                              ? editedMilestones[`${m.id}_days`] 
                              : m.daysFromPoDate}
                            onChange={(e) => onMilestoneChange(`${m.id}_days`, parseInt(e.target.value) || 0)}
                            className="w-20 mx-auto text-center"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`input-days-${m.milestone}`}
                          />
                        ) : (
                          <span>{m.daysFromPoDate} days</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center text-muted-foreground">
                        {m.dependsOnMilestone 
                          ? `${MILESTONE_LABELS[m.dependsOnMilestone] || m.dependsOnMilestone} +${m.daysFromDependency}d`
                          : '-'
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              Loading milestones...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
