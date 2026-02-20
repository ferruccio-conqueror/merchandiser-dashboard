import { InsertVendorCapacityData, InsertVendorCapacitySummary, InsertVendorTemplateMilestone, InsertVendorTimelineTemplate, poHeaders, VendorCapacityData, vendorCapacityData, vendorCapacitySummary, VendorCapacitySummary, vendors, VendorTemplateMilestone, vendorTemplateMilestones, VendorTimelineTemplate, vendorTimelineTemplates } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IVendorTimelineTemplateService } from "../Abstractions/IVendorTimelineTemplateService";

export class VendorTimelineTemplateService implements IVendorTimelineTemplateService {

    // Vendor Timeline Template operations
    async getVendorTimelineTemplates(vendorId: number): Promise<VendorTimelineTemplate[]> {
        const result = await db.select()
            .from(vendorTimelineTemplates)
            .where(and(
                eq(vendorTimelineTemplates.vendorId, vendorId),
                eq(vendorTimelineTemplates.isActive, true)
            ))
            .orderBy(vendorTimelineTemplates.name);
        return result;
    }

    async getVendorTimelineTemplateById(id: number): Promise<{
        template: VendorTimelineTemplate | null;
        milestones: VendorTemplateMilestone[];
    }> {
        const templateResult = await db.select()
            .from(vendorTimelineTemplates)
            .where(eq(vendorTimelineTemplates.id, id));

        const template = templateResult[0] || null;

        if (!template) {
            return { template: null, milestones: [] };
        }

        const milestones = await db.select()
            .from(vendorTemplateMilestones)
            .where(eq(vendorTemplateMilestones.templateId, template.id))
            .orderBy(vendorTemplateMilestones.sortOrder);

        return { template, milestones };
    }

    async createVendorTimelineTemplate(template: InsertVendorTimelineTemplate): Promise<VendorTimelineTemplate> {
        const result = await db.insert(vendorTimelineTemplates)
            .values(template)
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
        // Soft delete by marking as inactive
        const result = await db
            .update(vendorTimelineTemplates)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(vendorTimelineTemplates.id, id))
            .returning();
        return result.length > 0;
    }

    async setVendorTemplateMilestones(templateId: number, milestones: InsertVendorTemplateMilestone[]): Promise<VendorTemplateMilestone[]> {
        // Delete existing milestones
        await db.delete(vendorTemplateMilestones)
            .where(eq(vendorTemplateMilestones.templateId, templateId));

        if (milestones.length === 0) return [];

        // Insert new milestones
        const result = await db.insert(vendorTemplateMilestones)
            .values(milestones.map((m, index) => ({
                ...m,
                templateId,
                sortOrder: m.sortOrder ?? index,
            })))
            .returning();

        return result;
    }

}