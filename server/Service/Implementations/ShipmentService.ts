import { InsertShipment, poHeaders, poLineItems, Shipment, shipments } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IShipmentService } from "../Abstractions/IShipmentService";

export class ShipmentService implements IShipmentService {


    // Shipment operations
    async getShipmentsByPoId(poId: number): Promise<Shipment[]> {
        return db.select().from(shipments).where(eq(shipments.poId, poId)).orderBy(shipments.shipmentNumber);
    }

    async getShipmentsByPoNumber(poNumber: string): Promise<Shipment[]> {
        return db.select().from(shipments).where(eq(shipments.poNumber, poNumber)).orderBy(shipments.shipmentNumber);
    }

    async createShipment(shipment: InsertShipment): Promise<Shipment> {
        const result = await db.insert(shipments).values(shipment).returning();
        return result[0];
    }

    async bulkCreateShipments(shipmentList: InsertShipment[]): Promise<Shipment[]> {
        if (shipmentList.length === 0) return [];

        // Batch inserts to avoid stack overflow with large datasets
        const BATCH_SIZE = 500;
        const results: Shipment[] = [];
        const totalBatches = Math.ceil(shipmentList.length / BATCH_SIZE);

        console.log(`Processing ${shipmentList.length} shipments in ${totalBatches} batches`);

        for (let i = 0; i < shipmentList.length; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const batch = shipmentList.slice(i, i + BATCH_SIZE);
            console.log(`Processing shipment batch ${batchNum}/${totalBatches} (${batch.length} records)`);

            try {
                const batchResult = await db.insert(shipments).values(batch).returning();
                results.push(...batchResult);
            } catch (error: any) {
                console.error(`Shipment batch ${batchNum} failed:`, error.message);
                console.error(`First record in failed batch:`, JSON.stringify(batch[0], null, 2));
                throw error;
            }
        }

        return results;
    }

    async clearAllShipments(): Promise<void> {
        console.log("Clearing all shipments for full data refresh...");
        await db.delete(shipments);
        console.log("All shipments cleared");
    }


    // Clear shipments outside the 3-year rolling window (current year + last 2 years)
    async clearShipmentsOutsideRetention(): Promise<{ deleted: number }> {
        const currentYear = new Date().getFullYear();
        const cutoffDate = new Date(currentYear - 2, 0, 1); // January 1st, 2 years ago
        console.log(`Clearing shipments with cargo_ready_date before ${cutoffDate.toISOString().split('T')[0]} (3-year retention)`);

        const result = await db.execute<{ deleted_count: number }>(sql`
          WITH deleted AS (
            DELETE FROM shipments
            WHERE cargo_ready_date < ${cutoffDate}
            RETURNING id
          )
          SELECT COUNT(*) as deleted_count FROM deleted
        `);
        return { deleted: Number(result.rows[0]?.deleted_count) || 0 };
    }

    // Upsert shipments - preserves existing records by matching on composite key (po_number + style + cargo_ready_date)
    async bulkUpsertShipments(shipmentList: InsertShipment[]): Promise<{ inserted: number; updated: number }> {
        if (shipmentList.length === 0) return { inserted: 0, updated: 0 };

        console.log(`Upserting ${shipmentList.length} shipments (preserving linked data)...`);

        // Get all unique PO numbers from incoming shipments
        const poNumbers = [...new Set(shipmentList.map(s => s.poNumber))];

        // Fetch existing shipments for these POs
        const existingMap = new Map<string, number>(); // composite key -> id
        for (const poNumber of poNumbers) {
            const existing = await this.getShipmentsByPoNumber(poNumber);
            for (const s of existing) {
                // Create composite key: po_number + style + cargo_ready_date
                const key = `${s.poNumber}|${s.style || ''}|${s.cargoReadyDate?.toISOString().split('T')[0] || ''}`;
                existingMap.set(key, s.id);
            }
        }

        const toInsert: InsertShipment[] = [];
        const toUpdate: { id: number; data: InsertShipment }[] = [];

        for (const shipment of shipmentList) {
            const key = `${shipment.poNumber}|${shipment.style || ''}|${shipment.cargoReadyDate?.toISOString().split('T')[0] || ''}`;
            const existingId = existingMap.get(key);

            if (existingId) {
                toUpdate.push({ id: existingId, data: shipment });
            } else {
                toInsert.push(shipment);
            }
        }

        // Batch insert new records
        if (toInsert.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
                const batch = toInsert.slice(i, i + BATCH_SIZE);
                await db.insert(shipments).values(batch);
            }
        }

        // Batch update existing records
        if (toUpdate.length > 0) {
            const BATCH_SIZE = 100;
            for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
                const batch = toUpdate.slice(i, i + BATCH_SIZE);
                for (const { id, data } of batch) {
                    await db
                        .update(shipments)
                        .set({ ...data, updatedAt: new Date() })
                        .where(eq(shipments.id, id));
                }
            }
        }

        console.log(`Shipment upsert complete: ${toInsert.length} inserted, ${toUpdate.length} updated`);
        return { inserted: toInsert.length, updated: toUpdate.length };
    }

    // Enrich existing shipments with OS650 logistics data (does not create new shipments for values/dates)
    // OS650 provides logistics details only; primary shipment data comes from OS340
    // Uses PO-level matching: updates ALL shipments for a PO when OS650 has data for that PO
    async enrichShipmentsWithOS650(enrichmentData: Map<string, any[]>): Promise<{ inserted: number; updated: number }> {
        if (enrichmentData.size === 0) return { inserted: 0, updated: 0 };

        console.log(`Enriching shipments for ${enrichmentData.size} PO numbers with OS650 logistics data (PO-level matching)...`);

        let updated = 0;
        let inserted = 0;

        // Process by PO number - use PO-level matching
        for (const [poNumber, records] of enrichmentData) {
            // First: Aggregate PO-level data from all OS650 records for this PO
            // Use the first non-null value found for each field
            let ptsNumber: string | null = null;
            let soFirstSubmissionDate: Date | null = null;
            let ptsStatus: string | null = null;
            let logisticStatus: string | null = null;
            let hodStatus: string | null = null;
            let loadType: string | null = null;
            let cargoReadyDate: Date | null = null;
            let cargoReceiptStatus: string | null = null;
            let estimatedVesselEtd: Date | null = null;
            let latestHod: Date | null = null;

            for (const record of records) {
                if (!ptsNumber && record.ptsNumber) ptsNumber = record.ptsNumber;
                if (!soFirstSubmissionDate && record.soFirstSubmissionDate) soFirstSubmissionDate = record.soFirstSubmissionDate;
                if (!ptsStatus && record.ptsStatus) ptsStatus = record.ptsStatus;
                if (!logisticStatus && record.logisticStatus) logisticStatus = record.logisticStatus;
                if (!hodStatus && record.hodStatus) hodStatus = record.hodStatus;
                if (!loadType && record.loadType) loadType = record.loadType;
                if (!cargoReadyDate && record.cargoReadyDate) cargoReadyDate = record.cargoReadyDate;
                if (!cargoReceiptStatus && record.cargoReceiptStatus) cargoReceiptStatus = record.cargoReceiptStatus;
                if (!estimatedVesselEtd && record.estimatedVesselEtd) estimatedVesselEtd = record.estimatedVesselEtd;
                if (!latestHod && record.latestHod) latestHod = record.latestHod;
            }

            // Build update data from aggregated PO-level values
            const updateData: any = {
                updatedAt: new Date(),
            };

            if (ptsNumber) updateData.ptsNumber = ptsNumber;
            if (soFirstSubmissionDate) updateData.soFirstSubmissionDate = soFirstSubmissionDate;
            if (ptsStatus) updateData.ptsStatus = ptsStatus;
            if (logisticStatus) updateData.logisticStatus = logisticStatus;
            if (hodStatus) updateData.hodStatus = hodStatus;
            if (loadType) updateData.loadType = loadType;
            if (cargoReadyDate) updateData.cargoReadyDate = cargoReadyDate;
            if (cargoReceiptStatus) updateData.cargoReceiptStatus = cargoReceiptStatus;
            if (estimatedVesselEtd) updateData.estimatedVesselEtd = estimatedVesselEtd; // Store in dedicated column, NOT actualSailingDate
            if (latestHod) updateData.eta = latestHod;

            // Update ALL shipments for this PO with the aggregated OS650 data (if any exist)
            if (Object.keys(updateData).length > 1) { // More than just updatedAt
                const result = await db
                    .update(shipments)
                    .set(updateData)
                    .where(eq(shipments.poNumber, poNumber))
                    .returning({ id: shipments.id });
                updated += result.length;
            }

            // ALSO update po_headers directly with PTS data (regardless of shipments)
            // This ensures PTS data is stored at PO level for easy access
            if (ptsNumber || soFirstSubmissionDate || ptsStatus || logisticStatus) {
                const poHeaderUpdate: any = { updatedAt: new Date() };
                if (ptsNumber) poHeaderUpdate.ptsNumber = ptsNumber;
                if (soFirstSubmissionDate) poHeaderUpdate.ptsDate = soFirstSubmissionDate;
                if (ptsStatus) poHeaderUpdate.ptsStatus = ptsStatus;
                if (logisticStatus) poHeaderUpdate.logisticStatus = logisticStatus;

                await db
                    .update(poHeaders)
                    .set(poHeaderUpdate)
                    .where(eq(poHeaders.poNumber, poNumber));
            }
        }

        console.log(`OS650 enrichment complete: ${updated} shipments updated across ${enrichmentData.size} POs, ${inserted} new records created`);
        return { inserted, updated };
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

}