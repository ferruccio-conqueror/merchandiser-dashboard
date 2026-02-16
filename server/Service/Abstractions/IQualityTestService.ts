import { QualityTest, InsertQualityTest } from "@shared/schema";

export interface IQualityTestService {
    // Quality Test operations
    getQualityTestsBySkuId(skuId: number): Promise<QualityTest[]>;
    bulkCreateQualityTests(tests: InsertQualityTest[]): Promise<QualityTest[]>;
    bulkUpsertQualityTests(tests: InsertQualityTest[]): Promise<{ inserted: number; updated: number }>;
    clearAllQualityTests(): Promise<void>;
    getAllQualityTests(): Promise<Array<{
        id: number;
        poNumber: string;
        sku: string | null;
        testType: string;
        expirationDate: Date | null;
        result: string | null;
        status: string | null;
        vendorName: string | null;
    }>>;
}