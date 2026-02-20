import { InsertQualityTest, QualityTest, qualityTests } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IQualityTestService } from "../Abstractions/IQualityTestService";

export class QualityTestService implements IQualityTestService {


    // Quality Test operations
    async getQualityTestsBySkuId(skuId: number): Promise<QualityTest[]> {
        return db.select().from(qualityTests).where(eq(qualityTests.skuId, skuId)).orderBy(desc(qualityTests.reportDate));
    }

    async bulkCreateQualityTests(testList: InsertQualityTest[]): Promise<QualityTest[]> {
        if (testList.length === 0) return [];

        // Batch inserts to avoid stack overflow with large datasets
        const BATCH_SIZE = 500;
        const results: QualityTest[] = [];
        const totalBatches = Math.ceil(testList.length / BATCH_SIZE);

        console.log(`Processing ${testList.length} quality tests in ${totalBatches} batches`);

        for (let i = 0; i < testList.length; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const batch = testList.slice(i, i + BATCH_SIZE);
            console.log(`Processing quality test batch ${batchNum}/${totalBatches} (${batch.length} records)`);

            try {
                const batchResult = await db.insert(qualityTests).values(batch).returning();
                results.push(...batchResult);
            } catch (error: any) {
                console.error(`Quality test batch ${batchNum} failed:`, error.message);
                console.error(`First record in failed batch:`, JSON.stringify(batch[0], null, 2));
                throw error;
            }
        }

        return results;
    }

    async clearAllQualityTests(): Promise<void> {
        console.log("Clearing all quality tests for full data refresh...");
        await db.delete(qualityTests);
        console.log("All quality tests cleared");
    }

    // Upsert quality tests - preserves existing records by matching on composite key (sku + test_type + report_date)
    async bulkUpsertQualityTests(testList: InsertQualityTest[]): Promise<{ inserted: number; updated: number }> {
        if (testList.length === 0) return { inserted: 0, updated: 0 };

        console.log(`Upserting ${testList.length} quality tests (preserving linked data)...`);

        // Build map of existing quality tests by composite key
        const existingMap = new Map<string, number>(); // composite key -> id

        // Get all existing quality tests for matching
        const existingResult = await db.execute<{ id: number; sku: string; test_type: string; report_date: Date | null }>(sql`
          SELECT id, sku, test_type, report_date 
          FROM quality_tests
        `);

        // Helper to safely convert date to string for comparison
        const dateToString = (d: Date | string | null | undefined): string => {
            if (!d) return '';
            if (d instanceof Date) return d.toISOString().split('T')[0];
            if (typeof d === 'string') return d.split('T')[0];
            return '';
        };

        for (const row of existingResult.rows) {
            const key = `${row.sku || ''}|${row.test_type || ''}|${dateToString(row.report_date)}`;
            existingMap.set(key, row.id);
        }

        const toInsert: InsertQualityTest[] = [];
        const toUpdate: { id: number; data: InsertQualityTest }[] = [];

        for (const test of testList) {
            const key = `${test.sku || ''}|${test.testType || ''}|${dateToString(test.reportDate)}`;
            const existingId = existingMap.get(key);

            if (existingId) {
                toUpdate.push({ id: existingId, data: test });
            } else {
                toInsert.push(test);
            }
        }

        // Batch insert new records
        if (toInsert.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
                const batch = toInsert.slice(i, i + BATCH_SIZE);
                await db.insert(qualityTests).values(batch);
            }
        }

        // Batch update existing records
        if (toUpdate.length > 0) {
            const BATCH_SIZE = 100;
            for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
                const batch = toUpdate.slice(i, i + BATCH_SIZE);
                for (const { id, data } of batch) {
                    await db
                        .update(qualityTests)
                        .set(data)
                        .where(eq(qualityTests.id, id));
                }
            }
        }

        console.log(`Quality test upsert complete: ${toInsert.length} inserted, ${toUpdate.length} updated`);
        return { inserted: toInsert.length, updated: toUpdate.length };
    }

    // Get all quality tests with vendor information for To-Do List
    async getAllQualityTests(): Promise<Array<{
        id: number;
        poNumber: string;
        sku: string | null;
        testType: string;
        expirationDate: Date | null;
        result: string | null;
        status: string | null;
        vendorName: string | null;
    }>> {
        const results = await db.select({
            id: qualityTests.id,
            poNumber: qualityTests.poNumber,
            sku: qualityTests.sku,
            testType: qualityTests.testType,
            expiryDate: qualityTests.expiryDate,
            result: qualityTests.result,
            status: qualityTests.status,
            vendor: poHeaders.vendor,
        })
            .from(qualityTests)
            .leftJoin(poHeaders, eq(qualityTests.poNumber, poHeaders.poNumber));

        return results.map(r => ({
            id: r.id,
            poNumber: r.poNumber,
            sku: r.sku,
            testType: r.testType,
            expirationDate: r.expiryDate,
            result: r.result,
            status: r.status,
            vendorName: r.vendor,
        }));
    }

}