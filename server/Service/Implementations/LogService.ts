import { ActivityLog, activityLogs, InsertActivityLog } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../../db";
import { ILogService } from "../Abstractions/ILogService";

export class LogService implements ILogService {
    // Activity Log operations
    async getActivityLogsByEntity(entityType: string, entityId: string): Promise<ActivityLog[]> {
        const result = await db.select()
            .from(activityLogs)
            .where(and(
                eq(activityLogs.entityType, entityType),
                eq(activityLogs.entityId, entityId)
            ))
            .orderBy(desc(activityLogs.createdAt));
        return result;
    }

    async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
        const result = await db.insert(activityLogs).values(log as any).returning();
        return result[0];
    }

    async updateActivityLog(id: number, log: Partial<InsertActivityLog>): Promise<ActivityLog | undefined> {
        const result = await db
            .update(activityLogs)
            .set({ ...log, updatedAt: new Date() })
            .where(eq(activityLogs.id, id))
            .returning();
        return result[0];
    }

    async markActivityLogComplete(id: number): Promise<ActivityLog | undefined> {
        const result = await db
            .update(activityLogs)
            .set({
                isCompleted: true,
                completionDate: new Date(),
                updatedAt: new Date()
            })
            .where(eq(activityLogs.id, id))
            .returning();
        return result[0];
    }

    async getPendingActionsByUser(createdBy?: string): Promise<ActivityLog[]> {
        const conditions = [
            eq(activityLogs.logType, 'action'),
            eq(activityLogs.isCompleted, false)
        ];

        if (createdBy) {
            conditions.push(eq(activityLogs.createdBy, createdBy));
        }

        const result = await db.select()
            .from(activityLogs)
            .where(and(...conditions))
            .orderBy(activityLogs.dueDate);
        return result;
    }

    async getActivityLogById(id: number): Promise<ActivityLog | undefined> {
        const result = await db.select()
            .from(activityLogs)
            .where(eq(activityLogs.id, id));
        return result[0];
    }
}
