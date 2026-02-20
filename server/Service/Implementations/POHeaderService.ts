import { InsertPoHeader, InsertPoLineItem, PoHeader, poHeaders, PoLineItem, poLineItems } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IPOHeaderService } from "../Abstractions/IPOHeaderService";

export class POHeaderService implements IPOHeaderService {


    async createPoHeader(header: InsertPoHeader): Promise<PoHeader> {
        const result = await db.insert(poHeaders).values(header).returning();
        return result[0];
    }

    async updatePoHeader(id: number, header: Partial<InsertPoHeader>): Promise<PoHeader | undefined> {
        // Check if status is changing from EDI/Initial to Booked-to-ship
        // If so, automatically set confirmation_date
        if (header.status === 'Booked-to-ship') {
            const currentPo = await db
                .select({ status: poHeaders.status, confirmationDate: poHeaders.confirmationDate })
                .from(poHeaders)
                .where(eq(poHeaders.id, id))
                .limit(1);

            // Only set confirmation_date if transitioning from EDI/Initial and not already set
            if (currentPo[0] && currentPo[0].status === 'EDI/Initial' && !currentPo[0].confirmationDate) {
                header = { ...header, confirmationDate: new Date() } as Partial<InsertPoHeader>;
            }
        }

        const result = await db
            .update(poHeaders)
            .set({ ...header, updatedAt: new Date() })
            .where(eq(poHeaders.id, id))
            .returning();
        return result[0];
    }

    async bulkCreatePoHeaders(headers: InsertPoHeader[]): Promise<PoHeader[]> {
        if (headers.length === 0) return [];
        const result = await db.insert(poHeaders).values(headers).returning();
        return result;
    }

    async bulkCreatePoLineItems(items: InsertPoLineItem[]): Promise<PoLineItem[]> {
        if (items.length === 0) return [];
        const result = await db.insert(poLineItems).values(items).returning();
        return result;
    }

    // Clear PO data outside the 3-year rolling window (current year + last 2 years)
    async clearPoHeadersOutsideRetention(): Promise<{ deleted: number }> {
        const currentYear = new Date().getFullYear();
        const cutoffDate = new Date(currentYear - 2, 0, 1); // January 1st, 2 years ago
        console.log(`Clearing PO headers with po_date before ${cutoffDate.toISOString().split('T')[0]} (3-year retention)`);

        const result = await db.execute<{ deleted_count: number }>(sql`
          WITH deleted AS (
            DELETE FROM po_headers
            WHERE po_date < ${cutoffDate}
            RETURNING id
          )
          SELECT COUNT(*) as deleted_count FROM deleted
        `);
        return { deleted: Number(result.rows[0]?.deleted_count) || 0 };
    }

    async clearPoLineItemsOutsideRetention(): Promise<{ deleted: number }> {
        const currentYear = new Date().getFullYear();
        const cutoffDate = new Date(currentYear - 2, 0, 1);
        console.log(`Clearing PO line items for POs with po_date before ${cutoffDate.toISOString().split('T')[0]}`);

        const result = await db.execute<{ deleted_count: number }>(sql`
          WITH deleted AS (
            DELETE FROM po_line_items pli
            USING po_headers ph
            WHERE pli.po_header_id = ph.id AND ph.po_date < ${cutoffDate}
            RETURNING pli.id
          )
          SELECT COUNT(*) as deleted_count FROM deleted
        `);
        return { deleted: Number(result.rows[0]?.deleted_count) || 0 };
    }

    async clearPoLineItemsByHeaderIds(headerIds: number[]): Promise<void> {
        if (headerIds.length === 0) return;
        await db.delete(poLineItems).where(inArray(poLineItems.poHeaderId, headerIds));
    }

    async getPoHeadersByNumbers(poNumbers: string[]): Promise<Map<string, PoHeader>> {
        if (poNumbers.length === 0) return new Map();

        // Process in batches to avoid memory issues with large datasets
        const BATCH_SIZE = 500;
        const headerMap = new Map<string, PoHeader>();

        for (let i = 0; i < poNumbers.length; i += BATCH_SIZE) {
            const batch = poNumbers.slice(i, i + BATCH_SIZE);
            const batchResults = await db.select().from(poHeaders).where(inArray(poHeaders.poNumber, batch));
            for (const header of batchResults) {
                if (!headerMap.has(header.poNumber)) {
                    headerMap.set(header.poNumber, header);
                }
            }
        }

        return headerMap;
    }

    // Get all PO headers (used for projection matching)
    async getAllPoHeaders(): Promise<PoHeader[]> {
        return await db.select().from(poHeaders);
    }

    async bulkUpsertPoHeaders(headers: InsertPoHeader[]): Promise<{ inserted: number; updated: number; skipped: number; headerMap: Map<string, number>; modifiedPoNumbers: Set<string> }> {
        if (headers.length === 0) return { inserted: 0, updated: 0, skipped: 0, headerMap: new Map(), modifiedPoNumbers: new Set() };

        console.log(`Processing ${headers.length} PO headers (delta detection enabled)...`);

        // Get existing PO headers by number
        const poNumbers = [...new Set(headers.map(h => h.poNumber))];
        const existingHeaders = await this.getPoHeadersByNumbers(poNumbers);

        const toInsert: (InsertPoHeader & { contentHash: string })[] = [];
        const toUpdate: { id: number; data: InsertPoHeader; contentHash: string }[] = [];
        const headerMap = new Map<string, number>();
        const modifiedPoNumbers = new Set<string>();
        let skipped = 0;

        for (const header of headers) {
            const newHash = this.calculatePoHeaderHash(header);
            const existing = existingHeaders.get(header.poNumber);

            if (existing) {
                // Check if content has changed using hash comparison
                if (existing.contentHash === newHash) {
                    // Skip unchanged records - just add to map
                    headerMap.set(header.poNumber, existing.id);
                    skipped++;
                } else {
                    toUpdate.push({ id: existing.id, data: header, contentHash: newHash });
                    modifiedPoNumbers.add(header.poNumber);
                }
            } else {
                toInsert.push({ ...header, contentHash: newHash });
                modifiedPoNumbers.add(header.poNumber);
            }
        }

        console.log(`  Delta detection: ${toInsert.length} new, ${toUpdate.length} changed, ${skipped} unchanged (skipped)`);

        // Batch insert new records
        if (toInsert.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
                const batch = toInsert.slice(i, i + BATCH_SIZE);
                const inserted = await db.insert(poHeaders).values(batch).returning();
                for (const h of inserted) {
                    headerMap.set(h.poNumber, h.id);
                }
                console.log(`  Inserted ${Math.min(i + BATCH_SIZE, toInsert.length)} of ${toInsert.length} new PO headers...`);
            }
        }

        // Batch update changed records with parallel execution
        if (toUpdate.length > 0) {
            const BATCH_SIZE = 50;
            for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
                const batch = toUpdate.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async ({ id, data, contentHash }) => {
                    await db
                        .update(poHeaders)
                        .set({ ...data, contentHash, updatedAt: new Date() })
                        .where(eq(poHeaders.id, id));
                    headerMap.set(data.poNumber, id);
                }));
                // Log progress every 500 updates
                if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= toUpdate.length) {
                    console.log(`  Updated ${Math.min(i + BATCH_SIZE, toUpdate.length)} of ${toUpdate.length} changed PO headers...`);
                }
            }
        }

        console.log(`PO headers complete: ${toInsert.length} inserted, ${toUpdate.length} updated, ${skipped} skipped (unchanged)`);
        return { inserted: toInsert.length, updated: toUpdate.length, skipped, headerMap, modifiedPoNumbers };
    }

    async clearAllPoHeaders(): Promise<void> {
        console.log("Clearing all po_headers for full data refresh...");
        // First, unlink quality_tests from po_headers to avoid FK constraint violation
        // Quality tests are preserved and will be re-linked via po_number after import
        console.log("Unlinking quality_tests from po_headers before deletion...");
        await db.execute(sql`UPDATE quality_tests SET po_header_id = NULL WHERE po_header_id IS NOT NULL`);
        // Also unlink inspections if they reference po_headers
        await db.execute(sql`UPDATE inspections SET po_header_id = NULL WHERE po_header_id IS NOT NULL`);
        await db.delete(poHeaders);
        console.log("All po_headers cleared");
    }

    async clearAllPoLineItems(): Promise<void> {
        console.log("Clearing all po_line_items for full data refresh...");
        await db.delete(poLineItems);
        console.log("All po_line_items cleared");
    }


    // Calculate content hash for delta detection
    private calculatePoHeaderHash(header: InsertPoHeader): string {
        // Hash key fields that would indicate data has changed
        const hashFields = [
            header.poNumber,
            header.copNumber,
            header.vendor,
            header.factory,
            header.status,
            header.totalQuantity?.toString(),
            header.totalValue?.toString(),
            header.shippedValue?.toString(), // Shipped (USD) for YTD calculations
            header.balanceQuantity?.toString(),
            header.originalShipDate?.toISOString(),
            header.revisedShipDate?.toISOString(),
            header.originalCancelDate?.toISOString(),
            header.revisedCancelDate?.toISOString(),
            header.scheduleShipMode,
            header.schedulePoe,
            header.shipmentStatus,
        ].join('|');

        return createHash('md5').update(hashFields).digest('hex');
    }

}