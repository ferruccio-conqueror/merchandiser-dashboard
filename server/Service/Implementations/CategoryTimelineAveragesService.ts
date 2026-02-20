import { CategoryTimelineAverage, categoryTimelineAverages, poHeaders, poTimelines, poTimelineMilestones, shipments, inspections } from "@shared/schema";
import { eq, sql, isNull } from "drizzle-orm";
import { db } from "../../db";
import { ICategoryTimelineAveragesService } from "../Abstractions/ICategoryTimelineAveragesService";

export class CategoryTimelineAveragesService implements ICategoryTimelineAveragesService {

    async getCategoryTimelineAverages(): Promise<CategoryTimelineAverage[]> {
        return db.select().from(categoryTimelineAverages);
    }

    async recalculateCategoryTimelineAverages(): Promise<void> {
        // Clear existing averages
        await db.delete(categoryTimelineAverages);

        // Get all POs with timelines and actual dates
        const posWithTimelines = await db
            .select({
                poHeader: poHeaders,
                timeline: poTimelines,
            })
            .from(poHeaders)
            .innerJoin(poTimelines, eq(poHeaders.id, poTimelines.poHeaderId))
            .where(eq(poTimelines.isLocked, true)); // Only use locked/finalized timelines

        // Group by category
        const categoryData: Record<string, {
            category: string;
            rawMaterialsDays: number[];
            initialInspectionDays: number[];
            inlineInspectionDays: number[];
            finalInspectionDays: number[];
            shipDays: number[];
        }> = {};

        for (let i = 0; i < posWithTimelines.length; i++) {
            const row = posWithTimelines[i] as any;
            const po = row.poHeader;
            const timeline = row.timeline;
            const category = po.productCategory || 'Uncategorized';

            if (!categoryData[category]) {
                categoryData[category] = {
                    category,
                    rawMaterialsDays: [],
                    initialInspectionDays: [],
                    inlineInspectionDays: [],
                    finalInspectionDays: [],
                    shipDays: [],
                };
            }

            // Get milestones for this timeline
            const milestones = await db
                .select()
                .from(poTimelineMilestones)
                .where(eq(poTimelineMilestones.timelineId, timeline.id));

            // Calculate days from PO date for each milestone
            if (po.poDate) {
                const poDate = new Date(po.poDate);

                for (let j = 0; j < milestones.length; j++) {
                    const milestone = milestones[j] as any;
                    const actualDate = milestone.actualDate;

                    if (actualDate) {
                        const daysDiff = Math.round(
                            (new Date(actualDate).getTime() - poDate.getTime()) / (1000 * 60 * 60 * 24)
                        );

                        switch (milestone.milestone) {
                            case 'raw_materials_ordered':
                            case 'raw_materials_delivered':
                                categoryData[category].rawMaterialsDays.push(daysDiff);
                                break;
                            case 'production_start':
                                categoryData[category].initialInspectionDays.push(daysDiff);
                                break;
                            case 'inline_inspection':
                                categoryData[category].inlineInspectionDays.push(daysDiff);
                                break;
                            case 'final_inspection':
                                categoryData[category].finalInspectionDays.push(daysDiff);
                                break;
                            case 'etd':
                            case 'hod':
                                categoryData[category].shipDays.push(daysDiff);
                                break;
                        }
                    }
                }
            }
        }

        // Calculate averages and insert
        for (const category in categoryData) {
            const data = categoryData[category];

            const avgRawMaterials = this.calculateAverage(data.rawMaterialsDays);
            const avgInitial = this.calculateAverage(data.initialInspectionDays);
            const avgInline = this.calculateAverage(data.inlineInspectionDays);
            const avgFinal = this.calculateAverage(data.finalInspectionDays);
            const avgShip = this.calculateAverage(data.shipDays);

            const sampleCount = Math.max(
                data.rawMaterialsDays.length,
                data.initialInspectionDays.length,
                data.inlineInspectionDays.length,
                data.finalInspectionDays.length,
                data.shipDays.length
            );

            if (sampleCount > 0) {
                await db.insert(categoryTimelineAverages).values({
                    productCategory: category,
                    avgDaysToRawMaterials: avgRawMaterials,
                    avgDaysToInitialInspection: avgInitial,
                    avgDaysToInlineInspection: avgInline,
                    avgDaysToFinalInspection: avgFinal,
                    avgDaysToShipDate: avgShip,
                    sampleCount,
                    lastCalculatedAt: new Date(),
                } as any);
            }
        }
    }

    private calculateAverage(values: number[]): number | null {
        if (values.length === 0) return null;
        const sum = values.reduce((a, b) => a + b, 0);
        return Math.round(sum / values.length);
    }

    async getTimelineGenerationPreview(): Promise<{
        totalPOs: number;
        posWithTimelines: number;
        posWithoutTimelines: number;
        byCategory: { category: string; count: number; hasAverages: boolean }[];
    }> {
        // Count total POs
        const totalPOsResult = await db.select({ count: sql<number>`COUNT(*)` }).from(poHeaders);
        const totalPOs = Number(totalPOsResult[0]?.count) || 0;

        // Count POs with timelines
        const posWithTimelinesResult = await db
            .select({ count: sql<number>`COUNT(DISTINCT ${poHeaders.id})` })
            .from(poHeaders)
            .innerJoin(poTimelines, eq(poHeaders.id, poTimelines.poHeaderId));
        const posWithTimelines = Number(posWithTimelinesResult[0]?.count) || 0;

        const posWithoutTimelines = totalPOs - posWithTimelines;

        // Get category breakdown
        const categoryBreakdown = await db
            .select({
                category: poHeaders.productCategory,
                count: sql<number>`COUNT(*)`,
            })
            .from(poHeaders)
            .leftJoin(poTimelines, eq(poHeaders.id, poTimelines.poHeaderId))
            .where(isNull(poTimelines.id))
            .groupBy(poHeaders.productCategory);

        // Get available averages
        const averages = await this.getCategoryTimelineAverages();
        const categoriesWithAverages = new Set(averages.map((a: any) => a.productCategory));

        const byCategory = [];
        for (let i = 0; i < categoryBreakdown.length; i++) {
            const row = categoryBreakdown[i] as any;
            byCategory.push({
                category: row.category || 'Uncategorized',
                count: Number(row.count) || 0,
                hasAverages: categoriesWithAverages.has(row.category),
            });
        }

        return {
            totalPOs,
            posWithTimelines,
            posWithoutTimelines,
            byCategory,
        };
    }

    async bulkGenerateTimelinesFromCategoryAverages(dryRun: boolean = true, limit: number = 100): Promise<{
        success: boolean;
        timelinesCreated: number;
        milestonesCreated: number;
        errors: string[];
        dryRun: boolean;
    }> {
        const errors: string[] = [];
        let timelinesCreated = 0;
        let milestonesCreated = 0;

        try {
            // Get POs without timelines
            const posWithoutTimelines = await db
                .select()
                .from(poHeaders)
                .leftJoin(poTimelines, eq(poHeaders.id, poTimelines.poHeaderId))
                .where(isNull(poTimelines.id))
                .limit(limit);

            // Get category averages
            const averages = await this.getCategoryTimelineAverages();
            const averagesByCategory: Record<string, CategoryTimelineAverage> = {};
            for (let i = 0; i < averages.length; i++) {
                const avg = averages[i] as any;
                averagesByCategory[avg.productCategory] = avg;
            }

            for (let i = 0; i < posWithoutTimelines.length; i++) {
                const row = posWithoutTimelines[i] as any;
                const po = row.po_headers;
                const category = po.productCategory || 'Uncategorized';
                const categoryAvg = averagesByCategory[category];

                if (!categoryAvg) {
                    errors.push(`No averages found for category: ${category} (PO: ${po.poNumber})`);
                    continue;
                }

                if (!po.poDate) {
                    errors.push(`No PO date for: ${po.poNumber}`);
                    continue;
                }

                if (!dryRun) {
                    // Create timeline
                    const timelineResult = await db
                        .insert(poTimelines)
                        .values({
                            poHeaderId: po.id,
                            isLocked: false,
                        } as any)
                        .returning();

                    const timeline = timelineResult[0];
                    timelinesCreated++;

                    // Create milestones based on averages
                    const poDate = new Date(po.poDate);
                    const milestones = [
                        { milestone: 'raw_materials_ordered', days: categoryAvg.avgDaysToRawMaterials, sortOrder: 1 },
                        { milestone: 'production_start', days: categoryAvg.avgDaysToInitialInspection, sortOrder: 2 },
                        { milestone: 'inline_inspection', days: categoryAvg.avgDaysToInlineInspection, sortOrder: 3 },
                        { milestone: 'final_inspection', days: categoryAvg.avgDaysToFinalInspection, sortOrder: 4 },
                        { milestone: 'etd', days: categoryAvg.avgDaysToShipDate, sortOrder: 5 },
                    ];

                    for (let j = 0; j < milestones.length; j++) {
                        const m = milestones[j];
                        if (m.days) {
                            const plannedDate = new Date(poDate);
                            plannedDate.setDate(plannedDate.getDate() + m.days);

                            await db.insert(poTimelineMilestones).values({
                                timelineId: timeline.id,
                                milestone: m.milestone,
                                plannedDate,
                                sortOrder: m.sortOrder,
                            } as any);

                            milestonesCreated++;
                        }
                    }
                }
            }

            return {
                success: true,
                timelinesCreated,
                milestonesCreated,
                errors,
                dryRun,
            };
        } catch (error: any) {
            errors.push(`Fatal error: ${error.message}`);
            return {
                success: false,
                timelinesCreated,
                milestonesCreated,
                errors,
                dryRun,
            };
        }
    }
}