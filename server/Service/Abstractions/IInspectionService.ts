import { Inspection, InsertInspection } from "@shared/schema";

export interface IInspectionService {
    // Inspection operations
    getInspectionsBySkuId(skuId: number): Promise<Inspection[]>;
    getInspectionsByPoNumber(poNumber: string): Promise<Inspection[]>;
    bulkCreateInspections(inspections: InsertInspection[]): Promise<Inspection[]>;
    bulkUpsertInspections(inspections: InsertInspection[]): Promise<{ inserted: number; updated: number }>;
    clearAllInspections(): Promise<void>;
    getInspectors(): Promise<string[]>;
}