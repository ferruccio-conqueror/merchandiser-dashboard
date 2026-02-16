import { AiSummary, InsertAiSummary } from "@shared/schema";

export interface IAISummaryService {
    // AI Summary operations
    getAiSummary(entityType: string, entityId: number, summaryType: string): Promise<AiSummary | undefined>;
    createOrUpdateAiSummary(summary: InsertAiSummary): Promise<AiSummary>;
    markAiSummaryStale(entityType: string, entityId: number): Promise<void>;
    deleteAiSummary(id: number): Promise<boolean>;
}