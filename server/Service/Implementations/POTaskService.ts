import { activityLogs, InsertPoTask, inspections, MILESTONE_LABELS, poHeaders, PoTask, poTasks, poTimelineMilestones, poTimelines, qualityTests, shipments } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IPOTaskService } from "../Abstractions/IPOTasksService";;

export class POTaskService implements IPOTaskService {

    // PO Tasks operations
    async getPoTasksByPoNumber(poNumber: string, includeCompleted: boolean = false): Promise<PoTask[]> {
        const conditions = [eq(poTasks.poNumber, poNumber)];
        if (!includeCompleted) {
            conditions.push(eq(poTasks.isCompleted, false));
        }
        return await db
            .select()
            .from(poTasks)
            .where(and(...conditions))
            .orderBy(desc(poTasks.priority), poTasks.dueDate, desc(poTasks.createdAt));
    }

    async getPoTaskById(id: number): Promise<PoTask | undefined> {
        const result = await db.select().from(poTasks).where(eq(poTasks.id, id));
        return result[0];
    }

    async createPoTask(task: InsertPoTask): Promise<PoTask> {
        const result = await db.insert(poTasks).values(task).returning();
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
                completedBy: completedBy,
                updatedAt: new Date()
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
                updatedAt: new Date()
            })
            .where(eq(poTasks.id, id))
            .returning();
        return result[0];
    }

    async deletePoTask(id: number): Promise<boolean> {
        const result = await db.delete(poTasks).where(eq(poTasks.id, id)).returning();
        return result.length > 0;
    }

    async generatePoTasksFromData(poNumber: string): Promise<PoTask[]> {
        const generatedTasks: PoTask[] = [];

        // Get PO data from poHeaders
        const poHeaderResult = await db.select().from(poHeaders).where(eq(poHeaders.poNumber, poNumber)).limit(1);
        const poHeader = poHeaderResult[0];
        if (!poHeader) return generatedTasks;

        // Map header to PO format for compatibility
        const po = {
            id: poHeader.id,
            poNumber: poHeader.poNumber,
            status: poHeader.status,
            revisedCancelDate: poHeader.revisedCancelDate,
        };

        // Check for existing tasks to avoid duplicates
        const existingTasks = await db.select().from(poTasks).where(eq(poTasks.poNumber, poNumber));
        const existingTaskKeys = new Set(existingTasks.map(t => `${t.taskSource}-${t.taskType}-${t.relatedEntityId || ''}`));

        // 1. Generate inspection-related tasks
        const inspectionResults = await db
            .select()
            .from(inspections)
            .where(eq(inspections.poNumber, poNumber));

        // Check if final inspection is needed (PO has booking confirmed but no final inspection scheduled)
        const hasFinalInspection = inspectionResults.some(i =>
            i.inspectionType?.toLowerCase().includes('final')
        );
        const hasFailedInspection = inspectionResults.some(i =>
            i.result?.toLowerCase() === 'failed'
        );

        if (!hasFinalInspection && po.status?.toLowerCase().includes('book')) {
            const taskKey = 'inspection-book_final-';
            if (!existingTaskKeys.has(taskKey)) {
                const newTask = await this.createPoTask({
                    poNumber,
                    poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                    taskSource: 'inspection',
                    taskType: 'book_final',
                    title: 'Book Final Inspection',
                    description: `Final inspection needs to be scheduled for PO ${poNumber}`,
                    dueDate: po.revisedCancelDate ? new Date(new Date(po.revisedCancelDate).getTime() - 14 * 24 * 60 * 60 * 1000) : null,
                    priority: 'high'
                });
                generatedTasks.push(newTask);
                existingTaskKeys.add(taskKey);
            }
        }

        // Check for failed inspections that need follow-up
        for (const insp of inspectionResults) {
            if (insp.result?.toLowerCase() === 'failed') {
                const taskKey = `inspection-follow_up_failed-${insp.id}`;
                if (!existingTaskKeys.has(taskKey)) {
                    const newTask = await this.createPoTask({
                        poNumber,
                        poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                        taskSource: 'inspection',
                        taskType: 'follow_up_failed',
                        title: `Follow up on Failed ${insp.inspectionType || 'Inspection'}`,
                        description: `${insp.inspectionType || 'Inspection'} failed on ${insp.inspectionDate ? new Date(insp.inspectionDate).toLocaleDateString() : 'unknown date'}. Notes: ${insp.notes || 'None'}`,
                        priority: 'urgent',
                        relatedEntityType: 'inspection',
                        relatedEntityId: insp.id
                    });
                    generatedTasks.push(newTask);
                    existingTaskKeys.add(taskKey);
                }
            }
        }

        // 2. Generate compliance-related tasks (expiring certificates)
        const qualityResults = await db
            .select()
            .from(qualityTests)
            .where(eq(qualityTests.poNumber, poNumber));

        for (const test of qualityResults) {
            if (test.expiryDate) {
                const daysUntilExpiry = Math.ceil((new Date(test.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                if (daysUntilExpiry <= 90 && daysUntilExpiry > 0) {
                    const taskKey = `compliance-renew_certificate-${test.id}`;
                    if (!existingTaskKeys.has(taskKey)) {
                        const newTask = await this.createPoTask({
                            poNumber,
                            poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                            taskSource: 'compliance',
                            taskType: 'renew_certificate',
                            title: `Renew ${test.testType || 'Certificate'} - Expires in ${daysUntilExpiry} days`,
                            description: `${test.testType || 'Certificate'} for SKU ${test.sku || 'unknown'} expires on ${new Date(test.expiryDate).toLocaleDateString()}`,
                            dueDate: new Date(new Date(test.expiryDate).getTime() - 30 * 24 * 60 * 60 * 1000),
                            priority: daysUntilExpiry <= 30 ? 'urgent' : daysUntilExpiry <= 60 ? 'high' : 'normal',
                            relatedEntityType: 'quality_test',
                            relatedEntityId: test.id
                        });
                        generatedTasks.push(newTask);
                        existingTaskKeys.add(taskKey);
                    }
                }
            }
        }

        // 3. Generate shipment-related tasks
        const shipmentResults = await db
            .select()
            .from(shipments)
            .where(eq(shipments.poNumber, poNumber));

        for (const ship of shipmentResults) {
            // Check for shipments needing booking
            if (!ship.actualSailingDate && ship.cargoReadyDate) {
                const crd = new Date(ship.cargoReadyDate);
                const daysUntilCrd = Math.ceil((crd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

                if (daysUntilCrd <= 14 && daysUntilCrd > -7) {
                    const taskKey = `shipment-book_shipment-${ship.id}`;
                    if (!existingTaskKeys.has(taskKey)) {
                        const newTask = await this.createPoTask({
                            poNumber,
                            poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                            taskSource: 'shipment',
                            taskType: 'book_shipment',
                            title: 'Book Shipment',
                            description: `Cargo Ready Date is ${crd.toLocaleDateString()}. Shipment needs to be booked.`,
                            dueDate: new Date(crd.getTime() - 7 * 24 * 60 * 60 * 1000),
                            priority: daysUntilCrd <= 7 ? 'urgent' : 'high',
                            relatedEntityType: 'shipment',
                            relatedEntityId: ship.id
                        });
                        generatedTasks.push(newTask);
                        existingTaskKeys.add(taskKey);
                    }
                }
            }

            // Check for PTS follow-up needed
            if (ship.ptsNumber && !ship.ptsStatus) {
                const taskKey = `shipment-follow_up_pts-${ship.id}`;
                if (!existingTaskKeys.has(taskKey)) {
                    const newTask = await this.createPoTask({
                        poNumber,
                        poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                        taskSource: 'shipment',
                        taskType: 'follow_up_pts',
                        title: `Follow up on PTS ${ship.ptsNumber}`,
                        description: `PTS ${ship.ptsNumber} status needs confirmation`,
                        priority: 'normal',
                        relatedEntityType: 'shipment',
                        relatedEntityId: ship.id
                    });
                    generatedTasks.push(newTask);
                    existingTaskKeys.add(taskKey);
                }
            }
        }

        // 4. Generate tasks from activity logs (manual action items)
        const activityResults = await db
            .select()
            .from(activityLogs)
            .where(and(
                eq(activityLogs.entityType, 'po'),
                eq(activityLogs.entityId, poNumber),
                eq(activityLogs.logType, 'action'),
                eq(activityLogs.isCompleted, false)
            ));

        for (const activity of activityResults) {
            const taskKey = `manual-custom-${activity.id}`;
            if (!existingTaskKeys.has(taskKey)) {
                const newTask = await this.createPoTask({
                    poNumber,
                    poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                    taskSource: 'manual',
                    taskType: 'custom',
                    title: activity.description.substring(0, 255),
                    description: activity.description,
                    dueDate: activity.dueDate,
                    priority: 'normal',
                    relatedEntityType: 'activity_log',
                    relatedEntityId: activity.id,
                    createdBy: activity.createdBy || undefined
                });
                generatedTasks.push(newTask);
                existingTaskKeys.add(taskKey);
            }
        }

        // 5. Generate tasks from overdue/missing timeline milestones
        const timelineResult = await db
            .select()
            .from(poTimelines)
            .where(eq(poTimelines.poId, po.id))
            .limit(1);

        const timeline = timelineResult[0];
        if (timeline) {
            const milestonesResult = await db
                .select()
                .from(poTimelineMilestones)
                .where(eq(poTimelineMilestones.timelineId, timeline.id));

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (const milestone of milestonesResult) {
                const targetDate = milestone.revisedDate || milestone.plannedDate;

                if (targetDate && !milestone.actualDate) {
                    const targetDateTime = new Date(targetDate);
                    targetDateTime.setHours(0, 0, 0, 0);
                    const daysOverdue = Math.floor((today.getTime() - targetDateTime.getTime()) / (1000 * 60 * 60 * 24));

                    if (daysOverdue > 0) {
                        const taskKey = `timeline-overdue_milestone-${milestone.id}`;
                        if (!existingTaskKeys.has(taskKey)) {
                            const milestoneName = MILESTONE_LABELS[milestone.milestone as keyof typeof MILESTONE_LABELS] || milestone.milestone;
                            const priority = daysOverdue > 14 ? 'urgent' : daysOverdue > 7 ? 'high' : 'normal';

                            const newTask = await this.createPoTask({
                                poNumber,
                                poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                                taskSource: 'timeline',
                                taskType: 'overdue_milestone',
                                title: `Overdue: ${milestoneName}`,
                                description: `${milestoneName} was due on ${targetDateTime.toLocaleDateString()} (${daysOverdue} days overdue). Please update with actual completion date or revise the timeline.`,
                                dueDate: targetDateTime,
                                priority,
                                relatedEntityType: 'timeline_milestone',
                                relatedEntityId: milestone.id
                            });
                            generatedTasks.push(newTask);
                            existingTaskKeys.add(taskKey);
                        }
                    } else if (daysOverdue >= -7 && daysOverdue <= 0) {
                        const taskKey = `timeline-upcoming_milestone-${milestone.id}`;
                        if (!existingTaskKeys.has(taskKey)) {
                            const milestoneName = MILESTONE_LABELS[milestone.milestone as keyof typeof MILESTONE_LABELS] || milestone.milestone;
                            const daysUntil = Math.abs(daysOverdue);

                            const newTask = await this.createPoTask({
                                poNumber,
                                poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                                taskSource: 'timeline',
                                taskType: 'upcoming_milestone',
                                title: `Upcoming: ${milestoneName} (${daysUntil === 0 ? 'Today' : `in ${daysUntil} days`})`,
                                description: `${milestoneName} is scheduled for ${targetDateTime.toLocaleDateString()}. Ensure this milestone is on track.`,
                                dueDate: targetDateTime,
                                priority: daysUntil <= 3 ? 'high' : 'normal',
                                relatedEntityType: 'timeline_milestone',
                                relatedEntityId: milestone.id
                            });
                            generatedTasks.push(newTask);
                            existingTaskKeys.add(taskKey);
                        }
                    }
                }
            }
        }

        return generatedTasks;
    }

    async regenerateTasksForImportedPOs(poNumbers: string[]): Promise<{ poNumber: string; tasksGenerated: number }[]> {
        const results: { poNumber: string; tasksGenerated: number }[] = [];

        for (const poNumber of poNumbers) {
            try {
                const tasks = await this.generatePoTasksFromData(poNumber);
                results.push({ poNumber, tasksGenerated: tasks.length });
            } catch (error) {
                console.error(`Error generating tasks for PO ${poNumber}:`, error);
                results.push({ poNumber, tasksGenerated: 0 });
            }
        }

        return results;
    }


}