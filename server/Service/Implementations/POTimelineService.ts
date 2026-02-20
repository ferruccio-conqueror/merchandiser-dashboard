import { inspections, poHeaders, PoTimeline, PoTimelineMilestone, poTimelineMilestones, poTimelines, PurchaseOrder, shipments, vendorTemplateMilestones } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IPOTimelineService } from "../Abstractions/IPOTimelineService";

export class POTimelineService implements IPOTimelineService {



    // PO Timeline operations
    async getPoTimelineByPoId(poId: number): Promise<{
        timeline: PoTimeline | null;
        milestones: PoTimelineMilestone[];
    }> {
        const timelineResult = await db.select()
            .from(poTimelines)
            .where(eq(poTimelines.poId, poId));

        const timeline = timelineResult[0] || null;

        if (!timeline) {
            return { timeline: null, milestones: [] };
        }

        const milestones = await db.select()
            .from(poTimelineMilestones)
            .where(eq(poTimelineMilestones.timelineId, timeline.id))
            .orderBy(poTimelineMilestones.sortOrder);

        return { timeline, milestones };
    }

    async createPoTimeline(poId: number, templateId?: number): Promise<PoTimeline> {
        const result = await db.insert(poTimelines).values({
            poId,
            templateId: templateId || null,
            isLocked: false,
        }).returning();
        return result[0];
    }

    async updatePoTimelineMilestone(id: number, data: {
        revisedDate?: Date | null;
        actualDate?: Date | null;
        actualSource?: string | null;
        notes?: string | null
    }): Promise<PoTimelineMilestone | undefined> {
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
                updatedAt: new Date()
            })
            .where(eq(poTimelines.poId, poId))
            .returning();
        return result[0];
    }

    async syncPoTimelineActuals(poId: number): Promise<PoTimelineMilestone[]> {
        // Get the PO to find its po_number for shipment lookup
        const po = await this.getPurchaseOrderById(poId);
        if (!po) return [];

        const { timeline, milestones } = await this.getPoTimelineByPoId(poId);
        if (!timeline) return [];

        // Get shipment data for this PO
        const shipmentData = await db.select()
            .from(shipments)
            .where(eq(shipments.poId, poId))
            .orderBy(desc(shipments.createdAt))
            .limit(1);

        const shipment = shipmentData[0];

        // Get inspection data for this PO
        const inspectionData = await db.select()
            .from(inspections)
            .where(eq(inspections.poNumber, po.poNumber));

        const updatedMilestones: PoTimelineMilestone[] = [];

        for (const milestone of milestones) {
            let actualDate: Date | null = null;
            let actualSource: string = 'shipment';

            switch (milestone.milestone) {
                case 'hod':
                    // HOD from shipment deliveryToConsolidator
                    if (shipment?.deliveryToConsolidator) {
                        actualDate = new Date(shipment.deliveryToConsolidator);
                    }
                    break;
                case 'etd':
                    // ETD from shipment actualSailingDate
                    if (shipment?.actualSailingDate) {
                        actualDate = new Date(shipment.actualSailingDate);
                    }
                    break;
                case 'inline_inspection':
                    // Find inline inspection
                    const inlineInsp = inspectionData.find(i =>
                        i.inspectionType?.toLowerCase().includes('inline')
                    );
                    if (inlineInsp?.inspectionDate) {
                        actualDate = new Date(inlineInsp.inspectionDate);
                        actualSource = 'inspection';
                    }
                    break;
                case 'final_inspection':
                    // Find final inspection
                    const finalInsp = inspectionData.find(i =>
                        i.inspectionType?.toLowerCase().includes('final') &&
                        !i.inspectionType?.toLowerCase().includes('re-final')
                    );
                    if (finalInsp?.inspectionDate) {
                        actualDate = new Date(finalInsp.inspectionDate);
                        actualSource = 'inspection';
                    }
                    break;
                default:
                    // Other milestones are manual - don't auto-sync
                    continue;
            }

            if (actualDate && (!milestone.actualDate || milestone.actualSource !== 'manual')) {
                const updated = await this.updatePoTimelineMilestone(milestone.id, {
                    actualDate,
                    actualSource,
                });
                if (updated) updatedMilestones.push(updated);
            }
        }

        return updatedMilestones;
    }

    async initializePoTimelineFromTemplate(poId: number, templateId: number, poDate: Date): Promise<PoTimelineMilestone[]> {
        // Get the template milestones
        const templateMilestones = await db.select()
            .from(vendorTemplateMilestones)
            .where(eq(vendorTemplateMilestones.templateId, templateId))
            .orderBy(vendorTemplateMilestones.sortOrder);

        // Get or create the PO timeline
        let { timeline } = await this.getPoTimelineByPoId(poId);
        if (!timeline) {
            timeline = await this.createPoTimeline(poId, templateId);
        }

        // Calculate planned dates and create milestones
        const milestoneValues: any[] = [];
        const calculatedDates: Record<string, Date> = {};

        for (const tm of templateMilestones) {
            let plannedDate: Date;

            if (tm.dependsOnMilestone && tm.daysFromDependency !== null) {
                // Calculate from dependency
                const dependencyDate = calculatedDates[tm.dependsOnMilestone];
                if (dependencyDate) {
                    plannedDate = new Date(dependencyDate);
                    plannedDate.setDate(plannedDate.getDate() + (tm.daysFromDependency || 0));
                } else {
                    // Fallback to PO date calculation
                    plannedDate = new Date(poDate);
                    plannedDate.setDate(plannedDate.getDate() + tm.daysFromPoDate);
                }
            } else {
                // Calculate from PO date
                plannedDate = new Date(poDate);
                plannedDate.setDate(plannedDate.getDate() + tm.daysFromPoDate);
            }

            calculatedDates[tm.milestone] = plannedDate;

            milestoneValues.push({
                timelineId: timeline.id,
                milestone: tm.milestone,
                plannedDate,
                revisedDate: plannedDate, // Initially same as planned
                sortOrder: tm.sortOrder,
            });
        }

        // Delete existing milestones and insert new ones
        await db.delete(poTimelineMilestones)
            .where(eq(poTimelineMilestones.timelineId, timeline.id));

        if (milestoneValues.length > 0) {
            const result = await db.insert(poTimelineMilestones)
                .values(milestoneValues)
                .returning();
            return result;
        }

        return [];
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
        // Use raw SQL for proper filtering and deduplication
        // Only include milestones for ACTIVE POs (not closed, shipped, cancelled)
        // Join to a deduplicated active_pos CTE to avoid SKU-based row multiplication
        // Filter out POs where all SKUs are discontinued
        const result = await db.execute<{
            id: number;
            milestone: string;
            po_id: number;
            po_number: string;
            vendor: string | null;
            target_date: Date;
            days_until_due: number;
        }>(sql`
          WITH active_pos AS (
            SELECT DISTINCT ph.id as header_id, ph.po_number, ph.vendor, ph.client
            FROM po_headers ph
            WHERE UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
              AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
              AND COALESCE(ph.total_value, 0) > 0
              AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
              AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
              AND EXISTS (
                SELECT 1 FROM po_line_items pli
                LEFT JOIN skus s ON pli.sku = s.sku
                WHERE pli.po_header_id = ph.id
                  AND (s.status IS NULL OR s.status != 'discontinued')
              )
          )
          SELECT DISTINCT
            ptm.id,
            ptm.milestone,
            pt.po_header_id as po_id,
            ap.po_number,
            ap.vendor,
            COALESCE(ptm.revised_date, ptm.planned_date) as target_date,
            (COALESCE(ptm.revised_date, ptm.planned_date)::date - CURRENT_DATE)::int as days_until_due
          FROM po_timeline_milestones ptm
          JOIN po_timelines pt ON ptm.timeline_id = pt.id
          JOIN po_headers ph ON pt.po_header_id = ph.id
          JOIN active_pos ap ON ap.po_number = ph.po_number
          WHERE ptm.actual_date IS NULL
            AND COALESCE(ptm.revised_date, ptm.planned_date) <= CURRENT_DATE + INTERVAL '${sql.raw(String(daysThreshold))} days'
            ${client ? sql`AND ap.client = (SELECT c.name FROM clients c WHERE c.code = ${client})` : sql``}
          ORDER BY days_until_due ASC
          LIMIT 5000
        `);

        return result.rows.map(row => ({
            id: row.id,
            milestone: row.milestone,
            poId: row.po_id,
            poNumber: row.po_number,
            vendor: row.vendor,
            targetDate: new Date(row.target_date),
            daysUntilDue: row.days_until_due,
            status: (row.days_until_due < 0 ? 'overdue' : 'at-risk') as 'at-risk' | 'overdue',
        }));
    }


    async getPurchaseOrderById(id: number): Promise<PurchaseOrder | undefined> {
        const result = await db.select().from(poHeaders).where(eq(poHeaders.id, id));
        if (!result[0]) return undefined;
        const header = result[0];
        return {
            ...header,
            sku: null,
            style: null,
            sellerStyle: null,
            newSku: null,
            newStyle: null,
            bigBets: null,
            cbxItem: null,
            orderQuantity: header.totalQuantity,
            unitPrice: 0,
            createdBy: null,
            updatedBy: null,
        } as PurchaseOrder;
    }
}