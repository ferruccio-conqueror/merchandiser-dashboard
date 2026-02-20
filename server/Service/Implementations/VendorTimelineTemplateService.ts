import { VendorTimelineTemplate, VendorTemplateMilestone, InsertVendorTimelineTemplate, InsertVendorTemplateMilestone, vendorTimelineTemplates, vendorTemplateMilestones } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { IPOTimelineService } from "../Abstractions/IVendorTimelineTemplateService";

export class VendorTimelineTemplateService implements IPOTimelineService {

    async getVendorTimelineTemplates(vendorId: number): Promise<VendorTimelineTemplate[]> {
        return db
            .select()
            .from(vendorTimelineTemplates)
            .where(eq(vendorTimelineTemplates.vendorId, vendorId))
            .orderBy(vendorTimelineTemplates.name);
    }

    async getVendorTimelineTemplateById(id: number): Promise<{
        template: VendorTimelineTemplate | null;
        milestones: VendorTemplateMilestone[];
    }> {
        // Get template
        const templateResult = await db
            .select()
            .from(vendorTimelineTemplates)
            .where(eq(vendorTimelineTemplates.id, id));

        const template = templateResult.length > 0 ? templateResult[0] : null;

        // Get milestones if template exists
        let milestones: VendorTemplateMilestone[] = [];
        if (template) {
            milestones = await db
                .select()
                .from(vendorTemplateMilestones)
                .where(eq(vendorTemplateMilestones.templateId, id))
                .orderBy(vendorTemplateMilestones.sortOrder);
        }

        return { template, milestones };
    }

    async createVendorTimelineTemplate(template: InsertVendorTimelineTemplate): Promise<VendorTimelineTemplate> {
        const result = await db
            .insert(vendorTimelineTemplates)
            .values(template as any)
            .returning();
        
        return result[0];
    }

    async updateVendorTimelineTemplate(id: number, template: Partial<InsertVendorTimelineTemplate>): Promise<VendorTimelineTemplate | undefined> {
        const result = await db
            .update(vendorTimelineTemplates)
            .set({ ...template, updatedAt: new Date() })
            .where(eq(vendorTimelineTemplates.id, id))
            .returning();
        
        return result[0];
    }

    async deleteVendorTimelineTemplate(id: number): Promise<boolean> {
        // Delete associated milestones first (cascade)
        await db
            .delete(vendorTemplateMilestones)
            .where(eq(vendorTemplateMilestones.templateId, id));

        // Delete template
        const result = await db
            .delete(vendorTimelineTemplates)
            .where(eq(vendorTimelineTemplates.id, id))
            .returning();
        
        return result.length > 0;
    }

    async setVendorTemplateMilestones(templateId: number, milestones: InsertVendorTemplateMilestone[]): Promise<VendorTemplateMilestone[]> {
        // Delete existing milestones
        await db
            .delete(vendorTemplateMilestones)
            .where(eq(vendorTemplateMilestones.templateId, templateId));

        // Insert new milestones
        if (milestones.length === 0) return [];

        const result = await db
            .insert(vendorTemplateMilestones)
            .values(milestones as any)
            .returning();
        
        return result;
    }
}