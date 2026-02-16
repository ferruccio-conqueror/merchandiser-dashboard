import { ActivityLog, InsertActivityLog } from "@shared/schema";

export interface ILogService {
    // Activity Log operations
    getActivityLogsByEntity(entityType: string, entityId: string): Promise<ActivityLog[]>;
    createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
    updateActivityLog(id: number, log: Partial<InsertActivityLog>): Promise<ActivityLog | undefined>;
    markActivityLogComplete(id: number): Promise<ActivityLog | undefined>;
    getPendingActionsByUser(createdBy?: string): Promise<ActivityLog[]>;
    getActivityLogById(id: number): Promise<ActivityLog | undefined>;
}