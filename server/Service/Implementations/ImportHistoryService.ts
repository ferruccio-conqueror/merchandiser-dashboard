import { ImportHistory, InsertImportHistory, importHistory } from "@shared/schema";
import { desc } from "drizzle-orm";
import { db } from "../../db";
import { IImportHistoryService } from "../Abstractions/IImportHistoryService";

export class ImportHistoryService implements IImportHistoryService {
    
    async getImportHistory(): Promise<ImportHistory[]> {
        return db
            .select()
            .from(importHistory)
            .orderBy(desc(importHistory.createdAt)); // Most recent first
    }

    async createImportHistory(history: InsertImportHistory): Promise<ImportHistory> {
        const result = await db
            .insert(importHistory)
            .values(history as any)
            .returning();
        
        return result[0];
    }
}