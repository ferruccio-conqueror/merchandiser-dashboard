import { ImportHistory, InsertImportHistory } from "@shared/schema";

export interface IImportHistoryService {
    // Import History operations
    getImportHistory(): Promise<ImportHistory[]>;
    createImportHistory(history: InsertImportHistory): Promise<ImportHistory>;
}