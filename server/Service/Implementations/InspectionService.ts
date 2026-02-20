import { InsertInspection, Inspection, inspections } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IInspectionService } from "../Abstractions/IInspectionService";

export class InspectionService implements IInspectionService {


    // Inspection operations
    async getInspectionsBySkuId(skuId: number): Promise<Inspection[]> {
        return db.select().from(inspections).where(eq(inspections.skuId, skuId)).orderBy(desc(inspections.inspectionDate));
    }

    async getInspectionsByPoNumber(poNumber: string): Promise<Inspection[]> {
        return db.select().from(inspections).where(eq(inspections.poNumber, poNumber)).orderBy(desc(inspections.inspectionDate));
    }

    async bulkCreateInspections(inspectionList: InsertInspection[]): Promise<Inspection[]> {
        if (inspectionList.length === 0) return [];

        // Batch inserts to avoid stack overflow with large datasets
        const BATCH_SIZE = 500;
        const results: Inspection[] = [];
        const totalBatches = Math.ceil(inspectionList.length / BATCH_SIZE);

        console.log(`Processing ${inspectionList.length} inspections in ${totalBatches} batches`);

        for (let i = 0; i < inspectionList.length; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const batch = inspectionList.slice(i, i + BATCH_SIZE);
            console.log(`Processing inspection batch ${batchNum}/${totalBatches} (${batch.length} records)`);

            try {
                const batchResult = await db.insert(inspections).values(batch).returning();
                results.push(...batchResult);
            } catch (error: any) {
                console.error(`Inspection batch ${batchNum} failed:`, error.message);
                console.error(`First record in failed batch:`, JSON.stringify(batch[0], null, 2));
                throw error;
            }
        }

        return results;
    }

    async clearAllInspections(): Promise<void> {
        console.log("Clearing all inspections for full data refresh...");
        await db.delete(inspections);
        console.log("All inspections cleared");
    }

    // Upsert inspections - preserves existing records by matching on composite key (sku + inspection_type + inspection_date + po_number)
    async bulkUpsertInspections(inspectionList: InsertInspection[]): Promise<{ inserted: number; updated: number }> {
        if (inspectionList.length === 0) return { inserted: 0, updated: 0 };

        console.log(`Upserting ${inspectionList.length} inspections (preserving linked data)...`);

        // Build map of existing inspections by composite key
        const existingMap = new Map<string, number>(); // composite key -> id

        // Get all existing inspections for matching (limited query)
        const existingResult = await db.execute<{ id: number; sku: string; inspection_type: string; inspection_date: Date | null; po_number: string }>(sql`
          SELECT id, sku, inspection_type, inspection_date, po_number 
          FROM inspections
        `);

        // Helper to safely convert date to string for comparison
        const dateToString = (d: Date | string | null | undefined): string => {
            if (!d) return '';
            if (d instanceof Date) return d.toISOString().split('T')[0];
            if (typeof d === 'string') return d.split('T')[0];
            return '';
        };

        for (const row of existingResult.rows) {
            const key = `${row.sku || ''}|${row.inspection_type || ''}|${dateToString(row.inspection_date)}|${row.po_number || ''}`;
            existingMap.set(key, row.id);
        }

        const toInsert: InsertInspection[] = [];
        const toUpdate: { id: number; data: InsertInspection }[] = [];

        for (const insp of inspectionList) {
            const key = `${insp.sku || ''}|${insp.inspectionType || ''}|${dateToString(insp.inspectionDate)}|${insp.poNumber || ''}`;
            const existingId = existingMap.get(key);

            if (existingId) {
                toUpdate.push({ id: existingId, data: insp });
            } else {
                toInsert.push(insp);
            }
        }

        // Batch insert new records
        if (toInsert.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
                const batch = toInsert.slice(i, i + BATCH_SIZE);
                await db.insert(inspections).values(batch);
            }
        }

        // Batch update existing records
        if (toUpdate.length > 0) {
            const BATCH_SIZE = 100;
            for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
                const batch = toUpdate.slice(i, i + BATCH_SIZE);
                for (const { id, data } of batch) {
                    await db
                        .update(inspections)
                        .set(data)
                        .where(eq(inspections.id, id));
                }
            }
        }

        console.log(`Inspection upsert complete: ${toInsert.length} inserted, ${toUpdate.length} updated`);
        return { inserted: toInsert.length, updated: toUpdate.length };
    }

    async getInspectors(): Promise<string[]> {
        const result = await db.execute<{ inspector: string }>(sql`
          SELECT DISTINCT inspector 
          FROM inspections 
          WHERE inspector IS NOT NULL AND inspector != ''
          ORDER BY inspector
        `);
        return result.rows.map(row => row.inspector);
    }

}