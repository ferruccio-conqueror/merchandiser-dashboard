import { PoTimeline, PoTimelineMilestone, poTimelines, poTimelineMilestones, poHeaders, vendorTimelineTemplates, vendorTemplateMilestones, shipments, inspections } from "@shared/schema";
import { eq, and, lt, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { IPOTimelineService } from "../Abstractions/IPOTimelineService";

export class POTimelineService implements IPOTimelineService {

    async getPoTimelineByPoId(poId: number): Promise<{
        timeline: PoTimeline | null;
        milestones: PoTimelineMilestone[];
    }> {
        // Get timeline
        const timelineResult = await db
            .select()
            .from(poTimelines)
            .where(eq(poTimelines.poId, poId));

        const timeline = timelineResult.length > 0 ? timelineResult[0] : null;

        // Get milestones if timeline exists
        let milestones: PoTimelineMilestone[] = [];
        if (timeline) {
            milestones = await db
                .select()
                .from(poTimelineMilestones)
                .where(eq(poTimelineMilestones.timelineId, timeline.id))
                .orderBy(poTimelineMilestones.sortOrder);
        }

        return { timeline, milestones };
    }

    async createPoTimeline(poId: number, templateId?: number): Promise<PoTimeline> {
        const result = await db
            .insert(poTimelines)
            .values({
                poId,
                templateId: templateId || null,
                isLocked: false,
            } as any)
            .returning();

        return result[0];
    }

    async updatePoTimelineMilestone(
        id: number,
        data: {
            revisedDate?: Date | null;
            actualDate?: Date | null;
            actualSource?: string | null;
            notes?: string | null;
        }
    ): Promise<PoTimelineMilestone | undefined> {
        const result = await db
            .update(poTimelineMilestones)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(poTimelineMilestones.id, id))
            .returning();

        return result[0];
    }

    async lockPoTimeline(poId: number, lockedBy: string): Promise<PoTimeline | undefined> {
        const result = await db
            .update(poTimelines)
            .set({
                isLocked: true,
                lockedAt: new Date(),
                lockedBy,
                updatedAt: new Date(),
            })
            .where(eq(poTimelines.poId, poId))
            .returning();

        return result[0];
    }

    async syncPoTimelineActuals(poId: number): Promise<PoTimelineMilestone[]> {
        const { timeline, milestones } = await this.getPoTimelineByPoId(poId);

        if (!timeline) {
            return [];
        }

        // Get PO header for data
        const poHeaderResult = await db
            .select()
            .from(poHeaders)
            .where(eq(poHeaders.id, poId));

        if (poHeaderResult.length === 0) {
            return milestones;
        }

        const poHeader = poHeaderResult[0];

        // Get shipment data
        const shipmentsData = await db
            .select()
            .from(shipments)
            .where(eq(shipments.poHeaderId, poId));

        // Get inspection data
        const inspectionsData = await db
            .select()
            .from(inspections)
            .where(eq(inspections.poHeaderId, poId));

        const updatedMilestones: PoTimelineMilestone[] = [];

        // Sync each milestone
        for (let i = 0; i < milestones.length; i++) {
            const milestone = milestones[i] as any;
            let actualDate: Date | null = null;
            let actualSource: string | null = null;

            // Map milestones to actual data
            switch (milestone.milestone) {
                case 'po_confirmation':
                    if (poHeader.confirmationDate) {
                        actualDate = poHeader.confirmationDate;
                        actualSource = 'system';
                    }
                    break;

                case 'inline_inspection':
                    const inlineInspection = inspectionsData.find((i: any) => i.inspectionType === 'Inline');
                    if (inlineInspection && inlineInspection.inspectionDate) {
                        actualDate = inlineInspection.inspectionDate;
                        actualSource = 'inspection';
                    }
                    break;

                case 'final_inspection':
                    const finalInspection = inspectionsData.find((i: any) => i.inspectionType === 'Final');
                    if (finalInspection && finalInspection.inspectionDate) {
                        actualDate = finalInspection.inspectionDate;
                        actualSource = 'inspection';
                    }
                    break;

                case 'hod':
                    if (shipmentsData.length > 0 && shipmentsData[0].deliveryToConsolidator) {
                        actualDate = shipmentsData[0].deliveryToConsolidator;
                        actualSource = 'shipment';
                    }
                    break;

                case 'etd':
                    if (shipmentsData.length > 0 && shipmentsData[0].actualSailingDate) {
                        actualDate = shipmentsData[0].actualSailingDate;
                        actualSource = 'shipment';
                    }
                    break;
            }

            // Update if actual date found
            if (actualDate) {
                const updated = await this.updatePoTimelineMilestone(milestone.id, {
                    actualDate,
                    actualSource,
                });

                if (updated) {
                    updatedMilestones.push(updated);
                }
            } else {
                updatedMilestones.push(milestone);
            }
        }

        return updatedMilestones;
    }

    async initializePoTimelineFromTemplate(
        poId: number,
        templateId: number,
        poDate: Date
    ): Promise<PoTimelineMilestone[]> {
        // Create timeline
        const timeline = await this.createPoTimeline(poId, templateId);

        // Get template milestones
        const templateMilestonesData = await db
            .select()
            .from(vendorTemplateMilestones)
            .where(eq(vendorTemplateMilestones.templateId, templateId))
            .orderBy(vendorTemplateMilestones.sortOrder);

        const createdMilestones: PoTimelineMilestone[] = [];

        // Create milestone records
        for (let i = 0; i < templateMilestonesData.length; i++) {
            const templateMilestone = templateMilestonesData[i] as any;

            // Calculate planned date based on PO date + days offset
            const plannedDate = new Date(poDate);
            plannedDate.setDate(plannedDate.getDate() + templateMilestone.daysFromPoDate);

            const result = await db
                .insert(poTimelineMilestones)
                .values({
                    timelineId: timeline.id,
                    milestone: templateMilestone.milestone,
                    plannedDate,
                    revisedDate: null,
                    actualDate: null,
                    actualSource: null,
                    notes: null,
                    sortOrder: templateMilestone.sortOrder,
                } as any)
                .returning();

            createdMilestones.push(result[0]);
        }

        return createdMilestones;
    }

    async getAtRiskTimelineMilestones(client?: string, daysThreshold: number = 7): Promise<Array<{
        id: number;
        milestone: string;
        poId: number;
        poNumber: string;
        vendor: string | null;
        targetDate: Date;
        daysUntilDue: number;
        status: 'at-risk' | 'overdue';
    }>> {
        const today = new Date();
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

        // Query to get at-risk milestones
        const query = await db
            .select({
                milestone: poTimelineMilestones,
                timeline: poTimelines,
                po: poHeaders,
            })
            .from(poTimelineMilestones)
            .innerJoin(poTimelines, eq(poTimelineMilestones.timelineId, poTimelines.id))
            .innerJoin(poHeaders, eq(poTimelines.poHeaderId, poHeaders.id))
            .where(
                and(
                    isNull(poTimelineMilestones.actualDate), // Not completed
                    or(
                        lt(poTimelineMilestones.revisedDate, thresholdDate),
                        and(
                            isNull(poTimelineMilestones.revisedDate),
                            lt(poTimelineMilestones.plannedDate, thresholdDate)
                        )
                    )
                )
            );

        const results: Array<{
            id: number;
            milestone: string;
            poId: number;
            poNumber: string;
            vendor: string | null;
            targetDate: Date;
            daysUntilDue: number;
            status: 'at-risk' | 'overdue';
        }> = [];

        for (let i = 0; i < query.length; i++) {
            const row = query[i] as any;
            const milestone = row.milestone;
            const po = row.po;

            // Apply client filter if provided
            if (client && po.client !== client) {
                continue;
            }

            // Determine target date (revised if exists, otherwise planned)
            const targetDate = milestone.revisedDate || milestone.plannedDate;

            if (!targetDate) continue;

            // Calculate days until due
            const timeDiff = targetDate.getTime() - today.getTime();
            const daysUntilDue = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

            // Determine status
            const status: 'at-risk' | 'overdue' = daysUntilDue < 0 ? 'overdue' : 'at-risk';

            results.push({
                id: milestone.id,
                milestone: milestone.milestone,
                poId: po.id,
                poNumber: po.poNumber,
                vendor: po.vendor,
                targetDate,
                daysUntilDue,
                status,
            });
        }

        return results;
    }
}