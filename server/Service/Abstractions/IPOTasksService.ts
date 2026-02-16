import { PoTask, InsertPoTask } from "@shared/schema";

export interface IPOTaskService {
    // PO Tasks operations
    getPoTasksByPoNumber(poNumber: string, includeCompleted?: boolean): Promise<PoTask[]>;
    getPoTaskById(id: number): Promise<PoTask | undefined>;
    createPoTask(task: InsertPoTask): Promise<PoTask>;
    updatePoTask(id: number, task: Partial<InsertPoTask>): Promise<PoTask | undefined>;
    completePoTask(id: number, completedBy: string): Promise<PoTask | undefined>;
    uncompletePoTask(id: number): Promise<PoTask | undefined>;
    deletePoTask(id: number): Promise<boolean>;
    generatePoTasksFromData(poNumber: string): Promise<PoTask[]>;
    regenerateTasksForImportedPOs(poNumbers: string[]): Promise<{ poNumber: string; tasksGenerated: number }[]>;
}