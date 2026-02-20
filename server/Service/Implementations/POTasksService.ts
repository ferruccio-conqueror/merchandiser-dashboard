import { PoTask, InsertPoTask, poTasks, poHeaders, inspections, complianceStyles } from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "../../db";
import { IPOTaskService } from "../Abstractions/IPOTasksService";

export class POTasksService implements IPOTaskService {

    async getPoTasksByPoNumber(poNumber: string, includeCompleted?: boolean): Promise<PoTask[]> {
        const conditions = [eq(poTasks.poNumber, poNumber)];
        
        if (!includeCompleted) {
            conditions.push(eq(poTasks.isCompleted, false));
        }

        return db
            .select()
            .from(poTasks)
            .where(and(...conditions))
            .orderBy(desc(poTasks.priority), poTasks.dueDate);
    }

    async getPoTaskById(id: number): Promise<PoTask | undefined> {
        const result = await db
            .select()
            .from(poTasks)
            .where(eq(poTasks.id, id));
        
        return result[0];
    }

    async createPoTask(task: InsertPoTask): Promise<PoTask> {
        const result = await db
            .insert(poTasks)
            .values(task as any)
            .returning();
        
        return result[0];
    }

    async updatePoTask(id: number, task: Partial<InsertPoTask>): Promise<PoTask | undefined> {
        const result = await db
            .update(poTasks)
            .set({ ...task, updatedAt: new Date() })
            .where(eq(poTasks.id, id))
            .returning();
        
        return result[0];
    }

    async completePoTask(id: number, completedBy: string): Promise<PoTask | undefined> {
        const result = await db
            .update(poTasks)
            .set({
                isCompleted: true,
                completedAt: new Date(),
                completedBy,
                updatedAt: new Date(),
            })
            .where(eq(poTasks.id, id))
            .returning();
        
        return result[0];
    }

    async uncompletePoTask(id: number): Promise<PoTask | undefined> {
        const result = await db
            .update(poTasks)
            .set({
                isCompleted: false,
                completedAt: null,
                completedBy: null,
                updatedAt: new Date(),
            })
            .where(eq(poTasks.id, id))
            .returning();
        
        return result[0];
    }

    async deletePoTask(id: number): Promise<boolean> {
        const result = await db
            .delete(poTasks)
            .where(eq(poTasks.id, id))
            .returning();
        
        return result.length > 0;
    }

    async generatePoTasksFromData(poNumber: string): Promise<PoTask[]> {
        const generatedTasks: PoTask[] = [];

        // Get PO header
        const poHeaderResult = await db
            .select()
            .from(poHeaders)
            .where(eq(poHeaders.poNumber, poNumber));

        if (poHeaderResult.length === 0) {
            return generatedTasks;
        }

        const poHeader = poHeaderResult[0];
        const poHeaderId = poHeader.id;

        // 1. Check for missing inspections
        const existingInspections = await db
            .select()
            .from(inspections)
            .where(eq(inspections.poNumber, poNumber));

        const hasInitial = existingInspections.some((i: any) => i.inspectionType === 'Initial');
        const hasInline = existingInspections.some((i: any) => i.inspectionType === 'Inline');
        const hasFinal = existingInspections.some((i: any) => i.inspectionType === 'Final');

        // Generate inspection booking tasks
        if (!hasInitial && poHeader.originalShipDate) {
            const dueDate = new Date(poHeader.originalShipDate);
            dueDate.setDate(dueDate.getDate() - 45); // 45 days before ship date

            const task = await this.createPoTask({
                poNumber,
                poHeaderId,
                taskSource: 'inspection',
                taskType: 'book_inline',
                title: 'Book Initial Inspection',
                description: `Initial inspection needs to be scheduled for PO ${poNumber}`,
                dueDate,
                priority: 'high',
            } as any);

            generatedTasks.push(task);
        }

        if (!hasInline && poHeader.originalShipDate) {
            const dueDate = new Date(poHeader.originalShipDate);
            dueDate.setDate(dueDate.getDate() - 30); // 30 days before ship date

            const task = await this.createPoTask({
                poNumber,
                poHeaderId,
                taskSource: 'inspection',
                taskType: 'book_inline',
                title: 'Book Inline Inspection',
                description: `Inline inspection needs to be scheduled for PO ${poNumber}`,
                dueDate,
                priority: 'high',
            } as any);

            generatedTasks.push(task);
        }

        if (!hasFinal && poHeader.originalShipDate) {
            const dueDate = new Date(poHeader.originalShipDate);
            dueDate.setDate(dueDate.getDate() - 14); // 14 days before ship date

            const task = await this.createPoTask({
                poNumber,
                poHeaderId,
                taskSource: 'inspection',
                taskType: 'book_final',
                title: 'Book Final Inspection',
                description: `Final inspection needs to be scheduled for PO ${poNumber}`,
                dueDate,
                priority: 'urgent',
            } as any);

            generatedTasks.push(task);
        }

        // 2. Check for failed inspections requiring follow-up
        const failedInspections = existingInspections.filter((i: any) => i.result === 'Failed');
        for (let i = 0; i < failedInspections.length; i++) {
            const inspection = failedInspections[i];
            const task = await this.createPoTask({
                poNumber,
                poHeaderId,
                taskSource: 'inspection',
                taskType: 'follow_up_failed',
                title: `Follow up on Failed ${inspection.inspectionType} Inspection`,
                description: `Inspection failed on ${inspection.inspectionDate}. Review findings and coordinate corrections.`,
                dueDate: new Date(), // Immediate
                priority: 'urgent',
                relatedEntityType: 'inspection',
                relatedEntityId: inspection.id,
            } as any);

            generatedTasks.push(task);
        }

        // 3. Check for missing compliance tests
        const complianceRecords = await db
            .select()
            .from(complianceStyles)
            .where(eq(complianceStyles.poNumber, poNumber));

        for (let i = 0; i < complianceRecords.length; i++) {
            const compliance = complianceRecords[i] as any;

            // Check for expired or missing mandatory tests
            if (compliance.mandatoryStatus === 'Expired' || compliance.mandatoryStatus === 'Outstanding') {
                const task = await this.createPoTask({
                    poNumber,
                    poHeaderId,
                    taskSource: 'compliance',
                    taskType: 'follow_up_test_report',
                    title: 'Follow up on Mandatory Test',
                    description: `Mandatory test for style ${compliance.style} is ${compliance.mandatoryStatus}. Coordinate with vendor.`,
                    dueDate: compliance.mandatoryExpiryDate || new Date(),
                    priority: 'urgent',
                } as any);

                generatedTasks.push(task);
            }

            // Check for expired or missing performance tests
            if (compliance.performanceStatus === 'Expired' || compliance.performanceStatus === 'Outstanding') {
                const task = await this.createPoTask({
                    poNumber,
                    poHeaderId,
                    taskSource: 'compliance',
                    taskType: 'follow_up_test_report',
                    title: 'Follow up on Performance Test',
                    description: `Performance test for style ${compliance.style} is ${compliance.performanceStatus}. Coordinate with vendor.`,
                    dueDate: compliance.performanceExpiryDate || new Date(),
                    priority: 'high',
                } as any);

                generatedTasks.push(task);
            }
        }

        // 4. Check for missing shipment bookings
        if (poHeader.originalShipDate && !poHeader.ptsNumber) {
            const dueDate = new Date(poHeader.originalShipDate);
            dueDate.setDate(dueDate.getDate() - 21); // 3 weeks before ship date

            const task = await this.createPoTask({
                poNumber,
                poHeaderId,
                taskSource: 'shipment',
                taskType: 'book_shipment',
                title: 'Book Shipment',
                description: `Shipment booking required for PO ${poNumber}. Original ship date: ${poHeader.originalShipDate.toLocaleDateString()}`,
                dueDate,
                priority: 'high',
            } as any);

            generatedTasks.push(task);
        }

        // 5. Check for overdue shipments (if ship date passed and no PTS)
        if (poHeader.originalShipDate && new Date() > poHeader.originalShipDate && !poHeader.ptsNumber) {
            const task = await this.createPoTask({
                poNumber,
                poHeaderId,
                taskSource: 'shipment',
                taskType: 'follow_up_pts',
                title: 'Follow up on Overdue Shipment',
                description: `PO ${poNumber} is overdue (ship date: ${poHeader.originalShipDate.toLocaleDateString()}). No PTS number recorded.`,
                dueDate: new Date(),
                priority: 'urgent',
            } as any);

            generatedTasks.push(task);
        }

        return generatedTasks;
    }

    async regenerateTasksForImportedPOs(poNumbers: string[]): Promise<{ poNumber: string; tasksGenerated: number }[]> {
        const results: { poNumber: string; tasksGenerated: number }[] = [];
        
        for (let i = 0; i < poNumbers.length; i++) {
            const poNumber = poNumbers[i];
            
            // Delete existing auto-generated tasks for this PO (keep manual tasks)
            await db
                .delete(poTasks)
                .where(
                    and(
                        eq(poTasks.poNumber, poNumber),
                        eq(poTasks.isCompleted, false)
                    )
                );
            
            // Generate fresh tasks
            const tasks = await this.generatePoTasksFromData(poNumber);
            
            results.push({
                poNumber,
                tasksGenerated: tasks.length,
            });
        }
        
        return results;
    }
}