import { VendorTimelineTemplate, VendorTemplateMilestone, InsertVendorTimelineTemplate, InsertVendorTemplateMilestone } from "@shared/schema";

export interface IPOTimelineService {
    // Vendor Timeline Template operations
    getVendorTimelineTemplates(vendorId: number): Promise<VendorTimelineTemplate[]>;
    getVendorTimelineTemplateById(id: number): Promise<{
        template: VendorTimelineTemplate | null;
        milestones: VendorTemplateMilestone[];
    }>;
    createVendorTimelineTemplate(template: InsertVendorTimelineTemplate): Promise<VendorTimelineTemplate>;
    updateVendorTimelineTemplate(id: number, template: Partial<InsertVendorTimelineTemplate>): Promise<VendorTimelineTemplate | undefined>;
    deleteVendorTimelineTemplate(id: number): Promise<boolean>;
    setVendorTemplateMilestones(templateId: number, milestones: InsertVendorTemplateMilestone[]): Promise<VendorTemplateMilestone[]>;
}