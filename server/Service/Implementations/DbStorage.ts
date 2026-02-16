import { User, users, InsertUser, PurchaseOrder, PurchaseOrderWithComputedFields, poHeaders, PoLineItem, poLineItems, PoHeader, InsertPoHeader, InsertPoLineItem, InsertPurchaseOrder, Vendor, vendors, vendorClientAssignments, clients, InsertVendor, inspections, Sku, Inspection, QualityTest, qualityTests, InsertClient, Staff, staff, InsertStaff, StaffGoal, staffGoals, InsertStaffGoal, goalProgressEntries, GoalProgressEntry, InsertGoalProgressEntry, skus, InsertSku, InsertInspection, InsertQualityTest, Timeline, timelines, InsertTimeline, Shipment, shipments, InsertShipment, ImportHistory, importHistory, InsertImportHistory, BrandAssignment, brandAssignments, VendorContact, vendorContacts, InsertVendorContact, ColorPanel, InsertColorPanel, colorPanels, ColorPanelHistory, colorPanelHistory, InsertColorPanelHistory, SkuColorPanel, skuColorPanels, ColorPanelWorkflow, colorPanelWorkflows, InsertColorPanelWorkflow, ColorPanelCommunication, colorPanelCommunications, InsertColorPanelCommunication, ColorPanelMessage, colorPanelMessages, InsertColorPanelMessage, ColorPanelAiEvent, colorPanelAiEvents, InsertColorPanelAiEvent, ColorPanelIssue, colorPanelIssues, InsertColorPanelIssue, ActivityLog, activityLogs, InsertActivityLog, PoTimeline, PoTimelineMilestone, poTimelines, poTimelineMilestones, vendorTemplateMilestones, VendorTimelineTemplate, vendorTimelineTemplates, VendorTemplateMilestone, InsertVendorTimelineTemplate, InsertVendorTemplateMilestone, PoTask, poTasks, InsertPoTask, MILESTONE_LABELS, VendorCapacityData, vendorCapacityData, VendorCapacitySummary, vendorCapacitySummary, InsertVendorCapacityData, InsertVendorCapacitySummary, activeProjections, vendorSkuProjectionHistory, InsertActiveProjection, ActiveProjection, VendorSkuProjectionHistory, vendorCapacityAliases, expiredProjections, Communication, communications, InsertCommunication, AiSummary, aiSummaries, InsertAiSummary, CategoryTimelineAverage, categoryTimelineAverages, todoDismissals } from "@shared/schema";
import { createHash } from "crypto";
import { eq, sql, inArray, desc, and, lte, or, gt, SQL, isNotNull, gte } from "drizzle-orm";
import { Client } from "pg";
import { db } from "server/db";
import { ComplianceFilters, AT_RISK_THRESHOLDS } from "server/storage";

import { IStorage } from "../Abstractions/IStorage";

export class DbStorage implements IStorage {
    // User operations
    async getUser(id: string): Promise<User | undefined> {
        const result = await db.select().from(users).where(eq(users.id, id));
        return result[0];
    }

    async getUserByEmail(email: string): Promise<User | undefined> {
        const result = await db.select().from(users).where(eq(users.email, email));
        return result[0];
    }

    async createUser(user: InsertUser): Promise<User> {
        const result = await db.insert(users).values(user).returning();
        return result[0];
    }

    // Purchase Order operations - returns aggregated data per PO number
    async getPurchaseOrders(filters?: {
        vendor?: string;
        office?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
        client?: string;
        merchandiser?: string;
    }): Promise<PurchaseOrder[]> {
        // Build dynamic SQL conditions using template literals for proper parameterization
        const conditions: ReturnType<typeof sql>[] = [];

        if (filters?.vendor) {
            // Match vendor by canonical name from vendors table or via aliases
            conditions.push(sql`(
        ph.vendor = ${filters.vendor}
        OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor}))
        OR ph.vendor IN (
          SELECT vca.alias FROM vendor_capacity_aliases vca
          JOIN vendors v ON vca.vendor_id = v.id
          WHERE v.name = ${filters.vendor}
        )
      )`);
        }
        if (filters?.office) {
            conditions.push(sql`ph.office = ${filters.office}`);
        }
        if (filters?.status) {
            conditions.push(sql`ph.status = ${filters.status}`);
        }
        if (filters?.startDate) {
            conditions.push(sql`ph.po_date >= ${filters.startDate}`);
        }
        if (filters?.endDate) {
            conditions.push(sql`ph.po_date <= ${filters.endDate}`);
        }
        if (filters?.client) {
            // Look up full client name from clients table using the code
            conditions.push(sql`ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
        }
        if (filters?.merchandiser) {
            conditions.push(sql`v.merchandiser = ${filters.merchandiser}`);
        }

        // Build the WHERE clause by joining conditions with AND
        const whereClause = conditions.length > 0
            ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
            : sql``;

        // Use SQL to aggregate by PO header ID (each PO has one header)
        // Join with vendors table to get merchandiser info for filtering
        // IMPORTANT: Fall back to po_headers.total_value/total_quantity when no line items exist
        const result = await db.execute(sql`
      SELECT 
        ph.id,
        ph.po_number,
        ph.cop_number,
        ph.client,
        ph.client_division,
        ph.vendor,
        ph.buyer,
        ph.office,
        MAX(pli.sku) as sku,
        MAX(pli.style) as style,
        ph.program_description,
        ph.merchandise_program,
        ph.product_category as category,
        ph.product_group,
        ph.po_date,
        ph.original_ship_date,
        ph.revised_ship_date,
        ph.original_cancel_date,
        ph.revised_cancel_date,
        CASE 
          WHEN COALESCE(SUM(pli.order_quantity), 0) > 0 
          THEN SUM(pli.order_quantity)
          ELSE ph.total_quantity
        END as order_quantity,
        CASE 
          WHEN COALESCE(SUM(pli.order_quantity), 0) > 0 
          THEN SUM(pli.order_quantity * COALESCE(pli.unit_price, 0)) / NULLIF(SUM(pli.order_quantity), 0)
          ELSE 0
        END as unit_price,
        CASE 
          WHEN COALESCE(SUM(pli.order_quantity * COALESCE(pli.unit_price, 0)), 0) > 0 
          THEN SUM(pli.order_quantity * COALESCE(pli.unit_price, 0))
          ELSE ph.total_value
        END as total_value,
        ph.status,
        ph.shipment_status,
        ph.created_at,
        ph.updated_at,
        COUNT(pli.id) as line_item_count,
        EXISTS (
          SELECT 1 FROM shipments s 
          WHERE s.po_number = ph.po_number 
            AND (s.delivery_to_consolidator IS NOT NULL OR s.actual_sailing_date IS NOT NULL)
        ) as has_actual_ship_date
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      LEFT JOIN vendors v ON ph.vendor = v.name
      ${whereClause}
      GROUP BY ph.id, ph.po_number, ph.cop_number, ph.client, ph.client_division, ph.vendor, 
               ph.buyer, ph.office, ph.program_description, ph.merchandise_program, ph.product_category, ph.product_group,
               ph.po_date, ph.original_ship_date, ph.revised_ship_date, ph.original_cancel_date,
               ph.revised_cancel_date, ph.total_quantity, ph.total_value, ph.status, 
               ph.shipment_status, ph.created_at, ph.updated_at
      ORDER BY ph.po_date DESC NULLS LAST
    `);

        // Map snake_case to camelCase for frontend
        return result.rows.map((row: any) => ({
            id: row.id,
            poNumber: row.po_number,
            copNumber: row.cop_number,
            client: row.client,
            clientDivision: row.client_division,
            vendor: row.vendor,
            buyer: row.buyer,
            office: row.office,
            sku: row.sku,
            style: row.style,
            description: row.program_description,
            merchandiseProgram: row.merchandise_program,
            category: row.category,
            productGroup: row.product_group,
            poDate: row.po_date ? new Date(row.po_date) : null,
            originalShipDate: row.original_ship_date ? new Date(row.original_ship_date) : null,
            revisedShipDate: row.revised_ship_date ? new Date(row.revised_ship_date) : null,
            originalCancelDate: row.original_cancel_date ? new Date(row.original_cancel_date) : null,
            revisedCancelDate: row.revised_cancel_date ? new Date(row.revised_cancel_date) : null,
            orderQuantity: parseInt(row.order_quantity) || 0,
            // Keep values in cents - frontend formatCurrency will convert to dollars
            unitPrice: parseInt(row.unit_price) || 0,
            totalValue: parseInt(row.total_value) || 0,
            status: row.status,
            shipmentStatus: row.shipment_status,
            createdAt: row.created_at ? new Date(row.created_at) : null,
            updatedAt: row.updated_at ? new Date(row.updated_at) : null,
            lineItemCount: parseInt(row.line_item_count) || 1,
            hasActualShipDate: row.has_actual_ship_date === true,
        })) as unknown as PurchaseOrderWithComputedFields[];
    }

    async getPurchaseOrderById(id: number): Promise<PurchaseOrder | undefined> {
        const result = await db.select().from(poHeaders).where(eq(poHeaders.id, id));
        if (!result[0]) return undefined;
        const header = result[0];
        return {
            ...header,
            sku: null,
            style: null,
            sellerStyle: null,
            newSku: null,
            newStyle: null,
            bigBets: null,
            cbxItem: null,
            orderQuantity: header.totalQuantity,
            unitPrice: 0,
            createdBy: null,
            updatedBy: null,
        } as PurchaseOrder;
    }

    async getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | undefined> {
        const result = await db.select().from(poHeaders).where(eq(poHeaders.poNumber, poNumber));
        if (!result[0]) return undefined;
        const header = result[0];
        return {
            ...header,
            sku: null,
            style: null,
            sellerStyle: null,
            newSku: null,
            newStyle: null,
            bigBets: null,
            cbxItem: null,
            orderQuantity: header.totalQuantity,
            unitPrice: 0,
            createdBy: null,
            updatedBy: null,
        } as PurchaseOrder;
    }

    async getPurchaseOrdersByNumbers(poNumbers: string[]): Promise<Map<string, PurchaseOrder>> {
        if (poNumbers.length === 0) {
            return new Map();
        }
        const result = await db.select().from(poHeaders).where(inArray(poHeaders.poNumber, poNumbers));
        const poMap = new Map<string, PurchaseOrder>();
        for (const header of result) {
            if (!poMap.has(header.poNumber)) {
                poMap.set(header.poNumber, {
                    ...header,
                    sku: null,
                    style: null,
                    sellerStyle: null,
                    newSku: null,
                    newStyle: null,
                    bigBets: null,
                    cbxItem: null,
                    orderQuantity: header.totalQuantity,
                    unitPrice: 0,
                    createdBy: null,
                    updatedBy: null,
                } as PurchaseOrder);
            }
        }
        return poMap;
    }

    async getPurchaseOrderLineItems(poNumber: string): Promise<PoLineItem[]> {
        // Get from po_line_items table (normalized structure)
        // This table is populated during OS340 import and contains SKU-level detail
        const result = await db.select().from(poLineItems).where(eq(poLineItems.poNumber, poNumber)).orderBy(poLineItems.lineSequence);
        return result;
    }

    async getPoHeaderByNumber(poNumber: string): Promise<PoHeader | undefined> {
        const result = await db.select().from(poHeaders).where(eq(poHeaders.poNumber, poNumber));
        return result[0];
    }

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

    // Search purchase orders by PO number
    async searchPurchaseOrders(query: string): Promise<PurchaseOrder[]> {
        const result = await db.execute(sql`
      SELECT DISTINCT ON (po_number) *
      FROM po_headers
      WHERE po_number ILIKE ${`%${query}%`}
      ORDER BY po_number, revised_ship_date DESC NULLS LAST
      LIMIT 50
    `);

        return result.rows as PurchaseOrder[];
    }

    // Get aggregated purchase orders by vendor (grouped by PO number)
    async getAggregatedPurchaseOrdersByVendor(vendorName: string, startDate?: Date, endDate?: Date): Promise<{
        poNumber: string;
        copNumber: string | null;
        status: string;
        originalShipDate: Date | null;
        revisedShipDate: Date | null;
        orderQuantity: number;
        totalValue: number;
        lineItemCount: number;
    }[]> {
        // Build date filter conditions
        const dateConditions = [];
        if (startDate) {
            dateConditions.push(sql`po_date >= ${startDate}`);
        }
        if (endDate) {
            dateConditions.push(sql`po_date <= ${endDate}`);
        }

        const dateFilter = dateConditions.length > 0
            ? sql`AND ${sql.join(dateConditions, sql` AND `)}`
            : sql``;

        const result = await db.execute(sql`
      SELECT 
        po_number as "poNumber",
        MAX(cop_number) as "copNumber",
        MAX(status) as "status",
        MAX(original_ship_date) as "originalShipDate",
        MAX(revised_ship_date) as "revisedShipDate",
        SUM(total_quantity) as "orderQuantity",
        SUM(total_value) as "totalValue",
        (SELECT COUNT(*) FROM po_line_items pli WHERE pli.po_number = ph.po_number) as "lineItemCount"
      FROM po_headers ph
      WHERE vendor = ${vendorName}
        ${dateFilter}
      GROUP BY po_number
      ORDER BY MAX(revised_ship_date) DESC NULLS LAST
    `);

        return result.rows.map((row: any) => ({
            poNumber: row.poNumber,
            copNumber: row.copNumber,
            status: row.status || 'Unknown',
            originalShipDate: row.originalShipDate ? new Date(row.originalShipDate) : null,
            revisedShipDate: row.revisedShipDate ? new Date(row.revisedShipDate) : null,
            orderQuantity: parseInt(row.orderQuantity) || 0,
            totalValue: parseInt(row.totalValue) || 0,
            lineItemCount: parseInt(row.lineItemCount) || 1,
        }));
    }

    // DEPRECATED: Purchase order write operations removed
    // All new data now goes to po_headers + po_line_items (normalized structure)
    // The legacy purchase_orders table is kept for historical FK references only

    // Legacy createPurchaseOrder - DEPRECATED, use bulkUpsertPoHeaders instead
    async createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder> {
        throw new Error("DEPRECATED: Use bulkUpsertPoHeaders for new purchase orders. The purchase_orders table is no longer used.");
    }

    // Legacy updatePurchaseOrder - DEPRECATED, update po_headers directly
    async updatePurchaseOrder(id: number, po: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined> {
        throw new Error("DEPRECATED: Update po_headers directly. The purchase_orders table is no longer used.");
    }

    // Legacy bulkCreatePurchaseOrders - DEPRECATED, use bulkUpsertPoHeaders instead  
    async bulkCreatePurchaseOrders(pos: InsertPurchaseOrder[]): Promise<PurchaseOrder[]> {
        throw new Error("DEPRECATED: Use bulkUpsertPoHeaders for new purchase orders. The purchase_orders table is no longer used.");
    }

    // Legacy clearAllPurchaseOrders - DEPRECATED
    async clearAllPurchaseOrders(): Promise<void> {
        throw new Error("DEPRECATED: Use clearAllPoHeaders for clearing purchase orders. The purchase_orders table is no longer used.");
    }

    // Legacy bulkUpsertPurchaseOrders - DEPRECATED, use bulkUpsertPoHeaders instead
    async bulkUpsertPurchaseOrders(pos: InsertPurchaseOrder[]): Promise<{ inserted: number; updated: number }> {
        throw new Error("DEPRECATED: Use bulkUpsertPoHeaders for new purchase orders. The purchase_orders table is no longer used.");
    }

    // Vendor operations
    async getVendors(filters?: { client?: string }): Promise<Vendor[]> {
        if (filters?.client) {
            try {
                // Join with vendor_client_assignments and clients to filter by client name
                const result = await db
                    .select({
                        id: vendors.id,
                        name: vendors.name,
                        contactPerson: vendors.contactPerson,
                        email: vendors.email,
                        phone: vendors.phone,
                        address: vendors.address,
                        country: vendors.country,
                        region: vendors.region,
                        merchandiser: vendors.merchandiser,
                        merchandiserId: vendors.merchandiserId,
                        merchandisingManager: vendors.merchandisingManager,
                        merchandisingManagerId: vendors.merchandisingManagerId,
                        status: vendors.status,
                        createdAt: vendors.createdAt,
                        updatedAt: vendors.updatedAt,
                    })
                    .from(vendors)
                    .innerJoin(vendorClientAssignments, eq(vendors.id, vendorClientAssignments.vendorId))
                    .innerJoin(clients, eq(vendorClientAssignments.clientId, clients.id))
                    .where(eq(clients.code, filters.client))
                    .orderBy(vendors.name);
                return result || [];
            } catch (error) {
                console.error('Error fetching vendors with client filter:', error);
                return [];
            }
        }
        return db.select().from(vendors).orderBy(vendors.name);
    }

    async getVendorById(id: number): Promise<Vendor | undefined> {
        const result = await db.select().from(vendors).where(eq(vendors.id, id));
        return result[0];
    }

    async getVendorByName(name: string): Promise<Vendor | undefined> {
        const result = await db.select().from(vendors).where(eq(vendors.name, name));
        return result[0];
    }

    async createVendor(vendor: InsertVendor): Promise<Vendor> {
        const result = await db.insert(vendors).values(vendor).returning();
        return result[0];
    }

    async updateVendor(id: number, vendor: Partial<InsertVendor>): Promise<Vendor | undefined> {
        const result = await db
            .update(vendors)
            .set({ ...vendor, updatedAt: new Date() })
            .where(eq(vendors.id, id))
            .returning();
        return result[0];
    }

    async bulkCreateVendors(vendorsToCreate: InsertVendor[]): Promise<Vendor[]> {
        if (vendorsToCreate.length === 0) return [];
        const result = await db.insert(vendors).values(vendorsToCreate).returning();
        return result;
    }

    // Vendor Detail Performance - uses TRUE OTD formula
    // TRUE OTD = On-Time Shipped / (Total Shipped + Overdue Unshipped)
    async getVendorDetailPerformance(vendorId: number, startDate?: Date, endDate?: Date): Promise<{
        otdPercentage: number;
        totalOrders: number;
        onTimeOrders: number;
        lateOrders: number;
        overdueUnshipped: number;
        shippedTotal: number;
        firstTimeRightPercentage: number;
        totalInspections: number;
        passedFirstTime: number;
        failedFirstTime: number;
    }> {
        const vendor = await this.getVendorById(vendorId);
        if (!vendor) {
            return {
                otdPercentage: 0,
                totalOrders: 0,
                onTimeOrders: 0,
                lateOrders: 0,
                overdueUnshipped: 0,
                shippedTotal: 0,
                firstTimeRightPercentage: 0,
                totalInspections: 0,
                passedFirstTime: 0,
                failedFirstTime: 0,
            };
        }

        // Use provided date range or default to YTD
        const currentYear = new Date().getFullYear();
        const ytdStart = startDate || new Date(currentYear, 0, 1);
        const ytdEnd = endDate || new Date();

        // Calculate TRUE OTD using SQL for accuracy
        // Method B: shipped = delivery_to_consolidator IS NOT NULL OR actual_sailing_date IS NOT NULL
        // On-time = MIN(delivery_to_consolidator) <= COALESCE(revised_cancel_date, original_cancel_date)
        const trueOtdResult = await db.execute<{
            shipped_total: number;
            shipped_on_time: number;
            shipped_late: number;
            overdue_unshipped: number;
        }>(sql`
      WITH shipped_orders AS (
        SELECT DISTINCT ph.id,
          CASE 
            WHEN MIN(s.delivery_to_consolidator) <= COALESCE(ph.revised_cancel_date, ph.original_cancel_date) THEN 1 
            ELSE 0 
          END as is_on_time
        FROM po_headers ph
        JOIN shipments s ON s.po_number = ph.po_number
        WHERE ph.vendor = ${vendor.name}
          AND ph.po_date >= ${ytdStart}
          AND ph.po_date <= ${ytdEnd}
          AND (s.delivery_to_consolidator IS NOT NULL OR s.actual_sailing_date IS NOT NULL)
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) IS NOT NULL
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
        GROUP BY ph.id, ph.revised_cancel_date, ph.original_cancel_date
      ),
      overdue_unshipped AS (
        SELECT DISTINCT ph.id
        FROM po_headers ph
        LEFT JOIN shipments s ON s.po_number = ph.po_number 
          AND (s.delivery_to_consolidator IS NOT NULL OR s.actual_sailing_date IS NOT NULL)
        WHERE ph.vendor = ${vendor.name}
          AND ph.po_date >= ${ytdStart}
          AND ph.po_date <= ${ytdEnd}
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
          AND s.id IS NULL
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
      )
      SELECT 
        (SELECT COUNT(*)::int FROM shipped_orders) as shipped_total,
        (SELECT COALESCE(SUM(is_on_time), 0)::int FROM shipped_orders) as shipped_on_time,
        (SELECT COUNT(*)::int - COALESCE(SUM(is_on_time), 0)::int FROM shipped_orders) as shipped_late,
        (SELECT COUNT(*)::int FROM overdue_unshipped) as overdue_unshipped
    `);

        const shippedTotal = trueOtdResult.rows[0]?.shipped_total || 0;
        const onTimeOrders = trueOtdResult.rows[0]?.shipped_on_time || 0;
        const lateOrders = trueOtdResult.rows[0]?.shipped_late || 0;
        const overdueUnshipped = trueOtdResult.rows[0]?.overdue_unshipped || 0;
        const totalShouldHaveShipped = shippedTotal + overdueUnshipped;
        const otdPercentage = totalShouldHaveShipped > 0 ? (onTimeOrders / totalShouldHaveShipped) * 100 : 0;

        // Get all SKUs for this vendor via PO line items
        const skuResult = await db.execute(sql`
      SELECT DISTINCT pli.sku
      FROM po_headers ph
      JOIN po_line_items pli ON pli.po_header_id = ph.id
      WHERE ph.vendor = ${vendor.name}
        AND pli.sku IS NOT NULL
    `);
        const vendorSkus = skuResult.rows.map((row: any) => row.sku as string).filter(Boolean);

        // Get inspections for those SKUs
        const vendorInspections = vendorSkus.length > 0
            ? await db
                .select()
                .from(inspections)
                .where(inArray(inspections.sku, vendorSkus))
            : [];

        // Calculate first-time-right: inspections that passed on first attempt (not re-inspections)
        const firstTimeInspections = vendorInspections.filter(
            i => i.inspectionType && !i.inspectionType.toLowerCase().includes('re-')
        );

        const passedFirstTime = firstTimeInspections.filter(
            i => i.result?.toLowerCase() === 'passed'
        ).length;

        const failedFirstTime = firstTimeInspections.filter(
            i => i.result?.toLowerCase() === 'failed'
        ).length;

        const totalInspections = firstTimeInspections.length;
        const firstTimeRightPercentage = totalInspections > 0
            ? (passedFirstTime / totalInspections) * 100
            : 0;

        return {
            otdPercentage,
            totalOrders: totalShouldHaveShipped,
            onTimeOrders,
            lateOrders,
            overdueUnshipped,
            shippedTotal,
            firstTimeRightPercentage,
            totalInspections,
            passedFirstTime,
            failedFirstTime,
        };
    }

    async getVendorYTDPerformance(vendorId: number, startDate?: Date, endDate?: Date): Promise<{
        ytdSummary: {
            totalOrders: number;
            onTimeOrders: number;
            lateOrders: number;
            atRiskOrders: number;
            otdPercentage: number;
        };
        monthlyData: Array<{
            month: string;
            monthNum: number;
            totalOrders: number;
            onTimeOrders: number;
            lateOrders: number;
            atRiskOrders: number;
            cumulativeTotal: number;
            cumulativeOnTime: number;
            cumulativeLate: number;
            cumulativeOtdPercentage: number;
        }>;
    }> {
        const vendor = await this.getVendorById(vendorId);
        if (!vendor) {
            return {
                ytdSummary: { totalOrders: 0, onTimeOrders: 0, lateOrders: 0, atRiskOrders: 0, otdPercentage: 0 },
                monthlyData: []
            };
        }

        // Use provided date range or default to YTD
        const currentYear = new Date().getFullYear();
        const ytdStart = startDate || new Date(currentYear, 0, 1);
        const ytdEnd = endDate || new Date();

        // Extract base vendor name (before " - " suffix like " - Furnture" or " - Hardlines")
        // This handles cases where vendor table has "NTN Co., Ltd - Furnture" but POs have "NTN Co., Ltd"
        const baseVendorName = vendor.name.includes(' - ')
            ? vendor.name.split(' - ')[0]
            : vendor.name;

        // Get monthly performance data for this vendor within the date range
        // Uses cancel date for monthly grouping and proper split-shipment handling
        const result = await db.execute<{
            month_num: number;
            month_name: string;
            total_orders: number;
            on_time_orders: number;
            late_orders: number;
            at_risk_orders: number;
        }>(sql`
      WITH po_statuses AS (
        -- First, group by po_number to handle split shipments properly
        -- A PO is on-time only if ALL parts are on-time (BOOL_AND)
        -- A PO is late if ANY part is late (BOOL_OR)
        SELECT 
          ph.po_number,
          EXTRACT(MONTH FROM MIN(COALESCE(ph.revised_cancel_date, ph.original_cancel_date)))::int as month_num,
          TO_CHAR(MIN(COALESCE(ph.revised_cancel_date, ph.original_cancel_date)), 'Mon') as month_name,
          CASE WHEN BOOL_AND(ph.shipment_status = 'On-Time') THEN true ELSE false END as all_on_time,
          CASE WHEN BOOL_OR(ph.shipment_status = 'Late') THEN true ELSE false END as any_late,
          BOOL_OR(ph.shipment_status IN ('On-Time', 'Late')) as has_shipped_parts
        FROM po_headers ph
        WHERE (ph.vendor = ${vendor.name} OR ph.vendor = ${baseVendorName})
          AND (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${ytdStart}
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= ${ytdEnd}
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
        GROUP BY ph.po_number
      ),
      shipped_pos AS (
        SELECT po_number, month_num, month_name, all_on_time
        FROM po_statuses
        WHERE has_shipped_parts = true
      ),
      unshipped_late_pos AS (
        -- POs past cancel date with no shipped parts
        SELECT 
          ph.po_number,
          EXTRACT(MONTH FROM MIN(COALESCE(ph.revised_cancel_date, ph.original_cancel_date)))::int as month_num,
          TO_CHAR(MIN(COALESCE(ph.revised_cancel_date, ph.original_cancel_date)), 'Mon') as month_name
        FROM po_headers ph
        WHERE (ph.vendor = ${vendor.name} OR ph.vendor = ${baseVendorName})
          AND (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${ytdStart}
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= ${ytdEnd}
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
          AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          AND ph.po_number NOT IN (SELECT po_number FROM shipped_pos)
        GROUP BY ph.po_number
      ),
      -- At-Risk POs: Uses shared AT_RISK_THRESHOLDS constants (see top of file)
      -- Criteria: (1) Failed final inspection, (2) Inline not booked ≤14 days, (3) Final not booked ≤7 days, (4) QA not passed ≤45 days
      at_risk_pos AS (
        SELECT DISTINCT ph.po_number
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE (ph.vendor = ${vendor.name} OR ph.vendor = ${baseVendorName})
          AND (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${ytdStart}
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= ${ytdEnd}
          AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          AND ph.po_number NOT LIKE '089%'
          AND (
            -- Criteria 1: Failed final inspection
            EXISTS(
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
                AND i.inspection_type = 'Final Inspection'
                AND i.result IN ('Failed', 'Failed - Critical Failure')
            )
            -- Criteria 2: Inline inspection not booked within 14 days of HOD
            OR (
              EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) <= 14
              AND EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) > 0
              AND NOT EXISTS(SELECT 1 FROM inspections i WHERE i.po_number = ph.po_number AND i.inspection_type ILIKE '%inline%')
            )
            -- Criteria 3: Final inspection not booked within 7 days of HOD
            OR (
              EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) <= 7
              AND EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) > 0
              AND NOT EXISTS(SELECT 1 FROM inspections i WHERE i.po_number = ph.po_number AND i.inspection_type ILIKE '%final%')
            )
            -- Criteria 4: QA test not passed within 45 days of HOD
            OR (
              EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) <= 45
              AND EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) > 0
              AND NOT EXISTS(
                SELECT 1 FROM skus s 
                INNER JOIN quality_tests qt ON qt.sku_id = s.id
                WHERE s.sku = pli.sku AND qt.result = 'Pass'
              )
            )
          )
      ),
      monthly_stats AS (
        SELECT 
          COALESCE(sp.month_num, ul.month_num) as month_num,
          COALESCE(sp.month_name, ul.month_name) as month_name,
          COUNT(DISTINCT sp.po_number)::int + COUNT(DISTINCT ul.po_number)::int as total_orders,
          COUNT(DISTINCT CASE WHEN sp.all_on_time = true THEN sp.po_number END)::int as on_time_orders,
          COUNT(DISTINCT CASE WHEN sp.all_on_time = false THEN sp.po_number END)::int + COUNT(DISTINCT ul.po_number)::int as late_orders
        FROM shipped_pos sp
        FULL OUTER JOIN unshipped_late_pos ul ON sp.month_num = ul.month_num
        WHERE COALESCE(sp.month_num, ul.month_num) IS NOT NULL
        GROUP BY COALESCE(sp.month_num, ul.month_num), COALESCE(sp.month_name, ul.month_name)
      )
      SELECT 
        ms.month_num,
        ms.month_name,
        ms.total_orders,
        ms.on_time_orders,
        ms.late_orders,
        (SELECT COUNT(*)::int FROM at_risk_pos ar 
         JOIN po_headers ph ON ar.po_number = ph.po_number
         WHERE EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) = ms.month_num
           AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) = EXTRACT(YEAR FROM CURRENT_DATE)
        ) as at_risk_orders
      FROM monthly_stats ms
      ORDER BY month_num
    `);

        // Build monthly data with cumulative totals
        let cumulativeTotal = 0;
        let cumulativeOnTime = 0;
        let cumulativeLate = 0;

        const monthlyData = result.rows.map(row => {
            cumulativeTotal += row.total_orders;
            cumulativeOnTime += row.on_time_orders;
            cumulativeLate += row.late_orders;

            return {
                month: row.month_name,
                monthNum: row.month_num,
                totalOrders: row.total_orders,
                onTimeOrders: row.on_time_orders,
                lateOrders: row.late_orders,
                atRiskOrders: row.at_risk_orders,
                cumulativeTotal,
                cumulativeOnTime,
                cumulativeLate,
                cumulativeOtdPercentage: cumulativeTotal > 0
                    ? Math.round((cumulativeOnTime / cumulativeTotal) * 1000) / 10
                    : 0
            };
        });

        // Calculate YTD summary
        const ytdSummary = {
            totalOrders: cumulativeTotal,
            onTimeOrders: cumulativeOnTime,
            lateOrders: cumulativeLate,
            atRiskOrders: monthlyData.reduce((sum, m) => sum + m.atRiskOrders, 0),
            otdPercentage: cumulativeTotal > 0
                ? Math.round((cumulativeOnTime / cumulativeTotal) * 1000) / 10
                : 0
        };

        return { ytdSummary, monthlyData };
    }

    async getVendorSkus(vendorId: number): Promise<Sku[]> {
        const vendor = await this.getVendorById(vendorId);
        if (!vendor) return [];

        // Get unique SKUs with details from po_headers/po_line_items for this vendor
        const result = await db.execute(sql`
      SELECT DISTINCT ON (pli.sku)
        pli.sku,
        pli.style,
        ph.program_description as description,
        ph.product_category as category,
        ph.product_group as "productGroup"
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      WHERE ph.vendor = ${vendor.name}
        AND pli.sku IS NOT NULL
      ORDER BY pli.sku
    `);

        return result.rows.map((row: any) => ({
            id: 0,
            sku: row.sku,
            style: row.style || null,
            description: row.description || null,
            category: row.category || null,
            productGroup: row.productGroup || null,
            createdAt: null,
            updatedAt: null,
        })) as unknown as Sku[];
    }

    async getVendorInspections(vendorId: number): Promise<Inspection[]> {
        const vendor = await this.getVendorById(vendorId);
        if (!vendor) return [];

        // Get unique SKUs from PO line items for this vendor
        const skuResult = await db.execute(sql`
      SELECT DISTINCT pli.sku
      FROM po_headers ph
      JOIN po_line_items pli ON pli.po_header_id = ph.id
      WHERE ph.vendor = ${vendor.name}
        AND pli.sku IS NOT NULL
    `);
        const skuCodes = skuResult.rows.map((row: any) => row.sku as string).filter(Boolean);

        if (skuCodes.length === 0) return [];

        return db
            .select()
            .from(inspections)
            .where(inArray(inspections.sku, skuCodes))
            .orderBy(desc(inspections.inspectionDate));
    }

    async getVendorQualityTests(vendorId: number): Promise<QualityTest[]> {
        const vendor = await this.getVendorById(vendorId);
        if (!vendor) return [];

        // Get unique SKUs from PO line items for this vendor
        const skuResult = await db.execute(sql`
      SELECT DISTINCT pli.sku
      FROM po_headers ph
      JOIN po_line_items pli ON pli.po_header_id = ph.id
      WHERE ph.vendor = ${vendor.name}
        AND pli.sku IS NOT NULL
    `);
        const skuCodes = skuResult.rows.map((row: any) => row.sku as string).filter(Boolean);

        if (skuCodes.length === 0) return [];

        return db
            .select()
            .from(qualityTests)
            .where(inArray(qualityTests.sku, skuCodes))
            .orderBy(desc(qualityTests.reportDate));
    }

    async getVendorYoYSales(vendorId: number, startDate?: Date, endDate?: Date): Promise<Array<{
        year: number;
        month: number;
        monthName: string;
        totalSales: number;
        orderCount: number;
    }>> {
        const vendor = await this.getVendorById(vendorId);
        if (!vendor) return [];

        // Use provided date range or default to last 2 years
        const currentYear = new Date().getFullYear();
        const defaultStart = new Date(currentYear - 2, 0, 1);
        const filterStart = startDate || defaultStart;
        const filterEnd = endDate || new Date();

        const result = await db.execute<{
            year: number;
            month: number;
            month_name: string;
            total_sales: number;
            order_count: number;
        }>(sql`
      SELECT 
        EXTRACT(YEAR FROM po_date)::int as year,
        EXTRACT(MONTH FROM po_date)::int as month,
        TO_CHAR(po_date, 'Mon') as month_name,
        COALESCE(SUM(total_value), 0)::numeric as total_sales,
        COUNT(DISTINCT po_number)::int as order_count
      FROM po_headers
      WHERE vendor = ${vendor.name}
        AND po_date IS NOT NULL
        AND po_date >= ${filterStart}
        AND po_date <= ${filterEnd}
      GROUP BY 
        EXTRACT(YEAR FROM po_date),
        EXTRACT(MONTH FROM po_date),
        TO_CHAR(po_date, 'Mon')
      ORDER BY year, month
    `);

        return result.rows.map(row => ({
            year: Number(row.year),
            month: Number(row.month),
            monthName: row.month_name,
            totalSales: Number(row.total_sales),
            orderCount: Number(row.order_count),
        }));
    }

    // Vendor OTD Year-over-Year with value-based metrics
    // Includes both shipped orders AND overdue unshipped orders (matching dashboard methodology)
    // Uses same methodology as dashboard: delivery_to_consolidator vs effective cancel date
    // Returns both Original OTD (shipped only) and Revised OTD (includes overdue backlog)
    async getVendorOtdYoY(vendorId: number, startDate?: Date, endDate?: Date): Promise<Array<{
        year: number;
        month: number;
        monthName: string;
        shippedOnTime: number;
        totalShipped: number;
        otdPct: number;
        onTimeValue: number;
        totalValue: number;
        lateValue: number;
        otdValuePct: number;
        overdueUnshipped: number;
        overdueBacklogValue: number;
        revisedOtdPct: number;
        revisedOtdValuePct: number;
    }>> {
        const vendor = await this.getVendorById(vendorId);
        if (!vendor) return [];

        // Determine which years to include - default to 3-year rolling window
        const currentYear = new Date().getFullYear();
        const previousYear = currentYear - 1;
        const twoYearsAgo = currentYear - 2;
        const MIN_YEAR = 2024;

        let yearsToInclude: number[];
        if (startDate && endDate) {
            const normalizedStart = new Date(startDate.getTime() + 12 * 60 * 60 * 1000);
            const normalizedEnd = new Date(endDate.getTime() + 12 * 60 * 60 * 1000);
            const startYear = Math.max(normalizedStart.getFullYear(), MIN_YEAR);
            const endYear = normalizedEnd.getFullYear();
            yearsToInclude = [];
            for (let y = startYear; y <= endYear; y++) {
                yearsToInclude.push(y);
            }
        } else {
            // Default: current year + previous 2 years
            yearsToInclude = [twoYearsAgo, previousYear, currentYear].filter(y => y >= MIN_YEAR);
        }

        if (yearsToInclude.length === 0) {
            yearsToInclude = [currentYear];
        }

        // Extract base vendor name (before " - " suffix)
        const baseVendorName = vendor.name.includes(' - ')
            ? vendor.name.split(' - ')[0]
            : vendor.name;

        // Build dynamic year filter
        const yearsList = yearsToInclude.join(', ');
        const yearsFilter = sql.raw(`(${yearsList})`);

        const result = await db.execute<{
            year: number;
            month: number;
            month_name: string;
            shipped_on_time: number;
            total_shipped: number;
            otd_pct: number;
            on_time_value: number;
            total_value: number;
            late_value: number;
            otd_value_pct: number;
            overdue_unshipped: number;
            overdue_backlog_value: number;
            revised_otd_pct: number;
            revised_otd_value_pct: number;
        }>(sql`
      WITH vendor_shipped_pos AS (
        -- Get all shipped POs for this vendor with monthly grouping by effective cancel date
        -- Uses MIN(delivery_to_consolidator) vs effective cancel date for on-time determination
        SELECT 
          ph.po_number,
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as due_year,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as due_month,
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon') as month_name,
          COALESCE(ph.revised_cancel_date, ph.original_cancel_date) as effective_cancel_date,
          MAX(s.delivery_to_consolidator) as first_delivery_date,
          COALESCE(ph.shipped_value, 0) as shipped_value
        FROM po_headers ph
        LEFT JOIN shipments s ON s.po_number = ph.po_number
        WHERE (ph.vendor = ${vendor.name} OR ph.vendor = ${baseVendorName})
          AND ph.shipment_status IN ('On-Time', 'Late')
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) IS NOT NULL
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) IN ${yearsFilter}
        GROUP BY ph.po_number, ph.revised_cancel_date, ph.original_cancel_date, ph.shipped_value
      ),
      po_with_otd AS (
        SELECT 
          po_number,
          due_year,
          due_month,
          month_name,
          shipped_value,
          -- On-time if: delivered to consolidator on/before effective cancel date
          CASE 
            WHEN first_delivery_date IS NOT NULL AND first_delivery_date <= effective_cancel_date THEN 1 
            ELSE 0 
          END as is_on_time,
          -- Value-based on-time flag
          CASE 
            WHEN first_delivery_date IS NOT NULL AND first_delivery_date <= effective_cancel_date THEN shipped_value 
            ELSE 0 
          END as on_time_value
        FROM vendor_shipped_pos
      ),
      overdue_unshipped AS (
        -- Orders past cancel date that haven't shipped (exclude POs that have any shipped parts)
        SELECT 
          ph.po_number,
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as due_year,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as due_month,
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon') as month_name,
          COALESCE(ph.total_value, 0) as po_value
        FROM po_headers ph
        WHERE (ph.vendor = ${vendor.name} OR ph.vendor = ${baseVendorName})
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) IS NOT NULL
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
          AND (ph.shipment_status IS NULL OR ph.shipment_status NOT IN ('On-Time', 'Late'))
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) IN ${yearsFilter}
          AND ph.po_number NOT IN (SELECT po_number FROM po_with_otd)
        GROUP BY ph.po_number, ph.revised_cancel_date, ph.original_cancel_date, ph.total_value
      ),
      shipped_monthly AS (
        SELECT 
          due_year, due_month, month_name,
          COUNT(*)::int as shipped_total,
          SUM(is_on_time)::int as shipped_on_time,
          SUM(shipped_value)::bigint as total_value,
          SUM(on_time_value)::bigint as on_time_value
        FROM po_with_otd
        GROUP BY due_year, due_month, month_name
      ),
      overdue_monthly AS (
        SELECT 
          due_year, due_month, month_name,
          COUNT(*)::int as overdue_cnt,
          SUM(po_value)::bigint as overdue_value
        FROM overdue_unshipped
        GROUP BY due_year, due_month, month_name
      ),
      monthly_stats AS (
        SELECT 
          COALESCE(sm.due_year, om.due_year) as year,
          COALESCE(sm.due_month, om.due_month) as month,
          COALESCE(sm.month_name, om.month_name) as month_name,
          COALESCE(sm.shipped_total, 0) as total_shipped,
          COALESCE(sm.shipped_on_time, 0) as shipped_on_time,
          COALESCE(sm.total_value, 0) as total_value,
          COALESCE(sm.on_time_value, 0) as on_time_value,
          COALESCE(om.overdue_cnt, 0) as overdue_unshipped,
          COALESCE(om.overdue_value, 0) as overdue_value
        FROM shipped_monthly sm
        FULL OUTER JOIN overdue_monthly om 
          ON sm.due_year = om.due_year AND sm.due_month = om.due_month
      )
      SELECT 
        year,
        month,
        month_name,
        shipped_on_time,
        total_shipped,
        -- Original OTD: on-time / shipped only
        CASE WHEN total_shipped > 0 
          THEN ROUND((shipped_on_time::numeric / total_shipped::numeric) * 100, 1)
          ELSE 0
        END as otd_pct,
        on_time_value::bigint as on_time_value,
        total_value::bigint as total_value,
        (total_value - on_time_value)::bigint as late_value,
        -- Original OTD by value: on-time value / shipped value only
        CASE WHEN total_value > 0 
          THEN ROUND((on_time_value::numeric / total_value::numeric) * 100, 1)
          ELSE 0
        END as otd_value_pct,
        overdue_unshipped,
        overdue_value::bigint as overdue_backlog_value,
        -- Revised OTD: on-time / (shipped + overdue) - includes overdue backlog in denominator
        CASE WHEN (total_shipped + overdue_unshipped) > 0 
          THEN ROUND((shipped_on_time::numeric / (total_shipped + overdue_unshipped)::numeric) * 100, 1)
          ELSE 0
        END as revised_otd_pct,
        -- Revised OTD by value: on-time value / (shipped value + overdue value)
        CASE WHEN (total_value + overdue_value) > 0 
          THEN ROUND((on_time_value::numeric / (total_value + overdue_value)::numeric) * 100, 1)
          ELSE 0
        END as revised_otd_value_pct
      FROM monthly_stats
      WHERE year IS NOT NULL
      ORDER BY year, month
    `);

        return result.rows.map(row => ({
            year: Number(row.year),
            month: Number(row.month),
            monthName: row.month_name,
            shippedOnTime: Number(row.shipped_on_time || 0),
            totalShipped: Number(row.total_shipped || 0),
            otdPct: Number(row.otd_pct || 0),
            onTimeValue: Number(row.on_time_value || 0),
            totalValue: Number(row.total_value || 0),
            lateValue: Number(row.late_value || 0),
            otdValuePct: Number(row.otd_value_pct || 0),
            overdueUnshipped: Number(row.overdue_unshipped || 0),
            overdueBacklogValue: Number(row.overdue_backlog_value || 0),
            revisedOtdPct: Number(row.revised_otd_pct || 0),
            revisedOtdValuePct: Number(row.revised_otd_value_pct || 0),
        }));
    }

    async getOtdByVendor(filters?: {
        year?: number;
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
        vendorId: number;
        vendorName: string;
        year: number;
        month: number;
        monthName: string;
        shippedOnTime: number;
        totalShipped: number;
        otdPct: number;
        onTimeValue: number;
        totalValue: number;
        otdValuePct: number;
        overdueUnshipped: number;
        overdueBacklogValue: number;
        revisedOtdPct: number;
        revisedOtdValuePct: number;
    }>> {
        const currentYear = new Date().getFullYear();

        // Use full date range if provided, otherwise default to year-based range
        // For cancel date filtering: uses BETWEEN with actual dates (allows sub-year filtering)
        const startDate = filters?.startDate || (filters?.year
            ? new Date(`${filters.year}-01-01`)
            : new Date(`${currentYear - 1}-01-01`));
        const endDate = filters?.endDate || (filters?.year
            ? new Date(`${filters.year}-12-31`)
            : new Date(`${currentYear}-12-31`));

        // Build parameterized filters
        const merchandiserFilter = filters?.merchandiser || '';
        const managerFilter = filters?.merchandisingManager || '';
        const vendorFilter = filters?.vendor || '';
        const clientFilter = filters?.client || '';

        const result = await db.execute<{
            vendor_id: number;
            vendor_name: string;
            year: number;
            month: number;
            month_name: string;
            shipped_on_time: number;
            total_shipped: number;
            otd_pct: number;
            on_time_value: number;
            total_value: number;
            otd_value_pct: number;
            overdue_unshipped: number;
            overdue_backlog_value: number;
            revised_otd_pct: number;
            revised_otd_value_pct: number;
        }>(sql`
      WITH po_first_delivery AS (
        -- Get first delivery_to_consolidator date per PO
        SELECT 
          s.po_number,
          MAX(s.delivery_to_consolidator) as first_delivery
        FROM shipments s
        WHERE s.delivery_to_consolidator IS NOT NULL
          AND s.actual_sailing_date IS NOT NULL
        GROUP BY s.po_number
      ),
      vendor_shipped AS (
        -- Get shipped POs with on-time determination at PO level
        SELECT 
          v.id as vendor_id,
          v.name as vendor_name,
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as year,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as month,
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon') as month_name,
          ph.po_number,
          COALESCE(ph.shipped_value, 0) as shipped_value,
          CASE WHEN pfd.first_delivery <= COALESCE(ph.revised_cancel_date, ph.original_cancel_date)
            THEN 1 ELSE 0 
          END as is_on_time
        FROM po_headers ph
        JOIN vendors v ON v.name = ph.vendor
        JOIN po_first_delivery pfd ON pfd.po_number = ph.po_number
        WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) BETWEEN ${startDate} AND ${endDate}
          AND COALESCE(ph.shipped_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          AND (${merchandiserFilter} = '' OR ph.merchandiser ILIKE '%' || ${merchandiserFilter} || '%')
          AND (${managerFilter} = '' OR ph.merchandising_manager ILIKE '%' || ${managerFilter} || '%')
          AND (${vendorFilter} = '' OR ph.vendor ILIKE '%' || ${vendorFilter} || '%')
          AND (${clientFilter} = '' OR ph.client ILIKE '%' || ${clientFilter} || '%')
      ),
      vendor_shipped_agg AS (
        -- Aggregate shipped data per vendor per month
        SELECT 
          vendor_id,
          vendor_name,
          year,
          month,
          month_name,
          SUM(is_on_time) as shipped_on_time,
          COUNT(*) as total_shipped,
          SUM(CASE WHEN is_on_time = 1 THEN shipped_value ELSE 0 END) as on_time_value,
          SUM(shipped_value) as total_value
        FROM vendor_shipped
        GROUP BY vendor_id, vendor_name, year, month, month_name
      ),
      vendor_overdue AS (
        -- Get overdue unshipped POs by vendor per month
        SELECT 
          v.id as vendor_id,
          v.name as vendor_name,
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as year,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as month,
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon') as month_name,
          COUNT(DISTINCT ph.po_number) as overdue_count,
          SUM(COALESCE(ph.total_value, 0)) as overdue_value
        FROM po_headers ph
        JOIN vendors v ON v.name = ph.vendor
        LEFT JOIN shipments s ON s.po_number = ph.po_number AND s.actual_sailing_date IS NOT NULL
        WHERE s.id IS NULL
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) BETWEEN ${startDate} AND ${endDate}
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          AND (${merchandiserFilter} = '' OR ph.merchandiser ILIKE '%' || ${merchandiserFilter} || '%')
          AND (${managerFilter} = '' OR ph.merchandising_manager ILIKE '%' || ${managerFilter} || '%')
          AND (${vendorFilter} = '' OR ph.vendor ILIKE '%' || ${vendorFilter} || '%')
          AND (${clientFilter} = '' OR ph.client ILIKE '%' || ${clientFilter} || '%')
        GROUP BY v.id, v.name, 
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)),
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)),
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon')
      )
      SELECT 
        COALESCE(vs.vendor_id, vo.vendor_id) as vendor_id,
        COALESCE(vs.vendor_name, vo.vendor_name) as vendor_name,
        COALESCE(vs.year, vo.year) as year,
        COALESCE(vs.month, vo.month) as month,
        COALESCE(vs.month_name, vo.month_name) as month_name,
        COALESCE(vs.shipped_on_time, 0)::int as shipped_on_time,
        COALESCE(vs.total_shipped, 0)::int as total_shipped,
        CASE WHEN COALESCE(vs.total_shipped, 0) > 0 
          THEN ROUND((COALESCE(vs.shipped_on_time, 0)::numeric / vs.total_shipped::numeric) * 100, 1)
          ELSE 0 
        END as otd_pct,
        COALESCE(vs.on_time_value, 0)::bigint as on_time_value,
        COALESCE(vs.total_value, 0)::bigint as total_value,
        CASE WHEN COALESCE(vs.total_value, 0) > 0 
          THEN ROUND((COALESCE(vs.on_time_value, 0)::numeric / vs.total_value::numeric) * 100, 1)
          ELSE 0 
        END as otd_value_pct,
        COALESCE(vo.overdue_count, 0)::int as overdue_unshipped,
        COALESCE(vo.overdue_value, 0)::bigint as overdue_backlog_value,
        -- Revised OTD: on-time / (shipped + overdue)
        CASE WHEN (COALESCE(vs.total_shipped, 0) + COALESCE(vo.overdue_count, 0)) > 0 
          THEN ROUND((COALESCE(vs.shipped_on_time, 0)::numeric / (COALESCE(vs.total_shipped, 0) + COALESCE(vo.overdue_count, 0))::numeric) * 100, 1)
          ELSE 0 
        END as revised_otd_pct,
        -- Revised OTD by value
        CASE WHEN (COALESCE(vs.total_value, 0) + COALESCE(vo.overdue_value, 0)) > 0 
          THEN ROUND((COALESCE(vs.on_time_value, 0)::numeric / (COALESCE(vs.total_value, 0) + COALESCE(vo.overdue_value, 0))::numeric) * 100, 1)
          ELSE 0 
        END as revised_otd_value_pct
      FROM vendor_shipped_agg vs
      FULL OUTER JOIN vendor_overdue vo 
        ON vs.vendor_id = vo.vendor_id 
        AND vs.year = vo.year 
        AND vs.month = vo.month
      WHERE COALESCE(vs.total_shipped, 0) + COALESCE(vo.overdue_count, 0) > 0
      ORDER BY COALESCE(vs.vendor_name, vo.vendor_name), year, month
    `);

        return result.rows.map(row => ({
            vendorId: Number(row.vendor_id),
            vendorName: String(row.vendor_name),
            year: Number(row.year),
            month: Number(row.month),
            monthName: String(row.month_name),
            shippedOnTime: Number(row.shipped_on_time || 0),
            totalShipped: Number(row.total_shipped || 0),
            otdPct: Number(row.otd_pct || 0),
            onTimeValue: Number(row.on_time_value || 0),
            totalValue: Number(row.total_value || 0),
            otdValuePct: Number(row.otd_value_pct || 0),
            overdueUnshipped: Number(row.overdue_unshipped || 0),
            overdueBacklogValue: Number(row.overdue_backlog_value || 0),
            revisedOtdPct: Number(row.revised_otd_pct || 0),
            revisedOtdValuePct: Number(row.revised_otd_value_pct || 0),
        }));
    }

    async getSkuYoYSales(skuCode: string): Promise<Array<{
        year: number;
        month: number;
        monthName: string;
        totalSales: number;
        orderCount: number;
    }>> {
        const result = await db.execute<{
            year: number;
            month: number;
            month_name: string;
            total_sales: number;
            order_count: number;
        }>(sql`
      SELECT 
        EXTRACT(YEAR FROM ph.po_date)::int as year,
        EXTRACT(MONTH FROM ph.po_date)::int as month,
        TO_CHAR(ph.po_date, 'Mon') as month_name,
        COALESCE(SUM(ph.total_value), 0)::numeric as total_sales,
        COUNT(DISTINCT ph.po_number)::int as order_count
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      WHERE pli.sku = ${skuCode}
        AND ph.shipment_status IN ('On-Time', 'Late')
        AND ph.po_date IS NOT NULL
        AND EXTRACT(YEAR FROM ph.po_date) >= EXTRACT(YEAR FROM CURRENT_DATE) - 2
        AND COALESCE(ph.total_value, 0) > 0
        AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
        AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
        AND ph.po_number NOT LIKE '089%'
      GROUP BY 
        EXTRACT(YEAR FROM ph.po_date),
        EXTRACT(MONTH FROM ph.po_date),
        TO_CHAR(ph.po_date, 'Mon')
      ORDER BY year, month
    `);

        return result.rows.map(row => ({
            year: Number(row.year),
            month: Number(row.month),
            monthName: row.month_name,
            totalSales: Number(row.total_sales),
            orderCount: Number(row.order_count),
        }));
    }

    async getSkuShippingStats(skuCode: string): Promise<{
        firstShippedDate: string | null;
        lastShippedDate: string | null;
        totalShippedSales: number;
        totalShippedOrders: number;
        totalShippedQuantity: number;
        salesThisYear: number;
        salesLastYear: number;
    } | null> {
        const currentYear = new Date().getFullYear();
        const lastYear = currentYear - 1;

        const result = await db.execute<{
            first_shipped_date: string | null;
            last_shipped_date: string | null;
            total_shipped_sales: number;
            total_shipped_orders: number;
            total_shipped_quantity: number;
            sales_this_year: number;
            sales_last_year: number;
        }>(sql`
      WITH shipped_pos AS (
        -- Use shipped_value from OS340 "Shipped (USD)" for actual shipped dollars
        -- Include all shipped orders regardless of total_value to handle split shipments
        SELECT DISTINCT ON (ph.po_number)
          ph.id,
          ph.po_number,
          ph.shipped_value,
          ph.total_quantity,
          ph.po_date,
          COALESCE(ph.revised_ship_date, ph.original_ship_date) as ship_date
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE pli.sku = ${skuCode}
          AND ph.shipment_status IN ('On-Time', 'Late')
          AND COALESCE(ph.shipped_value, 0) > 0
        ORDER BY ph.po_number, ph.id
      )
      SELECT 
        MIN(ship_date)::text as first_shipped_date,
        MAX(ship_date)::text as last_shipped_date,
        COALESCE(SUM(shipped_value), 0)::numeric as total_shipped_sales,
        COUNT(DISTINCT po_number)::int as total_shipped_orders,
        COALESCE(SUM(total_quantity), 0)::int as total_shipped_quantity,
        COALESCE(SUM(CASE WHEN EXTRACT(YEAR FROM ship_date) = ${currentYear} THEN shipped_value ELSE 0 END), 0)::numeric as sales_this_year,
        COALESCE(SUM(CASE WHEN EXTRACT(YEAR FROM ship_date) = ${lastYear} THEN shipped_value ELSE 0 END), 0)::numeric as sales_last_year
      FROM shipped_pos
    `);

        const row = result.rows[0];
        if (!row) {
            return null;
        }

        return {
            firstShippedDate: row.first_shipped_date,
            lastShippedDate: row.last_shipped_date,
            totalShippedSales: Number(row.total_shipped_sales),
            totalShippedOrders: Number(row.total_shipped_orders),
            totalShippedQuantity: Number(row.total_shipped_quantity),
            salesThisYear: Number(row.sales_this_year),
            salesLastYear: Number(row.sales_last_year),
        };
    }

    async getSkuShipmentHistory(skuCode: string): Promise<Array<{
        id: number;
        poNumber: string;
        vendor: string | null;
        orderQuantity: number;
        unitPrice: number;
        totalValue: number;
        poDate: string | null;
        revisedShipDate: string | null;
        status: string;
        shipmentStatus: string | null;
    }>> {
        const result = await db.execute<{
            id: number;
            po_number: string;
            vendor: string | null;
            order_quantity: number;
            unit_price: number;
            total_value: number;
            po_date: string | null;
            revised_ship_date: string | null;
            status: string;
            shipment_status: string | null;
        }>(sql`
      SELECT 
        ph.id,
        ph.po_number,
        ph.vendor,
        COALESCE(pli.order_quantity, 0)::int as order_quantity,
        COALESCE(pli.unit_price, 0)::numeric as unit_price,
        COALESCE(ph.total_value, 0)::numeric as total_value,
        ph.po_date::text,
        ph.revised_ship_date::text,
        COALESCE(ph.status, 'Open') as status,
        s.hod_status as shipment_status
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      LEFT JOIN shipments s ON ph.po_number = s.po_number
      WHERE pli.sku = ${skuCode}
      ORDER BY ph.po_date DESC NULLS LAST
    `);

        return result.rows.map(row => ({
            id: Number(row.id),
            poNumber: row.po_number,
            vendor: row.vendor,
            orderQuantity: Number(row.order_quantity),
            unitPrice: Number(row.unit_price),
            totalValue: Number(row.total_value),
            poDate: row.po_date,
            revisedShipDate: row.revised_ship_date,
            status: row.status,
            shipmentStatus: row.shipment_status,
        }));
    }

    async getSkuComplianceStatus(skuCode: string): Promise<Array<{
        id: number;
        poNumber: string;
        testType: string | null;
        testCategory: string | null;
        reportDate: string | null;
        result: string | null;
        expiryDate: string | null;
        status: string;
        poCount?: number;
    }>> {
        // Get unique tests per SKU - deduplicated by test_type, report_date, and expiry_date
        // Tests belong to the product, not individual POs
        const result = await db.execute<{
            id: number;
            test_type: string | null;
            report_date: string | null;
            result: string | null;
            expiry_date: string | null;
            po_count: number;
        }>(sql`
      SELECT 
        MIN(qt.id)::int as id,
        qt.test_type,
        qt.report_date::text,
        qt.result,
        qt.expiry_date::text,
        COUNT(DISTINCT qt.po_number)::int as po_count
      FROM quality_tests qt
      JOIN po_headers ph ON qt.po_number = ph.po_number
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      WHERE pli.sku = ${skuCode}
      GROUP BY qt.test_type, qt.report_date, qt.result, qt.expiry_date
      ORDER BY qt.report_date DESC NULLS LAST
    `);

        const today = new Date();
        const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

        return result.rows.map(row => {
            let status = "Pending";
            if (row.result?.toLowerCase() === "failed" || row.result?.toLowerCase() === "fail") {
                status = "Failed";
            } else if (row.expiry_date) {
                const expiryDate = new Date(row.expiry_date);
                if (expiryDate < today) {
                    status = "Expired";
                } else if (expiryDate <= thirtyDaysFromNow) {
                    status = "Expiring Soon";
                } else if (row.result?.toLowerCase() === "passed" || row.result?.toLowerCase() === "pass") {
                    status = "Valid";
                }
            } else if (row.result?.toLowerCase() === "passed" || row.result?.toLowerCase() === "pass") {
                status = "Valid";
            }

            return {
                id: Number(row.id),
                poNumber: `${row.po_count} PO${row.po_count !== 1 ? 's' : ''}`,
                testType: row.test_type,
                testCategory: row.test_type,
                reportDate: row.report_date,
                result: row.result,
                expiryDate: row.expiry_date,
                status,
                poCount: row.po_count,
            };
        });
    }

    // Client operations
    async getClients(): Promise<Client[]> {
        return db.select().from(clients).orderBy(clients.name);
    }

    async getClientById(id: number): Promise<Client | undefined> {
        const result = await db.select().from(clients).where(eq(clients.id, id));
        return result[0];
    }

    async getClientByName(name: string): Promise<Client | undefined> {
        const result = await db.select().from(clients).where(eq(clients.name, name));
        return result[0];
    }

    async createClient(client: InsertClient): Promise<Client> {
        const result = await db.insert(clients).values(client).returning();
        return result[0];
    }

    async updateClient(id: number, client: Partial<InsertClient>): Promise<Client | undefined> {
        const result = await db
            .update(clients)
            .set({ ...client, updatedAt: new Date() })
            .where(eq(clients.id, id))
            .returning();
        return result[0];
    }

    async getClientKPIs(clientId: number): Promise<{
        totalPOs: number;
        totalValue: number;
        openPOs: number;
        shippedPOs: number;
        otdPercentage: number;
        atRiskPOs: number;
        vendorCount: number;
    }> {
        const client = await this.getClientById(clientId);
        if (!client) {
            return { totalPOs: 0, totalValue: 0, openPOs: 0, shippedPOs: 0, otdPercentage: 0, atRiskPOs: 0, vendorCount: 0 };
        }

        // Method B: shipped = delivery_to_consolidator IS NOT NULL OR actual_sailing_date IS NOT NULL
        // On-time = MIN(delivery_to_consolidator) <= COALESCE(revised_cancel_date, original_cancel_date)
        const result = await db.execute<{
            total_pos: number;
            total_value: number;
            open_pos: number;
            shipped_on_time: number;
            shipped_late: number;
            at_risk_pos: number;
            vendor_count: number;
        }>(sql`
      WITH po_ship_status AS (
        SELECT 
          ph.po_number,
          ph.total_value,
          ph.status,
          ph.revised_cancel_date,
          ph.original_cancel_date,
          ph.vendor,
          BOOL_OR(s.delivery_to_consolidator IS NOT NULL OR s.actual_sailing_date IS NOT NULL) as is_shipped,
          MIN(s.delivery_to_consolidator) as first_delivery
        FROM po_headers ph
        LEFT JOIN shipments s ON s.po_number = ph.po_number
        WHERE ph.client = ${client.name}
          AND COALESCE(ph.total_value, 0) > 0
          AND NOT (ph.po_number LIKE 'SMP%' OR ph.po_number LIKE '8X8%')
        GROUP BY ph.po_number, ph.total_value, ph.status, ph.revised_cancel_date, ph.original_cancel_date, ph.vendor
      )
      SELECT 
        COUNT(DISTINCT po_number)::int as total_pos,
        COALESCE(SUM(total_value), 0)::numeric as total_value,
        COUNT(DISTINCT CASE WHEN status NOT IN ('Closed', 'Shipped', 'Cancelled') THEN po_number END)::int as open_pos,
        COUNT(DISTINCT CASE 
          WHEN is_shipped AND first_delivery <= COALESCE(revised_cancel_date, original_cancel_date) 
          THEN po_number 
        END)::int as shipped_on_time,
        COUNT(DISTINCT CASE 
          WHEN is_shipped AND (first_delivery > COALESCE(revised_cancel_date, original_cancel_date) OR first_delivery IS NULL)
          THEN po_number 
        END)::int as shipped_late,
        COUNT(DISTINCT CASE 
          WHEN status NOT IN ('Closed', 'Shipped', 'Cancelled') 
          AND revised_cancel_date < CURRENT_DATE 
          AND NOT is_shipped
          THEN po_number 
        END)::int as at_risk_pos,
        COUNT(DISTINCT vendor)::int as vendor_count
      FROM po_ship_status
    `);

        const row = result.rows[0] || {
            total_pos: 0, total_value: 0, open_pos: 0,
            shipped_on_time: 0, shipped_late: 0, at_risk_pos: 0, vendor_count: 0
        };

        const shippedTotal = Number(row.shipped_on_time) + Number(row.shipped_late);
        const otdPercentage = shippedTotal > 0
            ? (Number(row.shipped_on_time) / shippedTotal) * 100
            : 0;

        return {
            totalPOs: Number(row.total_pos),
            totalValue: Number(row.total_value),
            openPOs: Number(row.open_pos),
            shippedPOs: shippedTotal,
            otdPercentage,
            atRiskPOs: Number(row.at_risk_pos),
            vendorCount: Number(row.vendor_count),
        };
    }

    async getStaffClientAssignments(clientId: number): Promise<Array<{
        staffId: number;
        staffName: string;
        role: string;
        isPrimary: boolean
    }>> {
        const result = await db.execute<{
            staff_id: number;
            staff_name: string;
            role: string;
            is_primary: boolean;
        }>(sql`
      SELECT 
        sca.staff_id,
        s.name as staff_name,
        COALESCE(sca.role, 'merchandiser') as role,
        sca.is_primary
      FROM staff_client_assignments sca
      JOIN staff s ON sca.staff_id = s.id
      WHERE sca.client_id = ${clientId}
      ORDER BY sca.is_primary DESC, s.name
    `);

        return result.rows.map(row => ({
            staffId: row.staff_id,
            staffName: row.staff_name,
            role: row.role,
            isPrimary: row.is_primary,
        }));
    }

    async getClientsForStaff(staffId: number): Promise<Array<{
        clientId: number;
        clientName: string;
        role: string;
        isPrimary: boolean
    }>> {
        const result = await db.execute<{
            client_id: number;
            client_name: string;
            role: string;
            is_primary: boolean;
        }>(sql`
      SELECT 
        sca.client_id,
        c.name as client_name,
        COALESCE(sca.role, 'merchandiser') as role,
        sca.is_primary
      FROM staff_client_assignments sca
      JOIN clients c ON sca.client_id = c.id
      WHERE sca.staff_id = ${staffId}
      ORDER BY sca.is_primary DESC, c.name
    `);

        return result.rows.map(row => ({
            clientId: row.client_id,
            clientName: row.client_name,
            role: row.role,
            isPrimary: row.is_primary,
        }));
    }

    async assignStaffToClient(staffId: number, clientId: number, role: string, isPrimary: boolean): Promise<void> {
        await db.execute(sql`
      INSERT INTO staff_client_assignments (staff_id, client_id, role, is_primary)
      VALUES (${staffId}, ${clientId}, ${role}, ${isPrimary})
      ON CONFLICT (staff_id, client_id) DO UPDATE SET
        role = EXCLUDED.role,
        is_primary = EXCLUDED.is_primary
    `);
    }

    async removeStaffFromClient(staffId: number, clientId: number): Promise<void> {
        await db.execute(sql`
      DELETE FROM staff_client_assignments 
      WHERE staff_id = ${staffId} AND client_id = ${clientId}
    `);
    }

    // Staff operations
    async getStaff(): Promise<Staff[]> {
        return db.select().from(staff).orderBy(staff.name);
    }

    async getStaffById(id: number): Promise<Staff | undefined> {
        const result = await db.select().from(staff).where(eq(staff.id, id));
        return result[0];
    }

    async getStaffByName(name: string): Promise<Staff | undefined> {
        const result = await db.select().from(staff).where(eq(staff.name, name));
        return result[0];
    }

    async createStaff(member: InsertStaff): Promise<Staff> {
        const result = await db.insert(staff).values(member).returning();
        return result[0];
    }

    async updateStaff(id: number, member: Partial<InsertStaff>): Promise<Staff | undefined> {
        const result = await db
            .update(staff)
            .set({ ...member, updatedAt: new Date() })
            .where(eq(staff.id, id))
            .returning();
        return result[0];
    }

    async bulkCreateStaff(members: InsertStaff[]): Promise<Staff[]> {
        if (members.length === 0) return [];
        const result = await db.insert(staff).values(members).returning();
        return result;
    }

    async updateVendorStaffAssignment(
        vendorName: string,
        merchandiserName: string,
        merchandisingManagerName: string
    ): Promise<Vendor | undefined> {
        const vendor = await this.getVendorByName(vendorName);
        if (!vendor) {
            return undefined;
        }

        let merchandiser = await this.getStaffByName(merchandiserName);
        if (!merchandiser) {
            merchandiser = await this.createStaff({
                name: merchandiserName,
                role: "merchandiser",
                status: "active",
            });
        }

        let merchandisingManager = await this.getStaffByName(merchandisingManagerName);
        if (!merchandisingManager) {
            merchandisingManager = await this.createStaff({
                name: merchandisingManagerName,
                role: "merchandising_manager",
                status: "active",
            });
        }

        const updates: Partial<InsertVendor> = {
            merchandiser: merchandiserName,
            merchandisingManager: merchandisingManagerName,
            merchandiserId: merchandiser.id,
            merchandisingManagerId: merchandisingManager.id,
        };

        return this.updateVendor(vendor.id, updates);
    }

    // Staff KPIs - Reuses dashboard KPIs with merchandiser filter
    // This ensures exact match with Operations Dashboard when filtered by the same merchandiser
    async getStaffKPIs(staffId: number): Promise<{
        // Header KPIs (matching Dashboard header)
        ytdSkusOrdered: number;
        newSkusYtd: number;
        ytdTotalSales: number;
        ytdShippedOrders: number;
        // Sales by SKU type
        ytdSalesNewSkus: number;
        ytdSalesExistingSkus: number;
        // Main KPIs (matching Dashboard main grid)
        otdOriginalPercentage: number;
        otdOriginalOrders: number;
        trueOtdPercentage: number;
        shippedOnTime: number;
        shippedTotal: number;
        qualityPassRate: number;
        avgLateDays: number;
        overdueUnshipped: number;
        // Vendor count
        assignedVendors: number;
        // New SKU/PO metrics
        totalSkusManaged: number;
        totalSkusManagedPrevYear: number;
        newSkusManaged: number;
        newSkusManagedPrevYear: number;
        totalPOsManaged: number;
    }> {
        const emptyResult = {
            ytdSkusOrdered: 0,
            newSkusYtd: 0,
            ytdTotalSales: 0,
            ytdShippedOrders: 0,
            ytdSalesNewSkus: 0,
            ytdSalesExistingSkus: 0,
            otdOriginalPercentage: 0,
            otdOriginalOrders: 0,
            trueOtdPercentage: 0,
            shippedOnTime: 0,
            shippedTotal: 0,
            qualityPassRate: 0,
            avgLateDays: 0,
            overdueUnshipped: 0,
            assignedVendors: 0,
            totalSkusManaged: 0,
            totalSkusManagedPrevYear: 0,
            newSkusManaged: 0,
            newSkusManagedPrevYear: 0,
            totalPOsManaged: 0,
        };

        // Get staff member
        const staffMember = await this.getStaffById(staffId);
        if (!staffMember) {
            return emptyResult;
        }

        const staffName = staffMember.name;

        // Determine the staff member's role level for filtering:
        // 1. GMM (General Merchandising Manager) - sees full team, no filter
        // 2. Merchandising Managers - see their team, filter by merchandising_manager
        // 3. Regular Merchandisers - see their own work, filter by merchandiser
        const isGMM = staffMember.role === 'gmm' ||
            staffMember.title?.toLowerCase().includes('general merchandising manager') ||
            staffName === 'Diah Mintarsih';

        const isMerchandisingManager = !isGMM && (
            staffMember.role === 'merchandising_manager' ||
            staffMember.title?.toLowerCase().includes('merchandising manager') ||
            ['Ellise Trinh', 'Emma Zhang', 'Zoe Chen'].includes(staffName));

        // Build the appropriate filter based on role
        let filters: { merchandiser?: string; merchandisingManager?: string } = {};
        if (isGMM) {
            // No filter - show full team performance
            filters = {};
        } else if (isMerchandisingManager) {
            // Filter by merchandising manager - show their team's performance
            filters = { merchandisingManager: staffName };
        } else {
            // Filter by merchandiser - show their individual performance
            filters = { merchandiser: staffName };
        }

        // Use the same getDashboardKPIs function that the Operations Dashboard uses
        const dashboardKPIs = await this.getDashboardKPIs(filters);

        // Get header KPIs using the same function as dashboard header
        const headerKPIs = await this.getHeaderKPIs(filters);

        // Count vendors based on role
        let vendorCountResult;
        if (isGMM) {
            vendorCountResult = await db.execute<{ count: number }>(sql`
        SELECT COUNT(DISTINCT name)::int as count FROM vendors
      `);
        } else if (isMerchandisingManager) {
            vendorCountResult = await db.execute<{ count: number }>(sql`
        SELECT COUNT(DISTINCT name)::int as count 
        FROM vendors 
        WHERE merchandising_manager = ${staffName}
      `);
        } else {
            vendorCountResult = await db.execute<{ count: number }>(sql`
        SELECT COUNT(DISTINCT name)::int as count 
        FROM vendors 
        WHERE merchandiser = ${staffName}
      `);
        }

        // Calculate SKU and PO metrics based on role
        // Use POINT-IN-TIME comparison: compare to same date last year for rolling YoY
        const now = new Date();
        const currentYear = now.getFullYear();
        const prevYear = currentYear - 1;
        const startOfCurrentYear = new Date(currentYear, 0, 1);
        const startOfPrevYear = new Date(prevYear, 0, 1);
        // Point-in-time: same date last year (e.g., Jan 13, 2025 for Jan 13, 2026)
        // Calculate days in month for prevYear to handle month-end edge cases (Feb 29, Apr 30, etc.)
        const daysInPrevYearMonth = new Date(prevYear, now.getMonth() + 1, 0).getDate();
        const clampedDay = Math.min(now.getDate(), daysInPrevYearMonth);
        const sameDatePrevYear = new Date(prevYear, now.getMonth(), clampedDay);

        // Build role-based filter for SKU/PO queries
        let skuPoFilter;
        if (isGMM) {
            skuPoFilter = sql`1=1`; // No filter for GMM
        } else if (isMerchandisingManager) {
            skuPoFilter = sql`v.merchandising_manager = ${staffName}`;
        } else {
            skuPoFilter = sql`v.merchandiser = ${staffName}`;
        }

        // Total SKUs managed (distinct SKUs with orders) - Current Year
        const skuCurrentYearResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT pli.sku)::int as count
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      JOIN vendors v ON ph.vendor = v.name
      WHERE ph.po_date >= ${startOfCurrentYear}
        AND ${skuPoFilter}
        AND pli.sku IS NOT NULL
        AND LENGTH(pli.sku) > 2
    `);

        // Total SKUs managed - Previous Year (POINT-IN-TIME: same date last year)
        const skuPrevYearResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT pli.sku)::int as count
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      JOIN vendors v ON ph.vendor = v.name
      WHERE ph.po_date >= ${startOfPrevYear}
        AND ph.po_date <= ${sameDatePrevYear}
        AND ${skuPoFilter}
        AND pli.sku IS NOT NULL
        AND LENGTH(pli.sku) > 2
    `);

        // New SKUs managed (first-time orders for SKUs) - Current Year
        const newSkuCurrentYearResult = await db.execute<{ count: number }>(sql`
      WITH first_orders AS (
        SELECT pli.sku, MIN(ph.po_date) as first_order_date
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE pli.sku IS NOT NULL AND LENGTH(pli.sku) > 2
        GROUP BY pli.sku
      )
      SELECT COUNT(DISTINCT pli.sku)::int as count
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      JOIN vendors v ON ph.vendor = v.name
      JOIN first_orders fo ON pli.sku = fo.sku
      WHERE fo.first_order_date >= ${startOfCurrentYear}
        AND ${skuPoFilter}
    `);

        // New SKUs managed - Previous Year (POINT-IN-TIME: same date last year)
        const newSkuPrevYearResult = await db.execute<{ count: number }>(sql`
      WITH first_orders AS (
        SELECT pli.sku, MIN(ph.po_date) as first_order_date
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE pli.sku IS NOT NULL AND LENGTH(pli.sku) > 2
        GROUP BY pli.sku
      )
      SELECT COUNT(DISTINCT pli.sku)::int as count
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      JOIN vendors v ON ph.vendor = v.name
      JOIN first_orders fo ON pli.sku = fo.sku
      WHERE fo.first_order_date >= ${startOfPrevYear}
        AND fo.first_order_date <= ${sameDatePrevYear}
        AND ${skuPoFilter}
    `);

        // Total POs managed (distinct PO numbers) - Current Year
        const totalPOsResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT ph.po_number)::int as count
      FROM po_headers ph
      JOIN vendors v ON ph.vendor = v.name
      WHERE ph.po_date >= ${startOfCurrentYear}
        AND ${skuPoFilter}
    `);

        return {
            ytdSkusOrdered: headerKPIs.totalSkus,
            newSkusYtd: headerKPIs.newSkus,
            ytdTotalSales: headerKPIs.totalSales, // Already in dollars from header KPIs
            ytdShippedOrders: headerKPIs.shippedOrders,
            ytdSalesNewSkus: headerKPIs.ytdSalesNewSkus,
            ytdSalesExistingSkus: headerKPIs.ytdSalesExistingSkus,
            otdOriginalPercentage: dashboardKPIs.otdOriginalPercentage,
            otdOriginalOrders: dashboardKPIs.otdOriginalTotal,
            trueOtdPercentage: dashboardKPIs.trueOtdPercentage,
            shippedOnTime: dashboardKPIs.shippedOnTime,
            shippedTotal: dashboardKPIs.shippedTotal,
            qualityPassRate: dashboardKPIs.qualityPercentage,
            avgLateDays: dashboardKPIs.avgLateDays,
            overdueUnshipped: dashboardKPIs.overdueUnshipped,
            assignedVendors: vendorCountResult.rows[0]?.count || 0,
            totalSkusManaged: skuCurrentYearResult.rows[0]?.count || 0,
            totalSkusManagedPrevYear: skuPrevYearResult.rows[0]?.count || 0,
            newSkusManaged: newSkuCurrentYearResult.rows[0]?.count || 0,
            newSkusManagedPrevYear: newSkuPrevYearResult.rows[0]?.count || 0,
            totalPOsManaged: totalPOsResult.rows[0]?.count || 0,
        };
    }

    // Staff Goals operations
    async getStaffGoals(staffId: number, year?: number): Promise<StaffGoal[]> {
        const conditions = [eq(staffGoals.staffId, staffId)];
        if (year) {
            conditions.push(eq(staffGoals.reviewYear, year));
        }
        return db.select().from(staffGoals).where(and(...conditions)).orderBy(staffGoals.priority);
    }

    async getStaffGoalById(goalId: number): Promise<StaffGoal | undefined> {
        const result = await db.select().from(staffGoals).where(eq(staffGoals.id, goalId));
        return result[0];
    }

    async createStaffGoal(goal: InsertStaffGoal): Promise<StaffGoal> {
        const result = await db.insert(staffGoals).values(goal).returning();
        return result[0];
    }

    async updateStaffGoal(goalId: number, goal: Partial<InsertStaffGoal>): Promise<StaffGoal | undefined> {
        const result = await db
            .update(staffGoals)
            .set({ ...goal, updatedAt: new Date() })
            .where(eq(staffGoals.id, goalId))
            .returning();
        return result[0];
    }

    async deleteStaffGoal(goalId: number): Promise<boolean> {
        // First delete all progress entries for this goal
        await db.delete(goalProgressEntries).where(eq(goalProgressEntries.goalId, goalId));
        // Then delete the goal itself
        const result = await db.delete(staffGoals).where(eq(staffGoals.id, goalId)).returning();
        return result.length > 0;
    }

    async getGoalProgressEntries(goalId: number): Promise<GoalProgressEntry[]> {
        return db.select().from(goalProgressEntries).where(eq(goalProgressEntries.goalId, goalId)).orderBy(desc(goalProgressEntries.entryDate));
    }

    async createGoalProgressEntry(entry: InsertGoalProgressEntry): Promise<GoalProgressEntry> {
        const result = await db.insert(goalProgressEntries).values(entry).returning();
        return result[0];
    }

    async deleteGoalProgressEntry(entryId: number): Promise<boolean> {
        const result = await db.delete(goalProgressEntries).where(eq(goalProgressEntries.id, entryId)).returning();
        return result.length > 0;
    }

    // SKU operations
    async getSkus(): Promise<Sku[]> {
        return db.select().from(skus).orderBy(skus.sku);
    }

    async getSkuById(id: number): Promise<Sku | undefined> {
        const result = await db.select().from(skus).where(eq(skus.id, id));
        return result[0];
    }

    async getSkuByCode(skuCode: string): Promise<Sku | undefined> {
        const result = await db.select().from(skus).where(eq(skus.sku, skuCode));
        return result[0];
    }

    async createSku(sku: InsertSku): Promise<Sku> {
        const result = await db.insert(skus).values(sku).returning();
        return result[0];
    }

    async bulkCreateSkus(skuList: InsertSku[]): Promise<Sku[]> {
        if (skuList.length === 0) return [];
        const result = await db.insert(skus).values(skuList).returning();
        return result;
    }

    async upsertSku(skuData: { sku: string }): Promise<Sku> {
        // Check if SKU exists
        const existing = await this.getSkuByCode(skuData.sku);
        if (existing) {
            return existing;
        }

        // Create new SKU with minimal data
        const newSku: InsertSku = {
            sku: skuData.sku,
            style: null,
            description: null,
            category: null,
            productGroup: null,
            season: null,
            isNew: false,
            unitPrice: 0,
        };

        return this.createSku(newSku);
    }

    async bulkUpsertSkusFromOS340(skuData: Array<{
        sku: string;
        style?: string | null;
        description?: string | null;
        category?: string | null;
        productGroup?: string | null;
        season?: string | null;
        isNew?: boolean;
    }>): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
        const result = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

        if (skuData.length === 0) return result;

        // Validation function for SKU codes
        const isValidSku = (code: string): boolean => {
            if (!code || typeof code !== 'string') return false;
            const trimmed = code.trim();
            // SKU must be at least 3 characters and alphanumeric
            if (trimmed.length < 3) return false;
            // Reject obvious placeholders like "1", "2", "test", "TBD", "N/A"
            const placeholders = ['1', '2', '3', 'test', 'tbd', 'n/a', 'na', 'xxx', 'zzz', 'none', 'unknown'];
            if (placeholders.includes(trimmed.toLowerCase())) return false;
            // Must contain at least one digit (most SKUs are numeric or alphanumeric with numbers)
            if (!/\d/.test(trimmed)) return false;
            return true;
        };

        // Deduplicate by SKU code, keeping first occurrence with most data
        const uniqueSkuMap = new Map<string, typeof skuData[0]>();
        for (const item of skuData) {
            const code = String(item.sku || '').trim();
            if (!code) continue;

            if (!isValidSku(code)) {
                result.skipped++;
                continue;
            }

            if (!uniqueSkuMap.has(code)) {
                uniqueSkuMap.set(code, item);
            } else {
                // Merge with existing - keep non-null values
                const existing = uniqueSkuMap.get(code)!;
                uniqueSkuMap.set(code, {
                    sku: code,
                    style: item.style || existing.style,
                    description: item.description || existing.description,
                    category: item.category || existing.category,
                    productGroup: item.productGroup || existing.productGroup,
                    season: item.season || existing.season,
                    isNew: item.isNew ?? existing.isNew,
                });
            }
        }

        // Get existing SKUs in batched queries to avoid memory issues with large datasets
        const skuCodes = Array.from(uniqueSkuMap.keys());

        // Early return if no valid SKUs to process
        if (skuCodes.length === 0) {
            return result;
        }

        // Process SKU lookups in batches to avoid query size limits
        const LOOKUP_BATCH_SIZE = 500;
        const existingMap = new Map<string, Sku>();

        for (let i = 0; i < skuCodes.length; i += LOOKUP_BATCH_SIZE) {
            const batch = skuCodes.slice(i, i + LOOKUP_BATCH_SIZE);
            const batchResults = await db.select().from(skus).where(inArray(skus.sku, batch));
            for (const sku of batchResults) {
                existingMap.set(sku.sku, sku);
            }
        }

        // Separate into creates and updates
        const toCreate: InsertSku[] = [];
        const toUpdate: Array<{ id: number; updates: Record<string, any> }> = [];

        for (const [code, data] of uniqueSkuMap) {
            const existing = existingMap.get(code);

            if (existing) {
                // Update only if we have more data than existing
                const updates: Record<string, any> = {};
                if (data.style && !existing.style) updates.style = data.style;
                if (data.description && !existing.description) updates.description = data.description;
                if (data.category && !existing.category) updates.category = data.category;
                if (data.productGroup && !existing.productGroup) updates.productGroup = data.productGroup;
                if (data.season && !existing.season) updates.season = data.season;
                if (data.isNew !== undefined && !existing.isNew) updates.isNew = data.isNew;

                if (Object.keys(updates).length > 0) {
                    toUpdate.push({ id: existing.id, updates });
                }
            } else {
                // Create new SKU
                toCreate.push({
                    sku: code,
                    style: data.style || null,
                    description: data.description || null,
                    category: data.category || null,
                    productGroup: data.productGroup || null,
                    season: data.season || null,
                    isNew: data.isNew ?? false,
                    unitPrice: 0,
                });
            }
        }

        // Bulk create new SKUs
        if (toCreate.length > 0) {
            try {
                const BATCH_SIZE = 500;
                for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
                    const batch = toCreate.slice(i, i + BATCH_SIZE);
                    await db.insert(skus).values(batch).onConflictDoNothing();
                }
                result.created = toCreate.length;
            } catch (error: any) {
                result.errors.push(`Failed to create SKUs: ${error.message}`);
            }
        }

        // Update existing SKUs with new data in batches
        const UPDATE_BATCH_SIZE = 100;
        for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH_SIZE) {
            const batch = toUpdate.slice(i, i + UPDATE_BATCH_SIZE);
            await Promise.all(batch.map(async ({ id, updates }) => {
                try {
                    await db.update(skus).set({ ...updates, updatedAt: new Date() }).where(eq(skus.id, id));
                    result.updated++;
                } catch (error: any) {
                    result.errors.push(`Failed to update SKU ${id}: ${error.message}`);
                }
            }));
        }

        return result;
    }

    async getSkuListWithMetrics(filters?: { brand?: string }): Promise<Array<{
        skuCode: string;
        description: string | null;
        supplier: string | null;
        lastOrderFobPrice: number;
        totalSalesYtd: number;
        totalOrdersYtd: number;
        lastOrderDate: Date | null;
    }>> {
        const currentYear = new Date().getFullYear();
        const yearStart = new Date(currentYear, 0, 1);

        // Build brand filter condition
        const brandFilter = filters?.brand ? sql`AND ph.client_division = ${filters.brand}` : sql``;

        const result = await db.execute<{
            sku_code: string;
            description: string | null;
            supplier: string | null;
            last_order_fob_price: number;
            total_sales_ytd: number;
            total_orders_ytd: number;
            last_order_date: Date | null;
        }>(sql`
      WITH sku_orders AS (
        -- Use shipped_value from OS340 "Shipped (USD)" for actual shipped dollars
        -- Filter on shipped_value OR total_value to handle split shipments
        SELECT 
          pli.sku,
          ph.po_number,
          ph.id as po_id,
          ph.vendor,
          pli.unit_price,
          ph.shipped_value,
          ph.total_quantity,
          ph.po_date,
          ph.shipment_status,
          ph.program_description,
          -- Use OS340 shipment_status to determine if shipped (On-Time or Late means shipped)
          CASE WHEN ph.shipment_status IN ('On-Time', 'Late') THEN TRUE ELSE FALSE END as is_shipped,
          ROW_NUMBER() OVER (PARTITION BY pli.sku ORDER BY ph.po_date DESC NULLS LAST) as rn
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE pli.sku IS NOT NULL AND pli.sku != ''
          AND (COALESCE(ph.total_value, 0) > 0 OR COALESCE(ph.shipped_value, 0) > 0)
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          ${brandFilter}
      ),
      -- Get unique POs per SKU for YTD calculations (avoid double-counting line items)
      unique_po_per_sku AS (
        SELECT DISTINCT ON (sku, po_number)
          sku,
          po_number,
          shipped_value,
          po_date,
          is_shipped
        FROM sku_orders
        ORDER BY sku, po_number, po_date DESC
      ),
      sku_metrics AS (
        SELECT 
          so.sku,
          MAX(CASE WHEN so.rn = 1 THEN so.vendor END) as supplier,
          MAX(CASE WHEN so.rn = 1 THEN so.unit_price END) as last_order_fob_price,
          MAX(CASE WHEN so.rn = 1 THEN so.po_date END) as last_order_date,
          MAX(CASE WHEN so.rn = 1 THEN so.program_description END) as program_description
        FROM sku_orders so
        GROUP BY so.sku
      ),
      sku_ytd AS (
        SELECT 
          sku,
          -- YTD Sales: Sum of unique shipped POs in current year (uses shipped_value from OS340)
          COALESCE(SUM(CASE WHEN po_date >= ${yearStart} AND is_shipped THEN shipped_value ELSE 0 END), 0) as total_sales_ytd,
          -- YTD Orders: Count of unique shipped POs in current year
          COUNT(DISTINCT CASE WHEN po_date >= ${yearStart} AND is_shipped THEN po_number END) as total_orders_ytd
        FROM unique_po_per_sku
        GROUP BY sku
      )
      SELECT 
        COALESCE(s.sku, sm.sku) as sku_code,
        COALESCE(s.description, sm.program_description) as description,
        sm.supplier,
        COALESCE(sm.last_order_fob_price, 0)::int as last_order_fob_price,
        COALESCE(sy.total_sales_ytd, 0)::bigint as total_sales_ytd,
        COALESCE(sy.total_orders_ytd, 0)::int as total_orders_ytd,
        sm.last_order_date
      FROM sku_metrics sm
      LEFT JOIN sku_ytd sy ON sy.sku = sm.sku
      LEFT JOIN skus s ON s.sku = sm.sku
      ORDER BY sy.total_sales_ytd DESC NULLS LAST, sku_code
    `);

        return result.rows.map(row => ({
            skuCode: row.sku_code,
            description: row.description,
            supplier: row.supplier,
            lastOrderFobPrice: Number(row.last_order_fob_price) || 0,
            totalSalesYtd: Number(row.total_sales_ytd) || 0,
            totalOrdersYtd: Number(row.total_orders_ytd) || 0,
            lastOrderDate: row.last_order_date,
        }));
    }

    async getSkuSummaryKpis(): Promise<{
        totalSkus: number;
        newSkusYtd: number;
        ytdTotalSales: number;
        ytdSalesNewSkus: number;
        ytdSalesExistingSkus: number;
        ytdTotalOrders: number;
    }> {
        const currentYear = new Date().getFullYear();
        const yearStart = new Date(currentYear, 0, 1);

        const result = await db.execute<{
            total_skus: number;
            new_skus_ytd: number;
            ytd_total_sales: string;
            ytd_sales_new_skus: string;
            ytd_sales_existing_skus: string;
            ytd_total_orders: number;
        }>(sql`
      WITH all_skus AS (
        -- YTD SKUs Ordered: unique SKUs ordered this year (same as Operations Dashboard)
        SELECT DISTINCT pli.sku FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE pli.sku IS NOT NULL AND pli.sku != ''
          AND ph.po_date >= ${yearStart}
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
      ),
      new_skus AS (
        SELECT DISTINCT pli.sku FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE pli.sku IS NOT NULL AND pli.sku != ''
          AND ph.po_date >= ${yearStart}
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND NOT EXISTS (
            SELECT 1 FROM po_headers prev_ph
            LEFT JOIN po_line_items prev_pli ON prev_pli.po_header_id = prev_ph.id
            WHERE prev_pli.sku = pli.sku 
              AND prev_ph.po_date < ${yearStart}
              AND prev_pli.sku IS NOT NULL AND prev_pli.sku != ''
          )
      ),
      unique_shipped_pos AS (
        -- Use shipped_value from OS340 "Shipped (USD)" for actual shipped dollars
        -- Filter on shipped_value > 0 to include only POs with actual shipped revenue (handles split shipments)
        SELECT DISTINCT ON (ph.po_number) 
          ph.po_number,
          pli.sku,
          ph.shipped_value, 
          COALESCE(ph.revised_ship_date, ph.original_ship_date) as ship_date
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE COALESCE(ph.shipped_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          AND ph.shipment_status IN ('On-Time', 'Late')
          AND ph.client = 'Euromarket Designs, Inc.'
          AND pli.sku IS NOT NULL AND pli.sku != ''
        ORDER BY ph.po_number, ph.id
      ),
      ytd_shipped AS (
        SELECT * FROM unique_shipped_pos
        WHERE ship_date >= ${yearStart}
      )
      SELECT 
        (SELECT COUNT(*) FROM all_skus)::int as total_skus,
        (SELECT COUNT(*) FROM new_skus)::int as new_skus_ytd,
        COALESCE((SELECT SUM(shipped_value) FROM ytd_shipped), 0) as ytd_total_sales,
        COALESCE((SELECT SUM(shipped_value) FROM ytd_shipped WHERE sku IN (SELECT sku FROM new_skus)), 0) as ytd_sales_new_skus,
        COALESCE((SELECT SUM(shipped_value) FROM ytd_shipped WHERE sku NOT IN (SELECT sku FROM new_skus)), 0) as ytd_sales_existing_skus,
        (SELECT COUNT(DISTINCT po_number) FROM ytd_shipped)::int as ytd_total_orders
    `);

        const row = result.rows[0];
        return {
            totalSkus: row?.total_skus || 0,
            newSkusYtd: row?.new_skus_ytd || 0,
            ytdTotalSales: parseFloat(row?.ytd_total_sales || '0'),
            ytdSalesNewSkus: parseFloat(row?.ytd_sales_new_skus || '0'),
            ytdSalesExistingSkus: parseFloat(row?.ytd_sales_existing_skus || '0'),
            ytdTotalOrders: row?.ytd_total_orders || 0,
        };
    }

    async getSkuShipmentHistory(skuCode: string): Promise<Array<{
        id: number;
        poNumber: string;
        vendor: string | null;
        orderQuantity: number;
        unitPrice: number;
        totalValue: number;
        poDate: Date | null;
        revisedShipDate: Date | null;
        status: string;
        shipmentStatus: string | null;
    }>> {
        const result = await db.execute<{
            id: number;
            po_number: string;
            vendor: string | null;
            order_quantity: number;
            unit_price: number;
            total_value: number;
            po_date: Date | null;
            revised_ship_date: Date | null;
            status: string;
            shipment_status: string | null;
        }>(sql`
      SELECT 
        ph.id,
        ph.po_number,
        ph.vendor,
        pli.order_quantity,
        pli.unit_price,
        ph.total_value,
        ph.po_date,
        ph.revised_ship_date,
        ph.status,
        ph.shipment_status
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      WHERE pli.sku = ${skuCode}
      ORDER BY ph.po_date DESC NULLS LAST, ph.id DESC
      LIMIT 100
    `);

        return result.rows.map(row => ({
            id: row.id,
            poNumber: row.po_number,
            vendor: row.vendor,
            orderQuantity: row.order_quantity || 0,
            unitPrice: row.unit_price || 0,
            totalValue: row.total_value || 0,
            poDate: row.po_date,
            revisedShipDate: row.revised_ship_date,
            status: row.status,
            shipmentStatus: row.shipment_status,
        }));
    }

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

    async getBusinessLevelInspectionMetrics(filters?: {
        inspector?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<{
        totalInspections: number;
        firstTimePassRate: number;
        inlineFirstTimePassRate: number;
        avgInspectionsPerShipment: number;
        avgInlinePerPoSku: number;
        avgFinalPerPoSku: number;
        failureAnalysis: Array<{ inspectionType: string; failedCount: number; totalCount: number; failureRate: number }>;
    }> {
        // Build filter conditions
        const conditions: string[] = [];
        if (filters?.inspector) {
            conditions.push(`inspector = '${filters.inspector.replace(/'/g, "''")}'`);
        }
        if (filters?.startDate) {
            conditions.push(`inspection_date >= '${filters.startDate.toISOString()}'`);
        }
        if (filters?.endDate) {
            conditions.push(`inspection_date <= '${filters.endDate.toISOString()}'`);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get overall metrics - First-Time Pass Rate is based on Final Inspections only
        // A PO/SKU passes first time if: Final Inspection passed AND no Re-Final Inspection exists
        // Inline First-Time Pass Rate: % of first Inline Inspections per PO/SKU that passed
        const metricsResult = await db.execute<{
            total_inspections: number;
            unique_pos: number;
            total_final_pos: number;
            passed_first_time: number;
            total_inline_pos: number;
            inline_passed_first_time: number;
            total_inline_count: number;
            total_final_count: number;
        }>(sql.raw(`
      WITH po_sku_finals AS (
        SELECT DISTINCT po_number, sku
        FROM inspections
        WHERE inspection_type = 'Final Inspection'
        ${whereClause ? whereClause.replace('WHERE', 'AND') : ''}
      ),
      po_sku_refinals AS (
        SELECT DISTINCT po_number, sku
        FROM inspections
        WHERE inspection_type = 'Re-Final Inspection'
        ${whereClause ? whereClause.replace('WHERE', 'AND') : ''}
      ),
      final_results AS (
        SELECT 
          po_number, 
          sku, 
          result,
          ROW_NUMBER() OVER (PARTITION BY po_number, sku ORDER BY inspection_date) as rn
        FROM inspections
        WHERE inspection_type = 'Final Inspection'
        ${whereClause ? whereClause.replace('WHERE', 'AND') : ''}
      ),
      inline_results AS (
        SELECT 
          po_number, 
          sku, 
          result,
          ROW_NUMBER() OVER (PARTITION BY po_number, sku ORDER BY inspection_date) as rn
        FROM inspections
        WHERE inspection_type = 'Inline Inspection'
        ${whereClause ? whereClause.replace('WHERE', 'AND') : ''}
      )
      SELECT 
        (SELECT COUNT(*)::int FROM inspections ${whereClause}) as total_inspections,
        (SELECT COUNT(DISTINCT po_number)::int FROM inspections ${whereClause}) as unique_pos,
        (SELECT COUNT(*)::int FROM po_sku_finals) as total_final_pos,
        (SELECT COUNT(*)::int FROM final_results fr
         WHERE fr.rn = 1 AND fr.result = 'Passed'
         AND NOT EXISTS (SELECT 1 FROM po_sku_refinals r WHERE r.po_number = fr.po_number AND r.sku = fr.sku)
        ) as passed_first_time,
        (SELECT COUNT(DISTINCT CONCAT(po_number, ':', sku))::int FROM inline_results) as total_inline_pos,
        (SELECT COUNT(*)::int FROM inline_results WHERE rn = 1 AND result = 'Passed') as inline_passed_first_time,
        (SELECT COUNT(*)::int FROM inspections WHERE inspection_type = 'Inline Inspection' ${whereClause ? whereClause.replace('WHERE', 'AND') : ''}) as total_inline_count,
        (SELECT COUNT(*)::int FROM inspections WHERE inspection_type = 'Final Inspection' ${whereClause ? whereClause.replace('WHERE', 'AND') : ''}) as total_final_count
    `));

        // Get failure analysis by inspection type
        const failureResult = await db.execute<{
            inspection_type: string;
            failed_count: number;
            total_count: number;
        }>(sql.raw(`
      SELECT 
        inspection_type,
        COUNT(*) FILTER (WHERE result = 'Failed')::int as failed_count,
        COUNT(*)::int as total_count
      FROM inspections
      ${whereClause}
      GROUP BY inspection_type
      ORDER BY failed_count DESC
    `));

        const metrics = metricsResult.rows[0] || {
            total_inspections: 0, unique_pos: 0, total_final_pos: 0, passed_first_time: 0,
            total_inline_pos: 0, inline_passed_first_time: 0, total_inline_count: 0, total_final_count: 0
        };
        const totalInspections = metrics.total_inspections || 0;
        const totalFinalPOs = metrics.total_final_pos || 0;
        const passedFirstTime = metrics.passed_first_time || 0;
        const totalInlinePOs = metrics.total_inline_pos || 0;
        const inlinePassedFirstTime = metrics.inline_passed_first_time || 0;
        const totalInlineCount = metrics.total_inline_count || 0;
        const totalFinalCount = metrics.total_final_count || 0;
        const uniquePOs = metrics.unique_pos || 1;

        return {
            totalInspections,
            // First-Time Pass Rate = (PO/SKUs where Final passed AND no Re-Final) / Total PO/SKUs with Final Inspections
            firstTimePassRate: totalFinalPOs > 0 ? (passedFirstTime / totalFinalPOs) * 100 : 0,
            // Inline First-Time Pass Rate = First Inline Inspections that passed / Total PO/SKUs with Inline Inspections
            inlineFirstTimePassRate: totalInlinePOs > 0 ? (inlinePassedFirstTime / totalInlinePOs) * 100 : 0,
            avgInspectionsPerShipment: uniquePOs > 0 ? totalInspections / uniquePOs : 0,
            // Average Inline Inspections per PO/SKU (all records)
            avgInlinePerPoSku: totalInlinePOs > 0 ? totalInlineCount / totalInlinePOs : 0,
            // Average Final Inspections per PO/SKU (all records)
            avgFinalPerPoSku: totalFinalPOs > 0 ? totalFinalCount / totalFinalPOs : 0,
            failureAnalysis: failureResult.rows.map(row => ({
                inspectionType: row.inspection_type,
                failedCount: row.failed_count || 0,
                totalCount: row.total_count || 0,
                failureRate: row.total_count > 0 ? (row.failed_count / row.total_count) * 100 : 0,
            })),
        };
    }

    async getSkuLevelInspectionMetrics(filters?: {
        inspector?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
        skuId: number;
        sku: string;
        description: string | null;
        vendorName: string | null;
        totalInspections: number;
        firstTimePassRate: number;
        avgInspectionsPerShipment: number;
        failedCount: number;
    }>> {
        const conditions: string[] = [];
        if (filters?.inspector) {
            conditions.push(`i.inspector = '${filters.inspector.replace(/'/g, "''")}'`);
        }
        if (filters?.startDate) {
            conditions.push(`i.inspection_date >= '${filters.startDate.toISOString()}'`);
        }
        if (filters?.endDate) {
            conditions.push(`i.inspection_date <= '${filters.endDate.toISOString()}'`);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // First-Time Pass Rate = (PO/SKUs where Final passed AND no Re-Final) / Total PO/SKUs with Final
        const result = await db.execute<{
            sku_id: number;
            sku: string;
            description: string | null;
            vendor_name: string | null;
            total_inspections: number;
            total_final_pos: number;
            passed_first_time: number;
            unique_pos: number;
            failed_count: number;
        }>(sql.raw(`
      WITH sku_inspections AS (
        SELECT 
          i.sku_id,
          i.sku,
          i.po_number,
          i.inspection_type,
          i.result,
          i.inspection_date
        FROM inspections i
        ${whereClause}
      ),
      sku_refinals AS (
        SELECT DISTINCT po_number, sku
        FROM sku_inspections
        WHERE inspection_type = 'Re-Final Inspection'
      ),
      sku_final_results AS (
        SELECT 
          sku_id,
          sku, 
          po_number, 
          result,
          ROW_NUMBER() OVER (PARTITION BY po_number, sku ORDER BY inspection_date) as rn
        FROM sku_inspections
        WHERE inspection_type = 'Final Inspection'
      ),
      sku_vendors AS (
        SELECT DISTINCT si.sku, ph.vendor as vendor_name
        FROM sku_inspections si
        LEFT JOIN po_headers ph ON si.po_number = ph.po_number
        WHERE ph.vendor IS NOT NULL
      )
      SELECT 
        COALESCE(si.sku_id, 0) as sku_id,
        COALESCE(si.sku, 'Unknown') as sku,
        s.description,
        (SELECT vendor_name FROM sku_vendors sv WHERE sv.sku = si.sku LIMIT 1) as vendor_name,
        COUNT(*)::int as total_inspections,
        (SELECT COUNT(DISTINCT CONCAT(po_number, ':', sku))::int FROM sku_final_results WHERE sku = si.sku) as total_final_pos,
        (SELECT COUNT(*)::int FROM sku_final_results fr 
         WHERE fr.sku = si.sku AND fr.rn = 1 AND fr.result = 'Passed'
         AND NOT EXISTS (SELECT 1 FROM sku_refinals r WHERE r.po_number = fr.po_number AND r.sku = fr.sku)
        ) as passed_first_time,
        COUNT(DISTINCT si.po_number)::int as unique_pos,
        COUNT(*) FILTER (WHERE si.result = 'Failed')::int as failed_count
      FROM sku_inspections si
      LEFT JOIN skus s ON si.sku_id = s.id
      GROUP BY si.sku_id, si.sku, s.description
      ORDER BY total_inspections DESC
      LIMIT 100
    `));

        return result.rows.map(row => ({
            skuId: row.sku_id,
            sku: row.sku,
            description: row.description,
            vendorName: row.vendor_name,
            totalInspections: row.total_inspections || 0,
            // First-Time Pass Rate = (PO/SKUs where Final passed AND no Re-Final) / Total PO/SKUs with Final
            firstTimePassRate: row.total_final_pos > 0 ? (row.passed_first_time / row.total_final_pos) * 100 : 0,
            avgInspectionsPerShipment: row.unique_pos > 0 ? row.total_inspections / row.unique_pos : 0,
            failedCount: row.failed_count || 0,
        }));
    }

    // Get SKU summary info
    async getSkuSummary(skuId: number): Promise<{
        skuId: number;
        sku: string;
        description: string | null;
        style: string | null;
        category: string | null;
        productGroup: string | null;
        totalInspections: number;
        passedCount: number;
        failedCount: number;
        firstTimePassRate: number;
        vendors: string[];
    } | null> {
        const skuResult = await db.execute<{
            id: number;
            sku: string;
            description: string | null;
            style: string | null;
            category: string | null;
            product_group: string | null;
        }>(sql`SELECT id, sku, description, style, category, product_group FROM skus WHERE id = ${skuId}`);

        if (skuResult.rows.length === 0) {
            // Try to get SKU info from inspections table
            const inspSku = await db.execute<{
                sku: string;
                sku_id: number;
            }>(sql`SELECT DISTINCT sku, sku_id FROM inspections WHERE sku_id = ${skuId} LIMIT 1`);

            if (inspSku.rows.length === 0) {
                return null;
            }
        }

        const skuRow = skuResult.rows[0];

        // Get inspection metrics
        const metricsResult = await db.execute<{
            total: number;
            passed: number;
            failed: number;
        }>(sql`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE result = 'Passed')::int as passed,
        COUNT(*) FILTER (WHERE result = 'Failed')::int as failed
      FROM inspections 
      WHERE sku_id = ${skuId}
    `);

        // Get unique vendors
        const vendorsResult = await db.execute<{ vendor_name: string }>(sql`
      SELECT DISTINCT COALESCE(vendor_name, 'Unknown') as vendor_name 
      FROM inspections 
      WHERE sku_id = ${skuId} AND vendor_name IS NOT NULL
    `);

        const metrics = metricsResult.rows[0] || { total: 0, passed: 0, failed: 0 };

        return {
            skuId: skuRow?.id || skuId,
            sku: skuRow?.sku || `SKU-${skuId}`,
            description: skuRow?.description || null,
            style: skuRow?.style || null,
            category: skuRow?.category || null,
            productGroup: skuRow?.product_group || null,
            totalInspections: metrics.total,
            passedCount: metrics.passed,
            failedCount: metrics.failed,
            firstTimePassRate: metrics.total > 0 ? (metrics.passed / metrics.total) * 100 : 0,
            vendors: vendorsResult.rows.map(r => r.vendor_name),
        };
    }

    // Get SKU inspection history with failure reasons (by SKU ID)
    async getSkuInspectionHistory(skuId: number): Promise<Array<{
        id: number;
        poNumber: string;
        inspectionType: string;
        inspectionDate: Date | null;
        result: string | null;
        notes: string | null;
        vendorName: string | null;
        inspector: string | null;
        inspectionCompany: string | null;
    }>> {
        const result = await db.execute<{
            id: number;
            po_number: string;
            inspection_type: string;
            inspection_date: Date | null;
            result: string | null;
            notes: string | null;
            vendor_name: string | null;
            inspector: string | null;
            inspection_company: string | null;
        }>(sql`
      SELECT 
        id,
        po_number,
        inspection_type,
        inspection_date,
        result,
        notes,
        vendor_name,
        inspector,
        inspection_company
      FROM inspections 
      WHERE sku_id = ${skuId}
      ORDER BY inspection_date DESC NULLS LAST, id DESC
      LIMIT 500
    `);

        return result.rows.map(row => ({
            id: row.id,
            poNumber: row.po_number || 'N/A',
            inspectionType: row.inspection_type || 'Unknown',
            inspectionDate: row.inspection_date,
            result: row.result,
            notes: row.notes,
            vendorName: row.vendor_name,
            inspector: row.inspector,
            inspectionCompany: row.inspection_company,
        }));
    }

    // Get SKU inspection history by SKU code (string)
    async getSkuInspectionHistoryByCode(skuCode: string): Promise<Array<{
        id: number;
        poNumber: string;
        inspectionType: string;
        inspectionDate: Date | null;
        result: string | null;
        notes: string | null;
        vendorName: string | null;
        inspector: string | null;
        inspectionCompany: string | null;
    }>> {
        // Join with po_headers to get vendor name from PO data
        const result = await db.execute<{
            id: number;
            po_number: string;
            inspection_type: string;
            inspection_date: Date | null;
            result: string | null;
            notes: string | null;
            vendor_name: string | null;
            inspector: string | null;
            inspection_company: string | null;
        }>(sql`
      SELECT DISTINCT ON (i.id)
        i.id,
        i.po_number,
        i.inspection_type,
        i.inspection_date,
        i.result,
        i.notes,
        COALESCE(i.vendor_name, ph.vendor) as vendor_name,
        i.inspector,
        i.inspection_company
      FROM inspections i
      LEFT JOIN po_headers ph ON i.po_number = ph.po_number
      WHERE i.sku = ${skuCode}
      ORDER BY i.id, i.inspection_date DESC NULLS LAST
    `);

        // Sort by inspection_date descending after DISTINCT ON
        const sortedRows = result.rows.sort((a, b) => {
            if (!a.inspection_date && !b.inspection_date) return b.id - a.id;
            if (!a.inspection_date) return 1;
            if (!b.inspection_date) return -1;
            return new Date(b.inspection_date).getTime() - new Date(a.inspection_date).getTime();
        });

        return sortedRows.slice(0, 500).map(row => ({
            id: row.id,
            poNumber: row.po_number || 'N/A',
            inspectionType: row.inspection_type || 'Unknown',
            inspectionDate: row.inspection_date,
            result: row.result,
            notes: row.notes,
            vendorName: row.vendor_name,
            inspector: row.inspector,
            inspectionCompany: row.inspection_company,
        }));
    }

    // Get SKU summary by SKU code (string)
    async getSkuSummaryByCode(skuCode: string): Promise<{
        skuCode: string;
        description: string | null;
        style: string | null;
        totalInspections: number;
        passedCount: number;
        failedCount: number;
        firstTimePassRate: number;
        vendors: string[];
    } | null> {
        // Check if SKU exists in skus table, po_line_items, or inspections
        const checkResult = await db.execute<{ cnt: number }>(sql`
      SELECT (
        (SELECT COUNT(*)::int FROM skus WHERE sku = ${skuCode}) +
        (SELECT COUNT(*)::int FROM po_line_items WHERE sku = ${skuCode}) +
        (SELECT COUNT(*)::int FROM inspections WHERE sku = ${skuCode})
      ) as cnt
    `);

        if ((checkResult.rows[0]?.cnt || 0) === 0) {
            return null;
        }

        // Get SKU info from skus table if available
        const skuResult = await db.execute<{
            description: string | null;
            style: string | null;
        }>(sql`SELECT description, style FROM skus WHERE sku = ${skuCode} LIMIT 1`);

        const skuRow = skuResult.rows[0];

        // If no description in skus table, try to get it from po_headers.program_description
        let description = skuRow?.description || null;
        if (!description) {
            const poDescResult = await db.execute<{ program_description: string | null }>(sql`
        SELECT ph.program_description 
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE pli.sku = ${skuCode} AND ph.program_description IS NOT NULL AND ph.program_description != ''
        LIMIT 1
      `);
            description = poDescResult.rows[0]?.program_description || null;
        }

        // Get inspection metrics - First-Time Pass Rate = (Finals passed AND no Re-Final) / Total Finals
        const metricsResult = await db.execute<{
            total: number;
            passed: number;
            failed: number;
            total_final_pos: number;
            passed_first_time: number;
        }>(sql`
      WITH sku_finals AS (
        SELECT DISTINCT po_number FROM inspections 
        WHERE sku = ${skuCode} AND inspection_type = 'Final Inspection'
      ),
      sku_refinals AS (
        SELECT DISTINCT po_number FROM inspections 
        WHERE sku = ${skuCode} AND inspection_type = 'Re-Final Inspection'
      ),
      first_final_results AS (
        SELECT 
          po_number,
          result,
          ROW_NUMBER() OVER (PARTITION BY po_number ORDER BY inspection_date) as rn
        FROM inspections 
        WHERE sku = ${skuCode} AND inspection_type = 'Final Inspection'
      )
      SELECT 
        (SELECT COUNT(*)::int FROM inspections WHERE sku = ${skuCode}) as total,
        (SELECT COUNT(*)::int FROM inspections WHERE sku = ${skuCode} AND result = 'Passed') as passed,
        (SELECT COUNT(*)::int FROM inspections WHERE sku = ${skuCode} AND result = 'Failed') as failed,
        (SELECT COUNT(*)::int FROM sku_finals) as total_final_pos,
        (SELECT COUNT(*)::int FROM first_final_results fr 
         WHERE fr.rn = 1 AND fr.result = 'Passed'
         AND NOT EXISTS (SELECT 1 FROM sku_refinals r WHERE r.po_number = fr.po_number)
        ) as passed_first_time
    `);

        // Get unique vendors from both inspections and po_headers
        const vendorsResult = await db.execute<{ vendor_name: string }>(sql`
      SELECT DISTINCT vendor_name FROM (
        SELECT COALESCE(vendor_name, 'Unknown') as vendor_name 
        FROM inspections 
        WHERE sku = ${skuCode} AND vendor_name IS NOT NULL
        UNION
        SELECT COALESCE(ph.vendor, 'Unknown') as vendor_name 
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE pli.sku = ${skuCode} AND ph.vendor IS NOT NULL
      ) combined
      WHERE vendor_name != 'Unknown'
    `);

        const metrics = metricsResult.rows[0] || { total: 0, passed: 0, failed: 0, total_final_pos: 0, passed_first_time: 0 };

        return {
            skuCode,
            description,
            style: skuRow?.style || null,
            totalInspections: metrics.total,
            passedCount: metrics.passed,
            failedCount: metrics.failed,
            // First-Time Pass Rate = (Finals passed AND no Re-Final) / Total Finals
            firstTimePassRate: metrics.total_final_pos > 0 ? (metrics.passed_first_time / metrics.total_final_pos) * 100 : 0,
            vendors: vendorsResult.rows.map(r => r.vendor_name),
        };
    }

    async getVendorLevelInspectionMetrics(filters?: {
        inspector?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
        vendorId: number | null;
        vendorName: string;
        totalInspections: number;
        firstTimePassRate: number;
        avgInspectionsPerShipment: number;
        failedCount: number;
    }>> {
        const conditions: string[] = [];
        if (filters?.inspector) {
            conditions.push(`i.inspector = '${filters.inspector.replace(/'/g, "''")}'`);
        }
        if (filters?.startDate) {
            conditions.push(`i.inspection_date >= '${filters.startDate.toISOString()}'`);
        }
        if (filters?.endDate) {
            conditions.push(`i.inspection_date <= '${filters.endDate.toISOString()}'`);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // First-Time Pass Rate = (PO/SKUs where Final passed AND no Re-Final) / Total PO/SKUs with Final
        const result = await db.execute<{
            vendor_id: number | null;
            vendor_name: string;
            total_inspections: number;
            total_final_pos: number;
            passed_first_time: number;
            unique_shipments: number;
            failed_count: number;
        }>(sql.raw(`
      WITH vendor_inspections AS (
        SELECT 
          v.id as vendor_id,
          COALESCE(i.vendor_name, ph.vendor, 'Unknown') as vendor_name,
          i.po_number,
          i.sku,
          i.inspection_type,
          i.result,
          i.inspection_date
        FROM inspections i
        LEFT JOIN po_headers ph ON i.po_number = ph.po_number
        LEFT JOIN vendors v ON ph.vendor = v.name
        ${whereClause}
      ),
      vendor_refinals AS (
        SELECT DISTINCT vendor_name, po_number, sku
        FROM vendor_inspections
        WHERE inspection_type = 'Re-Final Inspection'
      ),
      vendor_final_results AS (
        SELECT 
          vendor_id,
          vendor_name, 
          po_number,
          sku, 
          result,
          ROW_NUMBER() OVER (PARTITION BY vendor_name, po_number, sku ORDER BY inspection_date) as rn
        FROM vendor_inspections
        WHERE inspection_type = 'Final Inspection'
      )
      SELECT 
        vi.vendor_id,
        vi.vendor_name,
        COUNT(*)::int as total_inspections,
        (SELECT COUNT(DISTINCT CONCAT(po_number, ':', sku))::int FROM vendor_final_results WHERE vendor_name = vi.vendor_name) as total_final_pos,
        (SELECT COUNT(*)::int FROM vendor_final_results fr 
         WHERE fr.vendor_name = vi.vendor_name AND fr.rn = 1 AND fr.result = 'Passed'
         AND NOT EXISTS (SELECT 1 FROM vendor_refinals r WHERE r.vendor_name = fr.vendor_name AND r.po_number = fr.po_number AND r.sku = fr.sku)
        ) as passed_first_time,
        COUNT(DISTINCT CONCAT(vi.po_number, ':', vi.sku))::int as unique_shipments,
        COUNT(*) FILTER (WHERE vi.result IN ('Failed', 'Failed - Critical Failure'))::int as failed_count
      FROM vendor_inspections vi
      GROUP BY vi.vendor_id, vi.vendor_name
      ORDER BY total_inspections DESC
      LIMIT 100
    `));

        return result.rows.map(row => ({
            vendorId: row.vendor_id,
            vendorName: row.vendor_name,
            totalInspections: row.total_inspections || 0,
            // First-Time Pass Rate = (PO/SKUs where Final passed AND no Re-Final) / Total PO/SKUs with Final
            firstTimePassRate: row.total_final_pos > 0 ? (row.passed_first_time / row.total_final_pos) * 100 : 0,
            // Avg Insp/Shipment = Total inspections / Unique PO/SKU combinations
            avgInspectionsPerShipment: row.unique_shipments > 0 ? row.total_inspections / row.unique_shipments : 0,
            failedCount: row.failed_count || 0,
        }));
    }

    async getYearOverYearFirstTimePassRate(filters?: {
        inspector?: string;
    }): Promise<Array<{
        year: number;
        month: number;
        monthName: string;
        firstTimePassRate: number;
        totalInspections: number;
        passedFirstTime: number;
    }>> {
        // First-Time Pass Rate = (PO/SKUs where Final passed AND no Re-Final) / Total PO/SKUs with Final
        const inspectorCondition = filters?.inspector
            ? `AND inspector = '${filters.inspector.replace(/'/g, "''")}'`
            : '';

        const result = await db.execute<{
            year: number;
            month: number;
            month_name: string;
            total_final_pos: number;
            passed_first_time: number;
        }>(sql.raw(`
      WITH final_inspections AS (
        SELECT 
          EXTRACT(YEAR FROM inspection_date)::int as year,
          EXTRACT(MONTH FROM inspection_date)::int as month,
          TO_CHAR(inspection_date, 'Mon') as month_name,
          po_number,
          sku,
          result,
          ROW_NUMBER() OVER (PARTITION BY po_number, sku ORDER BY inspection_date) as rn
        FROM inspections
        WHERE inspection_date IS NOT NULL AND inspection_type = 'Final Inspection'
        ${inspectorCondition}
      ),
      refinal_inspections AS (
        SELECT DISTINCT 
          EXTRACT(YEAR FROM inspection_date)::int as year,
          EXTRACT(MONTH FROM inspection_date)::int as month,
          po_number,
          sku
        FROM inspections
        WHERE inspection_date IS NOT NULL AND inspection_type = 'Re-Final Inspection'
        ${inspectorCondition}
      )
      SELECT 
        f.year,
        f.month,
        f.month_name,
        COUNT(DISTINCT CONCAT(f.po_number, ':', f.sku))::int as total_final_pos,
        COUNT(*) FILTER (
          WHERE f.rn = 1 AND f.result = 'Passed'
          AND NOT EXISTS (
            SELECT 1 FROM refinal_inspections r 
            WHERE r.po_number = f.po_number AND r.sku = f.sku 
            AND r.year = f.year AND r.month = f.month
          )
        )::int as passed_first_time
      FROM final_inspections f
      GROUP BY f.year, f.month, f.month_name
      ORDER BY f.year, f.month
    `));

        return result.rows.map(row => ({
            year: row.year,
            month: row.month,
            monthName: row.month_name,
            totalInspections: row.total_final_pos || 0,
            passedFirstTime: row.passed_first_time || 0,
            // First-Time Pass Rate = (PO/SKUs where Final passed AND no Re-Final) / Total PO/SKUs with Final
            firstTimePassRate: row.total_final_pos > 0 ? (row.passed_first_time / row.total_final_pos) * 100 : 0,
        }));
    }

    async getInspectionDelayCorrelation(filters?: {
        inspector?: string;
    }): Promise<Array<{
        year: number;
        month: number;
        monthName: string;
        failedInspections: number;
        lateShipments: number;
        correlatedDelays: number;
    }>> {
        const inspector = filters?.inspector || null;

        const result = inspector
            ? await db.execute<{
                year: number;
                month: number;
                month_name: string;
                failed_inspections: number;
                late_shipments: number;
                correlated_delays: number;
            }>(sql`
          WITH monthly_failed AS (
            SELECT 
              EXTRACT(YEAR FROM inspection_date)::int as year,
              EXTRACT(MONTH FROM inspection_date)::int as month,
              TO_CHAR(inspection_date, 'Mon') as month_name,
              po_number
            FROM inspections
            WHERE result IN ('Failed', 'Failed - Critical Failure') AND inspection_date IS NOT NULL
            AND inspector = ${inspector}
          ),
          monthly_late AS (
            SELECT 
              EXTRACT(YEAR FROM ph.revised_cancel_date)::int as year,
              EXTRACT(MONTH FROM ph.revised_cancel_date)::int as month,
              ph.po_number
            FROM po_headers ph
            LEFT JOIN (
              SELECT po_number, 
                MIN(delivery_to_consolidator) as delivery_to_consolidator,
                MAX(CASE WHEN hod_status = 'Shipped' THEN 1 ELSE 0 END) as is_shipped
              FROM shipments
              GROUP BY po_number
            ) s ON s.po_number = ph.po_number
            WHERE ph.revised_cancel_date IS NOT NULL
              AND ph.status NOT IN ('Closed', 'Cancelled')
              AND COALESCE(ph.total_value, 0) > 0
              AND (ph.program_description IS NULL OR ph.program_description NOT LIKE 'SMP %')
              AND (ph.program_description IS NULL OR ph.program_description NOT LIKE '8X8 %')
              AND (
                (s.delivery_to_consolidator IS NOT NULL AND s.delivery_to_consolidator > ph.revised_cancel_date)
                OR
                (COALESCE(s.is_shipped, 0) = 0 AND s.delivery_to_consolidator IS NULL AND ph.revised_cancel_date < CURRENT_DATE)
              )
          )
          SELECT 
            COALESCE(mf.year, ml.year) as year,
            COALESCE(mf.month, ml.month) as month,
            COALESCE(mf.month_name, TO_CHAR(TO_DATE(COALESCE(ml.month, 1)::text, 'MM'), 'Mon')) as month_name,
            COUNT(DISTINCT mf.po_number)::int as failed_inspections,
            COUNT(DISTINCT ml.po_number)::int as late_shipments,
            COUNT(DISTINCT CASE WHEN mf.po_number = ml.po_number THEN mf.po_number END)::int as correlated_delays
          FROM monthly_failed mf
          FULL OUTER JOIN monthly_late ml ON mf.year = ml.year AND mf.month = ml.month
          WHERE COALESCE(mf.year, ml.year) IS NOT NULL
          GROUP BY COALESCE(mf.year, ml.year), COALESCE(mf.month, ml.month), COALESCE(mf.month_name, TO_CHAR(TO_DATE(COALESCE(ml.month, 1)::text, 'MM'), 'Mon'))
          ORDER BY year, month
        `)
            : await db.execute<{
                year: number;
                month: number;
                month_name: string;
                failed_inspections: number;
                late_shipments: number;
                correlated_delays: number;
            }>(sql`
          WITH monthly_failed AS (
            SELECT 
              EXTRACT(YEAR FROM inspection_date)::int as year,
              EXTRACT(MONTH FROM inspection_date)::int as month,
              TO_CHAR(inspection_date, 'Mon') as month_name,
              po_number
            FROM inspections
            WHERE result IN ('Failed', 'Failed - Critical Failure') AND inspection_date IS NOT NULL
          ),
          monthly_late AS (
            SELECT 
              EXTRACT(YEAR FROM ph.revised_cancel_date)::int as year,
              EXTRACT(MONTH FROM ph.revised_cancel_date)::int as month,
              ph.po_number
            FROM po_headers ph
            LEFT JOIN (
              SELECT po_number, 
                MIN(delivery_to_consolidator) as delivery_to_consolidator,
                MAX(CASE WHEN hod_status = 'Shipped' THEN 1 ELSE 0 END) as is_shipped
              FROM shipments
              GROUP BY po_number
            ) s ON s.po_number = ph.po_number
            WHERE ph.revised_cancel_date IS NOT NULL
              AND ph.status NOT IN ('Closed', 'Cancelled')
              AND COALESCE(ph.total_value, 0) > 0
              AND (ph.program_description IS NULL OR ph.program_description NOT LIKE 'SMP %')
              AND (ph.program_description IS NULL OR ph.program_description NOT LIKE '8X8 %')
              AND (
                (s.delivery_to_consolidator IS NOT NULL AND s.delivery_to_consolidator > ph.revised_cancel_date)
                OR
                (COALESCE(s.is_shipped, 0) = 0 AND s.delivery_to_consolidator IS NULL AND ph.revised_cancel_date < CURRENT_DATE)
              )
          )
          SELECT 
            COALESCE(mf.year, ml.year) as year,
            COALESCE(mf.month, ml.month) as month,
            COALESCE(mf.month_name, TO_CHAR(TO_DATE(COALESCE(ml.month, 1)::text, 'MM'), 'Mon')) as month_name,
            COUNT(DISTINCT mf.po_number)::int as failed_inspections,
            COUNT(DISTINCT ml.po_number)::int as late_shipments,
            COUNT(DISTINCT CASE WHEN mf.po_number = ml.po_number THEN mf.po_number END)::int as correlated_delays
          FROM monthly_failed mf
          FULL OUTER JOIN monthly_late ml ON mf.year = ml.year AND mf.month = ml.month
          WHERE COALESCE(mf.year, ml.year) IS NOT NULL
          GROUP BY COALESCE(mf.year, ml.year), COALESCE(mf.month, ml.month), COALESCE(mf.month_name, TO_CHAR(TO_DATE(COALESCE(ml.month, 1)::text, 'MM'), 'Mon'))
          ORDER BY year, month
        `);

        return result.rows.map(row => ({
            year: row.year,
            month: row.month,
            monthName: row.month_name,
            failedInspections: row.failed_inspections || 0,
            lateShipments: row.late_shipments || 0,
            correlatedDelays: row.correlated_delays || 0,
        }));
    }

    // Quality Dashboard methods
    async getQualityKpis(filters?: { inspector?: string }): Promise<{
        posDueNext2Weeks: number;
        scheduledInspections: number;
        completedInspectionsThisMonth: number;
        expiringCertifications: number;
        failedFinalInspections: number;
        inspectionsOutsideWindow: number;
        pendingQABeyond45Days: number;
        lateMaterialsAtFactory: number;
    }> {
        const twoWeeksFromNow = new Date();
        twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const threeMonthsFromNow = new Date();
        threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

        const inspector = filters?.inspector || null;

        // POs due in next 2 weeks (PO-level metric - no inspector filter needed)
        const posDueResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT po_number)::int as count
      FROM po_headers
      WHERE revised_ship_date BETWEEN CURRENT_DATE AND ${twoWeeksFromNow.toISOString()}
      AND status NOT IN ('Closed', 'Cancelled')
    `);

        // Scheduled inspections (POs without final inspection by this inspector)
        const scheduledResult = inspector
            ? await db.execute<{ count: number }>(sql`
          SELECT COUNT(DISTINCT ph.po_number)::int as count
          FROM po_headers ph
          WHERE ph.status NOT IN ('Closed', 'Cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM inspections i 
            WHERE i.po_number = ph.po_number 
            AND i.inspection_type = 'Final'
            AND i.inspector = ${inspector}
          )
        `)
            : await db.execute<{ count: number }>(sql`
          SELECT COUNT(DISTINCT ph.po_number)::int as count
          FROM po_headers ph
          WHERE ph.status NOT IN ('Closed', 'Cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM inspections i 
            WHERE i.po_number = ph.po_number 
            AND i.inspection_type = 'Final'
          )
        `);

        // Completed inspections this month (by this inspector)
        const completedResult = inspector
            ? await db.execute<{ count: number }>(sql`
          SELECT COUNT(*)::int as count
          FROM inspections
          WHERE inspection_date >= ${startOfMonth.toISOString()}
          AND inspector = ${inspector}
        `)
            : await db.execute<{ count: number }>(sql`
          SELECT COUNT(*)::int as count
          FROM inspections
          WHERE inspection_date >= ${startOfMonth.toISOString()}
        `);

        // Expiring certifications (next 3 months - count unique SKUs, no inspector filter)
        const expiringResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT sku)::int as count
      FROM quality_tests
      WHERE expiry_date BETWEEN CURRENT_DATE AND ${threeMonthsFromNow.toISOString()}
    `);

        // Failed final inspections (by this inspector)
        const failedFinalsResult = inspector
            ? await db.execute<{ count: number }>(sql`
          SELECT COUNT(*)::int as count
          FROM inspections
          WHERE inspection_type = 'Final' AND result = 'Failed'
          AND inspector = ${inspector}
        `)
            : await db.execute<{ count: number }>(sql`
          SELECT COUNT(*)::int as count
          FROM inspections
          WHERE inspection_type = 'Final' AND result = 'Failed'
        `);

        // Inspections outside HOD/CRD window (by this inspector)
        const outsideWindowResult = inspector
            ? await db.execute<{ count: number }>(sql`
          SELECT COUNT(*)::int as count
          FROM inspections i
          JOIN po_headers ph ON i.po_number = ph.po_number
          WHERE i.inspection_type = 'Final'
          AND (i.inspection_date < ph.revised_ship_date OR i.inspection_date > ph.revised_cancel_date)
          AND i.inspector = ${inspector}
        `)
            : await db.execute<{ count: number }>(sql`
          SELECT COUNT(*)::int as count
          FROM inspections i
          JOIN po_headers ph ON i.po_number = ph.po_number
          WHERE i.inspection_type = 'Final'
          AND (i.inspection_date < ph.revised_ship_date OR i.inspection_date > ph.revised_cancel_date)
        `);

        // Pending QA beyond 45 days (no inspector filter)
        const pendingQAResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int as count
      FROM quality_tests
      WHERE (result IS NULL OR result = '')
      AND report_date < CURRENT_DATE - INTERVAL '45 days'
    `);

        return {
            posDueNext2Weeks: posDueResult.rows[0]?.count || 0,
            scheduledInspections: scheduledResult.rows[0]?.count || 0,
            completedInspectionsThisMonth: completedResult.rows[0]?.count || 0,
            expiringCertifications: expiringResult.rows[0]?.count || 0,
            failedFinalInspections: failedFinalsResult.rows[0]?.count || 0,
            inspectionsOutsideWindow: outsideWindowResult.rows[0]?.count || 0,
            pendingQABeyond45Days: pendingQAResult.rows[0]?.count || 0,
            lateMaterialsAtFactory: 0, // Will be implemented when timelines feature is built
        };
    }

    async getAtRiskPurchaseOrders(filters?: { inspector?: string }): Promise<Array<{
        id: number;
        po_number: string;
        vendor: string | null;
        status: string;
        risk_criteria: string[];
        days_until_hod: number;
    }>> {
        const inspector = filters?.inspector || null;

        const result = inspector
            ? await db.execute<{
                id: number;
                po_number: string;
                vendor: string | null;
                status: string;
                has_failed_final: boolean;
                has_inspection_outside_window: boolean;
                has_pending_qa_beyond_45: boolean;
                days_until_hod: number;
            }>(sql`
          SELECT 
            ph.id,
            ph.po_number,
            ph.vendor,
            ph.status,
            EXISTS (
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
              AND i.inspection_type = 'Final Inspection' 
              AND i.result IN ('Failed', 'Failed - Critical Failure')
              AND i.inspector = ${inspector}
            ) as has_failed_final,
            EXISTS (
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
              AND i.inspection_type = 'Final Inspection'
              AND (i.inspection_date < ph.revised_ship_date OR i.inspection_date > ph.revised_cancel_date)
              AND i.inspector = ${inspector}
            ) as has_inspection_outside_window,
            EXISTS (
              SELECT 1 FROM quality_tests qt 
              JOIN skus s ON qt.sku_id = s.id
              JOIN po_line_items pli2 ON pli2.sku = s.sku
              WHERE pli2.po_header_id = ph.id
              AND (qt.result IS NULL OR qt.result = '')
              AND qt.report_date < CURRENT_DATE - INTERVAL '45 days'
            ) as has_pending_qa_beyond_45,
            (ph.revised_ship_date::date - CURRENT_DATE)::int as days_until_hod
          FROM po_headers ph
          WHERE ph.status NOT IN ('Closed', 'Cancelled', 'Shipped')
          AND ph.revised_ship_date >= CURRENT_DATE - INTERVAL '30 days'
          AND (
            EXISTS (
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
              AND i.inspection_type = 'Final Inspection' 
              AND i.result IN ('Failed', 'Failed - Critical Failure')
              AND i.inspector = ${inspector}
            )
            OR EXISTS (
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
              AND i.inspection_type = 'Final Inspection'
              AND (i.inspection_date < ph.revised_ship_date OR i.inspection_date > ph.revised_cancel_date)
              AND i.inspector = ${inspector}
            )
            OR EXISTS (
              SELECT 1 FROM quality_tests qt 
              JOIN skus s ON qt.sku_id = s.id
              JOIN po_line_items pli2 ON pli2.sku = s.sku
              WHERE pli2.po_header_id = ph.id
              AND (qt.result IS NULL OR qt.result = '')
              AND qt.report_date < CURRENT_DATE - INTERVAL '45 days'
            )
          )
          ORDER BY days_until_hod ASC
          LIMIT 100
        `)
            : await db.execute<{
                id: number;
                po_number: string;
                vendor: string | null;
                status: string;
                has_failed_final: boolean;
                has_inspection_outside_window: boolean;
                has_pending_qa_beyond_45: boolean;
                days_until_hod: number;
            }>(sql`
          SELECT 
            ph.id,
            ph.po_number,
            ph.vendor,
            ph.status,
            EXISTS (
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
              AND i.inspection_type = 'Final Inspection' 
              AND i.result IN ('Failed', 'Failed - Critical Failure')
            ) as has_failed_final,
            EXISTS (
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
              AND i.inspection_type = 'Final Inspection'
              AND (i.inspection_date < ph.revised_ship_date OR i.inspection_date > ph.revised_cancel_date)
            ) as has_inspection_outside_window,
            EXISTS (
              SELECT 1 FROM quality_tests qt 
              JOIN skus s ON qt.sku_id = s.id
              JOIN po_line_items pli2 ON pli2.sku = s.sku
              WHERE pli2.po_header_id = ph.id
              AND (qt.result IS NULL OR qt.result = '')
              AND qt.report_date < CURRENT_DATE - INTERVAL '45 days'
            ) as has_pending_qa_beyond_45,
            (ph.revised_ship_date::date - CURRENT_DATE)::int as days_until_hod
          FROM po_headers ph
          WHERE ph.status NOT IN ('Closed', 'Cancelled', 'Shipped')
          AND ph.revised_ship_date >= CURRENT_DATE - INTERVAL '30 days'
          AND (
            EXISTS (
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
              AND i.inspection_type = 'Final Inspection' 
              AND i.result IN ('Failed', 'Failed - Critical Failure')
            )
            OR EXISTS (
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
              AND i.inspection_type = 'Final Inspection'
              AND (i.inspection_date < ph.revised_ship_date OR i.inspection_date > ph.revised_cancel_date)
            )
            OR EXISTS (
              SELECT 1 FROM quality_tests qt 
              JOIN skus s ON qt.sku_id = s.id
              JOIN po_line_items pli2 ON pli2.sku = s.sku
              WHERE pli2.po_header_id = ph.id
              AND (qt.result IS NULL OR qt.result = '')
              AND qt.report_date < CURRENT_DATE - INTERVAL '45 days'
            )
          )
          ORDER BY days_until_hod ASC
          LIMIT 100
        `);

        return result.rows.map(row => {
            const criteria: string[] = [];
            if (row.has_failed_final) criteria.push('Failed Final Inspection');
            if (row.has_inspection_outside_window) criteria.push('Inspection Outside Window');
            if (row.has_pending_qa_beyond_45) criteria.push('Pending QA >45 Days');

            return {
                id: row.id,
                po_number: row.po_number,
                vendor: row.vendor,
                status: row.status,
                risk_criteria: criteria,
                days_until_hod: row.days_until_hod || 0,
            };
        });
    }

    // Compliance Styles operations (OS630 source data - separate table)
    async bulkInsertComplianceStyles(styleList: any[]): Promise<{ inserted: number }> {
        if (styleList.length === 0) return { inserted: 0 };

        // Clear existing data first (full replace on each import)
        await this.clearComplianceStyles();

        const BATCH_SIZE = 100; // Smaller batches for safety
        let totalInserted = 0;
        const totalBatches = Math.ceil(styleList.length / BATCH_SIZE);

        console.log(`Processing ${styleList.length} compliance styles in ${totalBatches} batches`);

        for (let i = 0; i < styleList.length; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const batch = styleList.slice(i, i + BATCH_SIZE);

            try {
                // Use individual inserts for each record in the batch
                for (const s of batch) {
                    await db.execute(sql`
            INSERT INTO compliance_styles (
              style, po_number, source_status, client_division, client_department, vendor_name,
              mandatory_status, mandatory_expiry_date, mandatory_report_number,
              performance_status, performance_expiry_date, performance_report_number,
              transit_status, transit_expiry_date
            ) VALUES (
              ${s.style}, ${s.poNumber}, ${s.sourceStatus}, ${s.clientDivision}, ${s.clientDepartment}, ${s.vendorName},
              ${s.mandatoryStatus}, ${s.mandatoryExpiryDate}, ${s.mandatoryReportNumber},
              ${s.performanceStatus}, ${s.performanceExpiryDate}, ${s.performanceReportNumber},
              ${s.transitStatus}, ${s.transitExpiryDate}
            )
          `);
                    totalInserted++;
                }

                if (batchNum % 20 === 0 || batchNum === totalBatches) {
                    console.log(`Compliance styles batch ${batchNum}/${totalBatches} complete`);
                }
            } catch (error: any) {
                console.error(`Compliance styles batch ${batchNum} failed:`, error.message);
                throw error;
            }
        }

        return { inserted: totalInserted };
    }

    async clearComplianceStyles(): Promise<void> {
        console.log("Clearing compliance styles for full data refresh...");
        await db.execute(sql`DELETE FROM compliance_styles`);
    }

    // Inspection Status Report - Final/Inline lateness based on ship dates
    // Final: Late if not passed within 5 days of ship date
    // Inline: Late if not passed within 8 days of ship date
    async getInspectionStatusReport(filters?: {
        vendor?: string;
        merchandiser?: string;
        merchandisingManager?: string;
    }): Promise<{
        finalInspection: {
            onTime: number;
            late: number;
            pending: number;
            total: number;
        };
        inlineInspection: {
            onTime: number;
            late: number;
            pending: number;
            total: number;
        };
        vendors: string[];
    }> {
        // Get distinct vendors for filter dropdown
        const vendorsResult = await db.execute<{ vendor_name: string }>(sql`
      SELECT DISTINCT vendor_name 
      FROM inspections 
      WHERE vendor_name IS NOT NULL AND vendor_name != ''
      ORDER BY vendor_name
    `);

        // Build filter conditions
        const vendorFilter = filters?.vendor && filters.vendor !== 'all'
            ? sql`AND i.vendor_name = ${filters.vendor}`
            : sql``;

        const merchandiserFilter = filters?.merchandiser && filters.merchandiser !== 'all'
            ? sql`AND i.vendor_name IN (SELECT name FROM vendors WHERE merchandiser = ${filters.merchandiser})`
            : sql``;

        const managerFilter = filters?.merchandisingManager && filters.merchandisingManager !== 'all'
            ? sql`AND i.vendor_name IN (SELECT name FROM vendors WHERE merchandising_manager = ${filters.merchandisingManager})`
            : sql``;

        // Query for Final Inspection status
        // Late if: no passed result AND ship_date - 5 days < TODAY
        const finalResult = await db.execute<{
            on_time: number;
            late: number;
            pending: number;
            total: number;
        }>(sql`
      WITH po_final_status AS (
        SELECT 
          ph.po_number,
          ph.vendor,
          COALESCE(ph.revised_ship_date, ph.original_ship_date) as ship_date,
          MAX(CASE WHEN i.result IN ('Passed', 'Exception - Factory Self-Inspection') THEN 1 ELSE 0 END) as has_passed,
          MAX(CASE WHEN i.inspection_date IS NOT NULL THEN 1 ELSE 0 END) as has_booked,
          MAX(i.inspection_date) as last_inspection_date
        FROM po_headers ph
        LEFT JOIN inspections i ON ph.po_number = i.po_number 
          AND i.inspection_type = 'Final Inspection'
          ${vendorFilter}
          ${merchandiserFilter}
          ${managerFilter}
        WHERE (ph.shipment_status IS NULL OR ph.shipment_status = '' OR ph.shipment_status NOT IN ('On-Time', 'Late'))
          AND COALESCE(ph.revised_ship_date, ph.original_ship_date) IS NOT NULL
        GROUP BY ph.po_number, ph.vendor, COALESCE(ph.revised_ship_date, ph.original_ship_date)
      )
      SELECT 
        COUNT(CASE WHEN has_passed = 1 THEN 1 END)::int as on_time,
        COUNT(CASE WHEN has_passed = 0 
          AND ship_date - INTERVAL '5 days' < CURRENT_DATE THEN 1 END)::int as late,
        COUNT(CASE WHEN has_passed = 0 
          AND ship_date - INTERVAL '5 days' >= CURRENT_DATE THEN 1 END)::int as pending,
        COUNT(*)::int as total
      FROM po_final_status
    `);

        // Query for Inline Inspection status
        // Late if: no passed result AND ship_date - 8 days < TODAY
        const inlineResult = await db.execute<{
            on_time: number;
            late: number;
            pending: number;
            total: number;
        }>(sql`
      WITH po_inline_status AS (
        SELECT 
          ph.po_number,
          ph.vendor,
          COALESCE(ph.revised_ship_date, ph.original_ship_date) as ship_date,
          MAX(CASE WHEN i.result IN ('Passed', 'Exception - Factory Self-Inspection') THEN 1 ELSE 0 END) as has_passed,
          MAX(CASE WHEN i.inspection_date IS NOT NULL THEN 1 ELSE 0 END) as has_booked,
          MAX(i.inspection_date) as last_inspection_date
        FROM po_headers ph
        LEFT JOIN inspections i ON ph.po_number = i.po_number 
          AND i.inspection_type = 'Inline Inspection'
          ${vendorFilter}
          ${merchandiserFilter}
          ${managerFilter}
        WHERE (ph.shipment_status IS NULL OR ph.shipment_status = '' OR ph.shipment_status NOT IN ('On-Time', 'Late'))
          AND COALESCE(ph.revised_ship_date, ph.original_ship_date) IS NOT NULL
        GROUP BY ph.po_number, ph.vendor, COALESCE(ph.revised_ship_date, ph.original_ship_date)
      )
      SELECT 
        COUNT(CASE WHEN has_passed = 1 THEN 1 END)::int as on_time,
        COUNT(CASE WHEN has_passed = 0 
          AND ship_date - INTERVAL '8 days' < CURRENT_DATE THEN 1 END)::int as late,
        COUNT(CASE WHEN has_passed = 0 
          AND ship_date - INTERVAL '8 days' >= CURRENT_DATE THEN 1 END)::int as pending,
        COUNT(*)::int as total
      FROM po_inline_status
    `);

        const finalRow = finalResult.rows[0] || { on_time: 0, late: 0, pending: 0, total: 0 };
        const inlineRow = inlineResult.rows[0] || { on_time: 0, late: 0, pending: 0, total: 0 };

        return {
            finalInspection: {
                onTime: finalRow.on_time,
                late: finalRow.late,
                pending: finalRow.pending,
                total: finalRow.total
            },
            inlineInspection: {
                onTime: inlineRow.on_time,
                late: inlineRow.late,
                pending: inlineRow.pending,
                total: inlineRow.total
            },
            vendors: vendorsResult.rows.map(r => r.vendor_name)
        };
    }

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

    // Quality & Compliance Dashboard - Alert System Implementation

    // Check if filters require vendor join
    private requiresVendorJoin(filters?: ComplianceFilters): boolean {
        return !!(filters?.merchandiser || filters?.merchandisingManager);
    }

    // POs with Booking Confirmed that need inspections booked
    async getBookingConfirmedNeedingInspection(filters?: ComplianceFilters): Promise<Array<{
        id: number;
        po_number: string;
        vendor: string | null;
        sku: string | null;
        revised_cancel_date: Date | null;
        status: string;
        days_until_ship: number | null;
        needed_inspections: string[];
    }>> {
        const needsVendorJoin = this.requiresVendorJoin(filters);

        // Query returns POs and which standard inspection types they're missing
        // Standard required inspections: Inline Inspection, Final Inspection
        const result = await db.execute<{
            id: number;
            po_number: string;
            vendor: string | null;
            sku: string | null;
            revised_cancel_date: Date | null;
            status: string;
            days_until_ship: number | null;
            has_inline: boolean;
            has_final: boolean;
        }>(sql`
      SELECT DISTINCT
        ph.id,
        ph.po_number,
        ph.vendor,
        pli.sku,
        ph.revised_cancel_date,
        ph.status,
        (ph.revised_cancel_date::date - CURRENT_DATE)::int as days_until_ship,
        EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number 
          AND i.inspection_type = 'Inline Inspection'
        ) as has_inline,
        EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number 
          AND i.inspection_type = 'Final Inspection'
        ) as has_final
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
      WHERE ph.status = 'Booked-to-ship'
        AND ph.revised_cancel_date >= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number
        )
        AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
        AND NOT EXISTS (
          SELECT 1 FROM shipments s 
          WHERE s.po_number = ph.po_number 
          AND (UPPER(COALESCE(s.hod_status, '')) = 'SHIPPED' OR s.delivery_to_consolidator IS NOT NULL)
        )
        ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
        ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
        ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
        ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
        ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
      ORDER BY days_until_ship ASC
      LIMIT 500
    `);

        // Map results to include needed_inspections array
        return result.rows.map(row => {
            const needed: string[] = [];
            if (!row.has_inline) needed.push('Inline');
            if (!row.has_final) needed.push('Final');
            return {
                id: row.id,
                po_number: row.po_number,
                vendor: row.vendor,
                sku: row.sku,
                revised_cancel_date: row.revised_cancel_date,
                status: row.status,
                days_until_ship: row.days_until_ship,
                needed_inspections: needed,
            };
        });
    }

    // POs within 7-day HOD window missing inline inspection (booking warning threshold)
    // HOD (Hand-off Date) = revised_ship_date, aligned with at-risk criteria
    async getMissingInlineInspections(filters?: ComplianceFilters): Promise<Array<{
        id: number;
        po_number: string;
        vendor: string | null;
        sku: string | null;
        cargo_ready_date: Date | null;
        days_until_crd: number | null;
        status: string;
    }>> {
        const needsVendorJoin = this.requiresVendorJoin(filters);

        // Use the at-risk threshold: inline inspection must be booked within 14 days of HOD
        // HOD = revised_ship_date (aligned with other at-risk queries)
        const result = await db.execute<{
            id: number;
            po_number: string;
            vendor: string | null;
            sku: string | null;
            cargo_ready_date: Date | null;
            days_until_crd: number | null;
            status: string;
        }>(sql`
      SELECT DISTINCT
        ph.id,
        ph.po_number,
        ph.vendor,
        pli.sku,
        s.cargo_ready_date,
        (COALESCE(ph.revised_ship_date, ph.original_ship_date)::date - CURRENT_DATE)::int as days_until_crd,
        ph.status
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      LEFT JOIN shipments s ON s.po_number = ph.po_number
      ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
      WHERE UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        -- Use 7 days for inline inspections (booking warning threshold)
        -- HOD = revised_ship_date (aligned with at-risk criteria)
        AND (COALESCE(ph.revised_ship_date, ph.original_ship_date)::date - CURRENT_DATE)::int <= 7
        AND (COALESCE(ph.revised_ship_date, ph.original_ship_date)::date - CURRENT_DATE)::int > 0
        -- No inline inspection booked yet
        AND NOT EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number 
          AND i.inspection_type ILIKE '%inline%'
        )
        -- Also exclude POs that have PASSED final inspection (they clearly already had inline)
        AND NOT EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number 
          AND i.inspection_type ILIKE '%final%'
          AND i.result ILIKE '%pass%'
        )
        AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
        -- Exclude already shipped POs
        AND NOT EXISTS (
          SELECT 1 FROM shipments s2 
          WHERE s2.po_number = ph.po_number 
          AND s2.delivery_to_consolidator IS NOT NULL
        )
        ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
        ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
        ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
        ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
        ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
      ORDER BY days_until_crd ASC
      LIMIT 500
    `);
        return result.rows;
    }

    // POs within 7-day HOD window missing final inspection (booking warning threshold)
    async getMissingFinalInspections(filters?: ComplianceFilters): Promise<Array<{
        id: number;
        po_number: string;
        vendor: string | null;
        sku: string | null;
        revised_ship_date: Date | null;
        days_until_ship: number | null;
        status: string;
    }>> {
        const needsVendorJoin = this.requiresVendorJoin(filters);

        const result = await db.execute<{
            id: number;
            po_number: string;
            vendor: string | null;
            sku: string | null;
            revised_ship_date: Date | null;
            days_until_ship: number | null;
            status: string;
        }>(sql`
      SELECT DISTINCT
        ph.id,
        ph.po_number,
        ph.vendor,
        pli.sku,
        ph.revised_ship_date,
        (COALESCE(ph.revised_ship_date, ph.original_ship_date)::date - CURRENT_DATE)::int as days_until_ship,
        ph.status
      FROM po_headers ph
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
      WHERE UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        -- Use 7 days for final inspections (booking warning threshold)
        AND (COALESCE(ph.revised_ship_date, ph.original_ship_date)::date - CURRENT_DATE)::int <= 7
        AND (COALESCE(ph.revised_ship_date, ph.original_ship_date)::date - CURRENT_DATE)::int > 0
        -- Has inline inspection but no final inspection booked
        AND EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number 
          AND i.inspection_type ILIKE '%inline%'
        )
        AND NOT EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number 
          AND i.inspection_type ILIKE '%final%'
        )
        AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
        -- Exclude already shipped POs
        AND NOT EXISTS (
          SELECT 1 FROM shipments s2 
          WHERE s2.po_number = ph.po_number 
          AND s2.delivery_to_consolidator IS NOT NULL
        )
        ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
        ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
        ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
        ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
        ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
      ORDER BY days_until_ship ASC
      LIMIT 500
    `);
        return result.rows;
    }

    // Failed inspections with failure reasons
    async getFailedInspections(filters?: ComplianceFilters, limit: number = 50): Promise<Array<{
        id: number;
        po_id: number | null;
        po_number: string;
        vendor_name: string | null;
        sku: string | null;
        inspection_type: string;
        result: string | null;
        inspection_date: Date | null;
        notes: string | null;
    }>> {
        const needsVendorJoin = this.requiresVendorJoin(filters);

        const result = await db.execute<{
            id: number;
            po_id: number | null;
            po_number: string;
            vendor_name: string | null;
            sku: string | null;
            inspection_type: string;
            result: string | null;
            inspection_date: Date | null;
            notes: string | null;
        }>(sql`
      SELECT 
        i.id,
        ph.id as po_id,
        i.po_number,
        COALESCE(NULLIF(i.vendor_name, ''), ph.vendor) as vendor_name,
        i.sku,
        i.inspection_type,
        i.result,
        i.inspection_date,
        i.notes
      FROM inspections i
      LEFT JOIN po_headers ph ON i.po_number = ph.po_number
      ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
      WHERE (i.result LIKE 'Failed%' OR i.result LIKE 'Abort%')
        AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
        AND NOT EXISTS (
          SELECT 1 FROM shipments s 
          WHERE s.po_number = i.po_number 
          AND (UPPER(COALESCE(s.hod_status, '')) = 'SHIPPED' OR s.delivery_to_consolidator IS NOT NULL)
        )
        ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
        ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
        ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
        ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
        ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
      ORDER BY i.inspection_date DESC
      LIMIT ${limit}
    `);
        return result.rows;
    }

    // Certificates expiring within 90 days before ship date
    async getExpiringCertificates90Days(filters?: ComplianceFilters): Promise<Array<{
        id: number;
        po_id: number | null;
        po_number: string;
        sku: string | null;
        sku_description: string | null;
        test_type: string;
        result: string | null;
        status: string | null;
        expiry_date: Date | null;
        ship_date: Date | null;
        days_until_expiry: number | null;
        po_count?: number;
    }>> {
        const needsVendorJoin = this.requiresVendorJoin(filters);

        // Get unique tests per SKU - tests belong to products, not individual POs
        // Group by SKU + test identity to deduplicate
        const result = await db.execute<{
            id: number;
            po_id: number | null;
            po_number: string;
            sku: string | null;
            sku_description: string | null;
            test_type: string;
            result: string | null;
            status: string | null;
            expiry_date: Date | null;
            ship_date: Date | null;
            days_until_expiry: number | null;
            po_count: number;
        }>(sql`
      SELECT
        MIN(qt.id)::int as id,
        MIN(ph.id)::int as po_id,
        COUNT(DISTINCT qt.po_number)::int || ' PO' || CASE WHEN COUNT(DISTINCT qt.po_number) > 1 THEN 's' ELSE '' END as po_number,
        pli.sku,
        MAX(ph.program_description) as sku_description,
        qt.test_type,
        qt.result,
        qt.status,
        qt.expiry_date,
        MAX(ph.revised_cancel_date) as ship_date,
        (qt.expiry_date::date - CURRENT_DATE)::int as days_until_expiry,
        COUNT(DISTINCT qt.po_number)::int as po_count
      FROM quality_tests qt
      JOIN po_headers ph ON qt.po_number = ph.po_number
      LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
      ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
      WHERE qt.expiry_date IS NOT NULL
        AND qt.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
        AND qt.expiry_date > CURRENT_DATE
        AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
        AND NOT EXISTS (
          SELECT 1 FROM shipments s 
          WHERE s.po_number = qt.po_number 
          AND (UPPER(COALESCE(s.hod_status, '')) = 'SHIPPED' OR s.delivery_to_consolidator IS NOT NULL)
        )
        ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
        ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
        ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
        ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
        ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
      GROUP BY pli.sku, qt.test_type, qt.result, qt.status, qt.expiry_date
      ORDER BY qt.expiry_date ASC
      LIMIT 500
    `);
        return result.rows;
    }

    // Inspection performance by vendor
    async getInspectionPerformanceByVendor(): Promise<Array<{
        vendor_name: string;
        total_inspections: number;
        passed_count: number;
        failed_count: number;
        pass_rate: number;
    }>> {
        const result = await db.execute<{
            vendor_name: string;
            total_inspections: number;
            passed_count: number;
            failed_count: number;
            pass_rate: number;
        }>(sql`
      SELECT 
        COALESCE(i.vendor_name, ph.vendor, 'Unknown') as vendor_name,
        COUNT(*)::int as total_inspections,
        COUNT(CASE WHEN i.result = 'Passed' THEN 1 END)::int as passed_count,
        COUNT(CASE WHEN i.result LIKE 'Failed%' THEN 1 END)::int as failed_count,
        ROUND(100.0 * COUNT(CASE WHEN i.result = 'Passed' THEN 1 END) / NULLIF(COUNT(*), 0), 1) as pass_rate
      FROM inspections i
      LEFT JOIN po_headers ph ON i.po_number = ph.po_number
      WHERE i.inspection_date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY COALESCE(i.vendor_name, ph.vendor, 'Unknown')
      HAVING COUNT(*) >= 5
      ORDER BY pass_rate ASC, total_inspections DESC
      LIMIT 50
    `);
        return result.rows;
    }

    // Inspection performance by SKU
    async getInspectionPerformanceBySku(): Promise<Array<{
        sku: string;
        total_inspections: number;
        passed_count: number;
        failed_count: number;
        pass_rate: number;
    }>> {
        const result = await db.execute<{
            sku: string;
            total_inspections: number;
            passed_count: number;
            failed_count: number;
            pass_rate: number;
        }>(sql`
      SELECT 
        COALESCE(i.sku, 'Unknown') as sku,
        COUNT(*)::int as total_inspections,
        COUNT(CASE WHEN i.result = 'Passed' THEN 1 END)::int as passed_count,
        COUNT(CASE WHEN i.result LIKE 'Failed%' THEN 1 END)::int as failed_count,
        ROUND(100.0 * COUNT(CASE WHEN i.result = 'Passed' THEN 1 END) / NULLIF(COUNT(*), 0), 1) as pass_rate
      FROM inspections i
      WHERE i.inspection_date >= CURRENT_DATE - INTERVAL '12 months'
        AND i.sku IS NOT NULL
      GROUP BY i.sku
      HAVING COUNT(*) >= 3
      ORDER BY pass_rate ASC, total_inspections DESC
      LIMIT 50
    `);
        return result.rows;
    }

    // Alert counts for the dashboard summary bar
    async getQualityComplianceAlertCounts(filters?: ComplianceFilters): Promise<{
        bookingConfirmedNeedingInspection: number;
        missingInlineInspections: number;
        missingFinalInspections: number;
        failedInspections: number;
        expiringCertificates: number;
    }> {
        const needsVendorJoin = this.requiresVendorJoin(filters);

        const bookingResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT ph.id)::int as count
      FROM po_headers ph
      ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
      WHERE ph.status = 'Booked-to-ship'
        AND ph.revised_cancel_date >= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM inspections i WHERE i.po_number = ph.po_number
        )
        AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
        AND NOT EXISTS (
          SELECT 1 FROM shipments s 
          WHERE s.po_number = ph.po_number 
          AND (UPPER(COALESCE(s.hod_status, '')) = 'SHIPPED' OR s.delivery_to_consolidator IS NOT NULL)
        )
        ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
        ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
        ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
        ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
        ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
    `);

        const missingInlineResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT ph.id)::int as count
      FROM po_headers ph
      LEFT JOIN shipments s ON s.po_number = ph.po_number
      ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
      WHERE UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND COALESCE(s.cargo_ready_date, ph.revised_cancel_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number 
          AND i.inspection_type = 'Inline Inspection'
        )
        AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
        AND NOT EXISTS (
          SELECT 1 FROM shipments s2 
          WHERE s2.po_number = ph.po_number 
          AND (UPPER(COALESCE(s2.hod_status, '')) = 'SHIPPED' OR s2.delivery_to_consolidator IS NOT NULL)
        )
        ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
        ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
        ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
        ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
        ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
    `);

        // Missing final inspections: POs within 7 days that have inline but no final
        const missingFinalResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT ph.id)::int as count
      FROM po_headers ph
      ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
      WHERE UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND (COALESCE(ph.revised_ship_date, ph.original_ship_date)::date - CURRENT_DATE)::int <= 7
        AND (COALESCE(ph.revised_ship_date, ph.original_ship_date)::date - CURRENT_DATE)::int > 0
        AND EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number 
          AND i.inspection_type ILIKE '%inline%'
        )
        AND NOT EXISTS (
          SELECT 1 FROM inspections i 
          WHERE i.po_number = ph.po_number 
          AND i.inspection_type ILIKE '%final%'
        )
        AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
        AND NOT EXISTS (
          SELECT 1 FROM shipments s2 
          WHERE s2.po_number = ph.po_number 
          AND (UPPER(COALESCE(s2.hod_status, '')) = 'SHIPPED' OR s2.delivery_to_consolidator IS NOT NULL)
        )
        ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
        ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
        ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
        ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
        ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
    `);

        const failedResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int as count
      FROM inspections i
      LEFT JOIN po_headers ph ON i.po_number = ph.po_number
      ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
      WHERE (i.result LIKE 'Failed%' OR i.result LIKE 'Abort%')
        AND i.inspection_date >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
        AND NOT EXISTS (
          SELECT 1 FROM shipments s 
          WHERE s.po_number = i.po_number 
          AND (UPPER(COALESCE(s.hod_status, '')) = 'SHIPPED' OR s.delivery_to_consolidator IS NOT NULL)
        )
        ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
        ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
        ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
        ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
        ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
    `);

        // Count unique expiring tests by deduplicating on (sku, test_type, expiry_date)
        // Tests belong to products, not individual POs
        const expiringResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int as count FROM (
        SELECT DISTINCT pli.sku, qt.test_type, qt.expiry_date
        FROM quality_tests qt
        JOIN po_headers ph ON qt.po_number = ph.po_number
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        ${needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``}
        WHERE qt.expiry_date IS NOT NULL
          AND qt.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
          AND qt.expiry_date > CURRENT_DATE
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
          AND NOT EXISTS (
            SELECT 1 FROM shipments s 
            WHERE s.po_number = qt.po_number 
            AND (UPPER(COALESCE(s.hod_status, '')) = 'SHIPPED' OR s.delivery_to_consolidator IS NOT NULL)
          )
          ${filters?.vendor ? sql`AND (ph.vendor = ${filters.vendor} OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor})) OR ph.vendor IN (SELECT vca.alias FROM vendor_capacity_aliases vca JOIN vendors v ON vca.vendor_id = v.id WHERE v.name = ${filters.vendor}))` : sql``}
          ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
          ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
          ${filters?.startDate ? sql`AND ph.po_date >= ${filters.startDate.toISOString().split('T')[0]}` : sql``}
          ${filters?.endDate ? sql`AND ph.po_date <= ${filters.endDate.toISOString().split('T')[0]}` : sql``}
      ) unique_tests
    `);

        return {
            bookingConfirmedNeedingInspection: bookingResult.rows[0]?.count || 0,
            missingInlineInspections: missingInlineResult.rows[0]?.count || 0,
            missingFinalInspections: missingFinalResult.rows[0]?.count || 0,
            failedInspections: failedResult.rows[0]?.count || 0,
            expiringCertificates: expiringResult.rows[0]?.count || 0,
        };
    }

    // Timeline operations
    async getTimelinesByPoId(poId: number): Promise<Timeline[]> {
        return db.select().from(timelines).where(eq(timelines.poId, poId)).orderBy(timelines.plannedDate);
    }

    async createTimeline(timeline: InsertTimeline): Promise<Timeline> {
        const result = await db.insert(timelines).values(timeline).returning();
        return result[0];
    }

    async updateTimeline(id: number, timeline: Partial<InsertTimeline>): Promise<Timeline | undefined> {
        const result = await db
            .update(timelines)
            .set({ ...timeline, updatedAt: new Date() })
            .where(eq(timelines.id, id))
            .returning();
        return result[0];
    }

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

    // Import History operations
    async getImportHistory(): Promise<ImportHistory[]> {
        return db.select().from(importHistory).orderBy(desc(importHistory.createdAt)).limit(50);
    }

    async createImportHistory(history: InsertImportHistory): Promise<ImportHistory> {
        const result = await db.insert(importHistory).values(history).returning();
        return result[0];
    }

    // Brand Assignment operations
    async getBrandAssignments(): Promise<BrandAssignment[]> {
        return db.select().from(brandAssignments).orderBy(brandAssignments.brandCode);
    }

    async getBrandAssignmentByCode(brandCode: string): Promise<BrandAssignment | undefined> {
        const result = await db.select().from(brandAssignments).where(eq(brandAssignments.brandCode, brandCode));
        return result[0];
    }

    // Vendor Contact operations
    async getVendorContacts(vendorId: number): Promise<VendorContact[]> {
        return db.select().from(vendorContacts)
            .where(eq(vendorContacts.vendorId, vendorId))
            .orderBy(desc(vendorContacts.isPrimary), vendorContacts.name);
    }

    async createVendorContact(contact: InsertVendorContact): Promise<VendorContact> {
        const result = await db.insert(vendorContacts).values(contact).returning();
        return result[0];
    }

    async bulkCreateVendorContacts(contacts: InsertVendorContact[]): Promise<VendorContact[]> {
        if (contacts.length === 0) return [];
        const result = await db.insert(vendorContacts).values(contacts).returning();
        return result;
    }

    // Color Panel operations
    async getColorPanels(filters?: {
        status?: string;
        brand?: string;
        vendorId?: number;
    }): Promise<(ColorPanel & { skuCount: number })[]> {
        const conditions = [];
        if (filters?.status) {
            conditions.push(sql`cp.status = ${filters.status}`);
        }
        if (filters?.brand) {
            conditions.push(sql`cp.brand = ${filters.brand}`);
        }
        if (filters?.vendorId) {
            conditions.push(sql`cp.vendor_id = ${filters.vendorId}`);
        }

        const whereClause = conditions.length > 0
            ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
            : sql``;

        const result = await db.execute<ColorPanel & { sku_count: number }>(sql`
      SELECT 
        cp.*,
        COUNT(DISTINCT CASE WHEN scp.is_active THEN scp.sku_id ELSE NULL END)::int as sku_count
      FROM color_panels cp
      LEFT JOIN sku_color_panels scp ON cp.id = scp.color_panel_id
      ${whereClause}
      GROUP BY cp.id
      ORDER BY cp.current_expiration_date DESC NULLS LAST
    `);

        return result.rows.map(row => ({
            ...row,
            skuCount: row.sku_count || 0,
        })) as (ColorPanel & { skuCount: number })[];
    }

    async getColorPanelById(id: number): Promise<(ColorPanel & { skuCount: number }) | undefined> {
        const result = await db.execute<ColorPanel & { sku_count: number }>(sql`
      SELECT 
        cp.*,
        COUNT(DISTINCT CASE WHEN scp.is_active THEN scp.sku_id ELSE NULL END)::int as sku_count
      FROM color_panels cp
      LEFT JOIN sku_color_panels scp ON cp.id = scp.color_panel_id
      WHERE cp.id = ${id}
      GROUP BY cp.id
    `);

        if (result.rows.length === 0) return undefined;

        return {
            ...result.rows[0],
            skuCount: result.rows[0].sku_count || 0,
        } as ColorPanel & { skuCount: number };
    }

    async createColorPanel(panel: InsertColorPanel): Promise<ColorPanel> {
        const result = await db.insert(colorPanels).values(panel).returning();
        return result[0];
    }

    async updateColorPanel(id: number, panel: Partial<InsertColorPanel>): Promise<ColorPanel | undefined> {
        const result = await db.update(colorPanels).set(panel).where(eq(colorPanels.id, id)).returning();
        return result[0];
    }

    async bulkCreateColorPanels(panels: InsertColorPanel[]): Promise<ColorPanel[]> {
        if (panels.length === 0) return [];
        const result = await db.insert(colorPanels).values(panels).returning();
        return result;
    }

    // Color Panel History operations
    async getColorPanelHistory(colorPanelId: number): Promise<ColorPanelHistory[]> {
        return db.select().from(colorPanelHistory)
            .where(eq(colorPanelHistory.colorPanelId, colorPanelId))
            .orderBy(desc(colorPanelHistory.versionNumber));
    }

    async createColorPanelHistory(history: InsertColorPanelHistory): Promise<ColorPanelHistory> {
        const result = await db.insert(colorPanelHistory).values(history).returning();
        return result[0];
    }

    async bulkCreateColorPanelHistory(history: InsertColorPanelHistory[]): Promise<ColorPanelHistory[]> {
        if (history.length === 0) return [];
        const result = await db.insert(colorPanelHistory).values(history).returning();
        return result;
    }

    // SKU-Color Panel Junction operations
    async linkSkuToColorPanel(skuId: number, colorPanelId: number): Promise<SkuColorPanel> {
        const result = await db.insert(skuColorPanels).values({
            skuId,
            colorPanelId,
            isActive: true,
        }).returning();
        return result[0];
    }

    async getSkusForColorPanel(colorPanelId: number): Promise<Sku[]> {
        const result = await db
            .select({
                id: skus.id,
                sku: skus.sku,
                style: skus.style,
                description: skus.description,
                category: skus.category,
                productGroup: skus.productGroup,
                season: skus.season,
                isNew: skus.isNew,
                unitPrice: skus.unitPrice,
                createdAt: skus.createdAt,
                updatedAt: skus.updatedAt,
            })
            .from(skuColorPanels)
            .innerJoin(skus, eq(skuColorPanels.skuId, skus.id))
            .where(and(
                eq(skuColorPanels.colorPanelId, colorPanelId),
                eq(skuColorPanels.isActive, true)
            ))
            .orderBy(skus.sku);
        return result;
    }

    async getColorPanelsForSku(skuId: number): Promise<ColorPanel[]> {
        const result = await db
            .select({
                id: colorPanels.id,
                vendorId: colorPanels.vendorId,
                merchandiserId: colorPanels.merchandiserId,
                brand: colorPanels.brand,
                vendorName: colorPanels.vendorName,
                collection: colorPanels.collection,
                skuDescription: colorPanels.skuDescription,
                material: colorPanels.material,
                finishName: colorPanels.finishName,
                sheenLevel: colorPanels.sheenLevel,
                finishSystem: colorPanels.finishSystem,
                paintSupplier: colorPanels.paintSupplier,
                validityMonths: colorPanels.validityMonths,
                currentMcpNumber: colorPanels.currentMcpNumber,
                currentApprovalDate: colorPanels.currentApprovalDate,
                currentExpirationDate: colorPanels.currentExpirationDate,
                status: colorPanels.status,
                notes: colorPanels.notes,
                lastReminderSent: colorPanels.lastReminderSent,
                reminderCount: colorPanels.reminderCount,
                createdAt: colorPanels.createdAt,
                updatedAt: colorPanels.updatedAt,
            })
            .from(skuColorPanels)
            .innerJoin(colorPanels, eq(skuColorPanels.colorPanelId, colorPanels.id))
            .where(and(
                eq(skuColorPanels.skuId, skuId),
                eq(skuColorPanels.isActive, true)
            ));
        return result;
    }

    async bulkLinkSkusToColorPanel(colorPanelId: number, skuIds: number[]): Promise<SkuColorPanel[]> {
        if (skuIds.length === 0) return [];
        const links = skuIds.map(skuId => ({
            skuId,
            colorPanelId,
            isActive: true,
        }));
        const result = await db.insert(skuColorPanels).values(links).returning();
        return result;
    }

    async deactivateSkuColorPanelLink(skuId: number, colorPanelId: number): Promise<void> {
        await db.update(skuColorPanels)
            .set({ isActive: false })
            .where(and(
                eq(skuColorPanels.skuId, skuId),
                eq(skuColorPanels.colorPanelId, colorPanelId)
            ));
    }

    // MCP Management Center - Get panels due for renewal
    async getColorPanelsDueForRenewal(filters?: {
        daysUntilExpiry?: number;
        merchandiserId?: number;
        merchandisingManagerId?: number;
        vendorId?: number;
        skuCode?: string;
        status?: string;
    }): Promise<Array<{
        panel: ColorPanel & { skuCount: number };
        workflow: ColorPanelWorkflow | null;
        linkedSkus: Sku[];
        vendor: Vendor | null;
        daysUntilExpiry: number;
        requiresAction: boolean;
    }>> {
        const daysLimit = filters?.daysUntilExpiry ?? 90;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() + daysLimit);

        const conditions: any[] = [
            lte(colorPanels.currentExpirationDate, cutoffDate),
            or(
                eq(colorPanels.status, 'active'),
                eq(colorPanels.status, 'expiring')
            )
        ];

        if (filters?.merchandiserId) {
            conditions.push(eq(colorPanels.merchandiserId, filters.merchandiserId));
        }
        if (filters?.vendorId) {
            conditions.push(eq(colorPanels.vendorId, filters.vendorId));
        }

        const panels = await db
            .select({
                id: colorPanels.id,
                vendorId: colorPanels.vendorId,
                merchandiserId: colorPanels.merchandiserId,
                brand: colorPanels.brand,
                vendorName: colorPanels.vendorName,
                collection: colorPanels.collection,
                skuDescription: colorPanels.skuDescription,
                material: colorPanels.material,
                finishName: colorPanels.finishName,
                sheenLevel: colorPanels.sheenLevel,
                finishSystem: colorPanels.finishSystem,
                paintSupplier: colorPanels.paintSupplier,
                validityMonths: colorPanels.validityMonths,
                currentMcpNumber: colorPanels.currentMcpNumber,
                currentApprovalDate: colorPanels.currentApprovalDate,
                currentExpirationDate: colorPanels.currentExpirationDate,
                status: colorPanels.status,
                notes: colorPanels.notes,
                lastReminderSent: colorPanels.lastReminderSent,
                reminderCount: colorPanels.reminderCount,
                createdAt: colorPanels.createdAt,
                updatedAt: colorPanels.updatedAt,
                skuCount: sql<number>`(
          SELECT COUNT(*) FROM sku_color_panels 
          WHERE sku_color_panels.color_panel_id = color_panels.id 
          AND sku_color_panels.is_active = true
        )`.as('sku_count'),
            })
            .from(colorPanels)
            .where(and(...conditions))
            .orderBy(colorPanels.currentExpirationDate);

        const results = await Promise.all(panels.map(async (panel) => {
            const workflow = await db.select().from(colorPanelWorkflows)
                .where(eq(colorPanelWorkflows.colorPanelId, panel.id))
                .then(rows => rows[0] || null);

            const linkedSkus = await this.getSkusForColorPanel(panel.id);

            const vendor = panel.vendorId
                ? await db.select().from(vendors).where(eq(vendors.id, panel.vendorId)).then(rows => rows[0] || null)
                : null;

            const now = new Date();
            const expiryDate = panel.currentExpirationDate ? new Date(panel.currentExpirationDate) : now;
            const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

            const requiresAction = workflow?.status === 'follow_up_required' ||
                workflow?.status === 'escalated' ||
                (workflow?.status === 'awaiting_response' &&
                    workflow.lastReminderDate &&
                    (now.getTime() - new Date(workflow.lastReminderDate).getTime()) > 3 * 24 * 60 * 60 * 1000);

            return {
                panel: panel as ColorPanel & { skuCount: number },
                workflow,
                linkedSkus,
                vendor,
                daysUntilExpiry,
                requiresAction: !!requiresAction,
            };
        }));

        return results;
    }

    // MCP Workflow operations
    async getColorPanelWorkflow(colorPanelId: number): Promise<ColorPanelWorkflow | undefined> {
        const result = await db.select().from(colorPanelWorkflows)
            .where(eq(colorPanelWorkflows.colorPanelId, colorPanelId));
        return result[0];
    }

    async createColorPanelWorkflow(workflow: InsertColorPanelWorkflow): Promise<ColorPanelWorkflow> {
        const result = await db.insert(colorPanelWorkflows).values(workflow).returning();
        return result[0];
    }

    async updateColorPanelWorkflow(colorPanelId: number, updates: Partial<InsertColorPanelWorkflow>): Promise<ColorPanelWorkflow | undefined> {
        const result = await db.update(colorPanelWorkflows)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(colorPanelWorkflows.colorPanelId, colorPanelId))
            .returning();
        return result[0];
    }

    // MCP Communications operations
    async getColorPanelCommunications(colorPanelId: number): Promise<ColorPanelCommunication[]> {
        return db.select().from(colorPanelCommunications)
            .where(eq(colorPanelCommunications.colorPanelId, colorPanelId))
            .orderBy(desc(colorPanelCommunications.createdAt));
    }

    async createColorPanelCommunication(communication: InsertColorPanelCommunication): Promise<ColorPanelCommunication> {
        const result = await db.insert(colorPanelCommunications).values(communication).returning();
        return result[0];
    }

    async updateColorPanelCommunication(id: number, updates: Partial<InsertColorPanelCommunication>): Promise<ColorPanelCommunication | undefined> {
        const result = await db.update(colorPanelCommunications)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(colorPanelCommunications.id, id))
            .returning();
        return result[0];
    }

    // MCP Messages operations
    async getColorPanelMessages(communicationId: number): Promise<ColorPanelMessage[]> {
        return db.select().from(colorPanelMessages)
            .where(eq(colorPanelMessages.communicationId, communicationId))
            .orderBy(colorPanelMessages.createdAt);
    }

    async createColorPanelMessage(message: InsertColorPanelMessage): Promise<ColorPanelMessage> {
        const result = await db.insert(colorPanelMessages).values(message).returning();
        return result[0];
    }

    // MCP AI Events operations
    async getColorPanelAiEvents(colorPanelId: number): Promise<ColorPanelAiEvent[]> {
        return db.select().from(colorPanelAiEvents)
            .where(eq(colorPanelAiEvents.colorPanelId, colorPanelId))
            .orderBy(desc(colorPanelAiEvents.createdAt));
    }

    async createColorPanelAiEvent(event: InsertColorPanelAiEvent): Promise<ColorPanelAiEvent> {
        const result = await db.insert(colorPanelAiEvents).values(event).returning();
        return result[0];
    }

    async updateColorPanelAiEvent(id: number, updates: Partial<InsertColorPanelAiEvent>): Promise<ColorPanelAiEvent | undefined> {
        const result = await db.update(colorPanelAiEvents)
            .set(updates)
            .where(eq(colorPanelAiEvents.id, id))
            .returning();
        return result[0];
    }

    // MCP Issues operations
    async getColorPanelIssues(colorPanelId: number): Promise<ColorPanelIssue[]> {
        return db.select().from(colorPanelIssues)
            .where(eq(colorPanelIssues.colorPanelId, colorPanelId))
            .orderBy(desc(colorPanelIssues.createdAt));
    }

    async createColorPanelIssue(issue: InsertColorPanelIssue): Promise<ColorPanelIssue> {
        const result = await db.insert(colorPanelIssues).values(issue).returning();
        return result[0];
    }

    async updateColorPanelIssue(id: number, updates: Partial<InsertColorPanelIssue>): Promise<ColorPanelIssue | undefined> {
        const result = await db.update(colorPanelIssues)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(colorPanelIssues.id, id))
            .returning();
        return result[0];
    }

    // MCP Detail - Get comprehensive panel information
    async getColorPanelDetail(colorPanelId: number): Promise<{
        panel: ColorPanel & { skuCount: number };
        vendor: Vendor | null;
        history: ColorPanelHistory[];
        linkedSkus: Sku[];
        workflow: ColorPanelWorkflow | null;
        communications: ColorPanelCommunication[];
        aiEvents: ColorPanelAiEvent[];
        issues: ColorPanelIssue[];
    } | null> {
        const panel = await this.getColorPanelById(colorPanelId);
        if (!panel) return null;

        const [vendor, history, linkedSkus, workflow, communications, aiEvents, issues] = await Promise.all([
            panel.vendorId
                ? db.select().from(vendors).where(eq(vendors.id, panel.vendorId)).then(rows => rows[0] || null)
                : Promise.resolve(null),
            this.getColorPanelHistory(colorPanelId),
            this.getSkusForColorPanel(colorPanelId),
            this.getColorPanelWorkflow(colorPanelId).then(w => w || null),
            this.getColorPanelCommunications(colorPanelId),
            this.getColorPanelAiEvents(colorPanelId),
            this.getColorPanelIssues(colorPanelId),
        ]);

        return {
            panel,
            vendor,
            history,
            linkedSkus,
            workflow,
            communications,
            aiEvents,
            issues,
        };
    }

    // Dashboard Filter Options
    // Shows all staff and vendors who have records, not limited to current year
    async getDashboardFilterOptions() {
        // Get all merchandisers and managers from vendors table (staff with assigned vendors)
        const staffResult = await db.execute<{
            merchandiser: string | null;
            merchandising_manager: string | null;
        }>(sql`
      SELECT DISTINCT
        merchandiser,
        merchandising_manager
      FROM vendors
      WHERE merchandiser IS NOT NULL OR merchandising_manager IS NOT NULL
      ORDER BY merchandising_manager, merchandiser
    `);

        // Get all vendors that have POs, resolved to canonical names via vendors table and aliases
        // Priority: direct match to vendors.name > match via aliases > original PO vendor name
        const vendorResult = await db.execute<{ canonical_name: string }>(sql`
      SELECT DISTINCT 
        COALESCE(v.name, va_v.name, ph.vendor) as canonical_name
      FROM po_headers ph
      LEFT JOIN vendors v ON UPPER(TRIM(ph.vendor)) = UPPER(TRIM(v.name))
      LEFT JOIN vendor_capacity_aliases vca ON UPPER(TRIM(ph.vendor)) = UPPER(TRIM(vca.alias))
      LEFT JOIN vendors va_v ON vca.vendor_id = va_v.id
      WHERE ph.vendor IS NOT NULL AND ph.vendor != ''
      ORDER BY canonical_name
    `);

        // Get all distinct brands (client_division: CB, CB2, C&K)
        const brandResult = await db.execute<{ client_division: string }>(sql`
      SELECT DISTINCT client_division
      FROM po_headers
      WHERE client_division IS NOT NULL AND client_division != ''
      ORDER BY client_division
    `);

        const merchandisers = [...new Set(staffResult.rows
            .map(r => r.merchandiser)
            .filter((m): m is string => m != null && m.trim() !== ''))]
            .sort();

        const managers = [...new Set(staffResult.rows
            .map(r => r.merchandising_manager)
            .filter((m): m is string => m != null && m.trim() !== ''))]
            .sort();

        const vendors = [...new Set(vendorResult.rows
            .map(r => r.canonical_name)
            .filter((v): v is string => v != null && v.trim() !== ''))]
            .sort();

        // Filter out 'CBH' - it's the client/parent company, not a brand
        // Actual brands are: CB, CB2, C&K
        // Also normalize 'CK' to 'C&K' if present
        const brands = [...new Set(brandResult.rows
            .map(r => r.client_division)
            .filter((b): b is string => b != null && b.trim() !== '' && b.toUpperCase() !== 'CBH')
            .map(b => b === 'CK' ? 'C&K' : b))]
            .sort();

        return { merchandisers, managers, vendors, brands };
    }

    // Dashboard KPIs
    async getDashboardKPIs(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
    }) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const ytdStart = filters?.startDate || new Date(currentYear, 0, 1); // January 1st of current year or custom start
        const ytdEnd = filters?.endDate || now;

        // Build reusable filter fragments for SQL queries
        const needsVendorJoin = !!(filters?.merchandiser || filters?.merchandisingManager);
        const vendorJoin = needsVendorJoin
            ? sql`LEFT JOIN vendors v ON v.name = ph.vendor`
            : sql``;

        // Build WHERE clause fragments (only additional filters, not the base ytdStart)
        const buildPoFilters = () => {
            const fragments = [];
            // Only add endDate if provided (ytdStart is already in the main WHERE clause)
            if (filters?.endDate) {
                fragments.push(sql`AND ph.po_date <= ${ytdEnd}`);
            }
            if (filters?.vendor) {
                // Match vendor by canonical name from vendors table or via aliases
                // This handles cases where PO has "GHP INTERNATIONAL" but dropdown shows "GOING STRONG ENTERPRISE"
                fragments.push(sql`AND (
          ph.vendor = ${filters.vendor}
          OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor}))
          OR ph.vendor IN (
            SELECT vca.alias FROM vendor_capacity_aliases vca
            JOIN vendors v ON vca.vendor_id = v.id
            WHERE v.name = ${filters.vendor}
          )
        )`);
            }
            if (filters?.merchandiser) {
                fragments.push(sql`AND v.merchandiser = ${filters.merchandiser}`);
            }
            if (filters?.merchandisingManager) {
                fragments.push(sql`AND v.merchandising_manager = ${filters.merchandisingManager}`);
            }
            if (filters?.client) {
                // Look up full client name from clients table using the code
                fragments.push(sql`AND ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
            }
            // Brand filter using client_division field
            if (filters?.brand) {
                fragments.push(sql`AND (
          CASE 
            WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
            WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
            ELSE 'CB'
          END
        ) = ${filters.brand}`);
            }
            // Join fragments - will return empty sql`` if no filters
            return fragments.length > 0 ? sql.join(fragments, sql` `) : sql``;
        };

        const poFilters = buildPoFilters();

        // Run all queries in parallel for better performance
        const [
            totalResult,
            otdResult,
            otdOriginalResult,
            trueOtdResult,
            lateDaysResult,
            qualityResult,
            cycleTimesResult,
            activeStatusResult
        ] = await Promise.all([
            // Get total orders for YTD (using cancel date for consistency with OTD metrics)
            db.execute<{ count: number }>(sql`
        SELECT COUNT(DISTINCT ph.po_number)::int as count
        FROM po_headers ph
        ${vendorJoin}
        WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) IS NOT NULL
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${ytdStart}
        ${poFilters}
      `),

            // OTD % = Orders shipped on-time using delivery_to_consolidator from shipments table
            // Shipped = has delivery_to_consolidator date, On-time = delivered <= revised/original cancel date
            // Uses MIN(delivery_to_consolidator) to handle split shipments (excludes franchise POs)
            db.execute<{ total: number, on_time: number }>(sql`
        WITH shipped_po_statuses AS (
          SELECT 
            ph.po_number,
            COALESCE(ph.revised_cancel_date, ph.original_cancel_date) as cancel_date,
            MAX(s.delivery_to_consolidator) as first_delivery_date
          FROM po_headers ph
          INNER JOIN shipments s ON s.po_number = ph.po_number
          ${vendorJoin}
          WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) IS NOT NULL
            AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${ytdStart}
            AND s.delivery_to_consolidator IS NOT NULL
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'  -- Exclude franchise POs
            ${poFilters}
          GROUP BY ph.po_number, ph.revised_cancel_date, ph.original_cancel_date
        )
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN first_delivery_date <= cancel_date THEN 1 END)::int as on_time
        FROM shipped_po_statuses
      `),

            // OTD Original % = Orders delivered to consolidator on/before the ORIGINAL cancel date
            // Shipped = has delivery_to_consolidator date (no shipment_status dependency)
            // On-time if first delivery date <= original cancel date, OR if revised_by is Client/Forwarder
            // (non-vendor delays are excused from Original OTD - consistent with chart's getOriginalOtdYoY)
            // IMPORTANT: Filter by SHIP YEAR (from delivery_to_consolidator) to match chart calculations exactly
            db.execute<{ total: number, on_time: number }>(sql`
        WITH shipped_po_original_otd AS (
          SELECT 
            ph.po_number,
            ph.original_cancel_date,
            ph.revised_by,
            MAX(s.delivery_to_consolidator) as first_delivery_date
          FROM po_headers ph
          INNER JOIN shipments s ON s.po_number = ph.po_number
          ${vendorJoin}
          WHERE ph.original_cancel_date IS NOT NULL
            AND s.delivery_to_consolidator IS NOT NULL
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'
            ${poFilters}
          GROUP BY ph.po_number, ph.original_cancel_date, ph.revised_by
          HAVING EXTRACT(YEAR FROM MAX(s.delivery_to_consolidator)) = ${currentYear}
        )
        SELECT 
          COUNT(*)::int as total,
          -- On-time per ORIGINAL: first delivery <= original cancel date,
          -- OR delay was caused by Client/Forwarder (non-vendor delays are excused)
          COUNT(CASE 
            WHEN first_delivery_date <= original_cancel_date THEN 1
            WHEN UPPER(COALESCE(revised_by, '')) IN ('CLIENT', 'FORWARDER') THEN 1
          END)::int as on_time
        FROM shipped_po_original_otd
      `),

            // TRUE OTD % = Orders delivered to consolidator on/before the REVISED cancel date (or original if no revision)
            // Shipped = has delivery_to_consolidator date (no shipment_status dependency)
            // Uses MAX(delivery_to_consolidator) from shipments table (column BH) for on-time determination
            // IMPORTANT: Filter by SHIP YEAR (from delivery_to_consolidator) to match chart calculations exactly
            // Client/Forwarder delays are excluded from late count (same as Original OTD)
            db.execute<{
                shipped_total: number;
                shipped_on_time: number;
                shipped_late: number;
                overdue_unshipped: number;
            }>(sql`
        WITH shipped_po_revised_otd AS (
          SELECT 
            ph.po_number,
            COALESCE(ph.revised_cancel_date, ph.original_cancel_date) as cancel_date,
            ph.revised_by,
            MAX(s.delivery_to_consolidator) as first_delivery_date
          FROM po_headers ph
          INNER JOIN shipments s ON s.po_number = ph.po_number
          ${vendorJoin}
          WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) IS NOT NULL
            AND s.delivery_to_consolidator IS NOT NULL
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'
            ${poFilters}
          GROUP BY ph.po_number, ph.revised_cancel_date, ph.original_cancel_date, ph.revised_by
          HAVING EXTRACT(YEAR FROM MAX(s.delivery_to_consolidator)) = ${currentYear}
        ),
        overdue_unshipped AS (
          -- Orders past cancel date with no delivery_to_consolidator (still actionable)
          -- Note: This still uses cancel date since these are UNSHIPPED orders
          SELECT DISTINCT ph.po_number
          FROM po_headers ph
          LEFT JOIN shipments s ON s.po_number = ph.po_number
          ${vendorJoin}
          WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${ytdStart}
            AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
            AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED')
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'
            AND ph.po_number NOT IN (SELECT po_number FROM shipped_po_revised_otd)
            ${poFilters}
          GROUP BY ph.po_number
          HAVING MAX(s.delivery_to_consolidator) IS NULL
        )
        SELECT 
          (SELECT COUNT(*) FROM shipped_po_revised_otd)::int as shipped_total,
          -- On-time per REVISED: first delivery <= revised cancel date,
          -- OR delay was caused by Client/Forwarder (non-vendor delays are excused)
          (SELECT COUNT(*) FROM shipped_po_revised_otd 
           WHERE first_delivery_date <= cancel_date
              OR UPPER(COALESCE(revised_by, '')) IN ('CLIENT', 'FORWARDER'))::int as shipped_on_time,
          (SELECT COUNT(*) FROM shipped_po_revised_otd 
           WHERE first_delivery_date > cancel_date
             AND UPPER(COALESCE(revised_by, '')) NOT IN ('CLIENT', 'FORWARDER'))::int as shipped_late,
          (SELECT COUNT(*) FROM overdue_unshipped)::int as overdue_unshipped
      `),

            // Calculate average late days (excludes franchise POs)
            // Only counts orders without delivery_to_consolidator that are past their cancel date (still actionable)
            db.execute<{ avg_late_days: number }>(sql`
        WITH shipped_pos AS (
          -- Orders with delivery_to_consolidator are considered shipped
          SELECT DISTINCT po_number
          FROM shipments
          WHERE delivery_to_consolidator IS NOT NULL
        ),
        late_pos AS (
          SELECT 
            ph.po_number,
            MIN(COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) as cancel_date,
            DATE_PART('day', CURRENT_DATE - MIN(COALESCE(ph.revised_cancel_date, ph.original_cancel_date)))::int as days_overdue
          FROM po_headers ph
          ${vendorJoin}
          WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) IS NOT NULL
            AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
            AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${ytdStart}
            AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'  -- Exclude franchise POs
            AND ph.po_number NOT IN (SELECT po_number FROM shipped_pos)
            ${poFilters}
          GROUP BY ph.po_number
        )
        SELECT COALESCE(AVG(days_overdue), 0)::int as avg_late_days
        FROM late_pos
      `),

            // Calculate Quality (First Time Right from inspections)
            db.execute<{ total: number, passed: number }>(sql`
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN LOWER(result) LIKE '%pass%' THEN 1 END)::int as passed
        FROM inspections
      `),

            // Calculate cycle times by order type
            db.execute<{
                order_classification: string;
                is_first_time: boolean;
                avg_days: number;
                order_count: number;
            }>(sql`
        WITH po_cycle_times AS (
          SELECT 
            ph.id,
            CASE WHEN pli.new_style = 'Y' THEN true ELSE false END as is_first_time,
            CASE WHEN pli.seller_style ILIKE '%MTO%' THEN 'MTO' ELSE 'Regular' END as order_classification,
            ph.po_date,
            ph.original_ship_date
          FROM po_headers ph
          LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
          ${vendorJoin}
          WHERE ph.po_date IS NOT NULL
            AND ph.original_ship_date IS NOT NULL
            AND ph.po_date >= ${ytdStart}
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            ${poFilters}
        )
        SELECT 
          order_classification,
          is_first_time,
          COALESCE(AVG(EXTRACT(DAY FROM (original_ship_date - po_date)))::int, 0) as avg_days,
          COUNT(*)::int as order_count
        FROM po_cycle_times
        WHERE original_ship_date > po_date
        GROUP BY order_classification, is_first_time
      `),

            // Calculate on-time, late, and at-risk counts with dollar values (optimized with JOINs instead of EXISTS)
            // At-Risk criteria:
            // 1. Failed final inspection
            // 2. Inline inspection not booked 2 weeks before HOD
            // 3. Final inspection not booked 1 week before HOD
            // 4. QA test report not available 45 days before HOD
            db.execute<{
                on_time_count: number;
                late_count: number;
                at_risk_count: number;
                on_time_value: number;
                late_value: number;
                at_risk_value: number;
            }>(sql`
        WITH on_time_deliveries AS (
          SELECT DISTINCT s.po_id
          FROM shipments s
          INNER JOIN po_headers ph ON ph.id = s.po_id
          WHERE UPPER(COALESCE(s.hod_status, '')) = 'SHIPPED'
             OR (s.delivery_to_consolidator IS NOT NULL AND s.delivery_to_consolidator <= ph.revised_cancel_date)
        ),
        not_delivered_pos AS (
          -- Current active POs only (not shipped, not closed) - excludes YTD filter to show current overall situation
          SELECT 
            ph.id,
            ph.po_number,
            pli.sku,
            ph.total_value,
            ph.revised_ship_date,
            ph.revised_cancel_date,
            EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE))::int as days_until_hod
          FROM po_headers ph
          LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
          ${vendorJoin}
          LEFT JOIN on_time_deliveries otd ON otd.po_id = ph.id
          WHERE UPPER(COALESCE(ph.status, '')) != 'CLOSED'
            AND UPPER(COALESCE(ph.status, '')) != 'SHIPPED'
            AND otd.po_id IS NULL
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'  -- Exclude franchise POs
            ${poFilters}
        ),
        unique_pos AS (
          -- Dedupe to unique POs with their total_value for accurate value aggregation
          SELECT DISTINCT ON (po_number)
            po_number,
            total_value,
            revised_cancel_date,
            revised_ship_date,
            days_until_hod,
            sku
          FROM not_delivered_pos
        ),
        failed_inspections AS (
          SELECT DISTINCT po_number
          FROM inspections
          WHERE inspection_type = 'Final Inspection'
            AND result IN ('Failed', 'Failed - Critical Failure')
        ),
        inline_inspections_booked AS (
          SELECT DISTINCT po_number
          FROM inspections
          WHERE inspection_type ILIKE '%inline%'
        ),
        final_inspections_booked AS (
          SELECT DISTINCT po_number
          FROM inspections
          WHERE inspection_type ILIKE '%final%'
        ),
        qa_passed AS (
          SELECT DISTINCT s.sku
          FROM skus s
          INNER JOIN quality_tests qt ON qt.sku_id = s.id
          WHERE qt.result = 'Pass'
        ),
        pts_submitted AS (
          SELECT DISTINCT po_number
          FROM shipments
          WHERE so_first_submission_date IS NOT NULL
        )
        SELECT
          COUNT(CASE 
            WHEN up.revised_cancel_date IS NOT NULL 
              AND up.revised_cancel_date >= CURRENT_DATE 
            THEN 1 
          END)::int as on_time_count,
          COUNT(CASE 
            WHEN up.revised_cancel_date IS NOT NULL 
              AND up.revised_cancel_date < CURRENT_DATE 
            THEN 1 
          END)::int as late_count,
          -- At-Risk Count: Uses shared AT_RISK_THRESHOLDS constants (see top of file)
          COUNT(CASE 
            WHEN 
              fi.po_number IS NOT NULL  -- Criteria 1: Failed final inspection
              OR (up.days_until_hod <= 14 AND up.days_until_hod > 0 AND iib.po_number IS NULL)  -- Criteria 2: Inline not booked (INLINE_INSPECTION_DAYS=14)
              OR (up.days_until_hod <= 7 AND up.days_until_hod > 0 AND fib.po_number IS NULL)   -- Criteria 3: Final not booked (FINAL_INSPECTION_DAYS=7)
              OR (up.days_until_hod <= 45 AND up.days_until_hod > 0 AND qap.sku IS NULL)  -- Criteria 4: QA not passed (QA_TEST_DAYS=45)
            THEN 1 
          END)::int as at_risk_count,
          -- Dollar values (in cents) for each status - using same unique_pos CTE for alignment
          COALESCE(SUM(CASE 
            WHEN up.revised_cancel_date IS NOT NULL 
              AND up.revised_cancel_date >= CURRENT_DATE 
            THEN up.total_value 
          END), 0)::bigint as on_time_value,
          COALESCE(SUM(CASE 
            WHEN up.revised_cancel_date IS NOT NULL 
              AND up.revised_cancel_date < CURRENT_DATE 
            THEN up.total_value 
          END), 0)::bigint as late_value,
          -- At-Risk Value: Uses same 4 criteria as at_risk_count (see AT_RISK_THRESHOLDS)
          COALESCE(SUM(CASE 
            WHEN 
              fi.po_number IS NOT NULL  -- Criteria 1: Failed final inspection
              OR (up.days_until_hod <= 14 AND up.days_until_hod > 0 AND iib.po_number IS NULL)  -- Criteria 2: Inline not booked
              OR (up.days_until_hod <= 7 AND up.days_until_hod > 0 AND fib.po_number IS NULL)   -- Criteria 3: Final not booked
              OR (up.days_until_hod <= 45 AND up.days_until_hod > 0 AND qap.sku IS NULL)  -- Criteria 4: QA not passed
            THEN up.total_value 
          END), 0)::bigint as at_risk_value
        FROM unique_pos up
        LEFT JOIN failed_inspections fi ON fi.po_number = up.po_number
        LEFT JOIN inline_inspections_booked iib ON iib.po_number = up.po_number
        LEFT JOIN final_inspections_booked fib ON fib.po_number = up.po_number
        LEFT JOIN qa_passed qap ON qap.sku = up.sku
        LEFT JOIN pts_submitted ps ON ps.po_number = up.po_number
      `)
        ]);

        // Process results
        const totalOrders = totalResult.rows[0]?.count || 0;

        const otdPercentage = otdResult.rows[0]?.total > 0
            ? (otdResult.rows[0].on_time / otdResult.rows[0].total) * 100
            : 0;

        const otdOriginalTotal = otdOriginalResult.rows[0]?.total || 0;
        const otdOriginalOnTime = otdOriginalResult.rows[0]?.on_time || 0;
        const otdOriginalPercentage = otdOriginalTotal > 0
            ? (otdOriginalOnTime / otdOriginalTotal) * 100
            : 0;

        const shippedTotal = trueOtdResult.rows[0]?.shipped_total || 0;
        const shippedOnTime = trueOtdResult.rows[0]?.shipped_on_time || 0;
        const shippedLate = trueOtdResult.rows[0]?.shipped_late || 0;
        const overdueUnshipped = trueOtdResult.rows[0]?.overdue_unshipped || 0;
        // TRUE OTD uses only shipped orders in denominator (same as OTD Original)
        const totalShouldHaveShipped = shippedTotal; // Changed: no longer includes overdueUnshipped
        const trueOtdPercentage = shippedTotal > 0
            ? (shippedOnTime / shippedTotal) * 100
            : 0;

        const avgLateDays = lateDaysResult.rows[0]?.avg_late_days || 0;

        const qualityPassRate = qualityResult.rows[0]?.total > 0
            ? (qualityResult.rows[0].passed / qualityResult.rows[0].total) * 100
            : 0;

        // Extract the cycle time results by category
        let firstMtoDays = 0, firstMtoCount = 0;
        let firstRegularDays = 0, firstRegularCount = 0;
        let repeatMtoDays = 0, repeatMtoCount = 0;
        let repeatRegularDays = 0, repeatRegularCount = 0;

        cycleTimesResult.rows.forEach(row => {
            if (row.is_first_time && row.order_classification === 'MTO') {
                firstMtoDays = row.avg_days;
                firstMtoCount = row.order_count;
            } else if (row.is_first_time && row.order_classification === 'Regular') {
                firstRegularDays = row.avg_days;
                firstRegularCount = row.order_count;
            } else if (!row.is_first_time && row.order_classification === 'MTO') {
                repeatMtoDays = row.avg_days;
                repeatMtoCount = row.order_count;
            } else if (!row.is_first_time && row.order_classification === 'Regular') {
                repeatRegularDays = row.avg_days;
                repeatRegularCount = row.order_count;
            }
        });

        const onTimeOrders = activeStatusResult.rows[0]?.on_time_count || 0;
        const lateOrders = activeStatusResult.rows[0]?.late_count || 0;
        const atRiskOrders = activeStatusResult.rows[0]?.at_risk_count || 0;
        const onTimeValue = Number(activeStatusResult.rows[0]?.on_time_value || 0);
        const lateValue = Number(activeStatusResult.rows[0]?.late_value || 0);
        const atRiskValue = Number(activeStatusResult.rows[0]?.at_risk_value || 0);

        return {
            otdPercentage: Math.round(otdPercentage * 10) / 10,
            otdOriginalPercentage: Math.round(otdOriginalPercentage * 10) / 10,
            otdOriginalTotal, // Shipped orders count for OTD Original metric
            otdOriginalOnTime, // On-time count for OTD Original metric
            // TRUE OTD breakdown (includes overdue unshipped orders)
            trueOtdPercentage: Math.round(trueOtdPercentage * 10) / 10,
            qualityPercentage,
            shippedTotal,
            shippedOnTime,
            shippedLate,
            overdueUnshipped,
            totalShouldHaveShipped,
            avgLateDays,
            totalOrders,
            lateOrders,
            onTimeOrders,
            atRiskOrders: Math.max(0, atRiskOrders),
            onTimeValue,
            lateValue,
            atRiskValue,
            qualityPassRate: Math.round(qualityPassRate * 10) / 10,
            firstMtoDays,
            firstMtoCount,
            firstRegularDays,
            firstRegularCount,
            repeatMtoDays,
            repeatMtoCount,
            repeatRegularDays,
            repeatRegularCount,
        };
    }

    // Header KPIs with Year-over-Year comparison (supports filters)
    // When date filters are provided, calculates rolling YoY comparison based on the selected date range
    async getHeaderKPIs(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
    }) {
        const now = new Date();
        const currentYear = now.getFullYear();

        // If custom date range provided, use it for rolling YoY comparison
        // Otherwise default to YTD (Jan 1 to now)
        let ytdStartCurrent: Date;
        let ytdEndCurrent: Date;
        let ytdStartPrevious: Date;
        let ytdEndPrevious: Date;

        if (filters?.startDate || filters?.endDate) {
            // Use custom date range with rolling YoY comparison
            ytdStartCurrent = filters.startDate || new Date(currentYear, 0, 1);
            // Use the full requested range - current year shows ALL POs scheduled for the year
            ytdEndCurrent = filters.endDate || now;

            // Calculate the same date range shifted back by 1 year for YoY comparison
            // Use point-in-time: same date last year (with leap year handling)
            ytdStartPrevious = new Date(ytdStartCurrent);
            ytdStartPrevious.setFullYear(ytdStartPrevious.getFullYear() - 1);

            // For point-in-time YoY comparison, clamp to same date last year
            const ytdEndPreviousRaw = new Date(ytdEndCurrent);
            ytdEndPreviousRaw.setFullYear(ytdEndPreviousRaw.getFullYear() - 1);
            // Handle Feb 29 -> Feb 28 for leap years
            if (ytdEndCurrent.getMonth() === 1 && ytdEndCurrent.getDate() === 29 && ytdEndPreviousRaw.getMonth() === 2) {
                ytdEndPreviousRaw.setDate(0); // Set to last day of February in previous year
            }
            ytdEndPrevious = ytdEndPreviousRaw;
        } else {
            // Default: YTD comparison (Jan 1 to today in each year)
            // This is a key feature showing point-in-time performance comparison
            const previousYear = currentYear - 1;
            const currentMonth = now.getMonth();
            const currentDay = now.getDate();

            ytdStartCurrent = new Date(currentYear, 0, 1);
            ytdEndCurrent = now;
            ytdStartPrevious = new Date(previousYear, 0, 1);
            ytdEndPrevious = new Date(previousYear, currentMonth, currentDay);
        }

        // Check if we need to join vendors table for merchandiser/manager filters
        const needsVendorJoin = !!(filters?.merchandiser || filters?.merchandisingManager);
        const vendorJoinClause = needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``;

        // Build dynamic filter conditions using Drizzle sql template
        const buildFilterConditions = () => {
            const conditions = [];
            if (filters?.merchandiser) {
                conditions.push(sql`v.merchandiser = ${filters.merchandiser}`);
            }
            if (filters?.merchandisingManager) {
                conditions.push(sql`v.merchandising_manager = ${filters.merchandisingManager}`);
            }
            if (filters?.vendor) {
                // Match vendor by canonical name from vendors table or via aliases
                conditions.push(sql`(
          ph.vendor = ${filters.vendor}
          OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor}))
          OR ph.vendor IN (
            SELECT vca.alias FROM vendor_capacity_aliases vca
            JOIN vendors v ON vca.vendor_id = v.id
            WHERE v.name = ${filters.vendor}
          )
        )`);
            }
            if (filters?.client) {
                // Look up full client name from clients table using the code
                conditions.push(sql`ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
            }
            // Brand filter using client_division field
            if (filters?.brand) {
                conditions.push(sql`(
          CASE 
            WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
            WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
            ELSE 'CB'
          END
        ) = ${filters.brand}`);
            }
            return conditions;
        };

        const filterConditions = buildFilterConditions();
        const hasFilters = filterConditions.length > 0;

        // Execute all header KPI queries in parallel for better performance
        const [skuResult, newSkusResult, salesResult, ordersResult, ordersReceivedResult, activePosResult, posOnHandResult, salesBySkuTypeResult, projectionsResult, prevYearEoyShippedResult, prevYearPitUnshippedResult] = await Promise.all([
            // Total SKUs for Year (unique SKUs from orders due to ship OR shipped in the year)
            // Uses cancel_date for "due to ship" determination, includes POs that actually shipped
            // Counts in year the order is due to ship (by cancel date), or if already shipped, by ship year
            // BOTH YEARS: Use point-in-time comparison - only count POs that existed by the comparison date
            // This ensures true YTD-to-YTD comparison for accurate YoY percentages
            db.execute<{ current_count: number, prev_count: number }>(sql`
        SELECT 
          (SELECT COUNT(DISTINCT pli.sku) FROM po_headers ph
           LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
           LEFT JOIN shipments s ON s.po_number = ph.po_number
           ${vendorJoinClause}
           WHERE pli.sku IS NOT NULL AND pli.sku != ''
             AND COALESCE(ph.total_value, 0) > 0
             AND COALESCE(pli.line_total, 0) > 0
             AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
             AND COALESCE(ph.program_description, '') NOT ILIKE '%SMPL%'
             AND COALESCE(ph.program_description, '') NOT ILIKE '%SAMPLE%'
             AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
             -- POINT-IN-TIME: Only count POs that existed by today for true YTD comparison
             AND ph.po_date <= ${ytdEndCurrent}::date
             AND (
               -- Due to ship in current year (by cancel date)
               (COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date >= DATE_TRUNC('year', ${ytdStartCurrent}::date)::date
                AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date < (DATE_TRUNC('year', ${ytdStartCurrent}::date) + INTERVAL '1 year')::date)
               OR
               -- Actually shipped in current year YTD (for rollover POs)
               (s.actual_sailing_date >= DATE_TRUNC('year', ${ytdStartCurrent}::date)::date
                AND s.actual_sailing_date <= ${ytdEndCurrent}::date)
             )
             ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``})::int as current_count,
          (SELECT COUNT(DISTINCT pli.sku) FROM po_headers ph
           LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
           LEFT JOIN shipments s ON s.po_number = ph.po_number
           ${vendorJoinClause}
           WHERE pli.sku IS NOT NULL AND pli.sku != ''
             AND COALESCE(ph.total_value, 0) > 0
             AND COALESCE(pli.line_total, 0) > 0
             AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
             AND COALESCE(ph.program_description, '') NOT ILIKE '%SMPL%'
             AND COALESCE(ph.program_description, '') NOT ILIKE '%SAMPLE%'
             AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
             -- POINT-IN-TIME: Only count POs that existed by same date last year
             AND ph.po_date <= ${ytdEndPrevious}::date
             AND (
               -- Due to ship in previous year (by cancel date)
               (COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date >= DATE_TRUNC('year', ${ytdStartPrevious}::date)::date
                AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date < (DATE_TRUNC('year', ${ytdStartPrevious}::date) + INTERVAL '1 year')::date)
               OR
               -- Actually shipped in previous year (for rollover POs) - only if shipped by same date last year
               (s.actual_sailing_date >= DATE_TRUNC('year', ${ytdStartPrevious}::date)::date
                AND s.actual_sailing_date <= ${ytdEndPrevious}::date)
             )
             ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``})::int as prev_count
      `),

            // New SKUs for Year (SKUs with new_style = 'Y' from orders due to ship OR shipped in the year)
            // Uses cancel_date for "due to ship" determination, includes POs that actually shipped
            // BOTH YEARS: Use point-in-time comparison - only count POs that existed by the comparison date
            // This ensures true YTD-to-YTD comparison for accurate YoY percentages
            db.execute<{ current_count: number, prev_count: number }>(sql`
        SELECT 
          (SELECT COUNT(DISTINCT pli.sku) FROM po_headers ph
           LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
           LEFT JOIN shipments s ON s.po_number = ph.po_number
           ${vendorJoinClause}
           WHERE pli.sku IS NOT NULL AND pli.sku != ''
             AND COALESCE(ph.total_value, 0) > 0
             AND COALESCE(pli.line_total, 0) > 0
             AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
             AND COALESCE(ph.program_description, '') NOT ILIKE '%SMPL%'
             AND COALESCE(ph.program_description, '') NOT ILIKE '%SAMPLE%'
             AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
             AND UPPER(COALESCE(pli.new_style, '')) = 'Y'
             -- POINT-IN-TIME: Only count POs that existed by today for true YTD comparison
             AND ph.po_date <= ${ytdEndCurrent}::date
             AND (
               -- Due to ship in current year (by cancel date)
               (COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date >= DATE_TRUNC('year', ${ytdStartCurrent}::date)::date
                AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date < (DATE_TRUNC('year', ${ytdStartCurrent}::date) + INTERVAL '1 year')::date)
               OR
               -- Actually shipped in current year YTD (for rollover POs)
               (s.actual_sailing_date >= DATE_TRUNC('year', ${ytdStartCurrent}::date)::date
                AND s.actual_sailing_date <= ${ytdEndCurrent}::date)
             )
             ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``})::int as current_count,
          (SELECT COUNT(DISTINCT pli.sku) FROM po_headers ph
           LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
           LEFT JOIN shipments s ON s.po_number = ph.po_number
           ${vendorJoinClause}
           WHERE pli.sku IS NOT NULL AND pli.sku != ''
             AND COALESCE(ph.total_value, 0) > 0
             AND COALESCE(pli.line_total, 0) > 0
             AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
             AND COALESCE(ph.program_description, '') NOT ILIKE '%SMPL%'
             AND COALESCE(ph.program_description, '') NOT ILIKE '%SAMPLE%'
             AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
             AND UPPER(COALESCE(pli.new_style, '')) = 'Y'
             -- POINT-IN-TIME: Only count POs that existed by same date last year
             AND ph.po_date <= ${ytdEndPrevious}::date
             AND (
               -- Due to ship in previous year (by cancel date)
               (COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date >= DATE_TRUNC('year', ${ytdStartPrevious}::date)::date
                AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date < (DATE_TRUNC('year', ${ytdStartPrevious}::date) + INTERVAL '1 year')::date)
               OR
               -- Actually shipped in previous year (for rollover POs) - only if shipped by same date last year
               (s.actual_sailing_date >= DATE_TRUNC('year', ${ytdStartPrevious}::date)::date
                AND s.actual_sailing_date <= ${ytdEndPrevious}::date)
             )
             ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``})::int as prev_count
      `),

            // YTD Total Sales - Uses actual_sailing_date from shipments for shipped visibility
            // Current year: shipments with actual_sailing_date use shipped_value
            // Previous year: historical record by actual_sailing_date only
            db.execute<{ current_sales: string, prev_sales: string }>(sql`
        WITH current_year_shipped AS (
          SELECT COALESCE(SUM(s.shipped_value), 0) as value
          FROM shipments s
          JOIN po_headers ph ON ph.po_number = s.po_number
          ${vendorJoinClause}
          WHERE s.actual_sailing_date >= ${ytdStartCurrent}
            AND s.actual_sailing_date <= ${ytdEndCurrent}
            AND COALESCE(s.shipped_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '%SMPL%'
            AND COALESCE(ph.program_description, '') NOT ILIKE '%SAMPLE%'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``}
        ),
        prev_year_shipped AS (
          SELECT COALESCE(SUM(s.shipped_value), 0) as value
          FROM shipments s
          JOIN po_headers ph ON ph.po_number = s.po_number
          ${vendorJoinClause}
          WHERE s.actual_sailing_date >= ${ytdStartPrevious}
            AND s.actual_sailing_date <= ${ytdEndPrevious}
            AND COALESCE(s.shipped_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '%SMPL%'
            AND COALESCE(ph.program_description, '') NOT ILIKE '%SAMPLE%'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``}
        )
        SELECT 
          (SELECT value FROM current_year_shipped)::text as current_sales,
          (SELECT value FROM prev_year_shipped)::text as prev_sales
      `),

            // YTD Shipped Orders (count of UNIQUE shipped POs with ANY shipment in period)
            // Count all unique POs that had at least one shipment in the YTD period
            // Group by estimated_vessel_etd (ETD) for earlier visibility, fallback to actual_sailing_date
            // NOTE: Franchise POs (089-) ARE included in shipped orders count, only excluded from late/OTD metrics
            db.execute<{ current_count: number, prev_count: number }>(sql`
        SELECT 
          COUNT(DISTINCT CASE 
            WHEN COALESCE(s.estimated_vessel_etd, s.actual_sailing_date) >= ${ytdStartCurrent}
              AND COALESCE(s.estimated_vessel_etd, s.actual_sailing_date) <= ${ytdEndCurrent}
            THEN ph.po_number END)::int as current_count,
          COUNT(DISTINCT CASE 
            WHEN COALESCE(s.estimated_vessel_etd, s.actual_sailing_date) >= ${ytdStartPrevious}
              AND COALESCE(s.estimated_vessel_etd, s.actual_sailing_date) <= ${ytdEndPrevious}
            THEN ph.po_number END)::int as prev_count
        FROM shipments s
        JOIN po_headers ph ON ph.po_number = s.po_number
        ${vendorJoinClause}
        WHERE COALESCE(s.estimated_vessel_etd, s.actual_sailing_date) IS NOT NULL
          ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``}
      `),

            // Total POs for Year (count of ALL POs due to ship OR shipped in the year)
            // Counts orders in the year they are due to ship (by cancel date) OR actually ship (for rollovers)
            // This represents the total workload volume for the year
            // BOTH YEARS: Use point-in-time comparison - only count POs that existed by the comparison date
            // This ensures true YTD-to-YTD comparison for accurate YoY percentages
            db.execute<{ current_count: number, prev_count: number }>(sql`
        SELECT 
          COUNT(DISTINCT CASE 
            WHEN (
              -- POINT-IN-TIME: PO must have existed by today for true YTD comparison
              ph.po_date <= ${ytdEndCurrent}::date
              AND (
                -- Due to ship in current year (by cancel date)
                (COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date >= DATE_TRUNC('year', ${ytdStartCurrent}::date)::date
                 AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date < (DATE_TRUNC('year', ${ytdStartCurrent}::date) + INTERVAL '1 year')::date)
                OR
                -- Actually shipped in current year YTD (for rollover POs)
                EXISTS (SELECT 1 FROM shipments s WHERE s.po_number = ph.po_number 
                  AND s.actual_sailing_date >= DATE_TRUNC('year', ${ytdStartCurrent}::date)::date
                  AND s.actual_sailing_date <= ${ytdEndCurrent}::date)
              )
            )
            THEN ph.po_number END)::int as current_count,
          COUNT(DISTINCT CASE 
            WHEN (
              -- POINT-IN-TIME: PO must have existed by same date last year
              ph.po_date <= ${ytdEndPrevious}::date
              AND (
                -- Due to ship in previous year (by cancel date)
                (COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date >= DATE_TRUNC('year', ${ytdStartPrevious}::date)::date
                 AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date < (DATE_TRUNC('year', ${ytdStartPrevious}::date) + INTERVAL '1 year')::date)
                OR
                -- Actually shipped in previous year (for rollover POs) - only if shipped by same date last year
                EXISTS (SELECT 1 FROM shipments s WHERE s.po_number = ph.po_number 
                  AND s.actual_sailing_date >= DATE_TRUNC('year', ${ytdStartPrevious}::date)::date
                  AND s.actual_sailing_date <= ${ytdEndPrevious}::date)
              )
            )
            THEN ph.po_number END)::int as prev_count
        FROM po_headers ph
        ${vendorJoinClause}
        WHERE COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '%SMPL%'
          AND COALESCE(ph.program_description, '') NOT ILIKE '%SAMPLE%'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``}
      `),

            // Total Active POs (excludes Closed/Shipped)
            db.execute<{ current_count: number, prev_count: number }>(sql`
        SELECT 
          COUNT(CASE 
            WHEN ph.po_date >= ${ytdStartCurrent} AND ph.po_date <= ${ytdEndCurrent}
              AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED')
            THEN 1 
          END)::int as current_count,
          COUNT(CASE 
            WHEN ph.po_date >= ${ytdStartPrevious} AND ph.po_date <= ${ytdEndPrevious}
              AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED')
            THEN 1 
          END)::int as prev_count
        FROM po_headers ph
        ${vendorJoinClause}
        WHERE COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``}
      `),

            // YTD POs Pending (remaining value of POs due to ship in full calendar year)
            // Uses formula: GREATEST(0, total_value - shipped_value) to show remaining unshipped amount
            // Filters by cancel_date within the calendar year (full year scope)
            // BOTH YEARS: Use point-in-time comparison - only count POs that existed by the comparison date
            db.execute<{ current_value: string, prev_value: string }>(sql`
        SELECT 
          COALESCE(SUM(CASE 
            WHEN ph.po_date <= ${ytdEndCurrent}::date
              AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date >= DATE_TRUNC('year', ${ytdStartCurrent}::date)::date
              AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date < (DATE_TRUNC('year', ${ytdStartCurrent}::date) + INTERVAL '1 year')::date
            THEN GREATEST(0, COALESCE(ph.total_value, 0) - COALESCE(ph.shipped_value, 0)) ELSE 0 END), 0) as current_value,
          COALESCE(SUM(CASE 
            WHEN ph.po_date <= ${ytdEndPrevious}::date
              AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date >= DATE_TRUNC('year', ${ytdStartPrevious}::date)::date
              AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date < (DATE_TRUNC('year', ${ytdStartPrevious}::date) + INTERVAL '1 year')::date
            THEN GREATEST(0, COALESCE(ph.total_value, 0) - COALESCE(ph.shipped_value, 0)) ELSE 0 END), 0) as prev_value
        FROM po_headers ph
        ${vendorJoinClause}
        WHERE COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '%SMPL%'
          AND COALESCE(ph.program_description, '') NOT ILIKE '%SAMPLE%'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``}
      `),

            // YTD Sales split by New SKUs vs Existing SKUs
            // New SKU = first ordered in current year (no orders before Jan 1 of current year)
            // Existing SKU = was ordered before current year
            // Use cancel_date (when order was DUE) for YTD comparison to match TRUE OTD metric
            // Use shipped_value from OS340 "Shipped (USD)" column for actual shipped dollars
            // Filter by actual_sailing_date IS NOT NULL (from shipments table) to determine if shipped
            // NOTE: Franchise POs (089-) ARE included in shipped sales, only excluded from late/OTD metrics
            db.execute<{ new_sku_sales: string, existing_sku_sales: string }>(sql`
        WITH unique_shipped_pos AS (
          SELECT DISTINCT ON (ph.po_number) 
            ph.po_number,
            pli.sku,
            ph.shipped_value, 
            COALESCE(ph.revised_cancel_date, ph.original_cancel_date) as cancel_date
          FROM po_headers ph
          LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
          ${vendorJoinClause}
          WHERE COALESCE(ph.shipped_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.client = 'Euromarket Designs, Inc.'
            AND pli.sku IS NOT NULL AND pli.sku != ''
            AND EXISTS (
              SELECT 1 FROM shipments s 
              WHERE s.po_number = ph.po_number 
              AND s.actual_sailing_date IS NOT NULL
            )
            ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``}
          ORDER BY ph.po_number, ph.id
        ),
        new_skus AS (
          SELECT DISTINCT pli.sku FROM po_headers ph
          LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
          WHERE pli.sku IS NOT NULL AND pli.sku != ''
            AND ph.po_date >= ${ytdStartCurrent}
            AND NOT EXISTS (
              SELECT 1 FROM po_headers prev_ph
              LEFT JOIN po_line_items prev_pli ON prev_pli.po_header_id = prev_ph.id
              WHERE prev_pli.sku = pli.sku 
                AND prev_ph.po_date < ${ytdStartCurrent}
                AND prev_pli.sku IS NOT NULL AND prev_pli.sku != ''
            )
        )
        SELECT 
          COALESCE(SUM(CASE 
            WHEN usp.cancel_date >= ${ytdStartCurrent} AND usp.cancel_date <= ${ytdEndCurrent} 
              AND usp.sku IN (SELECT sku FROM new_skus) 
            THEN usp.shipped_value ELSE 0 END), 0) as new_sku_sales,
          COALESCE(SUM(CASE 
            WHEN usp.cancel_date >= ${ytdStartCurrent} AND usp.cancel_date <= ${ytdEndCurrent} 
              AND usp.sku NOT IN (SELECT sku FROM new_skus) 
            THEN usp.shipped_value ELSE 0 END), 0) as existing_sku_sales
        FROM unique_shipped_pos usp
      `),

            // YTD Projections (from FURNITURE/HOME-GOODS imports via active_projections)
            // Sum of projection_value from active_projections for the year
            // ONLY include CB, CB2, C&K brand rows
            // EXCLUDES matched/partial projections to avoid double-counting with POs already in pipeline
            // Data is stored in CENTS (consistent with OS340 data)
            // NOW SUPPORTS FILTERS: vendor (with alias resolution via EXISTS), merchandiser, merchandising manager, brand
            // Uses EXISTS for alias lookup to avoid row duplication when vendors have multiple aliases
            // Note: Shows UNMATCHED projections only (matched ones are already counted in Unshipped POs)
            // active_projections already represents latest state - no need for latest_batches CTE
            db.execute<{ current_value: string, prev_value: string }>(sql`
        SELECT 
          COALESCE(SUM(CASE 
            WHEN ap.year = ${currentYear}
            THEN COALESCE(ap.projection_value, 0) ELSE 0 END), 0) as current_value,
          COALESCE(SUM(CASE 
            WHEN ap.year = ${currentYear - 1}
            THEN COALESCE(ap.projection_value, 0) ELSE 0 END), 0) as prev_value
        FROM active_projections ap
        JOIN vendors v ON ap.vendor_id = v.id
        WHERE ap.year IN (${currentYear}, ${currentYear - 1})
          AND ap.brand IN ('CB', 'CB2', 'C&K')
          AND COALESCE(ap.match_status, 'unmatched') NOT IN ('matched', 'partial')
          ${filters?.client ? sql`AND ap.client_id = (SELECT id FROM clients WHERE code = ${filters.client})` : sql``}
          ${filters?.brand ? sql`AND ap.brand = ${filters.brand}` : sql``}
          ${filters?.vendor ? sql`AND (
            LOWER(${filters.vendor}) ILIKE '%' || LOWER(TRIM(v.name)) || '%'
            OR LOWER(TRIM(v.name)) ILIKE '%' || LOWER(${filters.vendor}) || '%'
            OR UPPER(TRIM(${filters.vendor})) = UPPER(TRIM(v.name))
            OR EXISTS (
              SELECT 1 FROM vendor_capacity_aliases vca 
              WHERE vca.vendor_id = v.id 
              AND UPPER(TRIM(vca.alias)) = UPPER(TRIM(${filters.vendor}))
            )
          )` : sql``}
          ${filters?.merchandiser ? sql`AND v.merchandiser = ${filters.merchandiser}` : sql``}
          ${filters?.merchandisingManager ? sql`AND v.merchandising_manager = ${filters.merchandisingManager}` : sql``}
      `),

            // Previous Year End-of-Year (EOY) Total Shipped
            // FULL YEAR shipped total from previous year - used as baseline for YTD Potential YoY comparison
            // This shows how current potential pipeline compares to what was actually achieved last year
            db.execute<{ prev_year_eoy_shipped: string }>(sql`
        SELECT COALESCE(SUM(COALESCE(s.shipped_value, 0)), 0) as prev_year_eoy_shipped
        FROM shipments s
        JOIN po_headers ph ON ph.po_number = s.po_number
        ${vendorJoinClause}
        WHERE s.actual_sailing_date IS NOT NULL
          AND s.actual_sailing_date >= DATE_TRUNC('year', ${ytdStartPrevious}::date)::date
          AND s.actual_sailing_date < (DATE_TRUNC('year', ${ytdStartPrevious}::date) + INTERVAL '1 year')::date
          AND COALESCE(s.shipped_value, 0) > 0
          ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``}
      `),

            // Point-in-Time Unshipped Comparison - remaining unshipped value as of same date last year
            // Uses same logic as current year: GREATEST(0, total_value - shipped_value)
            // Filters by cancel_date within full calendar year to match current year scope
            // NOTE: shipped_value reflects CURRENT state, not historical, so for past years this effectively shows $0
            // (since those orders have fully shipped). This is expected behavior - a true historical comparison
            // would require snapshot data which we don't have.
            db.execute<{ prev_year_point_in_time_unshipped: string }>(sql`
        SELECT COALESCE(SUM(
          CASE 
            WHEN ph.po_date <= ${ytdEndPrevious}::date
              AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date >= DATE_TRUNC('year', ${ytdStartPrevious}::date)::date
              AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date)::date < (DATE_TRUNC('year', ${ytdStartPrevious}::date) + INTERVAL '1 year')::date
            THEN GREATEST(0, COALESCE(ph.total_value, 0) - COALESCE(ph.shipped_value, 0)) 
            ELSE 0 
          END
        ), 0) as prev_year_point_in_time_unshipped
        FROM po_headers ph
        ${vendorJoinClause}
        WHERE COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '%SMPL%'
          AND COALESCE(ph.program_description, '') NOT ILIKE '%SAMPLE%'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          ${hasFilters ? sql`AND ${sql.join(filterConditions, sql` AND `)}` : sql``}
      `)
        ]);

        // Process results (all values in cents - frontend divides by 100)
        const totalSkus = skuResult.rows[0]?.current_count || 0;
        const totalSkusPrevYear = skuResult.rows[0]?.prev_count || 0;
        const newSkusYtd = newSkusResult.rows[0]?.current_count || 0;
        const newSkusYtdPrevYear = newSkusResult.rows[0]?.prev_count || 0;
        const ytdTotalSales = parseFloat(salesResult.rows[0]?.current_sales || '0');
        const ytdTotalSalesPrevYear = parseFloat(salesResult.rows[0]?.prev_sales || '0');
        const ytdTotalOrders = ordersResult.rows[0]?.current_count || 0;
        const ytdTotalOrdersPrevYear = ordersResult.rows[0]?.prev_count || 0;
        // Total POs for Year (all POs due to ship OR shipped in the year)
        const totalPosForYear = ordersReceivedResult.rows[0]?.current_count || 0;
        const totalPosForYearPrevYear = ordersReceivedResult.rows[0]?.prev_count || 0;
        const ytdTotalPos = ytdTotalOrders;
        const ytdTotalPosPrevYear = ytdTotalOrdersPrevYear;
        const totalActivePOs = activePosResult.rows[0]?.current_count || 0;
        const totalActivePosPrevYear = activePosResult.rows[0]?.prev_count || 0;
        // POs Unshipped - total value of POs due to ship in calendar year that haven't shipped yet (in cents)
        const ytdPosUnshipped = parseFloat(posOnHandResult.rows[0]?.current_value || '0');
        // Point-in-time comparison: unshipped POs as of same date last year
        const ytdPosUnshippedPrevYear = parseFloat(prevYearPitUnshippedResult.rows[0]?.prev_year_point_in_time_unshipped || '0');
        // Sales split by new vs existing SKUs (in cents)
        const ytdSalesNewSkus = parseFloat(salesBySkuTypeResult.rows[0]?.new_sku_sales || '0');
        const ytdSalesExistingSkus = parseFloat(salesBySkuTypeResult.rows[0]?.existing_sku_sales || '0');
        // Projections from FURNITURE/HOME-GOODS imports (active_projections table - already in cents)
        // Projections are only meaningful for the CURRENT calendar year
        // Past year projections are zeroed out - they're redundant as they would have converted to actual POs
        // Add 12 hours to the date to normalize timezone edge cases (Jan 1 at midnight can appear as Dec 31)
        const normalizedStartDate = new Date(ytdStartCurrent.getTime() + 12 * 60 * 60 * 1000);
        const viewingYear = normalizedStartDate.getFullYear();
        const rawProjections = parseFloat(projectionsResult.rows[0]?.current_value || '0');
        const isViewingCurrentYear = viewingYear === currentYear;
        const ytdProjections = isViewingCurrentYear ? rawProjections : 0;
        const ytdProjectionsPrevYear = 0; // Past projections are always redundant
        // YTD Potential = Shipped + Unshipped + Projections (total potential volume for the year)
        const ytdPotential = ytdTotalSales + ytdPosUnshipped + ytdProjections;
        // Previous year END-OF-YEAR shipped total (full year) - used as baseline for YTD Potential YoY
        const prevYearEoyShipped = parseFloat(prevYearEoyShippedResult.rows[0]?.prev_year_eoy_shipped || '0');
        const ytdPotentialPrevYear = prevYearEoyShipped;

        return {
            totalSkus,
            totalSkusPrevYear,
            newSkusYtd,
            newSkusYtdPrevYear,
            ytdTotalSales,
            ytdTotalSalesPrevYear,
            ytdTotalOrders,
            ytdTotalOrdersPrevYear,
            // Total POs for Year (all POs due to ship or shipped in the year)
            totalPosForYear,
            totalPosForYearPrevYear,
            ytdTotalPos,
            ytdTotalPosPrevYear,
            totalActivePOs,
            totalActivePosPrevYear,
            ytdPosUnshipped,
            ytdPosUnshippedPrevYear,
            // Sales split by SKU type
            ytdSalesNewSkus,
            ytdSalesExistingSkus,
            // Projections from Vendor Capacity tracker
            ytdProjections,
            ytdProjectionsPrevYear,
            // YTD Potential (Shipped + Unshipped + Projections)
            ytdPotential,
            ytdPotentialPrevYear,
            // Derived field for convenience
            totalSales: ytdTotalSales,
            shippedOrders: ytdTotalOrders,
            newSkus: newSkusYtd,
        };
    }

    async getKpiMonthlyTrends(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<{
        skusTrend: Array<{ month: string; value: number }>;
        newSkusTrend: Array<{ month: string; value: number }>;
        salesTrend: Array<{ month: string; value: number }>;
        ordersTrend: Array<{ month: string; value: number }>;
        otdOriginalTrend: Array<{ month: string; value: number }>;
        trueOtdTrend: Array<{ month: string; value: number }>;
        qualityTrend: Array<{ month: string; value: number }>;
        avgLateTrend: Array<{ month: string; value: number }>;
        skusYoy: { current: number; previous: number; percent: number; isPositive: boolean } | null;
        newSkusYoy: { current: number; previous: number; percent: number; isPositive: boolean } | null;
        salesYoy: { current: number; previous: number; percent: number; isPositive: boolean } | null;
        ordersYoy: { current: number; previous: number; percent: number; isPositive: boolean } | null;
        otdOriginalYoy: { current: number; previous: number; percent: number; isPositive: boolean } | null;
        trueOtdYoy: { current: number; previous: number; percent: number; isPositive: boolean } | null;
        qualityYoy: { current: number; previous: number; percent: number; isPositive: boolean } | null;
        avgLateYoy: { current: number; previous: number; percent: number; isPositive: boolean } | null;
    }> {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        const needsVendorJoin = !!(filters?.merchandiser || filters?.merchandisingManager);
        const vendorJoin = needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``;

        const buildPoFilters = (includeDateRange: boolean = false) => {
            const fragments = [];
            if (filters?.client) {
                fragments.push(sql`AND ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
            }
            if (filters?.vendor) {
                fragments.push(sql`AND ph.vendor = ${filters.vendor}`);
            }
            if (filters?.brand) {
                fragments.push(sql`AND (
          CASE 
            WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
            WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
            ELSE 'CB'
          END
        ) = ${filters.brand}`);
            }
            if (filters?.merchandiser) {
                fragments.push(sql`AND v.merchandiser = ${filters.merchandiser}`);
            }
            if (filters?.merchandisingManager) {
                fragments.push(sql`AND v.merchandising_manager = ${filters.merchandisingManager}`);
            }
            if (includeDateRange) {
                if (filters?.startDate) {
                    fragments.push(sql`AND ph.po_date >= ${filters.startDate}`);
                }
                if (filters?.endDate) {
                    fragments.push(sql`AND ph.po_date <= ${filters.endDate}`);
                }
            }
            return fragments.length > 0 ? sql.join(fragments, sql` `) : sql``;
        };

        const poFilters = buildPoFilters(false);
        const poFiltersWithDates = buildPoFilters(true);

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        const calculateYoy = (current: number, previous: number): { current: number; previous: number; percent: number; isPositive: boolean } | null => {
            if (previous === 0 && current === 0) return null;
            if (previous === 0) return { current, previous, percent: 100, isPositive: current > 0 };
            const percent = ((current - previous) / Math.abs(previous)) * 100;
            return { current, previous, percent, isPositive: percent >= 0 };
        };

        // Helper to fill missing months with zeros
        const fillAllMonths = (data: { month_num: number; value: number }[], upToMonth: number): Array<{ month: string; value: number }> => {
            const monthMap = new Map<number, number>();
            data.forEach(r => monthMap.set(r.month_num, Number(r.value)));
            const result: Array<{ month: string; value: number }> = [];
            for (let m = 1; m <= upToMonth; m++) {
                result.push({ month: months[m - 1], value: monthMap.get(m) || 0 });
            }
            return result;
        };

        // Current month (1-indexed) - only show data up to current month
        const maxMonth = currentMonth + 1;

        const ytdStartCurrent = new Date(currentYear, 0, 1);
        const ytdEndCurrent = now;
        const ytdStartPrevious = new Date(currentYear - 1, 0, 1);
        const ytdEndPrevious = new Date(currentYear - 1, currentMonth, now.getDate());

        // Execute all trend queries in parallel for better performance
        const [
            skusTrendResult,
            salesTrendResult,
            ordersTrendResult,
            trueOtdTrendResult,
            otdOriginalTrendResult,
            qualityTrendResult,
            avgLateTrendResult,
            skusYoyCurrent,
            skusYoyPrev
        ] = await Promise.all([
            // SKUs trend by month
            db.execute<{ month_num: number; value: number }>(sql`
        SELECT 
          EXTRACT(MONTH FROM ph.po_date)::int as month_num,
          COUNT(DISTINCT pli.sku)::int as value
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        ${vendorJoin}
        WHERE pli.sku IS NOT NULL AND pli.sku != ''
          AND EXTRACT(YEAR FROM ph.po_date) = ${currentYear}
          AND EXTRACT(MONTH FROM ph.po_date) <= ${maxMonth}
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          ${poFilters}
        GROUP BY month_num
        ORDER BY month_num
      `),

            // Sales trend: Group by cancel date month (when due)
            // Use subquery with DISTINCT ON to avoid double-counting POs
            db.execute<{ month_num: number; value: number }>(sql`
        WITH unique_pos AS (
          SELECT DISTINCT ON (ph.po_number)
            ph.po_number,
            ph.total_value,
            ph.revised_cancel_date
          FROM po_headers ph
          ${vendorJoin}
          WHERE EXTRACT(YEAR FROM ph.revised_cancel_date) = ${currentYear}
            AND EXTRACT(MONTH FROM ph.revised_cancel_date) <= ${maxMonth}
            AND ph.shipment_status IN ('On-Time', 'Late')
            AND ph.client = 'Euromarket Designs, Inc.'
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            ${poFilters}
          ORDER BY ph.po_number, ph.id
        )
        SELECT 
          EXTRACT(MONTH FROM revised_cancel_date)::int as month_num,
          COALESCE(SUM(total_value), 0)::numeric as value
        FROM unique_pos
        GROUP BY month_num
        ORDER BY month_num
      `),

            // Orders shipped trend: Group by cancel date month (when due)
            db.execute<{ month_num: number; value: number }>(sql`
        SELECT 
          EXTRACT(MONTH FROM ph.revised_cancel_date)::int as month_num,
          COUNT(DISTINCT ph.po_number)::int as value
        FROM po_headers ph
        ${vendorJoin}
        WHERE EXTRACT(YEAR FROM ph.revised_cancel_date) = ${currentYear}
          AND EXTRACT(MONTH FROM ph.revised_cancel_date) <= ${maxMonth}
          AND ph.shipment_status IN ('On-Time', 'Late')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          ${poFilters}
        GROUP BY month_num
        ORDER BY month_num
      `),

            // TRUE OTD Trend
            db.execute<{ month_num: number; value: number }>(sql`
        WITH monthly_stats AS (
          SELECT 
            EXTRACT(MONTH FROM ph.revised_cancel_date)::int as month_num,
            COUNT(CASE WHEN ph.shipment_status = 'On-Time' THEN 1 END) as on_time,
            COUNT(CASE WHEN ph.shipment_status IN ('On-Time', 'Late') THEN 1 END) as shipped,
            COUNT(CASE WHEN ph.revised_cancel_date < CURRENT_DATE 
              AND (ph.shipment_status IS NULL OR ph.shipment_status NOT IN ('On-Time', 'Late'))
              AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED')
              THEN 1 END) as overdue
          FROM po_headers ph
          ${vendorJoin}
          WHERE EXTRACT(YEAR FROM ph.revised_cancel_date) = ${currentYear}
            AND EXTRACT(MONTH FROM ph.revised_cancel_date) <= ${maxMonth}
            AND ph.revised_cancel_date IS NOT NULL
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'
            ${poFilters}
          GROUP BY month_num
        )
        SELECT 
          month_num,
          CASE WHEN (shipped + overdue) > 0 
            THEN ROUND((on_time::numeric / (shipped + overdue)::numeric) * 100, 1)
            ELSE 0 
          END as value
        FROM monthly_stats
        ORDER BY month_num
      `),

            // OTD Original Trend - orders shipped on/before ORIGINAL cancel date (no extensions)
            db.execute<{ month_num: number; value: number }>(sql`
        WITH monthly_stats AS (
          SELECT 
            EXTRACT(MONTH FROM ph.original_cancel_date)::int as month_num,
            COUNT(CASE 
              WHEN ph.revised_cancel_date <= ph.original_cancel_date AND ph.shipment_status = 'On-Time' 
              THEN 1 
            END) as on_time,
            COUNT(CASE WHEN ph.shipment_status IN ('On-Time', 'Late') THEN 1 END) as shipped
          FROM po_headers ph
          ${vendorJoin}
          WHERE EXTRACT(YEAR FROM ph.original_cancel_date) = ${currentYear}
            AND EXTRACT(MONTH FROM ph.original_cancel_date) <= ${maxMonth}
            AND ph.original_cancel_date IS NOT NULL
            AND ph.revised_cancel_date IS NOT NULL
            AND ph.shipment_status IN ('On-Time', 'Late')
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'
            ${poFilters}
          GROUP BY month_num
        )
        SELECT 
          month_num,
          CASE WHEN shipped > 0 
            THEN ROUND((on_time::numeric / shipped::numeric) * 100, 1)
            ELSE 0 
          END as value
        FROM monthly_stats
        ORDER BY month_num
      `),

            // Quality Pass Rate trend by inspection date
            db.execute<{ month_num: number; value: number }>(sql`
        SELECT 
          EXTRACT(MONTH FROM i.inspection_date)::int as month_num,
          CASE WHEN COUNT(*) > 0 
            THEN ROUND((COUNT(CASE WHEN UPPER(i.result) NOT IN ('FAILED', 'FAILED - CRITICAL FAILURE') THEN 1 END)::numeric / COUNT(*)::numeric) * 100, 1)
            ELSE 0 
          END as value
        FROM inspections i
        WHERE i.inspection_type = 'Final Inspection'
          AND EXTRACT(YEAR FROM i.inspection_date) = ${currentYear}
          AND EXTRACT(MONTH FROM i.inspection_date) <= ${maxMonth}
          AND i.inspection_date IS NOT NULL
        GROUP BY month_num
        ORDER BY month_num
      `),

            // Average Late Days trend
            db.execute<{ month_num: number; value: number }>(sql`
        SELECT 
          EXTRACT(MONTH FROM ph.revised_cancel_date)::int as month_num,
          COALESCE(AVG(
            CASE 
              WHEN ph.shipment_status = 'Late' THEN 
                GREATEST(1, EXTRACT(DAY FROM (CURRENT_DATE - ph.revised_cancel_date))::int)
              WHEN ph.revised_cancel_date < CURRENT_DATE 
                AND (ph.shipment_status IS NULL OR ph.shipment_status NOT IN ('On-Time', 'Late'))
                AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED')
              THEN EXTRACT(DAY FROM (CURRENT_DATE - ph.revised_cancel_date))::int
              ELSE NULL
            END
          ), 0)::int as value
        FROM po_headers ph
        ${vendorJoin}
        WHERE EXTRACT(YEAR FROM ph.revised_cancel_date) = ${currentYear}
          AND EXTRACT(MONTH FROM ph.revised_cancel_date) <= ${maxMonth}
          AND ph.revised_cancel_date IS NOT NULL
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          ${poFilters}
        GROUP BY month_num
        ORDER BY month_num
      `),

            // SKUs YoY current year
            db.execute<{ value: number }>(sql`
        SELECT COUNT(DISTINCT pli.sku)::int as value
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        ${vendorJoin}
        WHERE pli.sku IS NOT NULL 
          AND ph.po_date >= ${ytdStartCurrent} AND ph.po_date <= ${ytdEndCurrent}
          AND COALESCE(ph.total_value, 0) > 0 
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %' 
          ${poFilters}
      `),

            // SKUs YoY previous year
            db.execute<{ value: number }>(sql`
        SELECT COUNT(DISTINCT pli.sku)::int as value
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        ${vendorJoin}
        WHERE pli.sku IS NOT NULL 
          AND ph.po_date >= ${ytdStartPrevious} AND ph.po_date <= ${ytdEndPrevious}
          AND COALESCE(ph.total_value, 0) > 0 
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %' 
          ${poFilters}
      `)
        ]);

        // Process results
        const skusTrend = fillAllMonths(skusTrendResult.rows, maxMonth);
        const salesTrend = fillAllMonths(salesTrendResult.rows, maxMonth);
        const ordersTrend = fillAllMonths(ordersTrendResult.rows, maxMonth);
        const trueOtdTrend = fillAllMonths(trueOtdTrendResult.rows, maxMonth);
        const otdOriginalTrend = fillAllMonths(otdOriginalTrendResult.rows, maxMonth);
        const qualityTrend = fillAllMonths(qualityTrendResult.rows, maxMonth);
        const avgLateTrend = fillAllMonths(avgLateTrendResult.rows, maxMonth);
        const skusYoy = calculateYoy(skusYoyCurrent.rows[0]?.value || 0, skusYoyPrev.rows[0]?.value || 0);

        return {
            skusTrend,
            newSkusTrend: skusTrend,
            salesTrend,
            ordersTrend,
            otdOriginalTrend,
            trueOtdTrend,
            qualityTrend,
            avgLateTrend,
            skusYoy,
            newSkusYoy: skusYoy,
            salesYoy: null,
            ordersYoy: null,
            otdOriginalYoy: null,
            trueOtdYoy: null,
            qualityYoy: null,
            avgLateYoy: null,
        };
    }

    // Vendor Performance - uses TRUE OTD formula with OS 340 shipment_status
    // TRUE OTD = On-Time Shipped / (Total Shipped + Overdue Unshipped)
    // Uses OS 340 shipment_status field ('On-Time' or 'Late') for shipped status
    async getVendorPerformance() {
        const currentYear = new Date().getFullYear();
        const ytdStart = new Date(currentYear, 0, 1);

        const result = await db.execute<{
            vendor: string;
            shipped_total: number;
            shipped_on_time: number;
            overdue_unshipped: number;
            true_otd_pct: number;
        }>(sql`
      WITH shipped_orders AS (
        -- Orders shipped per OS 340 shipment_status ('On-Time' or 'Late')
        SELECT DISTINCT 
          ph.vendor,
          ph.id,
          CASE WHEN ph.shipment_status = 'On-Time' THEN 1 ELSE 0 END as is_on_time
        FROM po_headers ph
        WHERE ph.vendor IS NOT NULL
          AND ph.po_date >= ${ytdStart}
          AND ph.revised_cancel_date IS NOT NULL
          AND ph.shipment_status IN ('On-Time', 'Late')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
      ),
      overdue_unshipped AS (
        -- Orders past cancel date that haven't shipped (no 'On-Time' or 'Late' status)
        SELECT DISTINCT 
          ph.vendor,
          ph.id
        FROM po_headers ph
        WHERE ph.vendor IS NOT NULL
          AND ph.po_date >= ${ytdStart}
          AND ph.revised_cancel_date < CURRENT_DATE
          AND (ph.shipment_status IS NULL OR ph.shipment_status NOT IN ('On-Time', 'Late'))
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
      ),
      vendor_stats AS (
        SELECT 
          vendors.vendor,
          COALESCE(shipped.total, 0) as shipped_total,
          COALESCE(shipped.on_time, 0) as shipped_on_time,
          COALESCE(overdue.cnt, 0) as overdue_unshipped
        FROM (SELECT DISTINCT vendor FROM shipped_orders UNION SELECT DISTINCT vendor FROM overdue_unshipped) vendors(vendor)
        LEFT JOIN (
          SELECT vendor, COUNT(*)::int as total, SUM(is_on_time)::int as on_time 
          FROM shipped_orders GROUP BY vendor
        ) shipped ON shipped.vendor = vendors.vendor
        LEFT JOIN (
          SELECT vendor, COUNT(*)::int as cnt FROM overdue_unshipped GROUP BY vendor
        ) overdue ON overdue.vendor = vendors.vendor
      )
      SELECT 
        vendor,
        shipped_total,
        shipped_on_time,
        overdue_unshipped,
        CASE 
          WHEN (shipped_total + overdue_unshipped) > 0 
          THEN ROUND((shipped_on_time::numeric / (shipped_total + overdue_unshipped)::numeric) * 100, 1)
          ELSE 0
        END as true_otd_pct
      FROM vendor_stats
      WHERE vendor IS NOT NULL
      ORDER BY (shipped_total + overdue_unshipped) DESC
    `);

        return result.rows.map(stat => ({
            vendor: stat.vendor,
            totalPOs: stat.shipped_total + stat.overdue_unshipped,
            onTimePercentage: stat.true_otd_pct,
            shippedTotal: stat.shipped_total,
            shippedOnTime: stat.shipped_on_time,
            overdueUnshipped: stat.overdue_unshipped,
            avgDelay: 0,
        }));
    }

    // Vendor Late and At-Risk Shipments
    // Late = Orders past revised_cancel_date that have NOT been shipped (using OS340 shipment_status)
    // Exclude zero-value orders and samples (SMP/8X8 prefixes)
    // At Risk = Orders with failed final inspections (simplified for performance)
    async getVendorLateAndAtRisk(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
    }) {
        // Build filter fragments
        const needsVendorJoin = !!(filters?.merchandiser || filters?.merchandisingManager);
        const vendorJoin = needsVendorJoin
            ? sql`LEFT JOIN vendors v ON v.name = ph.vendor`
            : sql``;

        const filterFragments = [];
        if (filters?.vendor) {
            filterFragments.push(sql`AND ph.vendor = ${filters.vendor}`);
        }
        if (filters?.merchandiser) {
            filterFragments.push(sql`AND v.merchandiser = ${filters.merchandiser}`);
        }
        if (filters?.merchandisingManager) {
            filterFragments.push(sql`AND v.merchandising_manager = ${filters.merchandisingManager}`);
        }
        if (filters?.client) {
            filterFragments.push(sql`AND ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
        }
        if (filters?.brand) {
            filterFragments.push(sql`AND (
        CASE 
          WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
          WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
          ELSE 'CB'
        END
      ) = ${filters.brand}`);
        }
        if (filters?.startDate) {
            filterFragments.push(sql`AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${filters.startDate}`);
        }
        if (filters?.endDate) {
            filterFragments.push(sql`AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= ${filters.endDate}`);
        }
        const poFilters = filterFragments.length > 0 ? sql.join(filterFragments, sql` `) : sql``;

        // Execute late count and at-risk count in parallel for better performance
        const [lateResult, atRiskResult] = await Promise.all([
            // Late orders: unshipped and past cancel date (excludes franchise POs starting with 089)
            // Handle split-shipped POs: only count as late if NO parts have shipped (no delivery_to_consolidator)
            db.execute<{ vendor: string; late_count: number }>(sql`
        WITH shipped_pos AS (
          SELECT DISTINCT po_number
          FROM shipments
          WHERE delivery_to_consolidator IS NOT NULL
        ),
        late_unshipped_pos AS (
          SELECT 
            ph.po_number,
            MIN(ph.vendor) as vendor
          FROM po_headers ph
          ${vendorJoin}
          WHERE ph.vendor IS NOT NULL
            AND (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
            AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
            AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
            AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'  -- Exclude franchise POs
            AND ph.po_number NOT IN (SELECT po_number FROM shipped_pos)
            ${poFilters}
          GROUP BY ph.po_number
        )
        SELECT vendor, COUNT(*)::int as late_count
        FROM late_unshipped_pos
        GROUP BY vendor
        ORDER BY late_count DESC
        LIMIT 8
      `),

            // At-risk orders: not yet late but meet at-risk criteria (excludes franchise POs starting with 089):
            // 1. Failed final inspection
            // 2. Inline inspection not booked within 2 weeks of HOD
            // 3. Final inspection not booked within 1 week of HOD
            // 4. QA test report not available within 45 days of HOD
            db.execute<{ vendor: string; at_risk_count: number }>(sql`
        WITH base_pos AS (
          SELECT DISTINCT ON (ph.po_number)
            ph.po_number,
            ph.vendor,
            pli.sku,
            ph.revised_ship_date,
            EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE))::int as days_until_hod
          FROM po_headers ph
          LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
          ${vendorJoin}
          WHERE ph.vendor IS NOT NULL
            AND ph.revised_ship_date IS NOT NULL
            AND ph.revised_ship_date > CURRENT_DATE  -- Not late yet (future HOD)
            AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
            AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            AND ph.po_number NOT LIKE '089%'  -- Exclude franchise POs
            ${poFilters}
          ORDER BY ph.po_number, ph.id DESC
        ),
        failed_inspections AS (
          SELECT DISTINCT po_number
          FROM inspections
          WHERE inspection_type = 'Final Inspection'
            AND result IN ('Failed', 'Failed - Critical Failure')
        ),
        inline_inspections_booked AS (
          SELECT DISTINCT po_number
          FROM inspections
          WHERE inspection_type ILIKE '%inline%'
        ),
        final_inspections_booked AS (
          SELECT DISTINCT po_number
          FROM inspections
          WHERE inspection_type ILIKE '%final%'
        ),
        qa_passed AS (
          SELECT DISTINCT s.sku
          FROM skus s
          INNER JOIN quality_tests qt ON qt.sku_id = s.id
          WHERE qt.result = 'Pass'
        ),
        pts_submitted AS (
          SELECT DISTINCT po_number
          FROM shipments
          WHERE so_first_submission_date IS NOT NULL
        ),
        -- At-Risk POs: Uses shared AT_RISK_THRESHOLDS constants (see top of file)
        at_risk_pos AS (
          SELECT bp.po_number, bp.vendor
          FROM base_pos bp
          LEFT JOIN failed_inspections fi ON fi.po_number = bp.po_number
          LEFT JOIN inline_inspections_booked iib ON iib.po_number = bp.po_number
          LEFT JOIN final_inspections_booked fib ON fib.po_number = bp.po_number
          LEFT JOIN qa_passed qap ON qap.sku = bp.sku
          WHERE 
            fi.po_number IS NOT NULL  -- Criteria 1: Failed final inspection
            OR (bp.days_until_hod <= 14 AND bp.days_until_hod > 0 AND iib.po_number IS NULL)  -- Criteria 2: Inline not booked (INLINE_INSPECTION_DAYS=14)
            OR (bp.days_until_hod <= 7 AND bp.days_until_hod > 0 AND fib.po_number IS NULL)   -- Criteria 3: Final not booked (FINAL_INSPECTION_DAYS=7)
            OR (bp.days_until_hod <= 45 AND bp.days_until_hod > 0 AND qap.sku IS NULL)  -- Criteria 4: QA not passed (QA_TEST_DAYS=45)
        )
        SELECT vendor, COUNT(*)::int as at_risk_count
        FROM at_risk_pos
        GROUP BY vendor
        ORDER BY at_risk_count DESC
        LIMIT 8
      `)
        ]);

        // Merge late and at-risk counts by vendor
        const vendorMap = new Map<string, { vendor: string; late_count: number; at_risk_count: number }>();

        for (const row of lateResult.rows) {
            vendorMap.set(row.vendor, { vendor: row.vendor, late_count: row.late_count, at_risk_count: 0 });
        }

        for (const row of atRiskResult.rows) {
            const existing = vendorMap.get(row.vendor);
            if (existing) {
                existing.at_risk_count = row.at_risk_count;
            } else {
                vendorMap.set(row.vendor, { vendor: row.vendor, late_count: 0, at_risk_count: row.at_risk_count });
            }
        }

        // Sort by total (late + at-risk) and return top 8
        return Array.from(vendorMap.values())
            .sort((a, b) => (b.late_count + b.at_risk_count) - (a.late_count + a.at_risk_count))
            .slice(0, 8);
    }

    // Currently Late Orders by Days Overdue (Severity Buckets)
    // Shows distribution of currently late unshipped orders by how many days overdue
    // Late = past revised_cancel_date and NOT shipped/closed/cancelled
    // Excludes samples (SMP) and swatches (8X8) and zero-value orders
    async getLateShipmentsByReason(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
    }) {
        // Build filter fragments
        const needsVendorJoin = !!(filters?.merchandiser || filters?.merchandisingManager);
        const vendorJoin = needsVendorJoin
            ? sql`LEFT JOIN vendors v ON v.name = ph.vendor`
            : sql``;

        const filterFragments = [];
        if (filters?.vendor) {
            filterFragments.push(sql`AND ph.vendor = ${filters.vendor}`);
        }
        if (filters?.merchandiser) {
            filterFragments.push(sql`AND v.merchandiser = ${filters.merchandiser}`);
        }
        if (filters?.merchandisingManager) {
            filterFragments.push(sql`AND v.merchandising_manager = ${filters.merchandisingManager}`);
        }
        if (filters?.client) {
            filterFragments.push(sql`AND ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
        }
        if (filters?.brand) {
            filterFragments.push(sql`AND (
        CASE 
          WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
          WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
          ELSE 'CB'
        END
      ) = ${filters.brand}`);
        }
        if (filters?.startDate) {
            filterFragments.push(sql`AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${filters.startDate}`);
        }
        if (filters?.endDate) {
            filterFragments.push(sql`AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= ${filters.endDate}`);
        }
        const poFilters = filterFragments.length > 0 ? sql.join(filterFragments, sql` `) : sql``;

        // Simple aggregation: group po_headers by severity bucket and sum total_value
        // No need for complex CTEs - just filter late unshipped POs and aggregate by severity
        const result = await db.execute<{
            reason: string;
            count: number;
            avg_days_late: number;
            total_value: number;
        }>(sql`
      WITH shipped_pos AS (
        SELECT DISTINCT po_number
        FROM shipments
        WHERE delivery_to_consolidator IS NOT NULL
      )
      SELECT 
        CASE 
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 7 THEN '1-7 days late'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 14 THEN '8-14 days late'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 30 THEN '15-30 days late'
          ELSE '30+ days late'
        END as reason,
        COUNT(*)::int as count,
        COALESCE(ROUND(AVG(EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date))))::int, 0) as avg_days_late,
        COALESCE(SUM(ph.total_value), 0)::bigint as total_value
      FROM po_headers ph
      ${vendorJoin}
      WHERE (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
        AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
        AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND COALESCE(ph.total_value, 0) > 0
        AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
        AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
        AND ph.po_number NOT LIKE '089%'
        AND ph.po_number NOT IN (SELECT po_number FROM shipped_pos)
        ${poFilters}
      GROUP BY 
        CASE 
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 7 THEN '1-7 days late'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 14 THEN '8-14 days late'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 30 THEN '15-30 days late'
          ELSE '30+ days late'
        END
      ORDER BY 
        MIN(EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)))
    `);

        return result.rows;
    }

    // Late Shipments by Status (Currently Late / Actionable Orders)
    // Shows distribution of currently late unshipped orders by their PO status
    // Late = past revised_cancel_date and NOT shipped/closed
    // Excludes: Closed, Shipped, Cancelled orders (not actionable)
    // Excludes samples (SMP) and swatches (8X8) and zero-value orders
    async getLateShipmentsByStatus(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
    }) {
        // Build filter fragments
        const needsVendorJoin = !!(filters?.merchandiser || filters?.merchandisingManager);
        const vendorJoin = needsVendorJoin
            ? sql`LEFT JOIN vendors v ON v.name = ph.vendor`
            : sql``;

        const filterFragments = [];
        if (filters?.vendor) {
            filterFragments.push(sql`AND ph.vendor = ${filters.vendor}`);
        }
        if (filters?.client) {
            filterFragments.push(sql`AND ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
        }
        if (filters?.brand) {
            filterFragments.push(sql`AND (
        CASE 
          WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
          WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
          ELSE 'CB'
        END
      ) = ${filters.brand}`);
        }
        if (filters?.merchandiser) {
            filterFragments.push(sql`AND v.merchandiser = ${filters.merchandiser}`);
        }
        if (filters?.merchandisingManager) {
            filterFragments.push(sql`AND v.merchandising_manager = ${filters.merchandisingManager}`);
        }
        if (filters?.startDate) {
            filterFragments.push(sql`AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${filters.startDate}`);
        }
        if (filters?.endDate) {
            filterFragments.push(sql`AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= ${filters.endDate}`);
        }
        const poFilters = filterFragments.length > 0 ? sql.join(filterFragments, sql` `) : sql``;

        // Simple aggregation: group po_headers by status and sum total_value
        // No need for complex CTEs - just filter late unshipped POs and aggregate
        const result = await db.execute<{
            status: string;
            count: number;
            avg_days_late: number;
            total_value: number;
        }>(sql`
      WITH shipped_pos AS (
        SELECT DISTINCT po_number
        FROM shipments
        WHERE delivery_to_consolidator IS NOT NULL
      )
      SELECT 
        COALESCE(NULLIF(TRIM(ph.status), ''), 'Unknown') as status,
        COUNT(*)::int as count,
        COALESCE(ROUND(AVG(EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date))))::int, 0) as avg_days_late,
        COALESCE(SUM(ph.total_value), 0)::bigint as total_value
      FROM po_headers ph
      ${vendorJoin}
      WHERE (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
        AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
        AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND COALESCE(ph.total_value, 0) > 0
        AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
        AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
        AND ph.po_number NOT LIKE '089%'
        AND ph.po_number NOT IN (SELECT po_number FROM shipped_pos)
        ${poFilters}
      GROUP BY COALESCE(NULLIF(TRIM(ph.status), ''), 'Unknown')
      ORDER BY count DESC
    `);

        return result.rows;
    }

    // Late and At-Risk POs for Dashboard
    // "Late" = Unshipped orders past revised_cancel_date (no delivery_to_consolidator)
    // Exclude zero-value orders and samples (SMP/8X8 prefixes)
    // "At Risk" = Meets any of these criteria:
    // 1. Failed final inspection
    // 2. Inline inspection not booked within 2 weeks of HOD
    // 3. Final inspection not booked within 1 week of HOD
    // 4. QA test not passed within 45 days of HOD
    async getLateAndAtRiskPOs(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
    }) {
        // Build filter fragments - always join vendors to get canonical name
        const filterFragments = [];
        if (filters?.vendor) {
            filterFragments.push(sql`AND v.name = ${filters.vendor}`);
        }
        if (filters?.merchandiser) {
            filterFragments.push(sql`AND v.merchandiser = ${filters.merchandiser}`);
        }
        if (filters?.merchandisingManager) {
            filterFragments.push(sql`AND v.merchandising_manager = ${filters.merchandisingManager}`);
        }
        if (filters?.client) {
            filterFragments.push(sql`AND ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
        }
        if (filters?.brand) {
            filterFragments.push(sql`AND (
        CASE 
          WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
          WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
          ELSE 'CB'
        END
      ) = ${filters.brand}`);
        }
        if (filters?.startDate) {
            filterFragments.push(sql`AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${filters.startDate}`);
        }
        if (filters?.endDate) {
            filterFragments.push(sql`AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= ${filters.endDate}`);
        }
        const poFilters = filterFragments.length > 0 ? sql.join(filterFragments, sql` `) : sql``;

        const result = await db.execute<{
            id: number;
            po_number: string;
            vendor: string | null;
            revised_reason: string | null;
            status: string;
            days_late: number;
            is_late: boolean;
            is_at_risk: boolean;
            revised_cancel_date: Date | null;
            total_value: number | null;
            has_pts: boolean;
        }>(sql`
      WITH shipped_pos AS (
        -- POs with delivery_to_consolidator are considered shipped (complete)
        SELECT DISTINCT po_number
        FROM shipments
        WHERE delivery_to_consolidator IS NOT NULL
      ),
      not_delivered_pos AS (
        -- Group by po_number to handle split shipments - only include POs with NO shipped parts
        -- Use v.name (canonical vendor name) instead of ph.vendor (raw imported name)
        -- Use MAX for total_value to avoid inflation from po_line_items join fan-out
        -- Filter out POs where all SKUs are discontinued
        SELECT 
          MIN(ph.id) as id,
          ph.po_number,
          MIN(v.name) as vendor,
          MIN(pli.sku) as sku,
          MIN(ph.revised_reason) as revised_reason,
          MIN(ph.status) as status,
          MIN(COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) as revised_cancel_date,
          MIN(ph.revised_ship_date) as revised_ship_date,
          EXTRACT(DAY FROM (MIN(ph.revised_ship_date) - CURRENT_DATE))::int as days_until_hod,
          MAX(COALESCE(ph.total_value, 0)) as total_value,
          -- Detect MTO orders from seller_style or program_description containing 'MTO'
          BOOL_OR(pli.seller_style ILIKE '%MTO%' OR ph.program_description ILIKE '%MTO%') as is_mto
        FROM po_headers ph
        LEFT JOIN vendors v ON v.id = ph.vendor_id
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'  -- Exclude franchise POs
          AND ph.po_number NOT IN (SELECT po_number FROM shipped_pos)
          AND EXISTS (
            SELECT 1 FROM po_line_items pli2
            LEFT JOIN skus s ON pli2.sku = s.sku
            WHERE pli2.po_header_id = ph.id
              AND (s.status IS NULL OR s.status != 'discontinued')
          )
          ${poFilters}
        GROUP BY ph.po_number
      ),
      failed_inspections AS (
        SELECT DISTINCT po_number
        FROM inspections
        WHERE inspection_type = 'Final Inspection'
          AND result IN ('Failed', 'Failed - Critical Failure')
      ),
      inline_inspections_booked AS (
        SELECT DISTINCT po_number
        FROM inspections
        WHERE inspection_type ILIKE '%inline%'
      ),
      final_inspections_booked AS (
        SELECT DISTINCT po_number
        FROM inspections
        WHERE inspection_type ILIKE '%final%'
      ),
      qa_passed AS (
        SELECT DISTINCT s.sku
        FROM skus s
        INNER JOIN quality_tests qt ON qt.sku_id = s.id
        WHERE qt.result = 'Pass'
      ),
      has_pts_number AS (
        -- Check both shipments and po_headers for PTS data
        SELECT DISTINCT po_number FROM shipments WHERE pts_number IS NOT NULL AND pts_number != ''
        UNION
        SELECT DISTINCT po_number FROM po_headers WHERE pts_number IS NOT NULL AND pts_number != ''
      ),
      -- At-Risk Analysis: Uses shared AT_RISK_THRESHOLDS constants (see top of file)
      po_risk_analysis AS (
        SELECT 
          ndp.*,
          fi.po_number IS NOT NULL as has_failed_final_inspection,
          (ndp.days_until_hod <= 14 AND ndp.days_until_hod > 0 AND iib.po_number IS NULL) as inline_not_booked,  -- INLINE_INSPECTION_DAYS=14
          (ndp.days_until_hod <= 7 AND ndp.days_until_hod > 0 AND fib.po_number IS NULL) as final_not_booked,    -- FINAL_INSPECTION_DAYS=7
          (ndp.days_until_hod <= 45 AND ndp.days_until_hod > 0 AND qap.sku IS NULL) as qa_not_passed,           -- QA_TEST_DAYS=45
          (hpn.po_number IS NOT NULL) as has_pts,
          (ndp.revised_cancel_date < CURRENT_DATE) as is_late,
          CASE 
            WHEN ndp.revised_cancel_date < CURRENT_DATE
            THEN EXTRACT(DAY FROM CURRENT_DATE - ndp.revised_cancel_date)::int
            ELSE 0
          END as days_late
        FROM not_delivered_pos ndp
        LEFT JOIN failed_inspections fi ON fi.po_number = ndp.po_number
        LEFT JOIN inline_inspections_booked iib ON iib.po_number = ndp.po_number
        LEFT JOIN final_inspections_booked fib ON fib.po_number = ndp.po_number
        LEFT JOIN qa_passed qap ON qap.sku = ndp.sku
        LEFT JOIN has_pts_number hpn ON hpn.po_number = ndp.po_number
      )
      SELECT 
        id,
        po_number,
        vendor,
        revised_reason,
        status,
        days_late,
        is_late,
        revised_cancel_date,
        total_value,
        has_pts,
        -- At-Risk: All 4 criteria from AT_RISK_THRESHOLDS
        (
          has_failed_final_inspection = TRUE
          OR inline_not_booked = TRUE
          OR final_not_booked = TRUE
          OR qa_not_passed = TRUE
        ) as is_at_risk
      FROM po_risk_analysis
      WHERE is_late = TRUE
         OR has_failed_final_inspection = TRUE
         OR inline_not_booked = TRUE
         OR final_not_booked = TRUE
         OR qa_not_passed = TRUE
      ORDER BY is_late DESC, days_late DESC, id DESC
      LIMIT 1000
    `);

        return result.rows;
    }

    // Year-over-Year TRUE OTD by Month
    // TRUE OTD = On-Time Shipped / Total Shipped (based on revised cancel date)
    // Groups by month of revised_cancel_date (when orders were due)
    // Uses OS 340 shipment_status field ('On-Time' or 'Late') for shipped status
    // Excludes zero-value orders and samples (SMP/8X8 prefixes)
    // If date filters are provided, shows all years in that range
    // Default (no date filters): shows current year vs previous year
    // NOTE: 2023 data is incomplete, so minimum year is 2024
    async getYearOverYearLateShipments(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
    }) {
        // Determine which years to include based on date filters
        const currentYear = new Date().getFullYear();
        const previousYear = currentYear - 1;
        const MIN_YEAR = 2024; // 2023 data is incomplete, don't include it

        // Calculate years from date range or default to current/previous
        let yearsToInclude: number[];
        if (filters?.startDate && filters?.endDate) {
            const startYear = Math.max(filters.startDate.getFullYear(), MIN_YEAR);
            const endYear = filters.endDate.getFullYear();
            yearsToInclude = [];
            for (let y = startYear; y <= endYear; y++) {
                yearsToInclude.push(y);
            }
        } else {
            // Default to current year and previous year (but not before MIN_YEAR)
            yearsToInclude = [Math.max(previousYear, MIN_YEAR), currentYear].filter((v, i, a) => a.indexOf(v) === i);
        }

        // Safety: ensure we have at least one year
        if (yearsToInclude.length === 0) {
            yearsToInclude = [currentYear];
        }

        // Build filter fragments - use vendors table to get merchandiser/manager info
        const needsVendorJoin = !!(filters?.merchandiser || filters?.merchandisingManager);
        const vendorJoin = needsVendorJoin
            ? sql`LEFT JOIN vendors v ON v.name = ph.vendor`
            : sql``;

        const filterFragments = [];
        if (filters?.vendor) {
            filterFragments.push(sql`AND ph.vendor = ${filters.vendor}`);
        }
        if (filters?.client) {
            filterFragments.push(sql`AND ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
        }
        if (filters?.brand) {
            filterFragments.push(sql`AND (
        CASE 
          WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
          WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
          ELSE 'CB'
        END
      ) = ${filters.brand}`);
        }
        if (filters?.merchandiser) {
            // Filter by vendor's assigned merchandiser
            filterFragments.push(sql`AND v.merchandiser = ${filters.merchandiser}`);
        }
        if (filters?.merchandisingManager) {
            // Filter by vendor's merchandising manager OR by their direct reports
            filterFragments.push(sql`AND (
        v.merchandising_manager = ${filters.merchandisingManager}
        OR v.merchandiser IN (
          SELECT m.name FROM staff m
          JOIN staff mgr ON m.manager_id = mgr.id
          WHERE mgr.name = ${filters.merchandisingManager}
        )
      )`);
        }
        // Note: Don't filter by po_date - we use startDate/endDate only to determine which years to display
        const poFilters = filterFragments.length > 0 ? sql.join(filterFragments, sql` `) : sql``;

        // Build dynamic year filter - creates: (2024, 2025, 2026) from yearsToInclude array
        const yearsList = yearsToInclude.join(', ');
        const yearsFilter = sql.raw(`(${yearsList})`);

        const result = await db.execute<{
            year: number;
            month: number;
            month_name: string;
            late_count: number;
            total_shipped: number;
            late_percentage: number;
            shipped_on_time: number;
            shipped_late: number;
            overdue_unshipped: number;
            total_should_have_shipped: number;
            true_otd_pct: number;
            on_time_value: number;
            total_value: number;
            late_value: number;
            revised_otd_value_pct: number;
            overdue_backlog_value: number;
        }>(sql`
      WITH shipped_po_revised_otd AS (
        -- Calculate Revised OTD: compare Delivery to Consolidator to REVISED cancel date
        -- Shipped = has delivery_to_consolidator (no shipment_status dependency)
        SELECT 
          ph.po_number,
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as due_year,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as due_month,
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon') as month_name,
          -- Get the first (MIN) delivery to consolidator date for this PO
          MAX(s.delivery_to_consolidator) as first_delivery_date,
          COALESCE(ph.revised_cancel_date, ph.original_cancel_date) as cancel_date,
          -- Shipped value for value-based OTD
          COALESCE(ph.shipped_value, 0) as shipped_value
        FROM po_headers ph
        INNER JOIN shipments s ON s.po_number = ph.po_number
        ${vendorJoin}
        WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) IS NOT NULL
          AND s.delivery_to_consolidator IS NOT NULL
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) IN ${yearsFilter}
          ${poFilters}
        GROUP BY ph.po_number, ph.revised_cancel_date, ph.original_cancel_date, ph.shipped_value
      ),
      po_with_revised_otd AS (
        SELECT 
          po_number,
          due_year,
          due_month,
          month_name,
          shipped_value,
          -- On-time if: delivered to consolidator on/before revised cancel date
          CASE 
            WHEN first_delivery_date IS NOT NULL AND first_delivery_date <= cancel_date THEN 1 
            ELSE 0 
          END as is_on_time,
          -- Value-based on-time flag
          CASE 
            WHEN first_delivery_date IS NOT NULL AND first_delivery_date <= cancel_date THEN shipped_value 
            ELSE 0 
          END as on_time_value
        FROM shipped_po_revised_otd
      ),
      overdue_unshipped AS (
        -- Orders past cancel date that haven't shipped (no delivery_to_consolidator)
        SELECT 
          ph.po_number,
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as due_year,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as due_month,
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon') as month_name,
          COALESCE(ph.total_value, 0) as po_value
        FROM po_headers ph
        LEFT JOIN shipments s ON s.po_number = ph.po_number
        ${vendorJoin}
        WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) IS NOT NULL
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) IN ${yearsFilter}
          AND ph.po_number NOT IN (SELECT po_number FROM po_with_revised_otd)
          ${poFilters}
        GROUP BY ph.po_number, ph.revised_cancel_date, ph.original_cancel_date, ph.total_value
        HAVING MAX(s.delivery_to_consolidator) IS NULL
      ),
      shipped_monthly AS (
        SELECT 
          due_year, due_month, month_name,
          COUNT(*)::int as shipped_total,
          SUM(is_on_time)::int as shipped_on_time,
          (COUNT(*) - SUM(is_on_time))::int as shipped_late,
          SUM(shipped_value)::bigint as total_value,
          SUM(on_time_value)::bigint as on_time_value
        FROM po_with_revised_otd
        GROUP BY due_year, due_month, month_name
      ),
      overdue_monthly AS (
        SELECT 
          due_year, due_month, month_name,
          COUNT(*)::int as overdue_cnt,
          SUM(po_value)::bigint as overdue_value
        FROM overdue_unshipped
        GROUP BY due_year, due_month, month_name
      ),
      monthly_stats AS (
        SELECT 
          COALESCE(sm.due_year, om.due_year) as year,
          COALESCE(sm.due_month, om.due_month) as month,
          COALESCE(sm.month_name, om.month_name) as month_name,
          COALESCE(sm.shipped_total, 0) as total_shipped,
          COALESCE(sm.shipped_on_time, 0) as shipped_on_time,
          COALESCE(sm.shipped_late, 0) as shipped_late,
          COALESCE(om.overdue_cnt, 0) as overdue_unshipped,
          COALESCE(sm.shipped_total, 0) + COALESCE(om.overdue_cnt, 0) as total_should_have_shipped,
          COALESCE(sm.total_value, 0) as total_value,
          COALESCE(sm.on_time_value, 0) as on_time_value,
          COALESCE(om.overdue_value, 0) as overdue_value
        FROM shipped_monthly sm
        FULL OUTER JOIN overdue_monthly om 
          ON sm.due_year = om.due_year AND sm.due_month = om.due_month
      )
      SELECT 
        year,
        month,
        month_name,
        shipped_late as late_count,
        total_shipped,
        CASE WHEN total_shipped > 0 
          THEN ROUND((shipped_late::numeric / total_shipped::numeric) * 100, 1)
          ELSE 0
        END as late_percentage,
        shipped_on_time,
        shipped_late,
        overdue_unshipped,
        total_should_have_shipped,
        CASE WHEN total_shipped > 0 
          THEN ROUND((shipped_on_time::numeric / total_shipped::numeric) * 100, 1)
          ELSE 0
        END as true_otd_pct,
        on_time_value::bigint as on_time_value,
        total_value::bigint as total_value,
        (total_value - on_time_value)::bigint as late_value,
        CASE WHEN total_value > 0 
          THEN ROUND((on_time_value::numeric / total_value::numeric) * 100, 1)
          ELSE 0
        END as revised_otd_value_pct,
        overdue_value::bigint as overdue_backlog_value
      FROM monthly_stats
      WHERE year IS NOT NULL
      ORDER BY year, month
    `);

        // Convert string values to numbers (Postgres bigint/numeric are returned as strings)
        return result.rows.map(row => ({
            ...row,
            year: Number(row.year),
            month: Number(row.month),
            late_count: Number(row.late_count || 0),
            total_shipped: Number(row.total_shipped || 0),
            late_percentage: Number(row.late_percentage || 0),
            shipped_on_time: Number(row.shipped_on_time || 0),
            shipped_late: Number(row.shipped_late || 0),
            overdue_unshipped: Number(row.overdue_unshipped || 0),
            total_should_have_shipped: Number(row.total_should_have_shipped || 0),
            true_otd_pct: Number(row.true_otd_pct || 0),
            on_time_value: Number(row.on_time_value || 0),
            total_value: Number(row.total_value || 0),
            late_value: Number(row.late_value || 0),
            revised_otd_value_pct: Number(row.revised_otd_value_pct || 0),
            overdue_backlog_value: Number(row.overdue_backlog_value || 0),
        }));
    }

    // Get unique revision reasons for filter dropdown
    // Returns trimmed reasons for consistent matching
    async getRevisionReasons(): Promise<string[]> {
        const result = await db.execute<{ reason: string }>(sql`
      SELECT DISTINCT TRIM(revised_reason) as reason
      FROM po_headers
      WHERE revised_reason IS NOT NULL 
        AND revised_reason != ''
        AND TRIM(revised_reason) != ''
      ORDER BY reason
    `);
        return result.rows.map(row => row.reason);
    }

    // Year-over-Year Original OTD with optional reason filtering
    // Original OTD = Shipped before/on ORIGINAL cancel date / Total Shipped
    // Uses MIN(actual_sailing_date) vs original_cancel_date for on-time calculation
    async getOriginalOtdYoY(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        startDate?: Date;
        endDate?: Date;
        reasons?: string[];
    }): Promise<Array<{
        year: number;
        month: number;
        month_name: string;
        shipped_on_time: number;
        total_shipped: number;
        original_otd_pct: number;
    }>> {
        // Determine which years to include based on date filters
        const currentYear = new Date().getFullYear();
        const previousYear = currentYear - 1;
        const MIN_YEAR = 2024;

        let yearsToInclude: number[];
        if (filters?.startDate && filters?.endDate) {
            // Normalize dates to avoid timezone edge cases (Jan 1 appearing as Dec 31)
            const normalizedStart = new Date(filters.startDate.getTime() + 12 * 60 * 60 * 1000);
            const normalizedEnd = new Date(filters.endDate.getTime() + 12 * 60 * 60 * 1000);
            const startYear = Math.max(normalizedStart.getFullYear(), MIN_YEAR);
            const endYear = normalizedEnd.getFullYear();
            yearsToInclude = [];
            // Always include previous year for YoY comparison
            const prevCompareYear = startYear - 1;
            if (prevCompareYear >= MIN_YEAR) {
                yearsToInclude.push(prevCompareYear);
            }
            for (let y = startYear; y <= endYear; y++) {
                yearsToInclude.push(y);
            }
        } else {
            yearsToInclude = [Math.max(previousYear, MIN_YEAR), currentYear].filter((v, i, a) => a.indexOf(v) === i);
        }

        if (yearsToInclude.length === 0) {
            yearsToInclude = [currentYear];
        }

        // Build filter fragments - use vendors table to get merchandiser/manager info
        const needsVendorJoin = !!(filters?.merchandiser || filters?.merchandisingManager);
        const vendorJoin = needsVendorJoin
            ? sql`LEFT JOIN vendors v ON v.name = ph.vendor`
            : sql``;

        const filterFragments = [];
        if (filters?.vendor) {
            filterFragments.push(sql`AND ph.vendor = ${filters.vendor}`);
        }
        if (filters?.client) {
            filterFragments.push(sql`AND ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
        }
        if (filters?.merchandiser) {
            filterFragments.push(sql`AND v.merchandiser = ${filters.merchandiser}`);
        }
        if (filters?.merchandisingManager) {
            filterFragments.push(sql`AND (
        v.merchandising_manager = ${filters.merchandisingManager}
        OR v.merchandiser IN (
          SELECT m.name FROM staff m
          JOIN staff mgr ON m.manager_id = mgr.id
          WHERE mgr.name = ${filters.merchandisingManager}
        )
      )`);
        }
        // Reason filter is NOT added to WHERE - instead used in on-time calculation
        // to treat orders with selected reasons as "excused" (count as on-time)
        const poFilters = filterFragments.length > 0 ? sql.join(filterFragments, sql` `) : sql``;

        // Build dynamic year filter
        const yearsList = yearsToInclude.join(', ');
        const yearsFilter = sql.raw(`(${yearsList})`);

        // Build the "excused reasons" list for treating late orders as on-time
        let excusedReasonsCondition = sql`FALSE`; // Default: no orders are excused
        if (filters?.reasons && filters.reasons.length > 0) {
            const cleanReasons = filters.reasons.filter(r => r && r.trim() !== '');
            if (cleanReasons.length > 0) {
                const reasonsList = cleanReasons.map(r => `'${r.replace(/'/g, "''")}'`).join(', ');
                excusedReasonsCondition = sql.raw(`TRIM(ph.revised_reason) IN (${reasonsList})`);
            }
        }

        const result = await db.execute<{
            year: number;
            month: number;
            month_name: string;
            shipped_on_time: number;
            total_shipped: number;
            original_otd_pct: number;
            on_time_value: number;
            total_value: number;
            late_value: number;
            original_otd_value_pct: number;
        }>(sql`
      WITH shipped_po_original_otd AS (
        -- Calculate Original OTD: compare Delivery to Consolidator (column BH) to ORIGINAL cancel date
        -- Shipped = has delivery_to_consolidator (no shipment_status dependency)
        -- Use revised_by column to exclude client/forwarder delays from "late" count
        SELECT 
          ph.po_number,
          MAX(s.delivery_to_consolidator) as last_delivery_date,
          ph.original_cancel_date,
          -- Shipped value for value-based OTD
          COALESCE(ph.shipped_value, 0) as shipped_value,
          -- revised_by indicates who caused the delay (Vendor, Client, Forwarder)
          ph.revised_by
        FROM po_headers ph
        INNER JOIN shipments s ON s.po_number = ph.po_number
        ${vendorJoin}
        WHERE ph.original_cancel_date IS NOT NULL
          AND s.delivery_to_consolidator IS NOT NULL
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          ${poFilters}
        GROUP BY ph.po_number, ph.original_cancel_date, ph.shipped_value, ph.revised_by
      ),
      po_with_original_otd AS (
        SELECT 
          po_number,
          EXTRACT(YEAR FROM last_delivery_date)::int as ship_year,
          EXTRACT(MONTH FROM last_delivery_date)::int as ship_month,
          TO_CHAR(last_delivery_date, 'Mon') as month_name,
          shipped_value,
          -- Original OTD: On-time if delivered before original cancel date,
          -- OR if delivered late but delay was caused by Client or Forwarder (not vendor's fault)
          -- Late ONLY if delivered after original cancel date AND (revised_by = 'Vendor' OR revised_by IS NULL)
          CASE 
            WHEN last_delivery_date IS NOT NULL AND last_delivery_date <= original_cancel_date THEN 1
            WHEN UPPER(COALESCE(revised_by, '')) IN ('CLIENT', 'FORWARDER') THEN 1
            ELSE 0 
          END as is_on_time_original,
          -- Value-based on-time flag with same logic
          CASE 
            WHEN last_delivery_date IS NOT NULL AND last_delivery_date <= original_cancel_date THEN shipped_value
            WHEN UPPER(COALESCE(revised_by, '')) IN ('CLIENT', 'FORWARDER') THEN shipped_value
            ELSE 0 
          END as on_time_value
        FROM shipped_po_original_otd
        WHERE EXTRACT(YEAR FROM last_delivery_date) IN ${yearsFilter}
      ),
      monthly_stats AS (
        SELECT 
          ship_year as year,
          ship_month as month,
          month_name,
          COUNT(po_number)::int as total_shipped,
          SUM(is_on_time_original)::int as shipped_on_time,
          SUM(shipped_value)::bigint as total_value,
          SUM(on_time_value)::bigint as on_time_value
        FROM po_with_original_otd
        GROUP BY ship_year, ship_month, month_name
      )
      SELECT 
        year,
        month,
        month_name,
        shipped_on_time,
        total_shipped,
        CASE WHEN total_shipped > 0 
          THEN ROUND((shipped_on_time::numeric / total_shipped::numeric) * 100, 1)
          ELSE 0
        END as original_otd_pct,
        on_time_value::bigint as on_time_value,
        total_value::bigint as total_value,
        (total_value - on_time_value)::bigint as late_value,
        CASE WHEN total_value > 0 
          THEN ROUND((on_time_value::numeric / total_value::numeric) * 100, 1)
          ELSE 0
        END as original_otd_value_pct
      FROM monthly_stats
      WHERE year IS NOT NULL
      ORDER BY year, month
    `);

        // Convert string values to numbers (Postgres bigint/numeric are returned as strings)
        return result.rows.map(row => ({
            ...row,
            year: Number(row.year),
            month: Number(row.month),
            shipped_on_time: Number(row.shipped_on_time || 0),
            total_shipped: Number(row.total_shipped || 0),
            original_otd_pct: Number(row.original_otd_pct || 0),
            on_time_value: Number(row.on_time_value || 0),
            total_value: Number(row.total_value || 0),
            late_value: Number(row.late_value || 0),
            original_otd_value_pct: Number(row.original_otd_value_pct || 0),
        }));
    }



    // PO Timeline operations
    async getPoTimelineByPoId(poId: number): Promise<{
        timeline: PoTimeline | null;
        milestones: PoTimelineMilestone[];
    }> {
        const timelineResult = await db.select()
            .from(poTimelines)
            .where(eq(poTimelines.poId, poId));

        const timeline = timelineResult[0] || null;

        if (!timeline) {
            return { timeline: null, milestones: [] };
        }

        const milestones = await db.select()
            .from(poTimelineMilestones)
            .where(eq(poTimelineMilestones.timelineId, timeline.id))
            .orderBy(poTimelineMilestones.sortOrder);

        return { timeline, milestones };
    }

    async createPoTimeline(poId: number, templateId?: number): Promise<PoTimeline> {
        const result = await db.insert(poTimelines).values({
            poId,
            templateId: templateId || null,
            isLocked: false,
        }).returning();
        return result[0];
    }

    async updatePoTimelineMilestone(id: number, data: {
        revisedDate?: Date | null;
        actualDate?: Date | null;
        actualSource?: string | null;
        notes?: string | null
    }): Promise<PoTimelineMilestone | undefined> {
        const result = await db
            .update(poTimelineMilestones)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(poTimelineMilestones.id, id))
            .returning();
        return result[0];
    }

    async lockPoTimeline(poId: number, lockedBy: string): Promise<PoTimeline | undefined> {
        const result = await db
            .update(poTimelines)
            .set({
                isLocked: true,
                lockedAt: new Date(),
                lockedBy,
                updatedAt: new Date()
            })
            .where(eq(poTimelines.poId, poId))
            .returning();
        return result[0];
    }

    async syncPoTimelineActuals(poId: number): Promise<PoTimelineMilestone[]> {
        // Get the PO to find its po_number for shipment lookup
        const po = await this.getPurchaseOrderById(poId);
        if (!po) return [];

        const { timeline, milestones } = await this.getPoTimelineByPoId(poId);
        if (!timeline) return [];

        // Get shipment data for this PO
        const shipmentData = await db.select()
            .from(shipments)
            .where(eq(shipments.poId, poId))
            .orderBy(desc(shipments.createdAt))
            .limit(1);

        const shipment = shipmentData[0];

        // Get inspection data for this PO
        const inspectionData = await db.select()
            .from(inspections)
            .where(eq(inspections.poNumber, po.poNumber));

        const updatedMilestones: PoTimelineMilestone[] = [];

        for (const milestone of milestones) {
            let actualDate: Date | null = null;
            let actualSource: string = 'shipment';

            switch (milestone.milestone) {
                case 'hod':
                    // HOD from shipment deliveryToConsolidator
                    if (shipment?.deliveryToConsolidator) {
                        actualDate = new Date(shipment.deliveryToConsolidator);
                    }
                    break;
                case 'etd':
                    // ETD from shipment actualSailingDate
                    if (shipment?.actualSailingDate) {
                        actualDate = new Date(shipment.actualSailingDate);
                    }
                    break;
                case 'inline_inspection':
                    // Find inline inspection
                    const inlineInsp = inspectionData.find(i =>
                        i.inspectionType?.toLowerCase().includes('inline')
                    );
                    if (inlineInsp?.inspectionDate) {
                        actualDate = new Date(inlineInsp.inspectionDate);
                        actualSource = 'inspection';
                    }
                    break;
                case 'final_inspection':
                    // Find final inspection
                    const finalInsp = inspectionData.find(i =>
                        i.inspectionType?.toLowerCase().includes('final') &&
                        !i.inspectionType?.toLowerCase().includes('re-final')
                    );
                    if (finalInsp?.inspectionDate) {
                        actualDate = new Date(finalInsp.inspectionDate);
                        actualSource = 'inspection';
                    }
                    break;
                default:
                    // Other milestones are manual - don't auto-sync
                    continue;
            }

            if (actualDate && (!milestone.actualDate || milestone.actualSource !== 'manual')) {
                const updated = await this.updatePoTimelineMilestone(milestone.id, {
                    actualDate,
                    actualSource,
                });
                if (updated) updatedMilestones.push(updated);
            }
        }

        return updatedMilestones;
    }

    async initializePoTimelineFromTemplate(poId: number, templateId: number, poDate: Date): Promise<PoTimelineMilestone[]> {
        // Get the template milestones
        const templateMilestones = await db.select()
            .from(vendorTemplateMilestones)
            .where(eq(vendorTemplateMilestones.templateId, templateId))
            .orderBy(vendorTemplateMilestones.sortOrder);

        // Get or create the PO timeline
        let { timeline } = await this.getPoTimelineByPoId(poId);
        if (!timeline) {
            timeline = await this.createPoTimeline(poId, templateId);
        }

        // Calculate planned dates and create milestones
        const milestoneValues: any[] = [];
        const calculatedDates: Record<string, Date> = {};

        for (const tm of templateMilestones) {
            let plannedDate: Date;

            if (tm.dependsOnMilestone && tm.daysFromDependency !== null) {
                // Calculate from dependency
                const dependencyDate = calculatedDates[tm.dependsOnMilestone];
                if (dependencyDate) {
                    plannedDate = new Date(dependencyDate);
                    plannedDate.setDate(plannedDate.getDate() + (tm.daysFromDependency || 0));
                } else {
                    // Fallback to PO date calculation
                    plannedDate = new Date(poDate);
                    plannedDate.setDate(plannedDate.getDate() + tm.daysFromPoDate);
                }
            } else {
                // Calculate from PO date
                plannedDate = new Date(poDate);
                plannedDate.setDate(plannedDate.getDate() + tm.daysFromPoDate);
            }

            calculatedDates[tm.milestone] = plannedDate;

            milestoneValues.push({
                timelineId: timeline.id,
                milestone: tm.milestone,
                plannedDate,
                revisedDate: plannedDate, // Initially same as planned
                sortOrder: tm.sortOrder,
            });
        }

        // Delete existing milestones and insert new ones
        await db.delete(poTimelineMilestones)
            .where(eq(poTimelineMilestones.timelineId, timeline.id));

        if (milestoneValues.length > 0) {
            const result = await db.insert(poTimelineMilestones)
                .values(milestoneValues)
                .returning();
            return result;
        }

        return [];
    }

    async getAtRiskTimelineMilestones(client?: string, daysThreshold: number = 7): Promise<Array<{
        id: number;
        milestone: string;
        poId: number;
        poNumber: string;
        vendor: string | null;
        targetDate: Date;
        daysUntilDue: number;
        status: 'at-risk' | 'overdue';
    }>> {
        // Use raw SQL for proper filtering and deduplication
        // Only include milestones for ACTIVE POs (not closed, shipped, cancelled)
        // Join to a deduplicated active_pos CTE to avoid SKU-based row multiplication
        // Filter out POs where all SKUs are discontinued
        const result = await db.execute<{
            id: number;
            milestone: string;
            po_id: number;
            po_number: string;
            vendor: string | null;
            target_date: Date;
            days_until_due: number;
        }>(sql`
      WITH active_pos AS (
        SELECT DISTINCT ph.id as header_id, ph.po_number, ph.vendor, ph.client
        FROM po_headers ph
        WHERE UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          AND COALESCE(ph.shipment_status, '') NOT IN ('On-Time', 'Late')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND EXISTS (
            SELECT 1 FROM po_line_items pli
            LEFT JOIN skus s ON pli.sku = s.sku
            WHERE pli.po_header_id = ph.id
              AND (s.status IS NULL OR s.status != 'discontinued')
          )
      )
      SELECT DISTINCT
        ptm.id,
        ptm.milestone,
        pt.po_header_id as po_id,
        ap.po_number,
        ap.vendor,
        COALESCE(ptm.revised_date, ptm.planned_date) as target_date,
        (COALESCE(ptm.revised_date, ptm.planned_date)::date - CURRENT_DATE)::int as days_until_due
      FROM po_timeline_milestones ptm
      JOIN po_timelines pt ON ptm.timeline_id = pt.id
      JOIN po_headers ph ON pt.po_header_id = ph.id
      JOIN active_pos ap ON ap.po_number = ph.po_number
      WHERE ptm.actual_date IS NULL
        AND COALESCE(ptm.revised_date, ptm.planned_date) <= CURRENT_DATE + INTERVAL '${sql.raw(String(daysThreshold))} days'
        ${client ? sql`AND ap.client = (SELECT c.name FROM clients c WHERE c.code = ${client})` : sql``}
      ORDER BY days_until_due ASC
      LIMIT 5000
    `);

        return result.rows.map(row => ({
            id: row.id,
            milestone: row.milestone,
            poId: row.po_id,
            poNumber: row.po_number,
            vendor: row.vendor,
            targetDate: new Date(row.target_date),
            daysUntilDue: row.days_until_due,
            status: (row.days_until_due < 0 ? 'overdue' : 'at-risk') as 'at-risk' | 'overdue',
        }));
    }

    // Missing Inspections for To-Do list
    // Uses shared AT_RISK_THRESHOLDS: INLINE_INSPECTION_DAYS=14, FINAL_INSPECTION_DAYS=7
    async getMissingInspections(filters?: { client?: string; merchandiser?: string }): Promise<Array<{
        id: number;
        poNumber: string;
        vendor: string | null;
        merchandiser: string | null;
        revisedShipDate: Date | null;
        daysUntilHod: number;
        missingInlineInspection: boolean;
        missingFinalInspection: boolean;
        totalValue: number | null;
    }>> {
        // Build filter conditions
        let clientFilter = sql`TRUE`;
        if (filters?.client) {
            clientFilter = sql`ph.client = (SELECT name FROM clients WHERE code = ${filters.client})`;
        }

        let merchandiserFilter = sql`TRUE`;
        if (filters?.merchandiser) {
            merchandiserFilter = sql`v.merchandiser = ${filters.merchandiser}`;
        }

        const result = await db.execute<{
            id: number;
            po_number: string;
            vendor: string | null;
            merchandiser: string | null;
            revised_ship_date: string | null;
            days_until_hod: number;
            missing_inline_inspection: boolean;
            missing_final_inspection: boolean;
            total_value: number | null;
        }>(sql`
      WITH active_pos AS (
        SELECT DISTINCT ON (ph.po_number)
          ph.id,
          ph.po_number,
          ph.vendor,
          v.merchandiser,
          ph.revised_ship_date,
          EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE))::int as days_until_hod,
          ph.total_value
        FROM po_headers ph
        LEFT JOIN vendors v ON v.name = ph.vendor
        WHERE ph.revised_ship_date IS NOT NULL
          AND ph.revised_ship_date > CURRENT_DATE
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
          AND ${clientFilter}
          AND ${merchandiserFilter}
        ORDER BY ph.po_number, ph.id DESC
      ),
      inline_inspections_booked AS (
        SELECT DISTINCT po_number FROM inspections WHERE inspection_type ILIKE '%inline%'
      ),
      final_inspections_booked AS (
        SELECT DISTINCT po_number FROM inspections WHERE inspection_type ILIKE '%final%'
      )
      SELECT 
        ap.id,
        ap.po_number,
        ap.vendor,
        ap.merchandiser,
        ap.revised_ship_date,
        ap.days_until_hod,
        -- Missing inline: within 14 days of HOD and no inline inspection booked (INLINE_INSPECTION_DAYS=14)
        (ap.days_until_hod <= ${AT_RISK_THRESHOLDS.INLINE_INSPECTION_DAYS} AND ap.days_until_hod > 0 AND iib.po_number IS NULL) as missing_inline_inspection,
        -- Missing final: within 7 days of HOD and no final inspection booked (FINAL_INSPECTION_DAYS=7)
        (ap.days_until_hod <= ${AT_RISK_THRESHOLDS.FINAL_INSPECTION_DAYS} AND ap.days_until_hod > 0 AND fib.po_number IS NULL) as missing_final_inspection,
        ap.total_value
      FROM active_pos ap
      LEFT JOIN inline_inspections_booked iib ON iib.po_number = ap.po_number
      LEFT JOIN final_inspections_booked fib ON fib.po_number = ap.po_number
      WHERE 
        -- Only show POs that are actually missing an inspection
        (ap.days_until_hod <= ${AT_RISK_THRESHOLDS.INLINE_INSPECTION_DAYS} AND ap.days_until_hod > 0 AND iib.po_number IS NULL)
        OR (ap.days_until_hod <= ${AT_RISK_THRESHOLDS.FINAL_INSPECTION_DAYS} AND ap.days_until_hod > 0 AND fib.po_number IS NULL)
      ORDER BY ap.days_until_hod ASC, ap.po_number
      LIMIT 200
    `);

        return result.rows.map(row => ({
            id: row.id,
            poNumber: row.po_number,
            vendor: row.vendor,
            merchandiser: row.merchandiser,
            revisedShipDate: row.revised_ship_date ? new Date(row.revised_ship_date) : null,
            daysUntilHod: row.days_until_hod,
            missingInlineInspection: row.missing_inline_inspection === true,
            missingFinalInspection: row.missing_final_inspection === true,
            totalValue: row.total_value,
        }));
    }

    // Vendor Timeline Template operations
    async getVendorTimelineTemplates(vendorId: number): Promise<VendorTimelineTemplate[]> {
        const result = await db.select()
            .from(vendorTimelineTemplates)
            .where(and(
                eq(vendorTimelineTemplates.vendorId, vendorId),
                eq(vendorTimelineTemplates.isActive, true)
            ))
            .orderBy(vendorTimelineTemplates.name);
        return result;
    }

    async getVendorTimelineTemplateById(id: number): Promise<{
        template: VendorTimelineTemplate | null;
        milestones: VendorTemplateMilestone[];
    }> {
        const templateResult = await db.select()
            .from(vendorTimelineTemplates)
            .where(eq(vendorTimelineTemplates.id, id));

        const template = templateResult[0] || null;

        if (!template) {
            return { template: null, milestones: [] };
        }

        const milestones = await db.select()
            .from(vendorTemplateMilestones)
            .where(eq(vendorTemplateMilestones.templateId, template.id))
            .orderBy(vendorTemplateMilestones.sortOrder);

        return { template, milestones };
    }

    async createVendorTimelineTemplate(template: InsertVendorTimelineTemplate): Promise<VendorTimelineTemplate> {
        const result = await db.insert(vendorTimelineTemplates)
            .values(template)
            .returning();
        return result[0];
    }

    async updateVendorTimelineTemplate(id: number, template: Partial<InsertVendorTimelineTemplate>): Promise<VendorTimelineTemplate | undefined> {
        const result = await db
            .update(vendorTimelineTemplates)
            .set({ ...template, updatedAt: new Date() })
            .where(eq(vendorTimelineTemplates.id, id))
            .returning();
        return result[0];
    }

    async deleteVendorTimelineTemplate(id: number): Promise<boolean> {
        // Soft delete by marking as inactive
        const result = await db
            .update(vendorTimelineTemplates)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(vendorTimelineTemplates.id, id))
            .returning();
        return result.length > 0;
    }

    async setVendorTemplateMilestones(templateId: number, milestones: InsertVendorTemplateMilestone[]): Promise<VendorTemplateMilestone[]> {
        // Delete existing milestones
        await db.delete(vendorTemplateMilestones)
            .where(eq(vendorTemplateMilestones.templateId, templateId));

        if (milestones.length === 0) return [];

        // Insert new milestones
        const result = await db.insert(vendorTemplateMilestones)
            .values(milestones.map((m, index) => ({
                ...m,
                templateId,
                sortOrder: m.sortOrder ?? index,
            })))
            .returning();

        return result;
    }

    // AI Analytics: Comprehensive shipping summary for AI context
    async getShippingAnalyticsSummary(): Promise<{
        overview: {
            totalActivePOs: number;
            totalLateOrders: number;
            trueOTD: number;
            originalOTD: number;
            avgDaysLate: number;
        };
        lateByVendor: Array<{ vendor: string; count: number; avgDaysLate: number }>;
        lateByStatus: Array<{ status: string; count: number; avgDaysLate: number }>;
        lateBySeverity: Array<{ bucket: string; count: number; avgDaysLate: number }>;
        topIssues: Array<{ issue: string; count: number; description: string }>;
        trends: {
            thisMonthLate: number;
            lastMonthLate: number;
            trendDirection: string;
            percentChange: number;
        };
    }> {
        // Get overview metrics
        const overviewResult = await db.execute<{
            total_active: string;
            total_late: string;
            avg_days_late: string;
        }>(sql`
      SELECT 
        COUNT(*)::text as total_active,
        COUNT(*) FILTER (
          WHERE revised_cancel_date IS NOT NULL 
          AND revised_cancel_date < CURRENT_DATE
          AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        )::text as total_late,
        COALESCE(
          ROUND(AVG(
            CASE WHEN revised_cancel_date IS NOT NULL 
              AND revised_cancel_date < CURRENT_DATE
              AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            THEN EXTRACT(DAY FROM CURRENT_DATE - revised_cancel_date)
            END
          ))::text, '0'
        ) as avg_days_late
      FROM po_headers
      WHERE COALESCE(total_value, 0) > 0
        AND COALESCE(program_description, '') NOT ILIKE 'SMP %'
        AND COALESCE(program_description, '') NOT ILIKE '8X8 %'
        AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'CANCELLED')
    `);

        // Get True OTD
        const otdResult = await db.execute<{
            true_otd: string;
            original_otd: string;
        }>(sql`
      WITH otd_data AS (
        SELECT 
          CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'ON-TIME' THEN 1 ELSE 0 END as on_time,
          CASE WHEN UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE') THEN 1 ELSE 0 END as shipped,
          CASE 
            WHEN revised_cancel_date IS NOT NULL 
            AND revised_cancel_date < CURRENT_DATE 
            AND UPPER(COALESCE(shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
            AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            THEN 1 ELSE 0 
          END as overdue_unshipped
        FROM po_headers
        WHERE COALESCE(total_value, 0) > 0
          AND COALESCE(program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(program_description, '') NOT ILIKE '8X8 %'
      )
      SELECT 
        COALESCE(
          ROUND(SUM(on_time)::numeric * 100 / NULLIF(SUM(shipped) + SUM(overdue_unshipped), 0), 1)::text,
          '0'
        ) as true_otd,
        COALESCE(
          ROUND(SUM(on_time)::numeric * 100 / NULLIF(SUM(shipped), 0), 1)::text,
          '0'
        ) as original_otd
      FROM otd_data
    `);

        // Get late by vendor - uses DISTINCT po_number to avoid SKU duplication
        const lateByVendorResult = await db.execute<{
            vendor: string;
            count: string;
            avg_days_late: string;
        }>(sql`
      WITH late_pos AS (
        SELECT DISTINCT ON (po_number)
          po_number,
          vendor,
          EXTRACT(DAY FROM CURRENT_DATE - revised_cancel_date)::int as days_late
        FROM po_headers
        WHERE revised_cancel_date IS NOT NULL
          AND revised_cancel_date < CURRENT_DATE
          AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          AND COALESCE(shipment_status, '') NOT IN ('On-Time', 'Late')
          AND COALESCE(total_value, 0) > 0
          AND COALESCE(program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(program_description, '') NOT ILIKE '8X8 %'
          AND po_number NOT LIKE '089%'
        ORDER BY po_number, id
      )
      SELECT 
        COALESCE(vendor, 'Unknown') as vendor,
        COUNT(*)::text as count,
        ROUND(AVG(days_late))::text as avg_days_late
      FROM late_pos
      GROUP BY vendor
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);

        // Get late by status - uses DISTINCT po_number to avoid SKU duplication
        const lateByStatusResult = await db.execute<{
            status: string;
            count: string;
            avg_days_late: string;
        }>(sql`
      WITH late_pos AS (
        SELECT DISTINCT ON (po_number)
          po_number,
          status,
          EXTRACT(DAY FROM CURRENT_DATE - revised_cancel_date)::int as days_late
        FROM po_headers
        WHERE revised_cancel_date IS NOT NULL
          AND revised_cancel_date < CURRENT_DATE
          AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          AND COALESCE(shipment_status, '') NOT IN ('On-Time', 'Late')
          AND COALESCE(total_value, 0) > 0
          AND COALESCE(program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(program_description, '') NOT ILIKE '8X8 %'
          AND po_number NOT LIKE '089%'
        ORDER BY po_number, id
      )
      SELECT 
        COALESCE(NULLIF(TRIM(status), ''), 'Unknown') as status,
        COUNT(*)::text as count,
        ROUND(AVG(days_late))::text as avg_days_late
      FROM late_pos
      GROUP BY status
      ORDER BY COUNT(*) DESC
    `);

        // Get late by severity bucket - uses shipped_pos CTE for consistency with status chart
        const lateBySeverityResult = await db.execute<{
            bucket: string;
            count: string;
            avg_days_late: string;
        }>(sql`
      WITH shipped_pos AS (
        SELECT DISTINCT po_number
        FROM shipments
        WHERE delivery_to_consolidator IS NOT NULL
      )
      SELECT 
        CASE 
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 7 THEN '1-7 days'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 14 THEN '8-14 days'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 30 THEN '15-30 days'
          ELSE '30+ days'
        END as bucket,
        COUNT(*)::text as count,
        ROUND(AVG(EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date))))::text as avg_days_late
      FROM po_headers ph
      WHERE (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
        AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
        AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND COALESCE(ph.total_value, 0) > 0
        AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
        AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
        AND ph.po_number NOT LIKE '089%'
        AND ph.po_number NOT IN (SELECT po_number FROM shipped_pos)
      GROUP BY 
        CASE 
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 7 THEN '1-7 days'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 14 THEN '8-14 days'
          WHEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) <= 30 THEN '15-30 days'
          ELSE '30+ days'
        END
      ORDER BY 
        MIN(EXTRACT(DAY FROM CURRENT_DATE - COALESCE(ph.revised_cancel_date, ph.original_cancel_date)))
    `);

        // Get month-over-month trends
        const trendsResult = await db.execute<{
            this_month: string;
            last_month: string;
        }>(sql`
      SELECT 
        COUNT(*) FILTER (
          WHERE revised_cancel_date >= DATE_TRUNC('month', CURRENT_DATE)
          AND revised_cancel_date < CURRENT_DATE
          AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        )::text as this_month,
        COUNT(*) FILTER (
          WHERE revised_cancel_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
          AND revised_cancel_date < DATE_TRUNC('month', CURRENT_DATE)
        )::text as last_month
      FROM po_headers
      WHERE COALESCE(total_value, 0) > 0
        AND COALESCE(program_description, '') NOT ILIKE 'SMP %'
        AND COALESCE(program_description, '') NOT ILIKE '8X8 %'
    `);

        const overview = overviewResult.rows[0];
        const otd = otdResult.rows[0];
        const trends = trendsResult.rows[0];

        const thisMonth = parseInt(trends?.this_month || '0');
        const lastMonth = parseInt(trends?.last_month || '0');
        const percentChange = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0;

        // Identify top issues based on data
        const topIssues: Array<{ issue: string; count: number; description: string }> = [];

        // Check for late orders
        const totalLate = parseInt(overview?.total_late || '0');
        if (totalLate > 0) {
            topIssues.push({
                issue: 'Late Unshipped Orders',
                count: totalLate,
                description: `${totalLate} orders are past their cancel date but haven't shipped`
            });
        }

        // Check severity - if many are 30+ days late
        const severityBuckets = lateBySeverityResult.rows;
        const critical = severityBuckets.find(b => b.bucket === '30+ days');
        if (critical && parseInt(critical.count) > 0) {
            topIssues.push({
                issue: 'Critical Delays (30+ days)',
                count: parseInt(critical.count),
                description: `${critical.count} orders are more than 30 days past cancel date`
            });
        }

        // Check for concentration in specific vendors
        const topVendor = lateByVendorResult.rows[0];
        if (topVendor && parseInt(topVendor.count) > 50) {
            topIssues.push({
                issue: `Vendor Concentration: ${topVendor.vendor}`,
                count: parseInt(topVendor.count),
                description: `${topVendor.vendor} has ${topVendor.count} late orders (avg ${topVendor.avg_days_late} days late)`
            });
        }

        return {
            overview: {
                totalActivePOs: parseInt(overview?.total_active || '0'),
                totalLateOrders: parseInt(overview?.total_late || '0'),
                trueOTD: parseFloat(otd?.true_otd || '0'),
                originalOTD: parseFloat(otd?.original_otd || '0'),
                avgDaysLate: parseInt(overview?.avg_days_late || '0')
            },
            lateByVendor: lateByVendorResult.rows.map(r => ({
                vendor: r.vendor,
                count: parseInt(r.count),
                avgDaysLate: parseInt(r.avg_days_late || '0')
            })),
            lateByStatus: lateByStatusResult.rows.map(r => ({
                status: r.status,
                count: parseInt(r.count),
                avgDaysLate: parseInt(r.avg_days_late || '0')
            })),
            lateBySeverity: lateBySeverityResult.rows.map(r => ({
                bucket: r.bucket,
                count: parseInt(r.count),
                avgDaysLate: parseInt(r.avg_days_late || '0')
            })),
            topIssues,
            trends: {
                thisMonthLate: thisMonth,
                lastMonthLate: lastMonth,
                trendDirection: thisMonth > lastMonth ? 'increasing' : thisMonth < lastMonth ? 'decreasing' : 'stable',
                percentChange: Math.round(percentChange * 10) / 10
            }
        };
    }

    async getVendorPerformanceSummary(): Promise<{
        totalVendors: number;
        vendorsWithLateOrders: number;
    }> {
        const result = await db.execute<{
            total_vendors: string;
            vendors_with_late: string;
        }>(sql`
      SELECT 
        COUNT(DISTINCT vendor)::text as total_vendors,
        COUNT(DISTINCT CASE 
          WHEN revised_cancel_date < CURRENT_DATE 
            AND UPPER(COALESCE(shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
            AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          THEN vendor 
        END)::text as vendors_with_late
      FROM po_headers
      WHERE COALESCE(total_value, 0) > 0
        AND COALESCE(program_description, '') NOT ILIKE 'SMP %'
        AND COALESCE(program_description, '') NOT ILIKE '8X8 %'
    `);

        const row = result.rows[0];
        return {
            totalVendors: parseInt(row?.total_vendors || '0'),
            vendorsWithLateOrders: parseInt(row?.vendors_with_late || '0')
        };
    }

    async getQualityInspectionSummary(): Promise<{
        pendingInspections: number;
        failedInspections: number;
    }> {
        const result = await db.execute<{
            pending: string;
            failed: string;
        }>(sql`
      SELECT 
        COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'PENDING')::text as pending,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED')::text as failed
      FROM inspections
    `);

        const row = result.rows[0];
        return {
            pendingInspections: parseInt(row?.pending || '0'),
            failedInspections: parseInt(row?.failed || '0')
        };
    }

    // Comprehensive AI Data Context - provides detailed data for AI analysis
    async getAIAnalystDataContext(): Promise<{
        latePOs: Array<{
            poNumber: string;
            vendor: string;
            daysLate: number;
            value: number;
            category: string;
            cancelDate: string;
        }>;
        atRiskPOs: Array<{
            poNumber: string;
            vendor: string;
            reason: string;
            cancelDate: string;
            value: number;
        }>;
        recentShipments: Array<{
            poNumber: string;
            vendor: string;
            status: string;
            shipDate: string;
            value: number;
        }>;
        upcomingDeadlines: Array<{
            poNumber: string;
            vendor: string;
            cancelDate: string;
            daysUntilDue: number;
            value: number;
        }>;
        vendorPerformance: Array<{
            vendor: string;
            totalPOs: number;
            latePOs: number;
            onTimeRate: number;
            totalValue: number;
        }>;
        categoryBreakdown: Array<{
            category: string;
            totalPOs: number;
            latePOs: number;
            totalValue: number;
        }>;
        failedInspections: Array<{
            poNumber: string;
            vendor: string;
            sku: string;
            inspectionType: string;
            inspectionDate: string;
        }>;
        staffPerformance: Array<{
            name: string;
            role: string;
            activePOs: number;
            latePOs: number;
            onTimeRate: number;
        }>;
    }> {
        // Get top late POs with details
        const latePOsResult = await db.execute<{
            po_number: string;
            vendor: string;
            days_late: string;
            total_value: string;
            category: string;
            cancel_date: string;
        }>(sql`
      SELECT DISTINCT ON (po_number)
        po_number,
        COALESCE(vendor, 'Unknown') as vendor,
        EXTRACT(DAY FROM CURRENT_DATE - COALESCE(revised_cancel_date, original_cancel_date))::text as days_late,
        COALESCE(total_value, 0)::text as total_value,
        COALESCE(product_category, 'Uncategorized') as category,
        TO_CHAR(COALESCE(revised_cancel_date, original_cancel_date), 'YYYY-MM-DD') as cancel_date
      FROM po_headers
      WHERE COALESCE(revised_cancel_date, original_cancel_date) < CURRENT_DATE
        AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND UPPER(COALESCE(shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
        AND COALESCE(total_value, 0) > 0
        AND COALESCE(program_description, '') NOT ILIKE 'SMP %'
        AND COALESCE(program_description, '') NOT ILIKE '8X8 %'
        AND po_number NOT LIKE '089%'
      ORDER BY po_number, revised_cancel_date
      LIMIT 25
    `);

        // Get at-risk POs (cancel date within 14 days)
        const atRiskResult = await db.execute<{
            po_number: string;
            vendor: string;
            cancel_date: string;
            total_value: string;
            days_until: string;
        }>(sql`
      SELECT DISTINCT ON (po_number)
        po_number,
        COALESCE(vendor, 'Unknown') as vendor,
        TO_CHAR(COALESCE(revised_cancel_date, original_cancel_date), 'YYYY-MM-DD') as cancel_date,
        COALESCE(total_value, 0)::text as total_value,
        EXTRACT(DAY FROM COALESCE(revised_cancel_date, original_cancel_date) - CURRENT_DATE)::text as days_until
      FROM po_headers
      WHERE COALESCE(revised_cancel_date, original_cancel_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
        AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND UPPER(COALESCE(shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
        AND COALESCE(total_value, 0) > 0
        AND po_number NOT LIKE '089%'
      ORDER BY po_number, revised_cancel_date
      LIMIT 25
    `);

        // Get recent shipments (last 30 days)
        const recentShipmentsResult = await db.execute<{
            po_number: string;
            vendor: string;
            shipment_status: string;
            ship_date: string;
            total_value: string;
        }>(sql`
      SELECT DISTINCT ON (po_number)
        po_number,
        COALESCE(vendor, 'Unknown') as vendor,
        COALESCE(shipment_status, 'Unknown') as shipment_status,
        TO_CHAR(COALESCE(revised_ship_date, original_ship_date), 'YYYY-MM-DD') as ship_date,
        COALESCE(total_value, 0)::text as total_value
      FROM po_headers
      WHERE UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE')
        AND COALESCE(revised_ship_date, original_ship_date) >= CURRENT_DATE - INTERVAL '30 days'
        AND COALESCE(total_value, 0) > 0
      ORDER BY po_number, revised_ship_date DESC
      LIMIT 25
    `);

        // Get upcoming deadlines (next 30 days)
        const upcomingResult = await db.execute<{
            po_number: string;
            vendor: string;
            cancel_date: string;
            days_until: string;
            total_value: string;
        }>(sql`
      SELECT DISTINCT ON (po_number)
        po_number,
        COALESCE(vendor, 'Unknown') as vendor,
        TO_CHAR(COALESCE(revised_cancel_date, original_cancel_date), 'YYYY-MM-DD') as cancel_date,
        EXTRACT(DAY FROM COALESCE(revised_cancel_date, original_cancel_date) - CURRENT_DATE)::text as days_until,
        COALESCE(total_value, 0)::text as total_value
      FROM po_headers
      WHERE COALESCE(revised_cancel_date, original_cancel_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND UPPER(COALESCE(shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
        AND COALESCE(total_value, 0) > 0
      ORDER BY po_number, revised_cancel_date
      LIMIT 30
    `);

        // Get vendor performance YTD
        const vendorPerfResult = await db.execute<{
            vendor: string;
            total_pos: string;
            late_pos: string;
            on_time_rate: string;
            total_value: string;
        }>(sql`
      WITH vendor_stats AS (
        SELECT 
          COALESCE(vendor, 'Unknown') as vendor,
          COUNT(DISTINCT po_number) as total_pos,
          COUNT(DISTINCT po_number) FILTER (
            WHERE COALESCE(revised_cancel_date, original_cancel_date) < CURRENT_DATE
            AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            AND UPPER(COALESCE(shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
          ) as late_pos,
          COUNT(DISTINCT po_number) FILTER (
            WHERE UPPER(COALESCE(shipment_status, '')) = 'ON-TIME'
          ) as on_time_pos,
          COUNT(DISTINCT po_number) FILTER (
            WHERE UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE')
          ) as shipped_pos,
          SUM(COALESCE(total_value, 0)) as total_value
        FROM po_headers
        WHERE EXTRACT(YEAR FROM COALESCE(po_date, CURRENT_DATE)) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND COALESCE(total_value, 0) > 0
          AND po_number NOT LIKE '089%'
        GROUP BY vendor
      )
      SELECT 
        vendor,
        total_pos::text,
        late_pos::text,
        CASE WHEN shipped_pos > 0 THEN ROUND(on_time_pos::numeric * 100 / shipped_pos, 1) ELSE 0 END::text as on_time_rate,
        total_value::text
      FROM vendor_stats
      WHERE total_pos > 0
      ORDER BY total_pos DESC
      LIMIT 20
    `);

        // Get category breakdown YTD
        const categoryResult = await db.execute<{
            category: string;
            total_pos: string;
            late_pos: string;
            total_value: string;
        }>(sql`
      SELECT 
        COALESCE(product_category, 'Uncategorized') as category,
        COUNT(DISTINCT po_number)::text as total_pos,
        COUNT(DISTINCT po_number) FILTER (
          WHERE COALESCE(revised_cancel_date, original_cancel_date) < CURRENT_DATE
          AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
          AND UPPER(COALESCE(shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
        )::text as late_pos,
        SUM(COALESCE(total_value, 0))::text as total_value
      FROM po_headers
      WHERE EXTRACT(YEAR FROM COALESCE(po_date, CURRENT_DATE)) = EXTRACT(YEAR FROM CURRENT_DATE)
        AND COALESCE(total_value, 0) > 0
      GROUP BY product_category
      ORDER BY SUM(COALESCE(total_value, 0)) DESC
      LIMIT 15
    `);

        // Get failed inspections (last 90 days)
        const failedInspResult = await db.execute<{
            po_number: string;
            vendor_name: string;
            sku: string;
            inspection_type: string;
            inspection_date: string;
        }>(sql`
      SELECT 
        COALESCE(po_number, 'Unknown') as po_number,
        COALESCE(vendor_name, 'Unknown') as vendor_name,
        COALESCE(sku, 'Unknown') as sku,
        COALESCE(inspection_type, 'Unknown') as inspection_type,
        TO_CHAR(inspection_date, 'YYYY-MM-DD') as inspection_date
      FROM inspections
      WHERE UPPER(COALESCE(result, '')) = 'FAILED'
        AND inspection_date >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY inspection_date DESC
      LIMIT 20
    `);

        // Get staff performance from vendors
        const staffPerfResult = await db.execute<{
            name: string;
            role: string;
            active_pos: string;
            late_pos: string;
            on_time_rate: string;
        }>(sql`
      WITH staff_stats AS (
        SELECT 
          v.merchandiser as name,
          'Merchandiser' as role,
          COUNT(DISTINCT ph.po_number) as active_pos,
          COUNT(DISTINCT ph.po_number) FILTER (
            WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
            AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            AND UPPER(COALESCE(ph.shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
          ) as late_pos,
          COUNT(DISTINCT ph.po_number) FILTER (
            WHERE UPPER(COALESCE(ph.shipment_status, '')) = 'ON-TIME'
          ) as on_time_pos,
          COUNT(DISTINCT ph.po_number) FILTER (
            WHERE UPPER(COALESCE(ph.shipment_status, '')) IN ('ON-TIME', 'LATE')
          ) as shipped_pos
        FROM vendors v
        JOIN po_headers ph ON v.name = ph.vendor
        WHERE v.merchandiser IS NOT NULL
          AND COALESCE(ph.total_value, 0) > 0
          AND EXTRACT(YEAR FROM COALESCE(ph.po_date, CURRENT_DATE)) = EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY v.merchandiser
      )
      SELECT 
        name,
        role,
        active_pos::text,
        late_pos::text,
        CASE WHEN shipped_pos > 0 THEN ROUND(on_time_pos::numeric * 100 / shipped_pos, 1) ELSE 0 END::text as on_time_rate
      FROM staff_stats
      WHERE name IS NOT NULL AND name != ''
      ORDER BY active_pos DESC
      LIMIT 15
    `);

        return {
            latePOs: latePOsResult.rows.map(r => ({
                poNumber: r.po_number,
                vendor: r.vendor,
                daysLate: parseInt(r.days_late || '0'),
                value: parseFloat(r.total_value || '0'),
                category: r.category,
                cancelDate: r.cancel_date
            })),
            atRiskPOs: atRiskResult.rows.map(r => ({
                poNumber: r.po_number,
                vendor: r.vendor,
                reason: `Due in ${r.days_until} days`,
                cancelDate: r.cancel_date,
                value: parseFloat(r.total_value || '0')
            })),
            recentShipments: recentShipmentsResult.rows.map(r => ({
                poNumber: r.po_number,
                vendor: r.vendor,
                status: r.shipment_status,
                shipDate: r.ship_date,
                value: parseFloat(r.total_value || '0')
            })),
            upcomingDeadlines: upcomingResult.rows.map(r => ({
                poNumber: r.po_number,
                vendor: r.vendor,
                cancelDate: r.cancel_date,
                daysUntilDue: parseInt(r.days_until || '0'),
                value: parseFloat(r.total_value || '0')
            })),
            vendorPerformance: vendorPerfResult.rows.map(r => ({
                vendor: r.vendor,
                totalPOs: parseInt(r.total_pos || '0'),
                latePOs: parseInt(r.late_pos || '0'),
                onTimeRate: parseFloat(r.on_time_rate || '0'),
                totalValue: parseFloat(r.total_value || '0')
            })),
            categoryBreakdown: categoryResult.rows.map(r => ({
                category: r.category,
                totalPOs: parseInt(r.total_pos || '0'),
                latePOs: parseInt(r.late_pos || '0'),
                totalValue: parseFloat(r.total_value || '0')
            })),
            failedInspections: failedInspResult.rows.map(r => ({
                poNumber: r.po_number,
                vendor: r.vendor_name,
                sku: r.sku,
                inspectionType: r.inspection_type,
                inspectionDate: r.inspection_date
            })),
            staffPerformance: staffPerfResult.rows.map(r => ({
                name: r.name,
                role: r.role,
                activePOs: parseInt(r.active_pos || '0'),
                latePOs: parseInt(r.late_pos || '0'),
                onTimeRate: parseFloat(r.on_time_rate || '0')
            }))
        };
    }

    // Vendor Trend Analysis - Monthly and Year-over-Year trends
    async getVendorTrendAnalysis(): Promise<{
        vendors: Array<{
            vendor: string;
            monthlyTrends: Array<{
                month: string;
                monthNum: number;
                totalPOs: number;
                onTimePOs: number;
                latePOs: number;
                otdRate: number;
                totalValue: number;
            }>;
            yearOverYear: {
                currentYearOTD: number;
                previousYearOTD: number;
                otdChange: number;
                currentYearValue: number;
                previousYearValue: number;
                valueChange: number;
            };
            trendDirection: string;
            riskLevel: string;
        }>;
    }> {
        const currentYear = new Date().getFullYear();
        const previousYear = currentYear - 1;

        // Get monthly trends for top vendors
        const monthlyResult = await db.execute<{
            vendor: string;
            month_num: string;
            month_name: string;
            total_pos: string;
            on_time_pos: string;
            late_pos: string;
            total_value: string;
        }>(sql`
      WITH monthly_stats AS (
        SELECT 
          COALESCE(vendor, 'Unknown') as vendor,
          EXTRACT(MONTH FROM COALESCE(revised_cancel_date, original_cancel_date))::int as month_num,
          TO_CHAR(COALESCE(revised_cancel_date, original_cancel_date), 'Mon') as month_name,
          COUNT(DISTINCT po_number) as total_pos,
          COUNT(DISTINCT po_number) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) = 'ON-TIME') as on_time_pos,
          COUNT(DISTINCT po_number) FILTER (
            WHERE COALESCE(revised_cancel_date, original_cancel_date) < CURRENT_DATE
            AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            AND UPPER(COALESCE(shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
          ) as late_pos,
          SUM(COALESCE(total_value, 0)) as total_value
        FROM po_headers
        WHERE EXTRACT(YEAR FROM COALESCE(revised_cancel_date, original_cancel_date)) = ${currentYear}
          AND COALESCE(total_value, 0) > 0
          AND po_number NOT LIKE '089%'
          AND COALESCE(program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(program_description, '') NOT ILIKE '8X8 %'
        GROUP BY vendor, month_num, month_name
      )
      SELECT 
        vendor,
        month_num::text,
        month_name,
        total_pos::text,
        on_time_pos::text,
        late_pos::text,
        total_value::text
      FROM monthly_stats
      WHERE vendor IN (
        SELECT vendor FROM monthly_stats GROUP BY vendor ORDER BY SUM(total_pos) DESC LIMIT 15
      )
      ORDER BY vendor, month_num
    `);

        // Get year-over-year comparison
        const yoyResult = await db.execute<{
            vendor: string;
            current_year_otd: string;
            previous_year_otd: string;
            current_year_value: string;
            previous_year_value: string;
        }>(sql`
      WITH vendor_yearly AS (
        SELECT 
          COALESCE(vendor, 'Unknown') as vendor,
          EXTRACT(YEAR FROM COALESCE(revised_cancel_date, original_cancel_date))::int as year,
          COUNT(DISTINCT po_number) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) = 'ON-TIME') as on_time_pos,
          COUNT(DISTINCT po_number) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE')) as shipped_pos,
          SUM(COALESCE(total_value, 0)) as total_value
        FROM po_headers
        WHERE EXTRACT(YEAR FROM COALESCE(revised_cancel_date, original_cancel_date)) IN (${currentYear}, ${previousYear})
          AND COALESCE(total_value, 0) > 0
          AND po_number NOT LIKE '089%'
        GROUP BY vendor, year
      )
      SELECT 
        v1.vendor,
        CASE WHEN v1.shipped_pos > 0 THEN ROUND(v1.on_time_pos::numeric * 100 / v1.shipped_pos, 1) ELSE 0 END::text as current_year_otd,
        CASE WHEN COALESCE(v2.shipped_pos, 0) > 0 THEN ROUND(COALESCE(v2.on_time_pos, 0)::numeric * 100 / v2.shipped_pos, 1) ELSE 0 END::text as previous_year_otd,
        v1.total_value::text as current_year_value,
        COALESCE(v2.total_value, 0)::text as previous_year_value
      FROM vendor_yearly v1
      LEFT JOIN vendor_yearly v2 ON v1.vendor = v2.vendor AND v2.year = ${previousYear}
      WHERE v1.year = ${currentYear}
      ORDER BY v1.total_value DESC
      LIMIT 15
    `);

        // Group monthly data by vendor
        const vendorMonthlyMap = new Map<string, Array<{
            month: string;
            monthNum: number;
            totalPOs: number;
            onTimePOs: number;
            latePOs: number;
            otdRate: number;
            totalValue: number;
        }>>();

        for (const row of monthlyResult.rows) {
            const vendor = row.vendor;
            if (!vendorMonthlyMap.has(vendor)) {
                vendorMonthlyMap.set(vendor, []);
            }
            const shipped = parseInt(row.on_time_pos) + parseInt(row.late_pos || '0');
            vendorMonthlyMap.get(vendor)!.push({
                month: row.month_name,
                monthNum: parseInt(row.month_num),
                totalPOs: parseInt(row.total_pos),
                onTimePOs: parseInt(row.on_time_pos),
                latePOs: parseInt(row.late_pos || '0'),
                otdRate: shipped > 0 ? Math.round(parseInt(row.on_time_pos) * 100 / shipped) : 0,
                totalValue: parseFloat(row.total_value)
            });
        }

        // Build final result
        const vendors = yoyResult.rows.map(row => {
            const currentOTD = parseFloat(row.current_year_otd);
            const previousOTD = parseFloat(row.previous_year_otd);
            const otdChange = currentOTD - previousOTD;

            // Determine trend direction
            let trendDirection = 'stable';
            if (otdChange > 5) trendDirection = 'improving';
            else if (otdChange < -5) trendDirection = 'declining';

            // Determine risk level based on current OTD
            let riskLevel = 'low';
            if (currentOTD < 70) riskLevel = 'high';
            else if (currentOTD < 85) riskLevel = 'medium';

            return {
                vendor: row.vendor,
                monthlyTrends: vendorMonthlyMap.get(row.vendor) || [],
                yearOverYear: {
                    currentYearOTD: currentOTD,
                    previousYearOTD: previousOTD,
                    otdChange: Math.round(otdChange * 10) / 10,
                    currentYearValue: parseFloat(row.current_year_value),
                    previousYearValue: parseFloat(row.previous_year_value),
                    valueChange: parseFloat(row.previous_year_value) > 0
                        ? Math.round((parseFloat(row.current_year_value) - parseFloat(row.previous_year_value)) / parseFloat(row.previous_year_value) * 1000) / 10
                        : 0
                },
                trendDirection,
                riskLevel
            };
        });

        return { vendors };
    }

    // Staff Trend Analysis - Monthly performance trends by merchandiser
    async getStaffTrendAnalysis(): Promise<{
        staff: Array<{
            name: string;
            role: string;
            monthlyTrends: Array<{
                month: string;
                monthNum: number;
                activePOs: number;
                shippedPOs: number;
                latePOs: number;
                otdRate: number;
                totalValue: number;
            }>;
            yearOverYear: {
                currentYearOTD: number;
                previousYearOTD: number;
                currentYearVolume: number;
                previousYearVolume: number;
            };
            performanceTrend: string;
        }>;
    }> {
        const currentYear = new Date().getFullYear();
        const previousYear = currentYear - 1;

        // Get monthly staff performance trends
        const monthlyResult = await db.execute<{
            merchandiser: string;
            month_num: string;
            month_name: string;
            active_pos: string;
            shipped_pos: string;
            on_time_pos: string;
            late_pos: string;
            total_value: string;
        }>(sql`
      WITH staff_monthly AS (
        SELECT 
          v.merchandiser,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as month_num,
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon') as month_name,
          COUNT(DISTINCT ph.po_number) as active_pos,
          COUNT(DISTINCT ph.po_number) FILTER (WHERE UPPER(COALESCE(ph.shipment_status, '')) IN ('ON-TIME', 'LATE')) as shipped_pos,
          COUNT(DISTINCT ph.po_number) FILTER (WHERE UPPER(COALESCE(ph.shipment_status, '')) = 'ON-TIME') as on_time_pos,
          COUNT(DISTINCT ph.po_number) FILTER (
            WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
            AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            AND UPPER(COALESCE(ph.shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
          ) as late_pos,
          SUM(COALESCE(ph.total_value, 0)) as total_value
        FROM vendors v
        JOIN po_headers ph ON v.name = ph.vendor
        WHERE v.merchandiser IS NOT NULL AND v.merchandiser != ''
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) = ${currentYear}
          AND COALESCE(ph.total_value, 0) > 0
          AND ph.po_number NOT LIKE '089%'
        GROUP BY v.merchandiser, month_num, month_name
      )
      SELECT 
        merchandiser,
        month_num::text,
        month_name,
        active_pos::text,
        shipped_pos::text,
        on_time_pos::text,
        late_pos::text,
        total_value::text
      FROM staff_monthly
      ORDER BY merchandiser, month_num
    `);

        // Get year-over-year comparison for staff
        const yoyResult = await db.execute<{
            merchandiser: string;
            current_year_otd: string;
            previous_year_otd: string;
            current_year_volume: string;
            previous_year_volume: string;
        }>(sql`
      WITH staff_yearly AS (
        SELECT 
          v.merchandiser,
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as year,
          COUNT(DISTINCT ph.po_number) FILTER (WHERE UPPER(COALESCE(ph.shipment_status, '')) = 'ON-TIME') as on_time_pos,
          COUNT(DISTINCT ph.po_number) FILTER (WHERE UPPER(COALESCE(ph.shipment_status, '')) IN ('ON-TIME', 'LATE')) as shipped_pos,
          COUNT(DISTINCT ph.po_number) as total_pos
        FROM vendors v
        JOIN po_headers ph ON v.name = ph.vendor
        WHERE v.merchandiser IS NOT NULL AND v.merchandiser != ''
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) IN (${currentYear}, ${previousYear})
          AND COALESCE(ph.total_value, 0) > 0
        GROUP BY v.merchandiser, year
      )
      SELECT 
        s1.merchandiser,
        CASE WHEN s1.shipped_pos > 0 THEN ROUND(s1.on_time_pos::numeric * 100 / s1.shipped_pos, 1) ELSE 0 END::text as current_year_otd,
        CASE WHEN COALESCE(s2.shipped_pos, 0) > 0 THEN ROUND(COALESCE(s2.on_time_pos, 0)::numeric * 100 / s2.shipped_pos, 1) ELSE 0 END::text as previous_year_otd,
        s1.total_pos::text as current_year_volume,
        COALESCE(s2.total_pos, 0)::text as previous_year_volume
      FROM staff_yearly s1
      LEFT JOIN staff_yearly s2 ON s1.merchandiser = s2.merchandiser AND s2.year = ${previousYear}
      WHERE s1.year = ${currentYear}
      ORDER BY s1.total_pos DESC
    `);

        // Group monthly data by staff
        const staffMonthlyMap = new Map<string, Array<{
            month: string;
            monthNum: number;
            activePOs: number;
            shippedPOs: number;
            latePOs: number;
            otdRate: number;
            totalValue: number;
        }>>();

        for (const row of monthlyResult.rows) {
            const name = row.merchandiser;
            if (!staffMonthlyMap.has(name)) {
                staffMonthlyMap.set(name, []);
            }
            const shipped = parseInt(row.shipped_pos);
            staffMonthlyMap.get(name)!.push({
                month: row.month_name,
                monthNum: parseInt(row.month_num),
                activePOs: parseInt(row.active_pos),
                shippedPOs: shipped,
                latePOs: parseInt(row.late_pos),
                otdRate: shipped > 0 ? Math.round(parseInt(row.on_time_pos) * 100 / shipped) : 0,
                totalValue: parseFloat(row.total_value)
            });
        }

        // Build final result
        const staff = yoyResult.rows.map(row => {
            const currentOTD = parseFloat(row.current_year_otd);
            const previousOTD = parseFloat(row.previous_year_otd);
            const otdChange = currentOTD - previousOTD;

            let performanceTrend = 'stable';
            if (otdChange > 5) performanceTrend = 'improving';
            else if (otdChange < -5) performanceTrend = 'declining';

            return {
                name: row.merchandiser,
                role: 'Merchandiser',
                monthlyTrends: staffMonthlyMap.get(row.merchandiser) || [],
                yearOverYear: {
                    currentYearOTD: currentOTD,
                    previousYearOTD: previousOTD,
                    currentYearVolume: parseInt(row.current_year_volume),
                    previousYearVolume: parseInt(row.previous_year_volume)
                },
                performanceTrend
            };
        });

        return { staff };
    }

    // SKU Trend Analysis - Monthly order and quality trends by SKU
    async getSkuTrendAnalysis(): Promise<{
        skus: Array<{
            skuCode: string;
            description: string;
            vendor: string;
            monthlyTrends: Array<{
                month: string;
                monthNum: number;
                orderCount: number;
                totalValue: number;
                onTimeCount: number;
                lateCount: number;
                failedInspections: number;
            }>;
            qualityTrend: string;
            deliveryTrend: string;
            totalYTDValue: number;
            totalYTDOrders: number;
        }>;
    }> {
        const currentYear = new Date().getFullYear();

        // Get monthly SKU trends (top SKUs by value)
        const skuResult = await db.execute<{
            sku_code: string;
            description: string;
            vendor: string;
            month_num: string;
            month_name: string;
            order_count: string;
            total_value: string;
            on_time_count: string;
            late_count: string;
        }>(sql`
      WITH sku_monthly AS (
        SELECT 
          COALESCE(pli.sku, 'Unknown') as sku_code,
          COALESCE(pli.seller_style, '') as description,
          COALESCE(ph.vendor, 'Unknown') as vendor,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as month_num,
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon') as month_name,
          COUNT(*) as order_count,
          SUM(COALESCE(pli.line_total, 0)) as total_value,
          COUNT(*) FILTER (WHERE UPPER(COALESCE(ph.shipment_status, '')) = 'ON-TIME') as on_time_count,
          COUNT(*) FILTER (
            WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
            AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
            AND UPPER(COALESCE(ph.shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
          ) as late_count
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) = ${currentYear}
          AND COALESCE(ph.total_value, 0) > 0
          AND pli.sku IS NOT NULL
        GROUP BY pli.sku, pli.seller_style, ph.vendor, month_num, month_name
      ),
      top_skus AS (
        SELECT sku_code FROM sku_monthly GROUP BY sku_code ORDER BY SUM(total_value) DESC LIMIT 20
      )
      SELECT 
        sm.sku_code,
        sm.description,
        sm.vendor,
        sm.month_num::text,
        sm.month_name,
        sm.order_count::text,
        sm.total_value::text,
        sm.on_time_count::text,
        sm.late_count::text
      FROM sku_monthly sm
      JOIN top_skus ts ON sm.sku_code = ts.sku_code
      ORDER BY sm.sku_code, sm.month_num
    `);

        // Get failed inspections by SKU
        const inspResult = await db.execute<{
            sku: string;
            month_num: string;
            failed_count: string;
        }>(sql`
      SELECT 
        COALESCE(sku, 'Unknown') as sku,
        EXTRACT(MONTH FROM inspection_date)::text as month_num,
        COUNT(*)::text as failed_count
      FROM inspections
      WHERE UPPER(COALESCE(result, '')) = 'FAILED'
        AND EXTRACT(YEAR FROM inspection_date) = ${currentYear}
        AND sku IS NOT NULL
      GROUP BY sku, month_num
      ORDER BY sku, month_num
    `);

        // Build inspection map
        const inspectionMap = new Map<string, Map<number, number>>();
        for (const row of inspResult.rows) {
            if (!inspectionMap.has(row.sku)) {
                inspectionMap.set(row.sku, new Map());
            }
            inspectionMap.get(row.sku)!.set(parseInt(row.month_num), parseInt(row.failed_count));
        }

        // Group by SKU
        const skuMap = new Map<string, {
            description: string;
            vendor: string;
            monthlyTrends: Array<{
                month: string;
                monthNum: number;
                orderCount: number;
                totalValue: number;
                onTimeCount: number;
                lateCount: number;
                failedInspections: number;
            }>;
            totalYTDValue: number;
            totalYTDOrders: number;
        }>();

        for (const row of skuResult.rows) {
            const skuCode = row.sku_code;
            if (!skuMap.has(skuCode)) {
                skuMap.set(skuCode, {
                    description: row.description,
                    vendor: row.vendor,
                    monthlyTrends: [],
                    totalYTDValue: 0,
                    totalYTDOrders: 0
                });
            }
            const sku = skuMap.get(skuCode)!;
            const monthNum = parseInt(row.month_num);
            const failedInspections = inspectionMap.get(skuCode)?.get(monthNum) || 0;

            sku.monthlyTrends.push({
                month: row.month_name,
                monthNum,
                orderCount: parseInt(row.order_count),
                totalValue: parseFloat(row.total_value),
                onTimeCount: parseInt(row.on_time_count),
                lateCount: parseInt(row.late_count),
                failedInspections
            });
            sku.totalYTDValue += parseFloat(row.total_value);
            sku.totalYTDOrders += parseInt(row.order_count);
        }

        // Calculate trends
        const skus = Array.from(skuMap.entries()).map(([skuCode, data]) => {
            // Determine quality trend from failed inspections
            const recentMonths = data.monthlyTrends.slice(-3);
            const earlierMonths = data.monthlyTrends.slice(0, 3);
            const recentFailures = recentMonths.reduce((sum, m) => sum + m.failedInspections, 0);
            const earlierFailures = earlierMonths.reduce((sum, m) => sum + m.failedInspections, 0);

            let qualityTrend = 'stable';
            if (recentFailures > earlierFailures + 2) qualityTrend = 'declining';
            else if (recentFailures < earlierFailures - 2) qualityTrend = 'improving';

            // Determine delivery trend
            const recentLate = recentMonths.reduce((sum, m) => sum + m.lateCount, 0);
            const earlierLate = earlierMonths.reduce((sum, m) => sum + m.lateCount, 0);

            let deliveryTrend = 'stable';
            if (recentLate > earlierLate + 2) deliveryTrend = 'declining';
            else if (recentLate < earlierLate - 2) deliveryTrend = 'improving';

            return {
                skuCode,
                description: data.description,
                vendor: data.vendor,
                monthlyTrends: data.monthlyTrends,
                qualityTrend,
                deliveryTrend,
                totalYTDValue: data.totalYTDValue,
                totalYTDOrders: data.totalYTDOrders
            };
        });

        return { skus };
    }

    // Comprehensive AI Trend Context - Quarterly summary for AI analysis
    async getAITrendContext(): Promise<{
        vendorTrends: Array<{
            vendor: string;
            q1OTD: number;
            q2OTD: number;
            q3OTD: number;
            q4OTD: number;
            ytdOTD: number;
            trendDirection: string;
            riskLevel: string;
        }>;
        staffTrends: Array<{
            name: string;
            role: string;
            q1OTD: number;
            q2OTD: number;
            q3OTD: number;
            q4OTD: number;
            ytdOTD: number;
            performanceTrend: string;
        }>;
        skuTrends: Array<{
            skuCode: string;
            vendor: string;
            monthlyOrders: number[];
            monthlyFailures: number[];
            qualityTrend: string;
            deliveryTrend: string;
        }>;
        seasonalPatterns: {
            peakMonths: string[];
            slowMonths: string[];
            avgMonthlyVolume: number;
        };
        yearOverYearComparison: {
            currentYearOTD: number;
            previousYearOTD: number;
            otdImprovement: number;
            currentYearValue: number;
            previousYearValue: number;
            valueGrowth: number;
        };
        futurePOs: Array<{
            month: string;
            poCount: number;
            totalValue: number;
            vendorCount: number;
            topVendors: string[];
        }>;
    }> {
        // Use rolling 24-month windows for comprehensive historical data access
        const now = new Date();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
        const twentyFourMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 24, now.getDate());
        const thirtySixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 36, now.getDate());
        const sixMonthsFuture = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());

        // Get quarterly vendor OTD (rolling 24 months for comprehensive analysis)
        const vendorQuarterlyResult = await db.execute<{
            vendor: string;
            q1_otd: string;
            q2_otd: string;
            q3_otd: string;
            q4_otd: string;
            ytd_otd: string;
        }>(sql`
      WITH vendor_quarterly AS (
        SELECT 
          COALESCE(vendor, 'Unknown') as vendor,
          CASE WHEN EXTRACT(QUARTER FROM COALESCE(revised_cancel_date, original_cancel_date)) = 1 THEN 1 ELSE 0 END as q1,
          CASE WHEN EXTRACT(QUARTER FROM COALESCE(revised_cancel_date, original_cancel_date)) = 2 THEN 1 ELSE 0 END as q2,
          CASE WHEN EXTRACT(QUARTER FROM COALESCE(revised_cancel_date, original_cancel_date)) = 3 THEN 1 ELSE 0 END as q3,
          CASE WHEN EXTRACT(QUARTER FROM COALESCE(revised_cancel_date, original_cancel_date)) = 4 THEN 1 ELSE 0 END as q4,
          CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'ON-TIME' THEN 1 ELSE 0 END as on_time,
          CASE WHEN UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE') THEN 1 ELSE 0 END as shipped
        FROM po_headers
        WHERE COALESCE(revised_cancel_date, original_cancel_date) >= ${twentyFourMonthsAgo}
          AND COALESCE(revised_cancel_date, original_cancel_date) <= CURRENT_DATE
          AND COALESCE(total_value, 0) > 0
          AND po_number NOT LIKE '089%'
      )
      SELECT 
        vendor,
        CASE WHEN SUM(q1 * shipped) > 0 THEN ROUND(SUM(q1 * on_time)::numeric * 100 / SUM(q1 * shipped), 1) ELSE 0 END::text as q1_otd,
        CASE WHEN SUM(q2 * shipped) > 0 THEN ROUND(SUM(q2 * on_time)::numeric * 100 / SUM(q2 * shipped), 1) ELSE 0 END::text as q2_otd,
        CASE WHEN SUM(q3 * shipped) > 0 THEN ROUND(SUM(q3 * on_time)::numeric * 100 / SUM(q3 * shipped), 1) ELSE 0 END::text as q3_otd,
        CASE WHEN SUM(q4 * shipped) > 0 THEN ROUND(SUM(q4 * on_time)::numeric * 100 / SUM(q4 * shipped), 1) ELSE 0 END::text as q4_otd,
        CASE WHEN SUM(shipped) > 0 THEN ROUND(SUM(on_time)::numeric * 100 / SUM(shipped), 1) ELSE 0 END::text as ytd_otd
      FROM vendor_quarterly
      GROUP BY vendor
      HAVING COUNT(*) > 10
      ORDER BY SUM(shipped) DESC
      LIMIT 15
    `);

        // Get quarterly staff OTD (rolling 24 months)
        const staffQuarterlyResult = await db.execute<{
            merchandiser: string;
            q1_otd: string;
            q2_otd: string;
            q3_otd: string;
            q4_otd: string;
            ytd_otd: string;
        }>(sql`
      WITH staff_quarterly AS (
        SELECT 
          v.merchandiser,
          CASE WHEN EXTRACT(QUARTER FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) = 1 THEN 1 ELSE 0 END as q1,
          CASE WHEN EXTRACT(QUARTER FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) = 2 THEN 1 ELSE 0 END as q2,
          CASE WHEN EXTRACT(QUARTER FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) = 3 THEN 1 ELSE 0 END as q3,
          CASE WHEN EXTRACT(QUARTER FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) = 4 THEN 1 ELSE 0 END as q4,
          CASE WHEN UPPER(COALESCE(ph.shipment_status, '')) = 'ON-TIME' THEN 1 ELSE 0 END as on_time,
          CASE WHEN UPPER(COALESCE(ph.shipment_status, '')) IN ('ON-TIME', 'LATE') THEN 1 ELSE 0 END as shipped
        FROM vendors v
        JOIN po_headers ph ON v.name = ph.vendor
        WHERE v.merchandiser IS NOT NULL AND v.merchandiser != ''
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${twentyFourMonthsAgo}
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= CURRENT_DATE
          AND COALESCE(ph.total_value, 0) > 0
      )
      SELECT 
        merchandiser,
        CASE WHEN SUM(q1 * shipped) > 0 THEN ROUND(SUM(q1 * on_time)::numeric * 100 / SUM(q1 * shipped), 1) ELSE 0 END::text as q1_otd,
        CASE WHEN SUM(q2 * shipped) > 0 THEN ROUND(SUM(q2 * on_time)::numeric * 100 / SUM(q2 * shipped), 1) ELSE 0 END::text as q2_otd,
        CASE WHEN SUM(q3 * shipped) > 0 THEN ROUND(SUM(q3 * on_time)::numeric * 100 / SUM(q3 * shipped), 1) ELSE 0 END::text as q3_otd,
        CASE WHEN SUM(q4 * shipped) > 0 THEN ROUND(SUM(q4 * on_time)::numeric * 100 / SUM(q4 * shipped), 1) ELSE 0 END::text as q4_otd,
        CASE WHEN SUM(shipped) > 0 THEN ROUND(SUM(on_time)::numeric * 100 / SUM(shipped), 1) ELSE 0 END::text as ytd_otd
      FROM staff_quarterly
      GROUP BY merchandiser
      ORDER BY SUM(shipped) DESC
    `);

        // Get SKU trends summary (rolling 24 months)
        const skuTrendResult = await db.execute<{
            sku_code: string;
            vendor: string;
            monthly_orders: string;
            monthly_failures: string;
        }>(sql`
      WITH sku_monthly AS (
        SELECT 
          COALESCE(pli.sku, 'Unknown') as sku_code,
          COALESCE(ph.vendor, 'Unknown') as vendor,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as month_num,
          COUNT(*) as order_count
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        WHERE COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= ${twentyFourMonthsAgo}
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= CURRENT_DATE
          AND COALESCE(ph.total_value, 0) > 0
          AND pli.sku IS NOT NULL
        GROUP BY pli.sku, ph.vendor, EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int
      ),
      sku_failures AS (
        SELECT 
          COALESCE(sku, 'Unknown') as sku_code,
          EXTRACT(MONTH FROM inspection_date)::int as month_num,
          COUNT(*) as fail_count
        FROM inspections
        WHERE UPPER(COALESCE(result, '')) = 'FAILED'
          AND inspection_date >= ${twentyFourMonthsAgo}
          AND inspection_date <= CURRENT_DATE
          AND sku IS NOT NULL
        GROUP BY sku, EXTRACT(MONTH FROM inspection_date)::int
      ),
      top_skus AS (
        SELECT sku_code, vendor FROM sku_monthly GROUP BY sku_code, vendor ORDER BY SUM(order_count) DESC LIMIT 15
      )
      SELECT 
        ts.sku_code,
        ts.vendor,
        COALESCE(string_agg(sm.order_count::text, ',' ORDER BY sm.month_num), '') as monthly_orders,
        COALESCE(string_agg(COALESCE(sf.fail_count, 0)::text, ',' ORDER BY sm.month_num), '') as monthly_failures
      FROM top_skus ts
      LEFT JOIN sku_monthly sm ON ts.sku_code = sm.sku_code
      LEFT JOIN sku_failures sf ON ts.sku_code = sf.sku_code AND sm.month_num = sf.month_num
      GROUP BY ts.sku_code, ts.vendor
    `);

        // Get seasonal patterns (rolling 24 months for better seasonality detection)
        const seasonalResult = await db.execute<{
            month_num: string;
            month_name: string;
            order_count: string;
        }>(sql`
      SELECT 
        EXTRACT(MONTH FROM COALESCE(po_date, revised_cancel_date, original_cancel_date))::text as month_num,
        TO_CHAR(COALESCE(po_date, revised_cancel_date, original_cancel_date), 'Mon') as month_name,
        COUNT(DISTINCT po_number)::text as order_count
      FROM po_headers
      WHERE COALESCE(po_date, revised_cancel_date, original_cancel_date) >= ${twentyFourMonthsAgo}
        AND COALESCE(po_date, revised_cancel_date, original_cancel_date) <= CURRENT_DATE
        AND COALESCE(total_value, 0) > 0
      GROUP BY EXTRACT(MONTH FROM COALESCE(po_date, revised_cancel_date, original_cancel_date)),
               TO_CHAR(COALESCE(po_date, revised_cancel_date, original_cancel_date), 'Mon')
      ORDER BY EXTRACT(MONTH FROM COALESCE(po_date, revised_cancel_date, original_cancel_date))::int
    `);

        // Get rolling 12-month vs previous 12-month comparison
        const yoyResult = await db.execute<{
            current_year_otd: string;
            previous_year_otd: string;
            current_year_value: string;
            previous_year_value: string;
        }>(sql`
      SELECT 
        CASE WHEN SUM(CASE WHEN period = 'current' AND shipped = 1 THEN 1 ELSE 0 END) > 0 
          THEN ROUND(SUM(CASE WHEN period = 'current' AND on_time = 1 THEN 1 ELSE 0 END)::numeric * 100 / 
            SUM(CASE WHEN period = 'current' AND shipped = 1 THEN 1 ELSE 0 END), 1) 
          ELSE 0 END::text as current_year_otd,
        CASE WHEN SUM(CASE WHEN period = 'previous' AND shipped = 1 THEN 1 ELSE 0 END) > 0 
          THEN ROUND(SUM(CASE WHEN period = 'previous' AND on_time = 1 THEN 1 ELSE 0 END)::numeric * 100 / 
            SUM(CASE WHEN period = 'previous' AND shipped = 1 THEN 1 ELSE 0 END), 1) 
          ELSE 0 END::text as previous_year_otd,
        SUM(CASE WHEN period = 'current' THEN value ELSE 0 END)::text as current_year_value,
        SUM(CASE WHEN period = 'previous' THEN value ELSE 0 END)::text as previous_year_value
      FROM (
        SELECT 
          CASE 
            WHEN COALESCE(revised_cancel_date, original_cancel_date) >= ${twelveMonthsAgo} 
              AND COALESCE(revised_cancel_date, original_cancel_date) <= CURRENT_DATE THEN 'current'
            WHEN COALESCE(revised_cancel_date, original_cancel_date) >= ${twentyFourMonthsAgo}
              AND COALESCE(revised_cancel_date, original_cancel_date) < ${twelveMonthsAgo} THEN 'previous'
          END as period,
          CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'ON-TIME' THEN 1 ELSE 0 END as on_time,
          CASE WHEN UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE') THEN 1 ELSE 0 END as shipped,
          COALESCE(total_value, 0) as value
        FROM po_headers
        WHERE COALESCE(revised_cancel_date, original_cancel_date) >= ${twentyFourMonthsAgo}
          AND COALESCE(revised_cancel_date, original_cancel_date) <= CURRENT_DATE
          AND COALESCE(total_value, 0) > 0
          AND po_number NOT LIKE '089%'
      ) sub
      WHERE period IS NOT NULL
    `);

        // Get forward-looking POs (future orders) for forecasting insights
        // Excludes samples (zero-value), 8x8 components, and franchise POs (089 prefix)
        const futurePOsResult = await db.execute<{
            month_name: string;
            po_count: string;
            total_value: string;
            vendor_count: string;
            top_vendors: string;
        }>(sql`
      SELECT 
        TO_CHAR(COALESCE(revised_cancel_date, original_cancel_date), 'Mon YYYY') as month_name,
        COUNT(DISTINCT po_number)::text as po_count,
        SUM(COALESCE(total_value, 0))::text as total_value,
        COUNT(DISTINCT vendor)::text as vendor_count,
        STRING_AGG(DISTINCT vendor, ', ' ORDER BY vendor) as top_vendors
      FROM po_headers
      WHERE COALESCE(revised_cancel_date, original_cancel_date) > CURRENT_DATE
        AND COALESCE(revised_cancel_date, original_cancel_date) <= ${sixMonthsFuture}
        AND COALESCE(total_value, 0) > 0
        AND UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED')
        AND po_number NOT LIKE '089%'
        AND (COALESCE(program_description, '') NOT LIKE '8X8 %' OR program_description IS NULL)
      GROUP BY TO_CHAR(COALESCE(revised_cancel_date, original_cancel_date), 'Mon YYYY'),
               EXTRACT(YEAR FROM COALESCE(revised_cancel_date, original_cancel_date)),
               EXTRACT(MONTH FROM COALESCE(revised_cancel_date, original_cancel_date))
      ORDER BY EXTRACT(YEAR FROM COALESCE(revised_cancel_date, original_cancel_date)),
               EXTRACT(MONTH FROM COALESCE(revised_cancel_date, original_cancel_date))
    `);

        // Process vendor trends
        const vendorTrends = vendorQuarterlyResult.rows.map(row => {
            const q1 = parseFloat(row.q1_otd);
            const q2 = parseFloat(row.q2_otd);
            const q3 = parseFloat(row.q3_otd);
            const q4 = parseFloat(row.q4_otd);
            const ytd = parseFloat(row.ytd_otd);

            // Calculate trend direction
            const quarters = [q1, q2, q3, q4].filter(q => q > 0);
            let trendDirection = 'stable';
            if (quarters.length >= 2) {
                const recent = quarters.slice(-2).reduce((a, b) => a + b, 0) / 2;
                const earlier = quarters.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
                if (recent > earlier + 5) trendDirection = 'improving';
                else if (recent < earlier - 5) trendDirection = 'declining';
            }

            let riskLevel = 'low';
            if (ytd < 70) riskLevel = 'high';
            else if (ytd < 85) riskLevel = 'medium';

            return {
                vendor: row.vendor,
                q1OTD: q1,
                q2OTD: q2,
                q3OTD: q3,
                q4OTD: q4,
                ytdOTD: ytd,
                trendDirection,
                riskLevel
            };
        });

        // Process staff trends
        const staffTrends = staffQuarterlyResult.rows.map(row => {
            const q1 = parseFloat(row.q1_otd);
            const q2 = parseFloat(row.q2_otd);
            const q3 = parseFloat(row.q3_otd);
            const q4 = parseFloat(row.q4_otd);
            const ytd = parseFloat(row.ytd_otd);

            const quarters = [q1, q2, q3, q4].filter(q => q > 0);
            let performanceTrend = 'stable';
            if (quarters.length >= 2) {
                const recent = quarters.slice(-2).reduce((a, b) => a + b, 0) / 2;
                const earlier = quarters.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
                if (recent > earlier + 5) performanceTrend = 'improving';
                else if (recent < earlier - 5) performanceTrend = 'declining';
            }

            return {
                name: row.merchandiser,
                role: 'Merchandiser',
                q1OTD: q1,
                q2OTD: q2,
                q3OTD: q3,
                q4OTD: q4,
                ytdOTD: ytd,
                performanceTrend
            };
        });

        // Process SKU trends
        const skuTrends = skuTrendResult.rows.map(row => {
            const monthlyOrders = row.monthly_orders ? row.monthly_orders.split(',').map(n => parseInt(n) || 0) : [];
            const monthlyFailures = row.monthly_failures ? row.monthly_failures.split(',').map(n => parseInt(n) || 0) : [];

            // Determine trends
            const recentOrders = monthlyOrders.slice(-3);
            const earlierOrders = monthlyOrders.slice(0, 3);
            const recentFailures = monthlyFailures.slice(-3).reduce((a, b) => a + b, 0);
            const earlierFailures = monthlyFailures.slice(0, 3).reduce((a, b) => a + b, 0);

            let qualityTrend = 'stable';
            if (recentFailures > earlierFailures + 1) qualityTrend = 'declining';
            else if (recentFailures < earlierFailures - 1) qualityTrend = 'improving';

            let deliveryTrend = 'stable';
            const recentAvg = recentOrders.length > 0 ? recentOrders.reduce((a, b) => a + b, 0) / recentOrders.length : 0;
            const earlierAvg = earlierOrders.length > 0 ? earlierOrders.reduce((a, b) => a + b, 0) / earlierOrders.length : 0;
            if (recentAvg > earlierAvg * 1.2) deliveryTrend = 'growing';
            else if (recentAvg < earlierAvg * 0.8) deliveryTrend = 'declining';

            return {
                skuCode: row.sku_code,
                vendor: row.vendor,
                monthlyOrders,
                monthlyFailures,
                qualityTrend,
                deliveryTrend
            };
        });

        // Process seasonal patterns
        const monthlyVolumes = seasonalResult.rows.map(r => ({
            month: r.month_name,
            volume: parseInt(r.order_count)
        }));
        const avgVolume = monthlyVolumes.length > 0
            ? monthlyVolumes.reduce((sum, m) => sum + m.volume, 0) / monthlyVolumes.length
            : 0;
        const peakMonths = monthlyVolumes.filter(m => m.volume > avgVolume * 1.2).map(m => m.month);
        const slowMonths = monthlyVolumes.filter(m => m.volume < avgVolume * 0.8).map(m => m.month);

        // Process YoY comparison
        const yoyRow = yoyResult.rows[0];
        const currentOTD = parseFloat(yoyRow?.current_year_otd || '0');
        const previousOTD = parseFloat(yoyRow?.previous_year_otd || '0');
        const currentValue = parseFloat(yoyRow?.current_year_value || '0');
        const previousValue = parseFloat(yoyRow?.previous_year_value || '0');

        // Process future POs
        const futurePOs = futurePOsResult.rows.map(row => ({
            month: row.month_name,
            poCount: parseInt(row.po_count) || 0,
            totalValue: parseFloat(row.total_value) || 0,
            vendorCount: parseInt(row.vendor_count) || 0,
            topVendors: row.top_vendors ? row.top_vendors.split(', ').slice(0, 5) : []
        }));

        return {
            vendorTrends,
            staffTrends,
            skuTrends,
            seasonalPatterns: {
                peakMonths,
                slowMonths,
                avgMonthlyVolume: Math.round(avgVolume)
            },
            yearOverYearComparison: {
                currentYearOTD: currentOTD,
                previousYearOTD: previousOTD,
                otdImprovement: Math.round((currentOTD - previousOTD) * 10) / 10,
                currentYearValue: currentValue,
                previousYearValue: previousValue,
                valueGrowth: previousValue > 0 ? Math.round((currentValue - previousValue) / previousValue * 1000) / 10 : 0
            },
            futurePOs
        };
    }

    // ============ DETAILED PO DATA FOR AI ANALYST ============

    // Get comprehensive PO details with all OS340 fields, shipments, and line items
    async getDetailedPOsForAI(): Promise<{
        activePOs: Array<{
            poNumber: string;
            copNumber: string | null;
            vendor: string;
            client: string;
            category: string;
            program: string;
            totalValue: number;
            shippedValue: number;
            totalQuantity: number;
            balanceQuantity: number;
            status: string;
            shipmentStatus: string;
            poDate: string | null;
            originalCancelDate: string | null;
            revisedCancelDate: string | null;
            revisedBy: string | null;
            revisedReason: string | null;
            daysUntilDue: number | null;
            daysLate: number | null;
            skus: string[];
            shipments: Array<{
                shipmentNumber: number;
                deliveryDate: string | null;
                sailingDate: string | null;
                qtyShipped: number;
                shippedValue: number;
                ptsNumber: string | null;
                logisticStatus: string | null;
                hodStatus: string | null;
            }>;
        }>;
        summary: {
            totalActivePOs: number;
            totalActiveValue: number;
            missingCOP: number;
            withShipments: number;
            withoutShipments: number;
        };
    }> {
        // Get active POs with detailed info
        const posResult = await db.execute<{
            po_number: string;
            cop_number: string | null;
            vendor: string;
            client: string;
            category: string;
            program: string;
            total_value: string;
            shipped_value: string;
            total_quantity: string;
            balance_quantity: string;
            status: string;
            shipment_status: string;
            po_date: string | null;
            original_cancel_date: string | null;
            revised_cancel_date: string | null;
            revised_by: string | null;
            revised_reason: string | null;
            days_until_due: string | null;
            days_late: string | null;
        }>(sql`
      SELECT 
        po_number,
        cop_number,
        COALESCE(vendor, 'Unknown') as vendor,
        COALESCE(client, 'Unknown') as client,
        COALESCE(product_category, 'Uncategorized') as category,
        COALESCE(program_description, '') as program,
        COALESCE(total_value, 0)::text as total_value,
        COALESCE(shipped_value, 0)::text as shipped_value,
        COALESCE(total_quantity, 0)::text as total_quantity,
        COALESCE(balance_quantity, 0)::text as balance_quantity,
        COALESCE(status, 'Unknown') as status,
        COALESCE(shipment_status, 'Pending') as shipment_status,
        TO_CHAR(po_date, 'YYYY-MM-DD') as po_date,
        TO_CHAR(original_cancel_date, 'YYYY-MM-DD') as original_cancel_date,
        TO_CHAR(revised_cancel_date, 'YYYY-MM-DD') as revised_cancel_date,
        revised_by,
        revised_reason,
        CASE 
          WHEN COALESCE(revised_cancel_date, original_cancel_date) > CURRENT_DATE 
          THEN EXTRACT(DAY FROM COALESCE(revised_cancel_date, original_cancel_date) - CURRENT_DATE)::text
          ELSE NULL
        END as days_until_due,
        CASE 
          WHEN COALESCE(revised_cancel_date, original_cancel_date) < CURRENT_DATE 
            AND UPPER(COALESCE(shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
          THEN EXTRACT(DAY FROM CURRENT_DATE - COALESCE(revised_cancel_date, original_cancel_date))::text
          ELSE NULL
        END as days_late
      FROM po_headers
      WHERE UPPER(COALESCE(status, '')) NOT IN ('CLOSED', 'CANCELLED')
        AND COALESCE(total_value, 0) > 0
        AND po_number NOT LIKE '089%'
        AND (COALESCE(program_description, '') NOT LIKE '8X8 %' OR program_description IS NULL)
      ORDER BY COALESCE(revised_cancel_date, original_cancel_date) ASC
      LIMIT 200
    `);

        // Get SKUs for these POs
        const poNumbers = posResult.rows.map(p => p.po_number);
        const skusMap = new Map<string, string[]>();
        const shipmentsMap = new Map<string, Array<{
            shipmentNumber: number;
            deliveryDate: string | null;
            sailingDate: string | null;
            qtyShipped: number;
            shippedValue: number;
            ptsNumber: string | null;
            logisticStatus: string | null;
            hodStatus: string | null;
        }>>();

        if (poNumbers.length > 0) {
            // Get SKUs for POs
            const skusResult = await db.execute<{
                po_number: string;
                sku: string;
            }>(sql`
        SELECT DISTINCT po_number, sku
        FROM po_line_items
        WHERE po_number = ANY(${poNumbers})
          AND sku IS NOT NULL
      `);

            for (const row of skusResult.rows) {
                const list = skusMap.get(row.po_number) || [];
                list.push(row.sku);
                skusMap.set(row.po_number, list);
            }

            // Get shipments for POs
            const shipmentsResult = await db.execute<{
                po_number: string;
                shipment_number: string;
                delivery_date: string | null;
                sailing_date: string | null;
                qty_shipped: string;
                shipped_value: string;
                pts_number: string | null;
                logistic_status: string | null;
                hod_status: string | null;
            }>(sql`
        SELECT 
          po_number,
          shipment_number::text,
          TO_CHAR(delivery_to_consolidator, 'YYYY-MM-DD') as delivery_date,
          TO_CHAR(actual_sailing_date, 'YYYY-MM-DD') as sailing_date,
          COALESCE(qty_shipped, 0)::text as qty_shipped,
          COALESCE(shipped_value, 0)::text as shipped_value,
          pts_number,
          logistic_status,
          hod_status
        FROM shipments
        WHERE po_number = ANY(${poNumbers})
        ORDER BY po_number, shipment_number
      `);

            for (const row of shipmentsResult.rows) {
                const list = shipmentsMap.get(row.po_number) || [];
                list.push({
                    shipmentNumber: parseInt(row.shipment_number) || 1,
                    deliveryDate: row.delivery_date,
                    sailingDate: row.sailing_date,
                    qtyShipped: parseInt(row.qty_shipped) || 0,
                    shippedValue: parseInt(row.shipped_value) || 0,
                    ptsNumber: row.pts_number,
                    logisticStatus: row.logistic_status,
                    hodStatus: row.hod_status
                });
                shipmentsMap.set(row.po_number, list);
            }
        }

        const activePOs = posResult.rows.map(row => ({
            poNumber: row.po_number,
            copNumber: row.cop_number,
            vendor: row.vendor,
            client: row.client,
            category: row.category,
            program: row.program,
            totalValue: parseInt(row.total_value) || 0,
            shippedValue: parseInt(row.shipped_value) || 0,
            totalQuantity: parseInt(row.total_quantity) || 0,
            balanceQuantity: parseInt(row.balance_quantity) || 0,
            status: row.status,
            shipmentStatus: row.shipment_status,
            poDate: row.po_date,
            originalCancelDate: row.original_cancel_date,
            revisedCancelDate: row.revised_cancel_date,
            revisedBy: row.revised_by,
            revisedReason: row.revised_reason,
            daysUntilDue: row.days_until_due ? parseInt(row.days_until_due) : null,
            daysLate: row.days_late ? parseInt(row.days_late) : null,
            skus: skusMap.get(row.po_number) || [],
            shipments: shipmentsMap.get(row.po_number) || []
        }));

        // Calculate summary
        const missingCOP = activePOs.filter(p => !p.copNumber).length;
        const withShipments = activePOs.filter(p => p.shipments.length > 0).length;

        return {
            activePOs,
            summary: {
                totalActivePOs: activePOs.length,
                totalActiveValue: activePOs.reduce((sum, p) => sum + p.totalValue, 0),
                missingCOP,
                withShipments,
                withoutShipments: activePOs.length - withShipments
            }
        };
    }

    // Get projections data for AI analyst
    async getProjectionsForAI(): Promise<{
        currentProjections: Array<{
            vendorCode: string;
            sku: string;
            skuDescription: string | null;
            brand: string;
            collection: string | null;
            year: number;
            month: number;
            monthName: string;
            projectedValue: number;
            projectedQuantity: number;
            matchStatus: string;
            matchedPoNumber: string | null;
            actualValue: number | null;
            actualQuantity: number | null;
            variancePct: number | null;
            orderType: string;
        }>;
        accuracySummary: {
            totalProjections: number;
            matched: number;
            unmatched: number;
            expired: number;
            accurateCount: number;
            overOrderedCount: number;
            underOrderedCount: number;
            avgVariancePct: number;
        };
        vendorAccuracy: Array<{
            vendorCode: string;
            totalProjections: number;
            matchedCount: number;
            avgVariancePct: number;
        }>;
    }> {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        // Get current projections (next 12 months) - filter by latest import_batch_id per vendor to avoid duplicates
        // NULL batch rows only included if vendor has no batches at all (legacy data)
        // NOTE: FURNITURE imports create batches per vendor (each vendor's projection file is a separate batch)
        //       If import granularity changes to vendor+month/sku, update CTE grouping accordingly
        const projectionsResult = await db.execute<{
            vendor_code: string;
            sku: string;
            sku_description: string | null;
            brand: string;
            collection: string | null;
            year: string;
            month: string;
            projection_value: string;
            quantity: string;
            match_status: string;
            matched_po_number: string | null;
            actual_value: string | null;
            actual_quantity: string | null;
            variance_pct: string | null;
            order_type: string;
        }>(sql`
      SELECT 
        p.vendor_code,
        p.sku,
        p.sku_description,
        p.brand,
        p.collection,
        p.year::text,
        p.month::text,
        COALESCE(p.projection_value, 0)::text as projection_value,
        COALESCE(p.quantity, 0)::text as quantity,
        COALESCE(p.match_status, 'unmatched') as match_status,
        p.matched_po_number,
        p.actual_value::text as actual_value,
        p.actual_quantity::text as actual_quantity,
        p.variance_pct::text as variance_pct,
        COALESCE(p.order_type, 'regular') as order_type
      FROM active_projections p
      WHERE (p.year * 12 + p.month) >= (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int - 3)
        AND (p.year * 12 + p.month) <= (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int + 12)
      ORDER BY p.year, p.month, p.vendor_code, p.sku
      LIMIT 500
    `);

        const currentProjections = projectionsResult.rows.map(row => ({
            vendorCode: row.vendor_code,
            sku: row.sku,
            skuDescription: row.sku_description,
            brand: row.brand,
            collection: row.collection,
            year: parseInt(row.year),
            month: parseInt(row.month),
            monthName: monthNames[parseInt(row.month) - 1] || 'Unknown',
            projectedValue: parseInt(row.projection_value) || 0,
            projectedQuantity: parseInt(row.quantity) || 0,
            matchStatus: row.match_status,
            matchedPoNumber: row.matched_po_number,
            actualValue: row.actual_value ? parseInt(row.actual_value) : null,
            actualQuantity: row.actual_quantity ? parseInt(row.actual_quantity) : null,
            variancePct: row.variance_pct ? parseInt(row.variance_pct) : null,
            orderType: row.order_type
        }));

        // Calculate accuracy summary
        const matched = currentProjections.filter(p => p.matchStatus === 'matched').length;
        const unmatched = currentProjections.filter(p => p.matchStatus === 'unmatched').length;
        const expired = currentProjections.filter(p => p.matchStatus === 'expired').length;

        const matchedWithVariance = currentProjections.filter(p => p.matchStatus === 'matched' && p.variancePct !== null);
        const accurateCount = matchedWithVariance.filter(p => Math.abs(p.variancePct!) <= 10).length;
        const overOrderedCount = matchedWithVariance.filter(p => p.variancePct! > 10).length;
        const underOrderedCount = matchedWithVariance.filter(p => p.variancePct! < -10).length;
        const avgVariancePct = matchedWithVariance.length > 0
            ? Math.round(matchedWithVariance.reduce((sum, p) => sum + (p.variancePct || 0), 0) / matchedWithVariance.length)
            : 0;

        // Get vendor accuracy - filter by latest import_batch_id per vendor
        // NULL batch rows only included if vendor has no batches at all (legacy data)
        const vendorAccuracyResult = await db.execute<{
            vendor_code: string;
            total: string;
            matched_count: string;
            avg_variance: string;
        }>(sql`
      SELECT 
        p.vendor_code,
        COUNT(*)::text as total,
        COUNT(CASE WHEN p.match_status = 'matched' THEN 1 END)::text as matched_count,
        COALESCE(AVG(CASE WHEN p.match_status = 'matched' THEN p.variance_pct END), 0)::text as avg_variance
      FROM active_projections p
      WHERE (p.year * 12 + p.month) >= (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int - 6)
      GROUP BY p.vendor_code
      HAVING COUNT(*) > 5
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);

        const vendorAccuracy = vendorAccuracyResult.rows.map(row => ({
            vendorCode: row.vendor_code,
            totalProjections: parseInt(row.total) || 0,
            matchedCount: parseInt(row.matched_count) || 0,
            avgVariancePct: Math.round(parseFloat(row.avg_variance) || 0)
        }));

        // Get historical accuracy by month - shows projection-to-order conversion rates over time
        const historicalAccuracyResult = await db.execute<{
            year: string;
            month: string;
            total_projections: string;
            matched_count: string;
            unmatched_count: string;
            expired_count: string;
            match_rate_pct: string;
        }>(sql`
      SELECT 
        p.year::text,
        p.month::text,
        COUNT(*)::text as total_projections,
        COUNT(CASE WHEN p.match_status = 'matched' THEN 1 END)::text as matched_count,
        COUNT(CASE WHEN p.match_status = 'unmatched' THEN 1 END)::text as unmatched_count,
        COUNT(CASE WHEN p.match_status = 'expired' THEN 1 END)::text as expired_count,
        ROUND(COUNT(CASE WHEN p.match_status = 'matched' THEN 1 END)::numeric * 100 / NULLIF(COUNT(*), 0), 1)::text as match_rate_pct
      FROM active_projections p
      WHERE (p.year * 12 + p.month) >= (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int - 11)
        AND (p.year * 12 + p.month) <= (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int)
      GROUP BY p.year, p.month
      ORDER BY p.year, p.month
    `);

        const historicalAccuracy = historicalAccuracyResult.rows.map(row => ({
            year: parseInt(row.year),
            month: parseInt(row.month),
            monthName: monthNames[parseInt(row.month) - 1] || 'Unknown',
            totalProjections: parseInt(row.total_projections) || 0,
            matchedCount: parseInt(row.matched_count) || 0,
            unmatchedCount: parseInt(row.unmatched_count) || 0,
            expiredCount: parseInt(row.expired_count) || 0,
            matchRatePct: parseFloat(row.match_rate_pct) || 0
        }));

        return {
            currentProjections,
            historicalAccuracy,
            accuracySummary: {
                totalProjections: currentProjections.length,
                matched,
                unmatched,
                expired,
                accurateCount,
                overOrderedCount,
                underOrderedCount,
                avgVariancePct
            },
            vendorAccuracy
        };
    }

    // Get SKU data for AI analysis - top sellers, shipping frequency, vendor breakdown
    async getSKUDataForAI(): Promise<{
        topSellingSkus: Array<{
            sku: string;
            description: string | null;
            vendor: string;
            category: string | null;
            totalOrders: number;
            totalValue: number;
            totalQuantity: number;
            avgOrderValue: number;
            shipmentCount: number;
            lastOrderDate: string | null;
        }>;
        skusByCategory: Array<{
            category: string;
            skuCount: number;
            totalValue: number;
            avgOrderValue: number;
        }>;
        skusByVendor: Array<{
            vendor: string;
            skuCount: number;
            totalValue: number;
            totalOrders: number;
        }>;
        summary: {
            totalActiveSKUs: number;
            totalSKUValue: number;
            avgSKUOrderValue: number;
        };
    }> {
        // Get top selling SKUs with shipping frequency
        const topSkusResult = await db.execute<{
            sku: string;
            description: string | null;
            vendor: string;
            category: string | null;
            total_orders: string;
            total_value: string;
            total_quantity: string;
            avg_order_value: string;
            shipment_count: string;
            last_order_date: string | null;
        }>(sql`
      SELECT 
        li.sku,
        li.sku_description as description,
        h.vendor,
        h.category,
        COUNT(DISTINCT h.po_number)::text as total_orders,
        COALESCE(SUM(li.total_value), 0)::text as total_value,
        COALESCE(SUM(li.quantity), 0)::text as total_quantity,
        ROUND(COALESCE(AVG(li.total_value), 0))::text as avg_order_value,
        COUNT(DISTINCT s.id)::text as shipment_count,
        MAX(h.po_date)::text as last_order_date
      FROM po_line_items li
      JOIN po_headers h ON li.po_number = h.po_number
      LEFT JOIN shipments s ON h.po_number = s.po_number
      WHERE h.po_date >= CURRENT_DATE - INTERVAL '24 months'
        AND COALESCE(h.total_value, 0) > 0
        AND h.po_number NOT LIKE '089%'
        AND (h.program_description IS NULL OR h.program_description NOT LIKE '8X8 %')
      GROUP BY li.sku, li.sku_description, h.vendor, h.category
      HAVING SUM(li.total_value) > 0
      ORDER BY SUM(li.total_value) DESC
      LIMIT 50
    `);

        const topSellingSkus = topSkusResult.rows.map(row => ({
            sku: row.sku,
            description: row.description,
            vendor: row.vendor,
            category: row.category,
            totalOrders: parseInt(row.total_orders) || 0,
            totalValue: parseInt(row.total_value) || 0,
            totalQuantity: parseInt(row.total_quantity) || 0,
            avgOrderValue: parseInt(row.avg_order_value) || 0,
            shipmentCount: parseInt(row.shipment_count) || 0,
            lastOrderDate: row.last_order_date
        }));

        // Get SKU breakdown by category (with same exclusions as top SKUs)
        const categoryResult = await db.execute<{
            category: string;
            sku_count: string;
            total_value: string;
            avg_order_value: string;
        }>(sql`
      SELECT 
        COALESCE(h.category, 'Uncategorized') as category,
        COUNT(DISTINCT li.sku)::text as sku_count,
        COALESCE(SUM(li.total_value), 0)::text as total_value,
        ROUND(COALESCE(AVG(li.total_value), 0))::text as avg_order_value
      FROM po_line_items li
      JOIN po_headers h ON li.po_number = h.po_number
      WHERE h.po_date >= CURRENT_DATE - INTERVAL '24 months'
        AND COALESCE(h.total_value, 0) > 0
        AND h.po_number NOT LIKE '089%'
        AND (h.program_description IS NULL OR h.program_description NOT LIKE '8X8 %')
      GROUP BY COALESCE(h.category, 'Uncategorized')
      ORDER BY SUM(li.total_value) DESC
      LIMIT 20
    `);

        const skusByCategory = categoryResult.rows.map(row => ({
            category: row.category,
            skuCount: parseInt(row.sku_count) || 0,
            totalValue: parseInt(row.total_value) || 0,
            avgOrderValue: parseInt(row.avg_order_value) || 0
        }));

        // Get SKU breakdown by vendor (with same exclusions as top SKUs)
        const vendorResult = await db.execute<{
            vendor: string;
            sku_count: string;
            total_value: string;
            total_orders: string;
        }>(sql`
      SELECT 
        h.vendor,
        COUNT(DISTINCT li.sku)::text as sku_count,
        COALESCE(SUM(li.total_value), 0)::text as total_value,
        COUNT(DISTINCT h.po_number)::text as total_orders
      FROM po_line_items li
      JOIN po_headers h ON li.po_number = h.po_number
      WHERE h.po_date >= CURRENT_DATE - INTERVAL '24 months'
        AND COALESCE(h.total_value, 0) > 0
        AND h.po_number NOT LIKE '089%'
        AND (h.program_description IS NULL OR h.program_description NOT LIKE '8X8 %')
      GROUP BY h.vendor
      ORDER BY SUM(li.total_value) DESC
      LIMIT 20
    `);

        const skusByVendor = vendorResult.rows.map(row => ({
            vendor: row.vendor,
            skuCount: parseInt(row.sku_count) || 0,
            totalValue: parseInt(row.total_value) || 0,
            totalOrders: parseInt(row.total_orders) || 0
        }));

        // Calculate summary from full-scope aggregate (not just top 50)
        const summaryResult = await db.execute<{
            total_skus: string;
            total_value: string;
            avg_order_value: string;
        }>(sql`
      SELECT 
        COUNT(DISTINCT li.sku)::text as total_skus,
        COALESCE(SUM(li.total_value), 0)::text as total_value,
        ROUND(COALESCE(AVG(li.total_value), 0))::text as avg_order_value
      FROM po_line_items li
      JOIN po_headers h ON li.po_number = h.po_number
      WHERE h.po_date >= CURRENT_DATE - INTERVAL '24 months'
        AND COALESCE(h.total_value, 0) > 0
        AND h.po_number NOT LIKE '089%'
        AND (h.program_description IS NULL OR h.program_description NOT LIKE '8X8 %')
    `);

        const totalActiveSKUs = parseInt(summaryResult.rows[0]?.total_skus) || 0;
        const totalSKUValue = parseInt(summaryResult.rows[0]?.total_value) || 0;
        const avgSKUOrderValue = parseInt(summaryResult.rows[0]?.avg_order_value) || 0;

        return {
            topSellingSkus,
            skusByCategory,
            skusByVendor,
            summary: {
                totalActiveSKUs,
                totalSKUValue,
                avgSKUOrderValue
            }
        };
    }

    // ============ ADVANCED AI ANALYTICS ============

    // Vendor Risk Scoring - calculates composite risk scores based on OTD, quality, trends, and concentration
    async getVendorRiskScoring(): Promise<{
        vendors: Array<{
            vendor: string;
            riskScore: number;
            riskLevel: 'critical' | 'high' | 'medium' | 'low';
            factors: {
                otdScore: number;
                qualityScore: number;
                trendScore: number;
                concentrationScore: number;
            };
            metrics: {
                ytdOTD: number;
                lateOrders: number;
                totalOrders: number;
                failedInspections: number;
                totalValue: number;
            };
            recommendations: string[];
        }>;
        summary: {
            criticalCount: number;
            highRiskCount: number;
            mediumRiskCount: number;
            lowRiskCount: number;
        };
    }> {
        const currentYear = new Date().getFullYear();

        // Get vendor performance data with OTD, late orders, and quality metrics
        const vendorDataResult = await db.execute<{
            vendor: string;
            total_orders: string;
            on_time_orders: string;
            late_orders: string;
            total_value: string;
            avg_days_late: string;
        }>(sql`
      WITH vendor_orders AS (
        SELECT 
          COALESCE(vendor, 'Unknown') as vendor,
          COUNT(*) as total_orders,
          SUM(CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'ON-TIME' THEN 1 ELSE 0 END) as on_time_orders,
          SUM(CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'LATE' THEN 1 ELSE 0 END) as late_orders,
          SUM(COALESCE(total_value, 0)) as total_value,
          AVG(CASE 
            WHEN UPPER(COALESCE(shipment_status, '')) = 'LATE' 
            THEN GREATEST(0, EXTRACT(DAY FROM (CURRENT_DATE - COALESCE(revised_cancel_date, original_cancel_date)))::int)
            ELSE 0 
          END) as avg_days_late
        FROM po_headers
        WHERE EXTRACT(YEAR FROM COALESCE(revised_cancel_date, original_cancel_date)) = ${currentYear}
          AND COALESCE(total_value, 0) > 0
          AND po_number NOT LIKE '089%'
        GROUP BY vendor
        HAVING COUNT(*) >= 5
      )
      SELECT * FROM vendor_orders ORDER BY total_orders DESC LIMIT 50
    `);

        // Get quality failure data
        const qualityDataResult = await db.execute<{
            vendor_name: string;
            failed_inspections: string;
            total_inspections: string;
        }>(sql`
      SELECT 
        vendor_name,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED')::text as failed_inspections,
        COUNT(*)::text as total_inspections
      FROM inspections
      WHERE EXTRACT(YEAR FROM inspection_date) = ${currentYear}
        AND vendor_name IS NOT NULL
      GROUP BY vendor_name
    `);

        // Get recent trend data (last 3 months vs previous 3 months)
        const trendDataResult = await db.execute<{
            vendor: string;
            recent_otd: string;
            earlier_otd: string;
        }>(sql`
      WITH monthly_perf AS (
        SELECT 
          COALESCE(vendor, 'Unknown') as vendor,
          CASE WHEN COALESCE(revised_cancel_date, original_cancel_date) >= CURRENT_DATE - INTERVAL '90 days' THEN 'recent' ELSE 'earlier' END as period,
          CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'ON-TIME' THEN 1 ELSE 0 END as on_time,
          CASE WHEN UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE') THEN 1 ELSE 0 END as shipped
        FROM po_headers
        WHERE COALESCE(revised_cancel_date, original_cancel_date) >= CURRENT_DATE - INTERVAL '180 days'
          AND COALESCE(total_value, 0) > 0
      )
      SELECT 
        vendor,
        CASE WHEN SUM(CASE WHEN period = 'recent' THEN shipped ELSE 0 END) > 0 
          THEN ROUND(SUM(CASE WHEN period = 'recent' THEN on_time ELSE 0 END)::numeric * 100 / 
               NULLIF(SUM(CASE WHEN period = 'recent' THEN shipped ELSE 0 END), 0), 1) 
          ELSE 0 END::text as recent_otd,
        CASE WHEN SUM(CASE WHEN period = 'earlier' THEN shipped ELSE 0 END) > 0 
          THEN ROUND(SUM(CASE WHEN period = 'earlier' THEN on_time ELSE 0 END)::numeric * 100 / 
               NULLIF(SUM(CASE WHEN period = 'earlier' THEN shipped ELSE 0 END), 0), 1) 
          ELSE 0 END::text as earlier_otd
      FROM monthly_perf
      GROUP BY vendor
    `);

        // Build quality map
        const qualityMap = new Map<string, { failed: number; total: number }>();
        qualityDataResult.rows.forEach(r => {
            qualityMap.set(r.vendor_name, {
                failed: parseInt(r.failed_inspections),
                total: parseInt(r.total_inspections)
            });
        });

        // Build trend map
        const trendMap = new Map<string, { recent: number; earlier: number }>();
        trendDataResult.rows.forEach(r => {
            trendMap.set(r.vendor, {
                recent: parseFloat(r.recent_otd),
                earlier: parseFloat(r.earlier_otd)
            });
        });

        // Calculate total portfolio value for concentration scoring
        const totalPortfolioValue = vendorDataResult.rows.reduce((sum, r) => sum + parseFloat(r.total_value), 0);

        // Calculate risk scores for each vendor
        const vendors = vendorDataResult.rows.map(row => {
            const totalOrders = parseInt(row.total_orders);
            const onTimeOrders = parseInt(row.on_time_orders);
            const lateOrders = parseInt(row.late_orders);
            const totalValue = parseFloat(row.total_value);
            const avgDaysLate = parseFloat(row.avg_days_late);

            const quality = qualityMap.get(row.vendor) || { failed: 0, total: 0 };
            const trend = trendMap.get(row.vendor) || { recent: 100, earlier: 100 };

            // Calculate component scores (0-25 each, higher = worse risk)
            // OTD Score: Based on on-time rate (poor OTD = high risk)
            const otdRate = totalOrders > 0 ? (onTimeOrders / totalOrders) * 100 : 100;
            const otdScore = Math.min(25, Math.max(0, (100 - otdRate) / 4));

            // Quality Score: Based on inspection failure rate
            const failureRate = quality.total > 0 ? (quality.failed / quality.total) * 100 : 0;
            const qualityScore = Math.min(25, failureRate / 2);

            // Trend Score: Based on recent performance vs earlier (declining = high risk)
            const trendDiff = trend.earlier - trend.recent; // Positive = declining
            const trendScore = Math.min(25, Math.max(0, trendDiff / 2));

            // Concentration Score: Based on % of total portfolio (high concentration = risk)
            const concentrationPct = totalPortfolioValue > 0 ? (totalValue / totalPortfolioValue) * 100 : 0;
            const concentrationScore = Math.min(25, concentrationPct);

            // Total risk score (0-100, higher = worse)
            const riskScore = Math.round(otdScore + qualityScore + trendScore + concentrationScore);

            // Determine risk level
            let riskLevel: 'critical' | 'high' | 'medium' | 'low' = 'low';
            if (riskScore >= 60) riskLevel = 'critical';
            else if (riskScore >= 40) riskLevel = 'high';
            else if (riskScore >= 20) riskLevel = 'medium';

            // Generate recommendations
            const recommendations: string[] = [];
            if (otdScore > 10) recommendations.push('Review production timelines and capacity');
            if (qualityScore > 10) recommendations.push('Schedule quality improvement meeting');
            if (trendScore > 10) recommendations.push('Investigate recent performance decline');
            if (concentrationScore > 15) recommendations.push('Consider diversifying order allocation');
            if (avgDaysLate > 10) recommendations.push('Implement expediting protocols');

            return {
                vendor: row.vendor,
                riskScore,
                riskLevel,
                factors: {
                    otdScore: Math.round(otdScore * 10) / 10,
                    qualityScore: Math.round(qualityScore * 10) / 10,
                    trendScore: Math.round(trendScore * 10) / 10,
                    concentrationScore: Math.round(concentrationScore * 10) / 10
                },
                metrics: {
                    ytdOTD: Math.round(otdRate * 10) / 10,
                    lateOrders,
                    totalOrders,
                    failedInspections: quality.failed,
                    totalValue
                },
                recommendations
            };
        });

        // Sort by risk score descending
        vendors.sort((a, b) => b.riskScore - a.riskScore);

        return {
            vendors,
            summary: {
                criticalCount: vendors.filter(v => v.riskLevel === 'critical').length,
                highRiskCount: vendors.filter(v => v.riskLevel === 'high').length,
                mediumRiskCount: vendors.filter(v => v.riskLevel === 'medium').length,
                lowRiskCount: vendors.filter(v => v.riskLevel === 'low').length
            }
        };
    }

    // Late Order Prediction - identifies POs likely to be late based on patterns
    async getLateOrderPrediction(): Promise<{
        predictions: Array<{
            poNumber: string;
            vendor: string;
            category: string;
            cancelDate: string;
            daysUntilDue: number;
            totalValue: number;
            riskProbability: number;
            riskFactors: string[];
            recommendation: string;
        }>;
        summary: {
            highRiskCount: number;
            mediumRiskCount: number;
            totalAtRisk: number;
            potentialValueAtRisk: number;
        };
    }> {
        // Get active unshipped POs with vendor history
        const activePOsResult = await db.execute<{
            po_number: string;
            vendor: string;
            category: string;
            cancel_date: string;
            days_until_due: string;
            total_value: string;
            vendor_otd_rate: string;
            vendor_avg_late_days: string;
            has_failed_inspection: string;
            has_timeline_delay: string;
        }>(sql`
      WITH vendor_history AS (
        SELECT 
          vendor,
          CASE WHEN COUNT(*) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE')) > 0
            THEN ROUND(COUNT(*) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) = 'ON-TIME')::numeric * 100 / 
                 COUNT(*) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE')), 1)
            ELSE 100 END as otd_rate,
          COALESCE(AVG(CASE 
            WHEN UPPER(COALESCE(shipment_status, '')) = 'LATE' 
            THEN GREATEST(0, EXTRACT(DAY FROM (CURRENT_DATE - COALESCE(revised_cancel_date, original_cancel_date)))::int)
            ELSE 0 
          END), 0) as avg_late_days
        FROM po_headers
        WHERE COALESCE(revised_cancel_date, original_cancel_date) >= CURRENT_DATE - INTERVAL '365 days'
          AND COALESCE(total_value, 0) > 0
        GROUP BY vendor
      ),
      active_pos AS (
        SELECT DISTINCT ON (ph.po_number)
          ph.po_number,
          COALESCE(ph.vendor, 'Unknown') as vendor,
          COALESCE(ph.product_category, 'Unknown') as category,
          COALESCE(ph.revised_cancel_date, ph.original_cancel_date) as cancel_date,
          (COALESCE(ph.revised_cancel_date, ph.original_cancel_date) - CURRENT_DATE) as days_until_due,
          COALESCE(ph.total_value, 0) as total_value
        FROM po_headers ph
        WHERE UPPER(COALESCE(ph.shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
          AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED', 'SHIPPED')
          AND (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) >= CURRENT_DATE
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) <= CURRENT_DATE + INTERVAL '60 days'
          AND COALESCE(ph.total_value, 0) > 0
          AND ph.po_number NOT LIKE '089%'
        ORDER BY ph.po_number, ph.revised_cancel_date DESC NULLS LAST
      ),
      failed_inspections AS (
        SELECT DISTINCT po_number FROM inspections 
        WHERE UPPER(COALESCE(result, '')) = 'FAILED'
          AND inspection_date >= CURRENT_DATE - INTERVAL '90 days'
      ),
      timeline_delays AS (
        SELECT DISTINCT ph.po_number 
        FROM po_timelines pt
        JOIN po_timeline_milestones ptm ON pt.id = ptm.timeline_id
        JOIN po_headers ph ON pt.po_header_id = ph.id
        WHERE ptm.actual_date IS NULL 
          AND ptm.planned_date < CURRENT_DATE
          AND ptm.milestone IN ('Raw Materials', 'Initial Inspection', 'Inline Inspection')
      )
      SELECT 
        ap.po_number,
        ap.vendor,
        ap.category,
        ap.cancel_date::text,
        ap.days_until_due::text,
        ap.total_value::text,
        COALESCE(vh.otd_rate, 100)::text as vendor_otd_rate,
        COALESCE(vh.avg_late_days, 0)::text as vendor_avg_late_days,
        CASE WHEN fi.po_number IS NOT NULL THEN '1' ELSE '0' END as has_failed_inspection,
        CASE WHEN td.po_number IS NOT NULL THEN '1' ELSE '0' END as has_timeline_delay
      FROM active_pos ap
      LEFT JOIN vendor_history vh ON ap.vendor = vh.vendor
      LEFT JOIN failed_inspections fi ON ap.po_number = fi.po_number
      LEFT JOIN timeline_delays td ON ap.po_number = td.po_number
      ORDER BY ap.days_until_due ASC
      LIMIT 100
    `);

        const predictions = activePOsResult.rows.map(row => {
            const daysUntilDue = parseInt(row.days_until_due);
            const vendorOTD = parseFloat(row.vendor_otd_rate);
            const avgLateDays = parseFloat(row.vendor_avg_late_days);
            const hasFailedInspection = row.has_failed_inspection === '1';
            const hasTimelineDelay = row.has_timeline_delay === '1';

            // Calculate risk probability (0-100%)
            let riskProbability = 0;
            const riskFactors: string[] = [];

            // Vendor history factor (up to 40%)
            if (vendorOTD < 70) {
                riskProbability += 40;
                riskFactors.push(`Vendor OTD rate is only ${vendorOTD}%`);
            } else if (vendorOTD < 85) {
                riskProbability += 25;
                riskFactors.push(`Vendor OTD rate is ${vendorOTD}%`);
            } else if (vendorOTD < 95) {
                riskProbability += 10;
            }

            // Time pressure factor (up to 25%)
            if (daysUntilDue <= 7) {
                riskProbability += 25;
                riskFactors.push(`Only ${daysUntilDue} days until cancel date`);
            } else if (daysUntilDue <= 14) {
                riskProbability += 15;
                riskFactors.push(`${daysUntilDue} days until cancel date`);
            } else if (daysUntilDue <= 21) {
                riskProbability += 5;
            }

            // Failed inspection factor (up to 20%)
            if (hasFailedInspection) {
                riskProbability += 20;
                riskFactors.push('Has recent failed inspection');
            }

            // Timeline delay factor (up to 15%)
            if (hasTimelineDelay) {
                riskProbability += 15;
                riskFactors.push('Missing milestone deadlines');
            }

            // Generate recommendation
            let recommendation = 'Monitor standard progress';
            if (riskProbability >= 60) {
                recommendation = 'URGENT: Contact vendor immediately, consider expediting';
            } else if (riskProbability >= 40) {
                recommendation = 'Schedule vendor call to verify production status';
            } else if (riskProbability >= 20) {
                recommendation = 'Request progress photos and timeline update';
            }

            return {
                poNumber: row.po_number,
                vendor: row.vendor,
                category: row.category,
                cancelDate: row.cancel_date,
                daysUntilDue,
                totalValue: parseFloat(row.total_value),
                riskProbability: Math.min(95, riskProbability),
                riskFactors,
                recommendation
            };
        });

        // Sort by risk probability descending
        predictions.sort((a, b) => b.riskProbability - a.riskProbability);

        const highRiskPOs = predictions.filter(p => p.riskProbability >= 50);
        const mediumRiskPOs = predictions.filter(p => p.riskProbability >= 25 && p.riskProbability < 50);

        return {
            predictions,
            summary: {
                highRiskCount: highRiskPOs.length,
                mediumRiskCount: mediumRiskPOs.length,
                totalAtRisk: highRiskPOs.length + mediumRiskPOs.length,
                potentialValueAtRisk: highRiskPOs.reduce((sum, p) => sum + p.totalValue, 0)
            }
        };
    }

    // Quality Pattern Analysis - identifies recurring quality issues
    async getQualityPatternAnalysis(): Promise<{
        vendorPatterns: Array<{
            vendor: string;
            totalInspections: number;
            failedCount: number;
            failureRate: number;
            commonIssues: string[];
            affectedSKUs: string[];
            trend: 'improving' | 'stable' | 'worsening';
            severity: 'critical' | 'high' | 'medium' | 'low';
        }>;
        skuPatterns: Array<{
            sku: string;
            vendor: string;
            failureCount: number;
            inspectionCount: number;
            failureRate: number;
            recentFailures: number;
        }>;
        summary: {
            totalFailures: number;
            criticalVendors: number;
            repeatOffenderSKUs: number;
        };
    }> {
        const currentYear = new Date().getFullYear();

        // Get vendor quality patterns
        const vendorQualityResult = await db.execute<{
            vendor_name: string;
            total_inspections: string;
            failed_count: string;
            recent_failures: string;
            earlier_failures: string;
        }>(sql`
      SELECT 
        vendor_name,
        COUNT(*)::text as total_inspections,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED')::text as failed_count,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED' AND inspection_date >= CURRENT_DATE - INTERVAL '90 days')::text as recent_failures,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED' AND inspection_date < CURRENT_DATE - INTERVAL '90 days' AND inspection_date >= CURRENT_DATE - INTERVAL '180 days')::text as earlier_failures
      FROM inspections
      WHERE EXTRACT(YEAR FROM inspection_date) = ${currentYear}
        AND vendor_name IS NOT NULL
      GROUP BY vendor_name
      HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED') DESC
      LIMIT 30
    `);

        // Get SKU failure patterns
        const skuQualityResult = await db.execute<{
            sku: string;
            vendor_name: string;
            failure_count: string;
            inspection_count: string;
            recent_failures: string;
        }>(sql`
      SELECT 
        COALESCE(sku, 'Unknown') as sku,
        COALESCE(vendor_name, 'Unknown') as vendor_name,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED')::text as failure_count,
        COUNT(*)::text as inspection_count,
        COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED' AND inspection_date >= CURRENT_DATE - INTERVAL '60 days')::text as recent_failures
      FROM inspections
      WHERE EXTRACT(YEAR FROM inspection_date) = ${currentYear}
        AND sku IS NOT NULL
      GROUP BY sku, vendor_name
      HAVING COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED') >= 2
      ORDER BY COUNT(*) FILTER (WHERE UPPER(COALESCE(result, '')) = 'FAILED') DESC
      LIMIT 20
    `);

        // Get affected SKUs per vendor
        const vendorSKUsResult = await db.execute<{
            vendor_name: string;
            affected_skus: string;
        }>(sql`
      SELECT 
        vendor_name,
        STRING_AGG(DISTINCT sku, ', ') as affected_skus
      FROM inspections
      WHERE UPPER(COALESCE(result, '')) = 'FAILED'
        AND EXTRACT(YEAR FROM inspection_date) = ${currentYear}
        AND vendor_name IS NOT NULL
        AND sku IS NOT NULL
      GROUP BY vendor_name
    `);

        const vendorSKUsMap = new Map<string, string[]>();
        vendorSKUsResult.rows.forEach(r => {
            vendorSKUsMap.set(r.vendor_name, r.affected_skus?.split(', ') || []);
        });

        const vendorPatterns = vendorQualityResult.rows.map(row => {
            const totalInspections = parseInt(row.total_inspections);
            const failedCount = parseInt(row.failed_count);
            const recentFailures = parseInt(row.recent_failures);
            const earlierFailures = parseInt(row.earlier_failures);
            const failureRate = totalInspections > 0 ? (failedCount / totalInspections) * 100 : 0;

            // Determine trend
            let trend: 'improving' | 'stable' | 'worsening' = 'stable';
            if (recentFailures > earlierFailures + 1) trend = 'worsening';
            else if (recentFailures < earlierFailures - 1) trend = 'improving';

            // Determine severity
            let severity: 'critical' | 'high' | 'medium' | 'low' = 'low';
            if (failureRate >= 30 || failedCount >= 10) severity = 'critical';
            else if (failureRate >= 20 || failedCount >= 5) severity = 'high';
            else if (failureRate >= 10 || failedCount >= 3) severity = 'medium';

            const affectedSKUs = vendorSKUsMap.get(row.vendor_name) || [];

            return {
                vendor: row.vendor_name,
                totalInspections,
                failedCount,
                failureRate: Math.round(failureRate * 10) / 10,
                commonIssues: [], // Would need notes analysis for this
                affectedSKUs: affectedSKUs.slice(0, 5),
                trend,
                severity
            };
        });

        const skuPatterns = skuQualityResult.rows.map(row => ({
            sku: row.sku,
            vendor: row.vendor_name,
            failureCount: parseInt(row.failure_count),
            inspectionCount: parseInt(row.inspection_count),
            failureRate: Math.round((parseInt(row.failure_count) / parseInt(row.inspection_count)) * 1000) / 10,
            recentFailures: parseInt(row.recent_failures)
        }));

        return {
            vendorPatterns,
            skuPatterns,
            summary: {
                totalFailures: vendorPatterns.reduce((sum, v) => sum + v.failedCount, 0),
                criticalVendors: vendorPatterns.filter(v => v.severity === 'critical').length,
                repeatOffenderSKUs: skuPatterns.filter(s => s.failureCount >= 3).length
            }
        };
    }

    // Demand Forecasting - predicts order volumes by category and season
    async getDemandForecast(): Promise<{
        categoryForecasts: Array<{
            category: string;
            historicalAvgMonthly: number;
            currentMonthOrders: number;
            projectedNextMonth: number;
            projectedNextQuarter: number;
            seasonalFactor: number;
            trend: 'growing' | 'stable' | 'declining';
        }>;
        monthlyProjections: Array<{
            month: string;
            projectedOrders: number;
            projectedValue: number;
            confidence: 'high' | 'medium' | 'low';
        }>;
        summary: {
            avgMonthlyOrders: number;
            projectedQ1Orders: number;
            peakMonth: string;
            slowMonth: string;
        };
    }> {
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        // Get historical monthly data by category
        const categoryDataResult = await db.execute<{
            category: string;
            avg_monthly: string;
            current_month: string;
            recent_avg: string;
            earlier_avg: string;
        }>(sql`
      WITH monthly_orders AS (
        SELECT 
          COALESCE(product_category, 'Unknown') as category,
          EXTRACT(MONTH FROM po_date)::int as month,
          COUNT(DISTINCT po_number) as order_count
        FROM po_headers
        WHERE po_date >= CURRENT_DATE - INTERVAL '24 months'
          AND COALESCE(total_value, 0) > 0
          AND po_number NOT LIKE '089%'
        GROUP BY product_category, EXTRACT(MONTH FROM po_date)::int
      )
      SELECT 
        category,
        ROUND(AVG(order_count))::text as avg_monthly,
        COALESCE(MAX(CASE WHEN month = ${currentMonth} THEN order_count END), 0)::text as current_month,
        ROUND(AVG(CASE WHEN month >= ${currentMonth - 2} THEN order_count END))::text as recent_avg,
        ROUND(AVG(CASE WHEN month < ${currentMonth - 2} AND month >= ${currentMonth - 5} THEN order_count END))::text as earlier_avg
      FROM monthly_orders
      GROUP BY category
      HAVING COUNT(*) >= 3
      ORDER BY AVG(order_count) DESC
      LIMIT 20
    `);

        // Get monthly patterns for seasonality
        const seasonalDataResult = await db.execute<{
            month: string;
            month_name: string;
            avg_orders: string;
            avg_value: string;
        }>(sql`
      SELECT 
        EXTRACT(MONTH FROM po_date)::text as month,
        TO_CHAR(po_date, 'Mon') as month_name,
        ROUND(AVG(order_count))::text as avg_orders,
        ROUND(AVG(total_value))::text as avg_value
      FROM (
        SELECT 
          po_date,
          COUNT(DISTINCT po_number) as order_count,
          SUM(COALESCE(total_value, 0)) as total_value
        FROM po_headers
        WHERE po_date >= CURRENT_DATE - INTERVAL '24 months'
          AND COALESCE(total_value, 0) > 0
        GROUP BY po_date
      ) daily
      GROUP BY EXTRACT(MONTH FROM po_date), TO_CHAR(po_date, 'Mon')
      ORDER BY EXTRACT(MONTH FROM po_date)::int
    `);

        // Calculate overall average for seasonality factor
        const overallAvg = seasonalDataResult.rows.length > 0
            ? seasonalDataResult.rows.reduce((sum, r) => sum + parseFloat(r.avg_orders), 0) / seasonalDataResult.rows.length
            : 1;

        const categoryForecasts = categoryDataResult.rows.map(row => {
            const historicalAvg = parseFloat(row.avg_monthly) || 0;
            const currentMonth = parseFloat(row.current_month) || 0;
            const recentAvg = parseFloat(row.recent_avg) || historicalAvg;
            const earlierAvg = parseFloat(row.earlier_avg) || historicalAvg;

            // Calculate trend
            let trend: 'growing' | 'stable' | 'declining' = 'stable';
            if (recentAvg > earlierAvg * 1.15) trend = 'growing';
            else if (recentAvg < earlierAvg * 0.85) trend = 'declining';

            // Simple projection based on recent average and trend
            const trendFactor = trend === 'growing' ? 1.1 : trend === 'declining' ? 0.9 : 1.0;
            const projectedNextMonth = Math.round(recentAvg * trendFactor);
            const projectedNextQuarter = Math.round(recentAvg * trendFactor * 3);

            return {
                category: row.category,
                historicalAvgMonthly: Math.round(historicalAvg),
                currentMonthOrders: Math.round(currentMonth),
                projectedNextMonth,
                projectedNextQuarter,
                seasonalFactor: 1.0,
                trend
            };
        });

        // Generate monthly projections for next 6 months
        const monthlyProjections: Array<{
            month: string;
            projectedOrders: number;
            projectedValue: number;
            confidence: 'high' | 'medium' | 'low';
        }> = [];

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        for (let i = 0; i < 6; i++) {
            const targetMonth = ((currentMonth + i - 1) % 12) + 1;
            const seasonalData = seasonalDataResult.rows.find(r => parseInt(r.month) === targetMonth);
            const baseOrders = seasonalData ? parseFloat(seasonalData.avg_orders) : overallAvg;
            const baseValue = seasonalData ? parseFloat(seasonalData.avg_value) : 0;

            monthlyProjections.push({
                month: monthNames[targetMonth - 1],
                projectedOrders: Math.round(baseOrders),
                projectedValue: Math.round(baseValue),
                confidence: i < 2 ? 'high' : i < 4 ? 'medium' : 'low'
            });
        }

        // Find peak and slow months
        const sortedMonths = [...seasonalDataResult.rows].sort((a, b) => parseFloat(b.avg_orders) - parseFloat(a.avg_orders));
        const peakMonth = sortedMonths[0]?.month_name || 'Unknown';
        const slowMonth = sortedMonths[sortedMonths.length - 1]?.month_name || 'Unknown';

        return {
            categoryForecasts,
            monthlyProjections,
            summary: {
                avgMonthlyOrders: Math.round(overallAvg),
                projectedQ1Orders: monthlyProjections.slice(0, 3).reduce((sum, m) => sum + m.projectedOrders, 0),
                peakMonth,
                slowMonth
            }
        };
    }

    // Workload Balancing - analyzes capacity by role level (merchandisers, managers, general managers)
    async getWorkloadBalancing(): Promise<{
        staffWorkloads: Array<{
            name: string;
            role: 'merchandiser' | 'merchandising_manager' | 'general_merchandising_manager';
            activePOs: number;
            totalValue: number;
            vendorCount: number;
            atRiskPOs: number;
            utilizationScore: number;
            status: 'overloaded' | 'optimal' | 'underutilized';
            recommendations: string[];
        }>;
        managerWorkloads: Array<{
            name: string;
            role: 'merchandising_manager' | 'general_merchandising_manager';
            teamSize: number;
            teamActivePOs: number;
            teamTotalValue: number;
            teamAtRiskPOs: number;
            teamOTDRate: number;
            overloadedTeamMembers: number;
            avgTeamUtilization: number;
            status: 'attention_needed' | 'balanced' | 'under_capacity';
            recommendations: string[];
        }>;
        portfolioOverview: {
            totalStaff: number;
            totalMerchandisers: number;
            totalManagers: number;
            overallActivePOs: number;
            overallValue: number;
            overallAtRiskPOs: number;
            portfolioOTDRate: number;
            workloadDistribution: 'balanced' | 'skewed' | 'severely_imbalanced';
            keyRisks: string[];
        };
        rebalancingOpportunities: Array<{
            fromStaff: string;
            toStaff: string;
            vendor: string;
            poCount: number;
            reason: string;
        }>;
        summary: {
            overloadedCount: number;
            underutilizedCount: number;
            avgPOsPerStaff: number;
            workloadVariance: number;
        };
    }> {
        // Get staff roles from staff table
        const staffRolesResult = await db.execute<{
            name: string;
            role: string;
            manager_id: string | null;
        }>(sql`
      SELECT name, role, manager_id::text FROM staff WHERE status = 'active'
    `);

        const staffRoleMap = new Map<string, string>();
        staffRolesResult.rows.forEach(r => staffRoleMap.set(r.name, r.role));

        // Get staff workload data with OTD metrics
        const staffWorkloadResult = await db.execute<{
            merchandiser: string;
            active_pos: string;
            total_value: string;
            vendor_count: string;
            at_risk_pos: string;
            on_time: string;
            late: string;
        }>(sql`
      SELECT 
        v.merchandiser,
        COUNT(DISTINCT ph.po_number)::text as active_pos,
        SUM(COALESCE(ph.total_value, 0))::text as total_value,
        COUNT(DISTINCT ph.vendor)::text as vendor_count,
        -- At-Risk: Uses shared AT_RISK_THRESHOLDS (failed inspection, unbooked inspections, QA not passed)
        -- Simplified check: uses deadline proximity as proxy - within 14 days of HOD without inspection booking
        COUNT(DISTINCT CASE 
          WHEN UPPER(COALESCE(ph.shipment_status, '')) NOT IN ('ON-TIME', 'LATE')
            AND ph.revised_ship_date IS NOT NULL
            AND EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) <= 14
            AND EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) > 0
            AND NOT EXISTS(
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
                AND (i.inspection_type ILIKE '%inline%' OR i.inspection_type ILIKE '%final%')
            )
          THEN ph.po_number 
        END)::text as at_risk_pos,
        COUNT(DISTINCT CASE WHEN UPPER(COALESCE(ph.shipment_status, '')) = 'ON-TIME' THEN ph.po_number END)::text as on_time,
        COUNT(DISTINCT CASE WHEN UPPER(COALESCE(ph.shipment_status, '')) = 'LATE' THEN ph.po_number END)::text as late
      FROM vendors v
      JOIN po_headers ph ON v.name = ph.vendor
      WHERE v.merchandiser IS NOT NULL AND v.merchandiser != ''
        AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED', 'SHIPPED')
        AND COALESCE(ph.total_value, 0) > 0
      GROUP BY v.merchandiser
      ORDER BY COUNT(DISTINCT ph.po_number) DESC
    `);

        // Get vendor distribution by staff for rebalancing
        const vendorDistResult = await db.execute<{
            merchandiser: string;
            vendor: string;
            po_count: string;
            vendor_otd: string;
        }>(sql`
      SELECT 
        v.merchandiser,
        v.name as vendor,
        COUNT(DISTINCT ph.po_number)::text as po_count,
        CASE WHEN COUNT(*) FILTER (WHERE UPPER(COALESCE(ph.shipment_status, '')) IN ('ON-TIME', 'LATE')) > 0
          THEN ROUND(COUNT(*) FILTER (WHERE UPPER(COALESCE(ph.shipment_status, '')) = 'ON-TIME')::numeric * 100 / 
               COUNT(*) FILTER (WHERE UPPER(COALESCE(ph.shipment_status, '')) IN ('ON-TIME', 'LATE')), 1)
          ELSE 100 END::text as vendor_otd
      FROM vendors v
      JOIN po_headers ph ON v.name = ph.vendor
      WHERE v.merchandiser IS NOT NULL AND v.merchandiser != ''
        AND UPPER(COALESCE(ph.status, '')) NOT IN ('CLOSED', 'CANCELLED', 'SHIPPED')
        AND COALESCE(ph.total_value, 0) > 0
      GROUP BY v.merchandiser, v.name
      HAVING COUNT(DISTINCT ph.po_number) >= 3
      ORDER BY v.merchandiser, COUNT(DISTINCT ph.po_number) DESC
    `);

        // Calculate average for utilization scoring - only for merchandisers
        const merchandiserRows = staffWorkloadResult.rows.filter(r => {
            const role = staffRoleMap.get(r.merchandiser);
            return role === 'merchandiser' || !role; // Include staff without explicit role assignment
        });

        const avgPOs = merchandiserRows.length > 0
            ? merchandiserRows.reduce((sum, r) => sum + parseInt(r.active_pos), 0) / merchandiserRows.length
            : 0;

        // Define role-specific thresholds
        const thresholds = {
            merchandiser: { overloaded: 130, underutilized: 70, targetPOs: 150, maxVendors: 8 },
            merchandising_manager: { overloaded: 200, underutilized: 100, targetPOs: 250, maxVendors: 15 },
            general_merchandising_manager: { overloaded: 500, underutilized: 200, targetPOs: 400, maxVendors: 30 }
        };

        const staffWorkloads = staffWorkloadResult.rows.map(row => {
            const activePOs = parseInt(row.active_pos);
            const totalValue = parseFloat(row.total_value);
            const vendorCount = parseInt(row.vendor_count);
            const atRiskPOs = parseInt(row.at_risk_pos);
            const onTime = parseInt(row.on_time);
            const late = parseInt(row.late);

            // Determine role - default to merchandiser if not found
            let role: 'merchandiser' | 'merchandising_manager' | 'general_merchandising_manager' = 'merchandiser';
            const staffRole = staffRoleMap.get(row.merchandiser);
            if (staffRole === 'merchandising_manager') role = 'merchandising_manager';
            else if (staffRole === 'general_merchandising_manager') role = 'general_merchandising_manager';

            const roleThresholds = thresholds[role];

            // Calculate utilization score based on role-specific targets
            const utilizationScore = roleThresholds.targetPOs > 0
                ? Math.round((activePOs / roleThresholds.targetPOs) * 100)
                : 100;

            let status: 'overloaded' | 'optimal' | 'underutilized' = 'optimal';
            if (utilizationScore > roleThresholds.overloaded) status = 'overloaded';
            else if (utilizationScore < roleThresholds.underutilized) status = 'underutilized';

            const recommendations: string[] = [];

            // Role-specific recommendations
            if (role === 'merchandiser') {
                if (status === 'overloaded') {
                    recommendations.push('Consider redistributing some vendors to other merchandisers');
                    if (atRiskPOs > 3) recommendations.push('Prioritize at-risk POs for immediate attention');
                } else if (status === 'underutilized') {
                    recommendations.push('Can take on additional vendor assignments');
                }
                if (vendorCount > roleThresholds.maxVendors) {
                    recommendations.push(`Managing ${vendorCount} vendors - consider focusing on fewer relationships`);
                }
                if (atRiskPOs > activePOs * 0.2) {
                    recommendations.push(`High at-risk ratio (${Math.round(atRiskPOs / activePOs * 100)}%) - review vendor timelines`);
                }
            } else if (role === 'merchandising_manager') {
                if (status === 'overloaded') {
                    recommendations.push('Team workload high - consider delegating or adding team capacity');
                    if (atRiskPOs > 10) recommendations.push('Multiple at-risk POs require escalation review');
                } else if (status === 'underutilized') {
                    recommendations.push('Team has capacity for additional vendor assignments');
                }
                if (vendorCount > roleThresholds.maxVendors) {
                    recommendations.push('Vendor portfolio may be too broad for effective oversight');
                }
            } else if (role === 'general_merchandising_manager') {
                if (status === 'overloaded') {
                    recommendations.push('Portfolio approaching capacity limits - review resource allocation');
                }
                if (atRiskPOs > 20) {
                    recommendations.push(`${atRiskPOs} at-risk POs across portfolio - escalation meeting recommended`);
                }
            }

            return {
                name: row.merchandiser,
                role,
                activePOs,
                totalValue,
                vendorCount,
                atRiskPOs,
                utilizationScore,
                status,
                recommendations
            };
        });

        // Generate manager workloads - aggregate team metrics
        const managerWorkloads: Array<{
            name: string;
            role: 'merchandising_manager' | 'general_merchandising_manager';
            teamSize: number;
            teamActivePOs: number;
            teamTotalValue: number;
            teamAtRiskPOs: number;
            teamOTDRate: number;
            overloadedTeamMembers: number;
            avgTeamUtilization: number;
            status: 'attention_needed' | 'balanced' | 'under_capacity';
            recommendations: string[];
        }> = [];

        // Get managers and staff with manager_id mappings
        const staffWithManagerResult = await db.execute<{
            id: string;
            name: string;
            role: string;
            manager_id: string | null;
        }>(sql`
      SELECT id::text, name, role, manager_id::text FROM staff WHERE status = 'active'
    `);

        const staffIdMap = new Map<string, { id: string; name: string; managerId: string | null }>();
        const nameToIdMap = new Map<string, string>();
        staffWithManagerResult.rows.forEach(r => {
            staffIdMap.set(r.id, { id: r.id, name: r.name, managerId: r.manager_id });
            nameToIdMap.set(r.name, r.id);
        });

        const managers = staffWithManagerResult.rows.filter(r =>
            r.role === 'merchandising_manager' || r.role === 'general_merchandising_manager'
        );

        // All merchandisers for portfolio overview
        const allMerchandisers = staffWorkloads.filter(s => s.role === 'merchandiser');

        managers.forEach(mgr => {
            const isGeneralManager = mgr.role === 'general_merchandising_manager';

            // Get direct reports for this manager
            const directReportIds = staffWithManagerResult.rows
                .filter(r => r.manager_id === mgr.id)
                .map(r => r.id);

            // For merchandising managers: only their direct reports (merchandisers)
            // For general manager: all merchandisers (portfolio view)
            let teamMembers: typeof allMerchandisers;
            if (isGeneralManager) {
                teamMembers = allMerchandisers;
            } else {
                // Filter to merchandisers who report to this manager
                teamMembers = allMerchandisers.filter(m => {
                    const staffId = nameToIdMap.get(m.name);
                    return staffId && directReportIds.includes(staffId);
                });
            }

            const teamSize = teamMembers.length;
            const teamActivePOs = teamMembers.reduce((sum, m) => sum + m.activePOs, 0);
            const teamTotalValue = teamMembers.reduce((sum, m) => sum + m.totalValue, 0);
            const teamAtRiskPOs = teamMembers.reduce((sum, m) => sum + m.atRiskPOs, 0);
            const overloadedTeamMembers = teamMembers.filter(m => m.status === 'overloaded').length;
            const avgTeamUtilization = teamSize > 0
                ? Math.round(teamMembers.reduce((sum, m) => sum + m.utilizationScore, 0) / teamSize)
                : 0;

            // Calculate team OTD from the raw data - filter to team members only
            const teamMemberNames = new Set(teamMembers.map(m => m.name));
            const teamRows = staffWorkloadResult.rows.filter(r => teamMemberNames.has(r.merchandiser));
            const teamOnTime = teamRows.reduce((sum, r) => sum + parseInt(r.on_time || '0'), 0);
            const teamLate = teamRows.reduce((sum, r) => sum + parseInt(r.late || '0'), 0);
            const teamOTDRate = (teamOnTime + teamLate) > 0
                ? Math.round((teamOnTime / (teamOnTime + teamLate)) * 1000) / 10
                : 100;

            let status: 'attention_needed' | 'balanced' | 'under_capacity' = 'balanced';
            const recommendations: string[] = [];

            if (overloadedTeamMembers > teamSize * 0.3) {
                status = 'attention_needed';
                recommendations.push(`${overloadedTeamMembers} team members are overloaded - workload redistribution needed`);
            }
            if (teamAtRiskPOs > teamActivePOs * 0.15) {
                status = 'attention_needed';
                recommendations.push(`${Math.round(teamAtRiskPOs / teamActivePOs * 100)}% of team POs are at-risk - review escalation procedures`);
            }
            if (avgTeamUtilization < 70) {
                status = 'under_capacity';
                recommendations.push('Team has excess capacity - consider taking on new vendors');
            }
            if (teamOTDRate < 85) {
                recommendations.push(`Team OTD at ${teamOTDRate}% - below target, investigate root causes`);
            }

            managerWorkloads.push({
                name: mgr.name,
                role: mgr.role as 'merchandising_manager' | 'general_merchandising_manager',
                teamSize,
                teamActivePOs,
                teamTotalValue,
                teamAtRiskPOs,
                teamOTDRate,
                overloadedTeamMembers,
                avgTeamUtilization,
                status,
                recommendations
            });
        });

        // Generate portfolio overview (for general manager level)
        const totalMerchandisers = allMerchandisers.length;
        const totalManagers = managers.filter(m => m.role === 'merchandising_manager').length;
        const overallActivePOs = allMerchandisers.reduce((sum, m) => sum + m.activePOs, 0);
        const overallValue = allMerchandisers.reduce((sum, m) => sum + m.totalValue, 0);
        const overallAtRiskPOs = allMerchandisers.reduce((sum, m) => sum + m.atRiskPOs, 0);

        const totalOnTime = staffWorkloadResult.rows.reduce((sum, r) => sum + parseInt(r.on_time || '0'), 0);
        const totalLate = staffWorkloadResult.rows.reduce((sum, r) => sum + parseInt(r.late || '0'), 0);
        const portfolioOTDRate = (totalOnTime + totalLate) > 0
            ? Math.round((totalOnTime / (totalOnTime + totalLate)) * 1000) / 10
            : 100;

        // Assess workload distribution
        const overloadedCount = allMerchandisers.filter(m => m.status === 'overloaded').length;
        const underutilizedCount = allMerchandisers.filter(m => m.status === 'underutilized').length;
        let workloadDistribution: 'balanced' | 'skewed' | 'severely_imbalanced' = 'balanced';

        if (overloadedCount > totalMerchandisers * 0.3 || underutilizedCount > totalMerchandisers * 0.3) {
            workloadDistribution = 'severely_imbalanced';
        } else if (overloadedCount > 0 || underutilizedCount > totalMerchandisers * 0.2) {
            workloadDistribution = 'skewed';
        }

        const keyRisks: string[] = [];
        if (overallAtRiskPOs > 50) {
            keyRisks.push(`${overallAtRiskPOs} POs at risk of late delivery across portfolio`);
        }
        if (overloadedCount > 0) {
            keyRisks.push(`${overloadedCount} merchandisers are overloaded - potential burnout risk`);
        }
        if (portfolioOTDRate < 80) {
            keyRisks.push(`Portfolio OTD at ${portfolioOTDRate}% - below acceptable threshold`);
        }
        if (workloadDistribution === 'severely_imbalanced') {
            keyRisks.push('Workload severely imbalanced - urgent rebalancing recommended');
        }

        // Generate rebalancing opportunities
        const rebalancingOpportunities: Array<{
            fromStaff: string;
            toStaff: string;
            vendor: string;
            poCount: number;
            reason: string;
        }> = [];

        const overloaded = staffWorkloads.filter(s => s.status === 'overloaded' && s.role === 'merchandiser');
        const underutilized = staffWorkloads.filter(s => s.status === 'underutilized' && s.role === 'merchandiser');

        overloaded.forEach(from => {
            const fromVendors = vendorDistResult.rows.filter(v => v.merchandiser === from.name);
            underutilized.forEach(to => {
                // Find vendors that could be moved
                fromVendors.slice(0, 2).forEach(v => {
                    if (parseInt(v.po_count) >= 3 && parseInt(v.po_count) <= 10) {
                        rebalancingOpportunities.push({
                            fromStaff: from.name,
                            toStaff: to.name,
                            vendor: v.vendor,
                            poCount: parseInt(v.po_count),
                            reason: `${from.name} is overloaded (${from.utilizationScore}% utilization), ${to.name} has capacity (${to.utilizationScore}%)`
                        });
                    }
                });
            });
        });

        // Calculate variance for merchandisers only
        const poValues = allMerchandisers.map(s => s.activePOs);
        const variance = poValues.length > 0
            ? Math.round(Math.sqrt(poValues.reduce((sum, val) => sum + Math.pow(val - avgPOs, 2), 0) / poValues.length))
            : 0;

        return {
            staffWorkloads,
            managerWorkloads,
            portfolioOverview: {
                totalStaff: staffWorkloads.length,
                totalMerchandisers,
                totalManagers,
                overallActivePOs,
                overallValue,
                overallAtRiskPOs,
                portfolioOTDRate,
                workloadDistribution,
                keyRisks
            },
            rebalancingOpportunities: rebalancingOpportunities.slice(0, 10),
            summary: {
                overloadedCount,
                underutilizedCount,
                avgPOsPerStaff: Math.round(avgPOs),
                workloadVariance: variance
            }
        };
    }

    // Executive Summary Generator - generates weekly/monthly briefings
    async getExecutiveSummary(period: 'weekly' | 'monthly' = 'weekly'): Promise<{
        period: string;
        keyMetrics: {
            totalOrders: number;
            onTimeDeliveries: number;
            lateDeliveries: number;
            otdRate: number;
            totalValue: number;
            activeVendors: number;
        };
        highlights: string[];
        concerns: string[];
        recommendations: string[];
        vendorSpotlight: {
            topPerformers: Array<{ vendor: string; otd: number; orders: number }>;
            needsAttention: Array<{ vendor: string; issue: string }>;
        };
        comparisonToPrevious: {
            otdChange: number;
            volumeChange: number;
            lateOrderChange: number;
        };
    }> {
        const interval = period === 'weekly' ? '7 days' : '30 days';
        const previousInterval = period === 'weekly' ? '14 days' : '60 days';

        // Get current period metrics
        const currentResult = await db.execute<{
            total_orders: string;
            on_time: string;
            late: string;
            total_value: string;
            active_vendors: string;
        }>(sql`
      SELECT 
        COUNT(DISTINCT po_number)::text as total_orders,
        COUNT(DISTINCT CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'ON-TIME' THEN po_number END)::text as on_time,
        COUNT(DISTINCT CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'LATE' THEN po_number END)::text as late,
        SUM(COALESCE(total_value, 0))::text as total_value,
        COUNT(DISTINCT vendor)::text as active_vendors
      FROM po_headers
      WHERE COALESCE(revised_cancel_date, original_cancel_date) >= CURRENT_DATE - ${sql.raw(`INTERVAL '${interval}'`)}
        AND COALESCE(total_value, 0) > 0
        AND po_number NOT LIKE '089%'
    `);

        // Get previous period metrics for comparison
        const previousResult = await db.execute<{
            total_orders: string;
            on_time: string;
            late: string;
        }>(sql`
      SELECT 
        COUNT(DISTINCT po_number)::text as total_orders,
        COUNT(DISTINCT CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'ON-TIME' THEN po_number END)::text as on_time,
        COUNT(DISTINCT CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'LATE' THEN po_number END)::text as late
      FROM po_headers
      WHERE COALESCE(revised_cancel_date, original_cancel_date) >= CURRENT_DATE - ${sql.raw(`INTERVAL '${previousInterval}'`)}
        AND COALESCE(revised_cancel_date, original_cancel_date) < CURRENT_DATE - ${sql.raw(`INTERVAL '${interval}'`)}
        AND COALESCE(total_value, 0) > 0
        AND po_number NOT LIKE '089%'
    `);

        // Get top performing vendors
        const topVendorsResult = await db.execute<{
            vendor: string;
            otd: string;
            orders: string;
        }>(sql`
      SELECT 
        vendor,
        ROUND(COUNT(*) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) = 'ON-TIME')::numeric * 100 / 
          NULLIF(COUNT(*) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE')), 0), 1)::text as otd,
        COUNT(DISTINCT po_number)::text as orders
      FROM po_headers
      WHERE COALESCE(revised_cancel_date, original_cancel_date) >= CURRENT_DATE - ${sql.raw(`INTERVAL '${interval}'`)}
        AND COALESCE(total_value, 0) > 0
        AND UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE')
      GROUP BY vendor
      HAVING COUNT(*) >= 5
      ORDER BY ROUND(COUNT(*) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) = 'ON-TIME')::numeric * 100 / 
        NULLIF(COUNT(*) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE')), 0), 1) DESC
      LIMIT 5
    `);

        // Get vendors needing attention
        const concernVendorsResult = await db.execute<{
            vendor: string;
            late_count: string;
        }>(sql`
      SELECT 
        vendor,
        COUNT(DISTINCT po_number)::text as late_count
      FROM po_headers
      WHERE COALESCE(revised_cancel_date, original_cancel_date) >= CURRENT_DATE - ${sql.raw(`INTERVAL '${interval}'`)}
        AND COALESCE(total_value, 0) > 0
        AND UPPER(COALESCE(shipment_status, '')) = 'LATE'
      GROUP BY vendor
      HAVING COUNT(DISTINCT po_number) >= 3
      ORDER BY COUNT(DISTINCT po_number) DESC
      LIMIT 5
    `);

        const current = currentResult.rows[0];
        const previous = previousResult.rows[0];

        const totalOrders = parseInt(current?.total_orders || '0');
        const onTime = parseInt(current?.on_time || '0');
        const late = parseInt(current?.late || '0');
        const shipped = onTime + late;
        const otdRate = shipped > 0 ? Math.round((onTime / shipped) * 1000) / 10 : 0;

        const prevOrders = parseInt(previous?.total_orders || '0');
        const prevOnTime = parseInt(previous?.on_time || '0');
        const prevLate = parseInt(previous?.late || '0');
        const prevShipped = prevOnTime + prevLate;
        const prevOtd = prevShipped > 0 ? Math.round((prevOnTime / prevShipped) * 1000) / 10 : 0;

        // Generate highlights
        const highlights: string[] = [];
        if (otdRate >= 90) highlights.push(`Strong OTD performance at ${otdRate}%`);
        if (totalOrders > prevOrders) highlights.push(`Order volume increased by ${Math.round((totalOrders - prevOrders) / Math.max(prevOrders, 1) * 100)}%`);
        if (late < prevLate) highlights.push(`Late deliveries decreased from ${prevLate} to ${late}`);

        // Generate concerns
        const concerns: string[] = [];
        if (otdRate < 80) concerns.push(`OTD rate of ${otdRate}% is below target`);
        if (late > prevLate) concerns.push(`Late deliveries increased from ${prevLate} to ${late}`);
        if (concernVendorsResult.rows.length > 0) {
            concerns.push(`${concernVendorsResult.rows.length} vendors have multiple late shipments`);
        }

        // Generate recommendations
        const recommendations: string[] = [];
        if (otdRate < 85) recommendations.push('Schedule vendor performance reviews for underperforming suppliers');
        if (late > 10) recommendations.push('Implement expediting protocols for at-risk orders');
        if (concernVendorsResult.rows.length > 3) recommendations.push('Consider diversifying vendor base');

        return {
            period: period === 'weekly' ? 'Last 7 Days' : 'Last 30 Days',
            keyMetrics: {
                totalOrders,
                onTimeDeliveries: onTime,
                lateDeliveries: late,
                otdRate,
                totalValue: parseFloat(current?.total_value || '0'),
                activeVendors: parseInt(current?.active_vendors || '0')
            },
            highlights,
            concerns,
            recommendations,
            vendorSpotlight: {
                topPerformers: topVendorsResult.rows.map(r => ({
                    vendor: r.vendor,
                    otd: parseFloat(r.otd),
                    orders: parseInt(r.orders)
                })),
                needsAttention: concernVendorsResult.rows.map(r => ({
                    vendor: r.vendor,
                    issue: `${r.late_count} late shipments this period`
                }))
            },
            comparisonToPrevious: {
                otdChange: Math.round((otdRate - prevOtd) * 10) / 10,
                volumeChange: prevOrders > 0 ? Math.round((totalOrders - prevOrders) / prevOrders * 100) : 0,
                lateOrderChange: late - prevLate
            }
        };
    }

    // What-If Scenario Modeling - simulates impact of changes
    async getWhatIfScenario(scenarioType: 'drop_vendor' | 'reallocate_staff' | 'volume_change', params: {
        vendorName?: string;
        fromStaff?: string;
        toStaff?: string;
        volumeChangePercent?: number;
    }): Promise<{
        scenario: string;
        currentState: Record<string, number | string>;
        projectedState: Record<string, number | string>;
        impact: {
            metric: string;
            currentValue: number | string;
            projectedValue: number | string;
            change: number | string;
        }[];
        risks: string[];
        benefits: string[];
        recommendation: string;
    }> {
        if (scenarioType === 'drop_vendor' && params.vendorName) {
            // Analyze impact of dropping a vendor
            const vendorDataResult = await db.execute<{
                total_orders: string;
                total_value: string;
                on_time: string;
                late: string;
                categories: string;
            }>(sql`
        SELECT 
          COUNT(DISTINCT po_number)::text as total_orders,
          SUM(COALESCE(total_value, 0))::text as total_value,
          COUNT(DISTINCT CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'ON-TIME' THEN po_number END)::text as on_time,
          COUNT(DISTINCT CASE WHEN UPPER(COALESCE(shipment_status, '')) = 'LATE' THEN po_number END)::text as late,
          STRING_AGG(DISTINCT product_category, ', ') as categories
        FROM po_headers
        WHERE vendor = ${params.vendorName}
          AND EXTRACT(YEAR FROM COALESCE(revised_cancel_date, original_cancel_date)) = ${new Date().getFullYear()}
          AND COALESCE(total_value, 0) > 0
      `);

            // Get overall metrics
            const overallResult = await db.execute<{
                total_orders: string;
                total_value: string;
                otd_rate: string;
            }>(sql`
        SELECT 
          COUNT(DISTINCT po_number)::text as total_orders,
          SUM(COALESCE(total_value, 0))::text as total_value,
          ROUND(COUNT(*) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) = 'ON-TIME')::numeric * 100 / 
            NULLIF(COUNT(*) FILTER (WHERE UPPER(COALESCE(shipment_status, '')) IN ('ON-TIME', 'LATE')), 0), 1)::text as otd_rate
        FROM po_headers
        WHERE EXTRACT(YEAR FROM COALESCE(revised_cancel_date, original_cancel_date)) = ${new Date().getFullYear()}
          AND COALESCE(total_value, 0) > 0
          AND po_number NOT LIKE '089%'
      `);

            const vendorData = vendorDataResult.rows[0];
            const overallData = overallResult.rows[0];

            const vendorOrders = parseInt(vendorData?.total_orders || '0');
            const vendorValue = parseFloat(vendorData?.total_value || '0');
            const vendorOnTime = parseInt(vendorData?.on_time || '0');
            const vendorLate = parseInt(vendorData?.late || '0');
            const vendorShipped = vendorOnTime + vendorLate;
            const vendorOTD = vendorShipped > 0 ? (vendorOnTime / vendorShipped) * 100 : 0;

            const totalOrders = parseInt(overallData?.total_orders || '0');
            const totalValue = parseFloat(overallData?.total_value || '0');
            const currentOTD = parseFloat(overallData?.otd_rate || '0');

            // Calculate projected state without this vendor
            const projectedOrders = totalOrders - vendorOrders;
            const projectedValue = totalValue - vendorValue;

            const risks: string[] = [];
            const benefits: string[] = [];

            if (vendorValue > totalValue * 0.1) {
                risks.push(`Significant revenue impact: ${Math.round(vendorValue / totalValue * 100)}% of YTD volume`);
            }
            if (vendorData?.categories) {
                risks.push(`Need alternative suppliers for: ${vendorData.categories}`);
            }

            if (vendorOTD < currentOTD) {
                benefits.push(`Could improve overall OTD - vendor's rate (${Math.round(vendorOTD)}%) is below average`);
            }
            if (vendorLate > 5) {
                benefits.push(`Removes ${vendorLate} late orders from portfolio`);
            }

            return {
                scenario: `Drop Vendor: ${params.vendorName}`,
                currentState: {
                    totalOrders,
                    totalValue: `$${Math.round(totalValue).toLocaleString()}`,
                    currentOTD: `${currentOTD}%`
                },
                projectedState: {
                    projectedOrders,
                    projectedValue: `$${Math.round(projectedValue).toLocaleString()}`,
                    vendorOrdersRemoved: vendorOrders
                },
                impact: [
                    { metric: 'Order Count', currentValue: totalOrders, projectedValue: projectedOrders, change: -vendorOrders },
                    { metric: 'Total Value', currentValue: `$${Math.round(totalValue).toLocaleString()}`, projectedValue: `$${Math.round(projectedValue).toLocaleString()}`, change: `-$${Math.round(vendorValue).toLocaleString()}` },
                    { metric: 'Late Orders Removed', currentValue: vendorLate, projectedValue: 0, change: -vendorLate }
                ],
                risks,
                benefits,
                recommendation: vendorOTD < 70 ?
                    'Consider dropping - vendor performance is significantly below target' :
                    vendorOTD < 85 ?
                        'Consider improvement plan before dropping' :
                        'Vendor performance is acceptable - explore other options first'
            };
        }

        // Default response for unsupported scenarios
        return {
            scenario: 'Unknown scenario type',
            currentState: {},
            projectedState: {},
            impact: [],
            risks: ['Unable to analyze this scenario type'],
            benefits: [],
            recommendation: 'Please specify a valid scenario type: drop_vendor, reallocate_staff, or volume_change'
        };
    }

    // PO Tasks operations
    async getPoTasksByPoNumber(poNumber: string, includeCompleted: boolean = false): Promise<PoTask[]> {
        const conditions = [eq(poTasks.poNumber, poNumber)];
        if (!includeCompleted) {
            conditions.push(eq(poTasks.isCompleted, false));
        }
        return await db
            .select()
            .from(poTasks)
            .where(and(...conditions))
            .orderBy(desc(poTasks.priority), poTasks.dueDate, desc(poTasks.createdAt));
    }

    async getPoTaskById(id: number): Promise<PoTask | undefined> {
        const result = await db.select().from(poTasks).where(eq(poTasks.id, id));
        return result[0];
    }

    async createPoTask(task: InsertPoTask): Promise<PoTask> {
        const result = await db.insert(poTasks).values(task).returning();
        return result[0];
    }

    async updatePoTask(id: number, task: Partial<InsertPoTask>): Promise<PoTask | undefined> {
        const result = await db
            .update(poTasks)
            .set({ ...task, updatedAt: new Date() })
            .where(eq(poTasks.id, id))
            .returning();
        return result[0];
    }

    async completePoTask(id: number, completedBy: string): Promise<PoTask | undefined> {
        const result = await db
            .update(poTasks)
            .set({
                isCompleted: true,
                completedAt: new Date(),
                completedBy: completedBy,
                updatedAt: new Date()
            })
            .where(eq(poTasks.id, id))
            .returning();
        return result[0];
    }

    async uncompletePoTask(id: number): Promise<PoTask | undefined> {
        const result = await db
            .update(poTasks)
            .set({
                isCompleted: false,
                completedAt: null,
                completedBy: null,
                updatedAt: new Date()
            })
            .where(eq(poTasks.id, id))
            .returning();
        return result[0];
    }

    async deletePoTask(id: number): Promise<boolean> {
        const result = await db.delete(poTasks).where(eq(poTasks.id, id)).returning();
        return result.length > 0;
    }

    async generatePoTasksFromData(poNumber: string): Promise<PoTask[]> {
        const generatedTasks: PoTask[] = [];

        // Get PO data from poHeaders
        const poHeaderResult = await db.select().from(poHeaders).where(eq(poHeaders.poNumber, poNumber)).limit(1);
        const poHeader = poHeaderResult[0];
        if (!poHeader) return generatedTasks;

        // Map header to PO format for compatibility
        const po = {
            id: poHeader.id,
            poNumber: poHeader.poNumber,
            status: poHeader.status,
            revisedCancelDate: poHeader.revisedCancelDate,
        };

        // Check for existing tasks to avoid duplicates
        const existingTasks = await db.select().from(poTasks).where(eq(poTasks.poNumber, poNumber));
        const existingTaskKeys = new Set(existingTasks.map(t => `${t.taskSource}-${t.taskType}-${t.relatedEntityId || ''}`));

        // 1. Generate inspection-related tasks
        const inspectionResults = await db
            .select()
            .from(inspections)
            .where(eq(inspections.poNumber, poNumber));

        // Check if final inspection is needed (PO has booking confirmed but no final inspection scheduled)
        const hasFinalInspection = inspectionResults.some(i =>
            i.inspectionType?.toLowerCase().includes('final')
        );
        const hasFailedInspection = inspectionResults.some(i =>
            i.result?.toLowerCase() === 'failed'
        );

        if (!hasFinalInspection && po.status?.toLowerCase().includes('book')) {
            const taskKey = 'inspection-book_final-';
            if (!existingTaskKeys.has(taskKey)) {
                const newTask = await this.createPoTask({
                    poNumber,
                    poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                    taskSource: 'inspection',
                    taskType: 'book_final',
                    title: 'Book Final Inspection',
                    description: `Final inspection needs to be scheduled for PO ${poNumber}`,
                    dueDate: po.revisedCancelDate ? new Date(new Date(po.revisedCancelDate).getTime() - 14 * 24 * 60 * 60 * 1000) : null,
                    priority: 'high'
                });
                generatedTasks.push(newTask);
                existingTaskKeys.add(taskKey);
            }
        }

        // Check for failed inspections that need follow-up
        for (const insp of inspectionResults) {
            if (insp.result?.toLowerCase() === 'failed') {
                const taskKey = `inspection-follow_up_failed-${insp.id}`;
                if (!existingTaskKeys.has(taskKey)) {
                    const newTask = await this.createPoTask({
                        poNumber,
                        poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                        taskSource: 'inspection',
                        taskType: 'follow_up_failed',
                        title: `Follow up on Failed ${insp.inspectionType || 'Inspection'}`,
                        description: `${insp.inspectionType || 'Inspection'} failed on ${insp.inspectionDate ? new Date(insp.inspectionDate).toLocaleDateString() : 'unknown date'}. Notes: ${insp.notes || 'None'}`,
                        priority: 'urgent',
                        relatedEntityType: 'inspection',
                        relatedEntityId: insp.id
                    });
                    generatedTasks.push(newTask);
                    existingTaskKeys.add(taskKey);
                }
            }
        }

        // 2. Generate compliance-related tasks (expiring certificates)
        const qualityResults = await db
            .select()
            .from(qualityTests)
            .where(eq(qualityTests.poNumber, poNumber));

        for (const test of qualityResults) {
            if (test.expiryDate) {
                const daysUntilExpiry = Math.ceil((new Date(test.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                if (daysUntilExpiry <= 90 && daysUntilExpiry > 0) {
                    const taskKey = `compliance-renew_certificate-${test.id}`;
                    if (!existingTaskKeys.has(taskKey)) {
                        const newTask = await this.createPoTask({
                            poNumber,
                            poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                            taskSource: 'compliance',
                            taskType: 'renew_certificate',
                            title: `Renew ${test.testType || 'Certificate'} - Expires in ${daysUntilExpiry} days`,
                            description: `${test.testType || 'Certificate'} for SKU ${test.sku || 'unknown'} expires on ${new Date(test.expiryDate).toLocaleDateString()}`,
                            dueDate: new Date(new Date(test.expiryDate).getTime() - 30 * 24 * 60 * 60 * 1000),
                            priority: daysUntilExpiry <= 30 ? 'urgent' : daysUntilExpiry <= 60 ? 'high' : 'normal',
                            relatedEntityType: 'quality_test',
                            relatedEntityId: test.id
                        });
                        generatedTasks.push(newTask);
                        existingTaskKeys.add(taskKey);
                    }
                }
            }
        }

        // 3. Generate shipment-related tasks
        const shipmentResults = await db
            .select()
            .from(shipments)
            .where(eq(shipments.poNumber, poNumber));

        for (const ship of shipmentResults) {
            // Check for shipments needing booking
            if (!ship.actualSailingDate && ship.cargoReadyDate) {
                const crd = new Date(ship.cargoReadyDate);
                const daysUntilCrd = Math.ceil((crd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

                if (daysUntilCrd <= 14 && daysUntilCrd > -7) {
                    const taskKey = `shipment-book_shipment-${ship.id}`;
                    if (!existingTaskKeys.has(taskKey)) {
                        const newTask = await this.createPoTask({
                            poNumber,
                            poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                            taskSource: 'shipment',
                            taskType: 'book_shipment',
                            title: 'Book Shipment',
                            description: `Cargo Ready Date is ${crd.toLocaleDateString()}. Shipment needs to be booked.`,
                            dueDate: new Date(crd.getTime() - 7 * 24 * 60 * 60 * 1000),
                            priority: daysUntilCrd <= 7 ? 'urgent' : 'high',
                            relatedEntityType: 'shipment',
                            relatedEntityId: ship.id
                        });
                        generatedTasks.push(newTask);
                        existingTaskKeys.add(taskKey);
                    }
                }
            }

            // Check for PTS follow-up needed
            if (ship.ptsNumber && !ship.ptsStatus) {
                const taskKey = `shipment-follow_up_pts-${ship.id}`;
                if (!existingTaskKeys.has(taskKey)) {
                    const newTask = await this.createPoTask({
                        poNumber,
                        poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                        taskSource: 'shipment',
                        taskType: 'follow_up_pts',
                        title: `Follow up on PTS ${ship.ptsNumber}`,
                        description: `PTS ${ship.ptsNumber} status needs confirmation`,
                        priority: 'normal',
                        relatedEntityType: 'shipment',
                        relatedEntityId: ship.id
                    });
                    generatedTasks.push(newTask);
                    existingTaskKeys.add(taskKey);
                }
            }
        }

        // 4. Generate tasks from activity logs (manual action items)
        const activityResults = await db
            .select()
            .from(activityLogs)
            .where(and(
                eq(activityLogs.entityType, 'po'),
                eq(activityLogs.entityId, poNumber),
                eq(activityLogs.logType, 'action'),
                eq(activityLogs.isCompleted, false)
            ));

        for (const activity of activityResults) {
            const taskKey = `manual-custom-${activity.id}`;
            if (!existingTaskKeys.has(taskKey)) {
                const newTask = await this.createPoTask({
                    poNumber,
                    poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                    taskSource: 'manual',
                    taskType: 'custom',
                    title: activity.description.substring(0, 255),
                    description: activity.description,
                    dueDate: activity.dueDate,
                    priority: 'normal',
                    relatedEntityType: 'activity_log',
                    relatedEntityId: activity.id,
                    createdBy: activity.createdBy || undefined
                });
                generatedTasks.push(newTask);
                existingTaskKeys.add(taskKey);
            }
        }

        // 5. Generate tasks from overdue/missing timeline milestones
        const timelineResult = await db
            .select()
            .from(poTimelines)
            .where(eq(poTimelines.poId, po.id))
            .limit(1);

        const timeline = timelineResult[0];
        if (timeline) {
            const milestonesResult = await db
                .select()
                .from(poTimelineMilestones)
                .where(eq(poTimelineMilestones.timelineId, timeline.id));

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (const milestone of milestonesResult) {
                const targetDate = milestone.revisedDate || milestone.plannedDate;

                if (targetDate && !milestone.actualDate) {
                    const targetDateTime = new Date(targetDate);
                    targetDateTime.setHours(0, 0, 0, 0);
                    const daysOverdue = Math.floor((today.getTime() - targetDateTime.getTime()) / (1000 * 60 * 60 * 24));

                    if (daysOverdue > 0) {
                        const taskKey = `timeline-overdue_milestone-${milestone.id}`;
                        if (!existingTaskKeys.has(taskKey)) {
                            const milestoneName = MILESTONE_LABELS[milestone.milestone as keyof typeof MILESTONE_LABELS] || milestone.milestone;
                            const priority = daysOverdue > 14 ? 'urgent' : daysOverdue > 7 ? 'high' : 'normal';

                            const newTask = await this.createPoTask({
                                poNumber,
                                poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                                taskSource: 'timeline',
                                taskType: 'overdue_milestone',
                                title: `Overdue: ${milestoneName}`,
                                description: `${milestoneName} was due on ${targetDateTime.toLocaleDateString()} (${daysOverdue} days overdue). Please update with actual completion date or revise the timeline.`,
                                dueDate: targetDateTime,
                                priority,
                                relatedEntityType: 'timeline_milestone',
                                relatedEntityId: milestone.id
                            });
                            generatedTasks.push(newTask);
                            existingTaskKeys.add(taskKey);
                        }
                    } else if (daysOverdue >= -7 && daysOverdue <= 0) {
                        const taskKey = `timeline-upcoming_milestone-${milestone.id}`;
                        if (!existingTaskKeys.has(taskKey)) {
                            const milestoneName = MILESTONE_LABELS[milestone.milestone as keyof typeof MILESTONE_LABELS] || milestone.milestone;
                            const daysUntil = Math.abs(daysOverdue);

                            const newTask = await this.createPoTask({
                                poNumber,
                                poHeaderId: po.id, // Use po_headers.id instead of deprecated poId
                                taskSource: 'timeline',
                                taskType: 'upcoming_milestone',
                                title: `Upcoming: ${milestoneName} (${daysUntil === 0 ? 'Today' : `in ${daysUntil} days`})`,
                                description: `${milestoneName} is scheduled for ${targetDateTime.toLocaleDateString()}. Ensure this milestone is on track.`,
                                dueDate: targetDateTime,
                                priority: daysUntil <= 3 ? 'high' : 'normal',
                                relatedEntityType: 'timeline_milestone',
                                relatedEntityId: milestone.id
                            });
                            generatedTasks.push(newTask);
                            existingTaskKeys.add(taskKey);
                        }
                    }
                }
            }
        }

        return generatedTasks;
    }

    async regenerateTasksForImportedPOs(poNumbers: string[]): Promise<{ poNumber: string; tasksGenerated: number }[]> {
        const results: { poNumber: string; tasksGenerated: number }[] = [];

        for (const poNumber of poNumbers) {
            try {
                const tasks = await this.generatePoTasksFromData(poNumber);
                results.push({ poNumber, tasksGenerated: tasks.length });
            } catch (error) {
                console.error(`Error generating tasks for PO ${poNumber}:`, error);
                results.push({ poNumber, tasksGenerated: 0 });
            }
        }

        return results;
    }

    // Vendor Capacity operations
    async getVendorCapacityData(filters?: { vendorCode?: string; year?: number; client?: string }): Promise<VendorCapacityData[]> {
        const conditions = [];

        if (filters?.vendorCode) {
            conditions.push(eq(vendorCapacityData.vendorCode, filters.vendorCode));
        }
        if (filters?.year) {
            conditions.push(eq(vendorCapacityData.year, filters.year));
        }
        if (filters?.client) {
            conditions.push(eq(vendorCapacityData.client, filters.client));
        }

        const result = conditions.length > 0
            ? await db.select().from(vendorCapacityData).where(and(...conditions)).orderBy(vendorCapacityData.year, vendorCapacityData.month, vendorCapacityData.client)
            : await db.select().from(vendorCapacityData).orderBy(vendorCapacityData.year, vendorCapacityData.month, vendorCapacityData.client);

        return result;
    }

    async getVendorCapacityByVendor(vendorCode: string, year?: number): Promise<VendorCapacityData[]> {
        const conditions = [eq(vendorCapacityData.vendorCode, vendorCode)];

        if (year) {
            conditions.push(eq(vendorCapacityData.year, year));
        }

        const result = await db.select().from(vendorCapacityData)
            .where(and(...conditions))
            .orderBy(vendorCapacityData.year, vendorCapacityData.month, vendorCapacityData.client);

        return result;
    }

    async getVendorCapacitySummaries(year?: number): Promise<(VendorCapacitySummary & { canonicalVendorName?: string; canonicalVendorId?: number })[]> {
        const query = db.select({
            id: vendorCapacitySummary.id,
            vendorId: vendorCapacitySummary.vendorId,
            vendorCode: vendorCapacitySummary.vendorCode,
            vendorName: vendorCapacitySummary.vendorName,
            office: vendorCapacitySummary.office,
            year: vendorCapacitySummary.year,
            totalShipmentAnnual: vendorCapacitySummary.totalShipmentAnnual,
            totalProjectionAnnual: vendorCapacitySummary.totalProjectionAnnual,
            totalReservedCapacityAnnual: vendorCapacitySummary.totalReservedCapacityAnnual,
            avgUtilizationPct: vendorCapacitySummary.avgUtilizationPct,
            cbShipmentAnnual: vendorCapacitySummary.cbShipmentAnnual,
            cb2ShipmentAnnual: vendorCapacitySummary.cb2ShipmentAnnual,
            ckShipmentAnnual: vendorCapacitySummary.ckShipmentAnnual,
            isLocked: vendorCapacitySummary.isLocked,
            importDate: vendorCapacitySummary.importDate,
            createdAt: vendorCapacitySummary.createdAt,
            updatedAt: vendorCapacitySummary.updatedAt,
            canonicalVendorName: vendors.name,
            canonicalVendorId: vendors.id,
        })
            .from(vendorCapacitySummary)
            .leftJoin(vendors, eq(vendorCapacitySummary.vendorId, vendors.id));

        if (year) {
            return await query
                .where(eq(vendorCapacitySummary.year, year))
                .orderBy(vendors.name, vendorCapacitySummary.vendorCode);
        }
        return await query.orderBy(vendorCapacitySummary.year, vendors.name, vendorCapacitySummary.vendorCode);
    }

    async getVendorCapacitySummary(vendorCode: string, year: number): Promise<VendorCapacitySummary | undefined> {
        const result = await db.select().from(vendorCapacitySummary)
            .where(and(
                eq(vendorCapacitySummary.vendorCode, vendorCode),
                eq(vendorCapacitySummary.year, year)
            ));
        return result[0];
    }

    async createVendorCapacityData(data: VendorCapacityData): Promise<VendorCapacityData> {
        const result = await db.insert(vendorCapacityData).values(data).returning();
        return result[0];
    }

    async bulkCreateVendorCapacityData(data: InsertVendorCapacityData[]): Promise<VendorCapacityData[]> {
        if (data.length === 0) return [];
        const result = await db.insert(vendorCapacityData).values(data).returning();
        return result;
    }

    async createVendorCapacitySummary(summary: InsertVendorCapacitySummary): Promise<VendorCapacitySummary> {
        const result = await db.insert(vendorCapacitySummary).values(summary).returning();
        return result[0];
    }

    async bulkCreateVendorCapacitySummary(summaries: InsertVendorCapacitySummary[]): Promise<VendorCapacitySummary[]> {
        if (summaries.length === 0) return [];
        const result = await db.insert(vendorCapacitySummary).values(summaries).returning();
        return result;
    }

    async clearVendorCapacityData(vendorCode?: string, year?: number): Promise<number> {
        const conditions = [];
        if (vendorCode) {
            conditions.push(eq(vendorCapacityData.vendorCode, vendorCode));
        }
        if (year) {
            conditions.push(eq(vendorCapacityData.year, year));
        }

        if (conditions.length > 0) {
            const result = await db.delete(vendorCapacityData).where(and(...conditions)).returning();
            return result.length;
        }
        const result = await db.delete(vendorCapacityData).returning();
        return result.length;
    }

    async clearVendorCapacitySummary(vendorCode?: string, year?: number): Promise<number> {
        const conditions = [];
        if (vendorCode) {
            conditions.push(eq(vendorCapacitySummary.vendorCode, vendorCode));
        }
        if (year) {
            conditions.push(eq(vendorCapacitySummary.year, year));
        }

        if (conditions.length > 0) {
            const result = await db.delete(vendorCapacitySummary).where(and(...conditions)).returning();
            return result.length;
        }
        const result = await db.delete(vendorCapacitySummary).returning();
        return result.length;
    }

    async clearUnlockedVendorCapacityData(years: number[]): Promise<number> {
        if (years.length === 0) return 0;
        // Only delete rows where isLocked is false AND year is in the list
        const result = await db.delete(vendorCapacityData)
            .where(and(
                eq(vendorCapacityData.isLocked, false),
                inArray(vendorCapacityData.year, years)
            ))
            .returning();
        return result.length;
    }

    async clearUnlockedVendorCapacitySummary(years: number[]): Promise<number> {
        if (years.length === 0) return 0;
        // Only delete rows where isLocked is false AND year is in the list
        const result = await db.delete(vendorCapacitySummary)
            .where(and(
                eq(vendorCapacitySummary.isLocked, false),
                inArray(vendorCapacitySummary.year, years)
            ))
            .returning();
        return result.length;
    }

    async getLockedCapacityYears(): Promise<number[]> {
        const lockedData = await db.selectDistinct({ year: vendorCapacityData.year })
            .from(vendorCapacityData)
            .where(eq(vendorCapacityData.isLocked, true));
        const lockedSummary = await db.selectDistinct({ year: vendorCapacitySummary.year })
            .from(vendorCapacitySummary)
            .where(eq(vendorCapacitySummary.isLocked, true));

        const yearsSet = new Set([
            ...lockedData.map(r => r.year),
            ...lockedSummary.map(r => r.year)
        ]);
        return Array.from(yearsSet).sort((a, b) => a - b);
    }

    async lockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }> {
        const dataResult = await db.update(vendorCapacityData)
            .set({ isLocked: true })
            .where(eq(vendorCapacityData.year, year))
            .returning();
        const summaryResult = await db.update(vendorCapacitySummary)
            .set({ isLocked: true })
            .where(eq(vendorCapacitySummary.year, year))
            .returning();
        return { dataRows: dataResult.length, summaryRows: summaryResult.length };
    }

    async unlockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }> {
        const dataResult = await db.update(vendorCapacityData)
            .set({ isLocked: false })
            .where(eq(vendorCapacityData.year, year))
            .returning();
        const summaryResult = await db.update(vendorCapacitySummary)
            .set({ isLocked: false })
            .where(eq(vendorCapacitySummary.year, year))
            .returning();
        return { dataRows: dataResult.length, summaryRows: summaryResult.length };
    }

    async getShippedValuesByVendor(year: number): Promise<Record<string, number>> {
        // Use ship date for shipped orders since we're looking at when they actually shipped
        const result = await db
            .select({
                vendor: poHeaders.vendor,
                shippedValue: sql<number>`SUM(CASE WHEN ${poHeaders.shipmentStatus} IN ('On-Time', 'Late') THEN ${poHeaders.totalValue} ELSE 0 END)`
            })
            .from(poHeaders)
            .where(sql`${poHeaders.shipmentStatus} IN ('On-Time', 'Late') 
        AND EXTRACT(YEAR FROM COALESCE(${poHeaders.revisedShipDate}, ${poHeaders.originalShipDate})) = ${year}`)
            .groupBy(poHeaders.vendor);

        const vendorShipped: Record<string, number> = {};
        for (const row of result) {
            if (row.vendor && row.shippedValue) {
                vendorShipped[row.vendor] = Number(row.shippedValue);
            }
        }
        return vendorShipped;
    }

    async getOrdersOnHandFromOS340(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }> {
        // Get unshipped orders (orders on hand) from po_headers
        // Group by vendor, brand (from clientDivision), and cancel month
        // Uses GREATEST of original_cancel_date and revised_cancel_date (whichever is later)
        // "Orders on Hand" = orders that are booked but not yet shipped
        // We check by looking at shipment_status: NULL/empty means no shipment created,
        // 'On-Time'/'Late' means shipped. Anything else is still pending.
        const result = await db.execute(sql`
      SELECT 
        ph.vendor,
        CASE 
          WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
          WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
          ELSE 'CB'
        END as brand,
        EXTRACT(MONTH FROM GREATEST(
          COALESCE(ph.original_cancel_date, ph.revised_cancel_date),
          COALESCE(ph.revised_cancel_date, ph.original_cancel_date)
        )) as cancel_month,
        SUM(ph.total_value) as total_value
      FROM po_headers ph
      WHERE 
        (ph.shipment_status IS NULL OR ph.shipment_status = '' OR ph.shipment_status NOT IN ('On-Time', 'Late'))
        AND EXTRACT(YEAR FROM GREATEST(
          COALESCE(ph.original_cancel_date, ph.revised_cancel_date),
          COALESCE(ph.revised_cancel_date, ph.original_cancel_date)
        )) = ${year}
        AND ph.total_value > 0
        AND ph.po_number NOT LIKE 'SMP%'
        AND ph.po_number NOT LIKE '8X8%'
      GROUP BY ph.vendor, brand, cancel_month
      ORDER BY ph.vendor, brand, cancel_month
    `);

        const byVendor: Record<string, number> = {};
        const byVendorBrandMonth: Record<string, Record<string, Record<number, number>>> = {};

        for (const row of result.rows) {
            const vendor = row.vendor as string;
            const brand = row.brand as string;
            const month = parseInt(row.cancel_month as string) || 0;
            const value = parseInt(row.total_value as string) || 0;

            if (!vendor || month === 0) continue;

            byVendor[vendor] = (byVendor[vendor] || 0) + value;

            if (!byVendorBrandMonth[vendor]) {
                byVendorBrandMonth[vendor] = {};
            }
            if (!byVendorBrandMonth[vendor][brand]) {
                byVendorBrandMonth[vendor][brand] = {};
            }
            byVendorBrandMonth[vendor][brand][month] = (byVendorBrandMonth[vendor][brand][month] || 0) + value;
        }

        return { byVendor, byVendorBrandMonth };
    }

    // Get ALL orders (shipped + unshipped) for historical tracking on capacity page
    // Uses GREATEST of original_cancel_date and revised_cancel_date (whichever is later)
    async getAllOrdersFromOS340(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
        shippedByVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }> {
        // Get ALL orders from po_headers regardless of shipment status
        // Split into shipped vs unshipped for display purposes
        const result = await db.execute(sql`
      SELECT 
        ph.vendor,
        CASE 
          WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
          WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
          ELSE 'CB'
        END as brand,
        EXTRACT(MONTH FROM GREATEST(
          COALESCE(ph.original_cancel_date, ph.revised_cancel_date),
          COALESCE(ph.revised_cancel_date, ph.original_cancel_date)
        )) as cancel_month,
        ph.shipment_status,
        SUM(ph.total_value) as total_value
      FROM po_headers ph
      WHERE 
        EXTRACT(YEAR FROM GREATEST(
          COALESCE(ph.original_cancel_date, ph.revised_cancel_date),
          COALESCE(ph.revised_cancel_date, ph.original_cancel_date)
        )) = ${year}
        AND ph.total_value > 0
        AND ph.po_number NOT LIKE 'SMP%'
        AND ph.po_number NOT LIKE '8X8%'
      GROUP BY ph.vendor, brand, cancel_month, ph.shipment_status
      ORDER BY ph.vendor, brand, cancel_month
    `);

        const byVendor: Record<string, number> = {};
        const byVendorBrandMonth: Record<string, Record<string, Record<number, number>>> = {};
        const shippedByVendorBrandMonth: Record<string, Record<string, Record<number, number>>> = {};

        for (const row of result.rows) {
            const vendor = row.vendor as string;
            const brand = row.brand as string;
            const month = parseInt(row.cancel_month as string) || 0;
            const value = parseInt(row.total_value as string) || 0;
            const status = row.shipment_status as string;
            const isShipped = status === 'On-Time' || status === 'Late';

            if (!vendor || month === 0) continue;

            // Total by vendor (all orders)
            byVendor[vendor] = (byVendor[vendor] || 0) + value;

            // All orders by vendor/brand/month
            if (!byVendorBrandMonth[vendor]) byVendorBrandMonth[vendor] = {};
            if (!byVendorBrandMonth[vendor][brand]) byVendorBrandMonth[vendor][brand] = {};
            byVendorBrandMonth[vendor][brand][month] = (byVendorBrandMonth[vendor][brand][month] || 0) + value;

            // Shipped orders separately
            if (isShipped) {
                if (!shippedByVendorBrandMonth[vendor]) shippedByVendorBrandMonth[vendor] = {};
                if (!shippedByVendorBrandMonth[vendor][brand]) shippedByVendorBrandMonth[vendor][brand] = {};
                shippedByVendorBrandMonth[vendor][brand][month] = (shippedByVendorBrandMonth[vendor][brand][month] || 0) + value;
            }
        }

        return { byVendor, byVendorBrandMonth, shippedByVendorBrandMonth };
    }

    async getProjectionsFromSkuProjections(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }> {
        // Get projections from active_projections table (FURNITURE/HOME-GOODS imports)
        // Group by vendor name, brand, and month
        // IMPORTANT: Exclude expired projections from capacity calculations
        // active_projections already represents latest state - no need for latest_batches CTE
        const result = await db.execute(sql`
      SELECT 
        v.name as vendor_name,
        ap.brand,
        ap.month,
        SUM(ap.projection_value) as total_projection
      FROM active_projections ap
      JOIN vendors v ON ap.vendor_id = v.id
      WHERE 
        ap.year = ${year}
        AND (ap.match_status IS NULL OR ap.match_status != 'expired')
      GROUP BY v.name, ap.brand, ap.month
      ORDER BY v.name, ap.brand, ap.month
    `);

        const byVendor: Record<string, number> = {};
        const byVendorBrandMonth: Record<string, Record<string, Record<number, number>>> = {};

        for (const row of result.rows) {
            const vendor = row.vendor_name as string;
            const brand = row.brand as string;
            const month = parseInt(row.month as string) || 0;
            const value = parseInt(row.total_projection as string) || 0;

            if (!vendor || month === 0) continue;

            // Aggregate by vendor
            byVendor[vendor] = (byVendor[vendor] || 0) + value;

            // Aggregate by vendor/brand/month
            if (!byVendorBrandMonth[vendor]) {
                byVendorBrandMonth[vendor] = {};
            }
            if (!byVendorBrandMonth[vendor][brand]) {
                byVendorBrandMonth[vendor][brand] = {};
            }
            byVendorBrandMonth[vendor][brand][month] = (byVendorBrandMonth[vendor][brand][month] || 0) + value;
        }

        return { byVendor, byVendorBrandMonth };
    }

    // Active Projections operations
    async archiveActiveProjections(vendorId: number): Promise<number> {
        // Get existing projections for this vendor
        const existing = await db.select().from(activeProjections)
            .where(eq(activeProjections.vendorId, vendorId));

        if (existing.length === 0) return 0;

        // Archive them to history table (including match/variance data)
        const archiveRecords = existing.map(p => ({
            vendorId: p.vendorId,
            vendorCode: p.vendorCode,
            sku: p.sku,
            skuDescription: p.skuDescription,
            brand: p.brand,
            productClass: p.productClass,
            collection: p.collection,
            year: p.year,
            month: p.month,
            projectionValue: p.projectionValue,
            quantity: p.quantity,
            orderType: p.orderType,
            matchStatus: p.matchStatus,
            matchedPoNumber: p.matchedPoNumber,
            matchedAt: p.matchedAt,
            actualQuantity: p.actualQuantity,
            actualValue: p.actualValue,
            quantityVariance: p.quantityVariance,
            valueVariance: p.valueVariance,
            variancePct: p.variancePct,
            archivedAt: new Date()
        }));

        await db.insert(vendorSkuProjectionHistory).values(archiveRecords);

        // Delete existing projections
        await db.delete(activeProjections)
            .where(eq(activeProjections.vendorId, vendorId));

        return existing.length;
    }

    async createActiveProjection(projection: InsertActiveProjection): Promise<ActiveProjection> {
        const [result] = await db.insert(activeProjections).values(projection).returning();
        return result;
    }

    async getActiveProjections(vendorId: number, year?: number, month?: number): Promise<ActiveProjection[]> {
        const conditions = [eq(activeProjections.vendorId, vendorId)];

        if (year !== undefined) {
            conditions.push(eq(activeProjections.year, year));
        }
        if (month !== undefined) {
            conditions.push(eq(activeProjections.month, month));
        }

        return await db.select().from(activeProjections)
            .where(and(...conditions))
            .orderBy(activeProjections.year, activeProjections.month, activeProjections.sku);
    }

    async getVendorSkuProjectionHistory(vendorId: number, sku?: string, year?: number): Promise<VendorSkuProjectionHistory[]> {
        const conditions = [eq(vendorSkuProjectionHistory.vendorId, vendorId)];

        if (sku) {
            conditions.push(eq(vendorSkuProjectionHistory.sku, sku));
        }
        if (year !== undefined) {
            conditions.push(eq(vendorSkuProjectionHistory.year, year));
        }

        return await db.select().from(vendorSkuProjectionHistory)
            .where(and(...conditions))
            .orderBy(desc(vendorSkuProjectionHistory.archivedAt));
    }

    // Match projections to incoming POs by SKU and target month
    // Regular projections: match by vendorCode + sku + year + month
    // SPO/MTO projections: match by vendorCode + collection + year + month to POs with "MTO {collection}" in program_description
    async matchProjectionsToPOs(importedPOs: Array<{ poNumber: string; vendor: string | null; sku: string | null; orderQuantity: number; totalValue: number; poDate: Date | null; originalShipDate: Date | null; programDescription?: string | null }>): Promise<{ matched: number; variances: number; errors: string[] }> {
        const errors: string[] = [];
        let matchedCount = 0;
        let varianceCount = 0;

        // Get all unmatched projections
        const unmatchedProjections = await db.select()
            .from(activeProjections)
            .where(eq(activeProjections.matchStatus, 'unmatched'));

        if (unmatchedProjections.length === 0) {
            return { matched: 0, variances: 0, errors: [] };
        }

        // Build vendor name/alias to vendor ID mapping for resolving PO vendor names
        const allVendors = await db.select().from(vendors);
        const allAliases = await db.select().from(vendorCapacityAliases);

        const vendorNameToId = new Map<string, number>();
        for (const v of allVendors) {
            if (v.name) {
                vendorNameToId.set(v.name.toLowerCase().trim(), v.id);
            }
        }
        for (const alias of allAliases) {
            if (alias.aliasName) {
                vendorNameToId.set(alias.aliasName.toLowerCase().trim(), alias.vendorId);
            }
        }

        // Build lookup maps for regular and SPO projections using VENDOR ID (not code)
        // Regular: vendorId_sku_year_month -> projection
        const regularProjectionMap = new Map<string, typeof unmatchedProjections[0]>();
        // SPO/MTO: vendorId_collection_year_month -> projection (uses collection field)
        const spoProjectionMap = new Map<string, typeof unmatchedProjections[0]>();

        for (const proj of unmatchedProjections) {
            if (proj.orderType === 'mto' && proj.collection) {
                // SPO projection - match by collection and vendor ID
                const key = `${proj.vendorId}_${proj.collection.toLowerCase()}_${proj.year}_${proj.month}`;
                spoProjectionMap.set(key, proj);
            } else if (proj.sku) {
                // Regular projection - match by SKU and vendor ID (skip if no SKU)
                const key = `${proj.vendorId}_${proj.sku.toLowerCase()}_${proj.year}_${proj.month}`;
                regularProjectionMap.set(key, proj);
            }
        }

        // Helper to update projection with match data
        const updateProjectionMatch = async (
            projection: typeof unmatchedProjections[0],
            po: typeof importedPOs[0],
            lookupKey: string,
            projectionMap: Map<string, typeof unmatchedProjections[0]>
        ) => {
            try {
                const projectedQty = projection.quantity || 0;
                const projectedValue = projection.projectionValue || 0;
                const actualQty = po.orderQuantity || 0;
                const actualValue = po.totalValue || 0;

                const qtyVariance = actualQty - projectedQty;
                const valueVariance = actualValue - projectedValue;
                const variancePctValue = projectedQty > 0
                    ? Math.round(((actualQty - projectedQty) / projectedQty) * 100)
                    : 0;

                await db.update(activeProjections)
                    .set({
                        matchStatus: 'matched',
                        matchedPoNumber: po.poNumber,
                        matchedAt: new Date(),
                        actualQuantity: actualQty,
                        actualValue: actualValue,
                        quantityVariance: qtyVariance,
                        valueVariance: valueVariance,
                        variancePct: variancePctValue,
                        updatedAt: new Date()
                    })
                    .where(eq(activeProjections.id, projection.id));

                matchedCount++;

                if (Math.abs(variancePctValue) > 10) {
                    varianceCount++;
                }

                projectionMap.delete(lookupKey);
                return true;
            } catch (err: any) {
                errors.push(`Failed to match PO ${po.poNumber} to projection: ${err.message}`);
                return false;
            }
        };

        // Extract collection name from program_description if it contains MTO pattern
        // Patterns: "MTO COLLECTION", "MTO:COLLECTION", "MTO - COLLECTION", "MTO HOXTON FEB 2026"
        // Known SPO collections: AMBROISE, FORTE, HOXTON, PM SYMMETRIC, VERA, AVIATOR, LOWE, EMILE, LAURA/TIFF, BLUME, SOMA, EDENDALE
        const knownCollections = [
            'ambroise', 'forte', 'hoxton', 'pm symmetric', 'vera', 'aviator',
            'lowe', 'emile', 'laura/tiff', 'laura', 'tiff', 'blume', 'soma', 'edendale'
        ];

        const extractMtoCollection = (programDesc: string | null | undefined): string | null => {
            if (!programDesc) return null;
            const lowerDesc = programDesc.toLowerCase();

            // Must contain "mto" to be considered an MTO PO
            if (!lowerDesc.includes('mto')) return null;

            // Try to match known collections first (most reliable)
            for (const collection of knownCollections) {
                if (lowerDesc.includes(collection)) {
                    return collection;
                }
            }

            // Fallback: Extract first word(s) after MTO, stopping at months, years, or common delimiters
            // Patterns like "MTO HOXTON FEB 2026" should extract "HOXTON"
            const monthsPattern = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i;
            const yearPattern = /\b(20\d{2})\b/;

            // Extract text after MTO
            const mtoMatch = lowerDesc.match(/mto[\s:_-]+([a-z\s\/]+)/i);
            if (mtoMatch && mtoMatch[1]) {
                let extracted = mtoMatch[1].trim();

                // Stop at month names
                const monthMatch = extracted.match(monthsPattern);
                if (monthMatch && monthMatch.index !== undefined && monthMatch.index > 0) {
                    extracted = extracted.substring(0, monthMatch.index).trim();
                }

                // Stop at year numbers (2020-2029)
                const yearMatch = extracted.match(yearPattern);
                if (yearMatch && yearMatch.index !== undefined && yearMatch.index > 0) {
                    extracted = extracted.substring(0, yearMatch.index).trim();
                }

                // Clean up trailing whitespace and common suffixes
                extracted = extracted.replace(/[\s,]+$/, '').trim();

                if (extracted.length > 0) {
                    return extracted;
                }
            }

            return null;
        };

        // Process each imported PO
        for (const po of importedPOs) {
            if (!po.vendor || !po.originalShipDate) continue;

            const targetYear = po.originalShipDate.getFullYear();
            const targetMonth = po.originalShipDate.getMonth() + 1; // 1-12

            // Resolve vendor name to vendor ID using our vendor/alias mapping
            const vendorId = vendorNameToId.get(po.vendor.toLowerCase().trim());
            if (!vendorId) {
                // Vendor not found in our database - skip this PO for projection matching
                continue;
            }

            // Try SPO/MTO matching first if program_description contains MTO pattern
            const mtoCollection = extractMtoCollection(po.programDescription);
            if (mtoCollection) {
                const spoKey = `${vendorId}_${mtoCollection}_${targetYear}_${targetMonth}`;
                const spoProjection = spoProjectionMap.get(spoKey);

                if (spoProjection) {
                    await updateProjectionMatch(spoProjection, po, spoKey, spoProjectionMap);
                    continue; // Move to next PO
                }
            }

            // Try regular SKU matching
            if (po.sku) {
                const skuKey = po.sku.toLowerCase().trim();
                const lookupKey = `${vendorId}_${skuKey}_${targetYear}_${targetMonth}`;
                const matchedProjection = regularProjectionMap.get(lookupKey);

                if (matchedProjection) {
                    await updateProjectionMatch(matchedProjection, po, lookupKey, regularProjectionMap);
                }
            }
        }

        return { matched: matchedCount, variances: varianceCount, errors };
    }

    // Get overdue/at-risk projections (within threshold days without matching PO)
    async getOverdueProjections(thresholdDays: number = 90, filters?: { vendor?: string; brand?: string; year?: number; month?: number }): Promise<Array<ActiveProjection & { daysUntilDue: number; isOverdue: boolean }>> {
        const today = new Date();

        // Build filter conditions
        const conditions: any[] = [
            eq(activeProjections.matchStatus, 'unmatched')
        ];

        if (filters?.vendorId) {
            conditions.push(eq(activeProjections.vendorId, filters.vendorId));
        }
        if (filters?.brand) {
            conditions.push(eq(activeProjections.brand, filters.brand));
        }
        if (filters?.year) {
            conditions.push(eq(activeProjections.year, filters.year));
        }
        if (filters?.month) {
            conditions.push(eq(activeProjections.month, filters.month));
        }

        // Get all unmatched projections with filters
        const unmatched = await db.select()
            .from(activeProjections)
            .where(and(...conditions));

        const overdueProjections: Array<ActiveProjection & { daysUntilDue: number; isOverdue: boolean }> = [];

        for (const proj of unmatched) {
            // Skip MTO projections - they go to the SPO tab
            if (proj.orderType === 'mto') continue;

            // Calculate target date from year/month
            const targetDate = new Date(proj.year, proj.month - 1, 1); // First day of target month
            const daysUntil = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            // Determine threshold based on order type (regular = 90 days)
            const effectiveThreshold = thresholdDays;

            // Include if within threshold or overdue
            if (daysUntil <= effectiveThreshold) {
                overdueProjections.push({
                    ...proj,
                    daysUntilDue: daysUntil,
                    isOverdue: daysUntil < 0
                });
            }
        }

        // Sort by most urgent first (lowest daysUntilDue)
        overdueProjections.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

        return overdueProjections;
    }

    // Get projections with significant volume variances
    async getProjectionsWithVariance(minVariancePct: number = 10, filters?: { vendor?: string; brand?: string; year?: number; month?: number }): Promise<ActiveProjection[]> {
        // Build filter conditions
        const conditions: any[] = [
            eq(activeProjections.matchStatus, 'matched'),
            or(
                gt(activeProjections.variancePct, minVariancePct),
                sql`${activeProjections.variancePct} < ${-minVariancePct}`
            )
        ];

        if (filters?.vendorId) {
            conditions.push(eq(activeProjections.vendorId, filters.vendorId));
        }
        if (filters?.brand) {
            conditions.push(eq(activeProjections.brand, filters.brand));
        }
        if (filters?.year) {
            conditions.push(eq(activeProjections.year, filters.year));
        }
        if (filters?.month) {
            conditions.push(eq(activeProjections.month, filters.month));
        }

        // Get matched projections with variance above threshold (excluding MTO which goes to SPO tab)
        const result = await db.select()
            .from(activeProjections)
            .where(and(
                ...conditions,
                or(
                    isNull(activeProjections.orderType),
                    sql`${activeProjections.orderType} != 'mto'`
                )
            ))
            .orderBy(desc(sql`ABS(${activeProjections.variancePct})`));

        return result;
    }

    // Get SPO/MTO projections
    async getSpoProjections(filters?: { vendor?: string; brand?: string; year?: number; month?: number }): Promise<Array<ActiveProjection & { daysUntilDue?: number; isOverdue?: boolean }>> {
        const today = new Date();

        // Build filter conditions - only MTO order type
        const conditions: any[] = [
            eq(activeProjections.orderType, 'mto')
        ];

        if (filters?.vendorId) {
            conditions.push(eq(activeProjections.vendorId, filters.vendorId));
        }
        if (filters?.brand) {
            conditions.push(eq(activeProjections.brand, filters.brand));
        }
        if (filters?.year) {
            conditions.push(eq(activeProjections.year, filters.year));
        }
        if (filters?.month) {
            conditions.push(eq(activeProjections.month, filters.month));
        }

        const spoProjections = await db.select()
            .from(activeProjections)
            .where(and(...conditions))
            .orderBy(desc(activeProjections.year), desc(activeProjections.month));

        // Add days until due for unmatched projections
        return spoProjections.map(proj => {
            if (proj.matchStatus === 'unmatched') {
                const targetDate = new Date(proj.year, proj.month - 1, 1);
                const daysUntil = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                return {
                    ...proj,
                    daysUntilDue: daysUntil,
                    isOverdue: daysUntil < 0
                };
            }
            return proj;
        });
    }

    // Get filter options for projections page
    async getProjectionFilterOptions(): Promise<{ vendors: Array<{ id: number; name: string; vendorCode: string }>; brands: string[] }> {
        // Get unique vendors from projections joined with vendors table for proper names
        const vendorResults = await db.selectDistinct({
            vendorId: activeProjections.vendorId,
            vendorCode: activeProjections.vendorCode,
            vendorName: vendors.name
        })
            .from(activeProjections)
            .leftJoin(vendors, eq(activeProjections.vendorId, vendors.id))
            .orderBy(vendors.name);

        // Get unique brands
        const brandResults = await db.selectDistinct({ brand: activeProjections.brand })
            .from(activeProjections)
            .orderBy(activeProjections.brand);

        // Filter out 'CBH' - it's the client/parent company, not a brand
        // Actual brands are: CB, CB2, C&K
        // Also normalize 'CK' to 'C&K' if present
        const filteredBrands = [...new Set(
            brandResults
                .map(r => r.brand)
                .filter((b): b is string => b != null && b.trim() !== '' && b.toUpperCase() !== 'CBH')
                .map(b => b === 'CK' ? 'C&K' : b)
        )].sort();

        return {
            vendors: vendorResults
                .filter(r => r.vendorId)
                .map(r => ({
                    id: r.vendorId!,
                    name: r.vendorName || r.vendorCode || `Vendor ID ${r.vendorId}`,
                    vendorCode: r.vendorCode || ''
                })),
            brands: filteredBrands
        };
    }

    // Mark projection as expired
    async markProjectionRemoved(projectionId: number, reason: string): Promise<ActiveProjection | undefined> {
        const result = await db.update(activeProjections)
            .set({
                matchStatus: 'expired',
                comment: reason,
                commentedAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(activeProjections.id, projectionId))
            .returning();

        return result[0];
    }

    // Unmatch a projection (revert to unmatched state)
    async unmatchProjection(projectionId: number): Promise<ActiveProjection | undefined> {
        const result = await db.update(activeProjections)
            .set({
                matchStatus: 'unmatched',
                matchedPoNumber: null,
                matchedAt: null,
                actualQuantity: null,
                actualValue: null,
                quantityVariance: null,
                valueVariance: null,
                variancePct: null,
                updatedAt: new Date()
            })
            .where(eq(activeProjections.id, projectionId))
            .returning();

        return result[0];
    }

    // Manually match a projection to a PO
    async manualMatchProjection(projectionId: number, poNumber: string): Promise<ActiveProjection | undefined> {
        // Get the PO details
        const po = await db.select().from(poHeaders)
            .where(eq(poHeaders.poNumber, poNumber));

        if (po.length === 0) {
            throw new Error(`PO ${poNumber} not found`);
        }

        const poData = po[0];

        // Get the projection
        const projection = await db.select().from(activeProjections)
            .where(eq(activeProjections.id, projectionId));

        if (projection.length === 0) {
            throw new Error(`Projection ${projectionId} not found`);
        }

        const proj = projection[0];

        // Calculate variances
        const actualQty = poData.totalQuantity || 0;
        const actualValue = poData.totalValue || 0;
        const qtyVariance = actualQty - (proj.quantity || 0);
        const valueVariance = actualValue - (proj.projectionValue || 0);
        const variancePctValue = (proj.quantity || 0) > 0
            ? Math.round((qtyVariance / (proj.quantity || 1)) * 100)
            : 0;

        const result = await db.update(activeProjections)
            .set({
                matchStatus: 'matched',
                matchedPoNumber: poNumber,
                matchedAt: new Date(),
                actualQuantity: actualQty,
                actualValue: actualValue,
                quantityVariance: qtyVariance,
                valueVariance: valueVariance,
                variancePct: variancePctValue,
                updatedAt: new Date()
            })
            .where(eq(activeProjections.id, projectionId))
            .returning();

        return result[0];
    }

    // Update projection order type (regular/mto)
    async updateProjectionOrderType(projectionId: number, orderType: 'regular' | 'mto'): Promise<ActiveProjection | undefined> {
        const result = await db.update(activeProjections)
            .set({
                orderType,
                updatedAt: new Date()
            })
            .where(eq(activeProjections.id, projectionId))
            .returning();

        return result[0];
    }

    // Get projection validation summary for a vendor
    async getProjectionValidationSummary(vendorId?: number, filters?: { vendor?: string; brand?: string; year?: number; month?: number }): Promise<{
        totalProjections: number;
        unmatched: number;
        matched: number;
        removed: number;
        overdueCount: number;
        atRiskCount: number;
        withVariance: number;
        spoTotal: number;
        spoMatched: number;
        spoUnmatched: number;
    }> {
        const conditions: any[] = [];
        if (vendorId) {
            conditions.push(eq(activeProjections.vendorId, vendorId));
        }
        // if (filters?.vendor) {
        //     conditions.push(eq(activeProjections.vendorId, filters.vendor));
        // }
        if (filters?.brand) {
            conditions.push(eq(activeProjections.brand, filters.brand));
        }
        if (filters?.year) {
            conditions.push(eq(activeProjections.year, filters.year));
        }
        if (filters?.month) {
            conditions.push(eq(activeProjections.month, filters.month));
        }

        const projections = await db.select().from(activeProjections)
            .where(conditions.length > 0 ? and(...conditions) : undefined);

        const today = new Date();
        let overdueCount = 0;
        let atRiskCount = 0;
        let withVariance = 0;
        let spoTotal = 0;
        let spoMatched = 0;
        let spoUnmatched = 0;

        for (const proj of projections) {
            // Count SPO/MTO items
            if (proj.orderType === 'mto') {
                spoTotal++;
                if (proj.matchStatus === 'matched') spoMatched++;
                if (proj.matchStatus === 'unmatched') spoUnmatched++;
            }

            // Count regular overdue/at-risk (excluding MTO which has separate tracking)
            if (proj.matchStatus === 'unmatched' && proj.orderType !== 'mto') {
                const targetDate = new Date(proj.year, proj.month - 1, 1);
                const daysUntil = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                const threshold = 90;

                if (daysUntil < 0) overdueCount++;
                else if (daysUntil <= threshold) atRiskCount++;
            }

            // Count variances (excluding MTO which has separate tracking)
            if (proj.matchStatus === 'matched' && proj.variancePct && Math.abs(proj.variancePct) > 10 && proj.orderType !== 'mto') {
                withVariance++;
            }
        }

        return {
            totalProjections: projections.length,
            unmatched: projections.filter(p => p.matchStatus === 'unmatched').length,
            matched: projections.filter(p => p.matchStatus === 'matched').length,
            removed: projections.filter(p => p.matchStatus === 'expired').length,
            overdueCount,
            atRiskCount,
            withVariance,
            spoTotal,
            spoMatched,
            spoUnmatched
        };
    }

    // Expired Projections operations
    async checkAndExpireProjections(): Promise<{ expiredCount: number; regularExpired: number; spoExpired: number }> {
        // Use batch SQL updates for performance instead of individual row updates
        // Regular POs: 90 days before end of target month
        // SPO/MTO: 30 days before end of target month

        // Mark regular orders as expired (90-day window)
        // Logic: target_month_end = make_date(year, month, 1) + interval '1 month' - interval '1 day'
        // order_deadline = target_month_end - 90 days
        // If CURRENT_DATE > order_deadline, it's expired
        // Include both 'unmatched' and 'partial' statuses (partial = partially matched but not fully fulfilled)
        const regularResult = await db.execute(sql`
      UPDATE active_projections
      SET 
        match_status = 'expired',
        comment = 'Automatically expired: past 90-day order window',
        updated_at = NOW()
      WHERE match_status IN ('unmatched', 'partial')
        AND (order_type IS NULL OR order_type = 'regular')
        AND CURRENT_DATE > (
          (make_date(year, month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date - INTERVAL '90 days'
        )::date
    `);

        // Mark SPO/MTO orders as expired (30-day window)
        // Include both 'unmatched' and 'partial' statuses
        const spoResult = await db.execute(sql`
      UPDATE active_projections
      SET 
        match_status = 'expired',
        comment = 'Automatically expired: past 30-day order window',
        updated_at = NOW()
      WHERE match_status IN ('unmatched', 'partial')
        AND order_type IN ('mto', 'spo')
        AND CURRENT_DATE > (
          (make_date(year, month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date - INTERVAL '30 days'
        )::date
    `);

        const regularExpired = parseInt(regularResult.rowCount?.toString() || '0');
        const spoExpired = parseInt(spoResult.rowCount?.toString() || '0');

        return {
            expiredCount: regularExpired + spoExpired,
            regularExpired,
            spoExpired
        };
    }

    async getExpiredProjections(filters?: { vendorId?: number; brand?: string; year?: number; month?: number; status?: string }): Promise<any[]> {
        const conditions: any[] = [];

        if (filters?.vendorId) {
            conditions.push(eq(expiredProjections.vendorId, filters.vendorId));
        }
        if (filters?.brand) {
            conditions.push(eq(expiredProjections.brand, filters.brand));
        }
        if (filters?.year) {
            conditions.push(eq(expiredProjections.year, filters.year));
        }
        if (filters?.month) {
            conditions.push(eq(expiredProjections.month, filters.month));
        }
        if (filters?.status) {
            conditions.push(eq(expiredProjections.verificationStatus, filters.status));
        }

        // Exclude restored projections unless specifically queried
        if (filters?.status !== 'restored') {
            conditions.push(isNull(expiredProjections.restoredAt));
        }

        const query = conditions.length > 0
            ? db.select().from(expiredProjections).where(and(...conditions)).orderBy(desc(expiredProjections.expiredAt))
            : db.select().from(expiredProjections).orderBy(desc(expiredProjections.expiredAt));
        // : db.select().from(expiredProjections).where(isNull(expiredProjections.restoredAt)).orderBy(desc(expiredProjections.expiredAt));

        return await query;
    }

    async restoreExpiredProjection(expiredId: number, restoredBy: string): Promise<boolean> {
        // Get the expired projection
        const expired = await db.select().from(expiredProjections).where(eq(expiredProjections.id, expiredId));
        if (!expired.length) return false;

        const proj = expired[0];

        // Mark original projection as unmatched again
        await db.update(activeProjections)
            .set({
                matchStatus: 'unmatched',
                comment: null,
                commentedAt: null,
                updatedAt: new Date()
            })
            .where(eq(activeProjections.id, proj.originalProjectionId));

        // Mark expired projection as restored
        await db.update(expiredProjections)
            .set({
                restoredAt: new Date(),
                restoredBy,
                verificationStatus: 'restored'
            })
            .where(eq(expiredProjections.id, expiredId));

        return true;
    }

    async verifyExpiredProjection(expiredId: number, status: 'verified' | 'cancelled', verifiedBy: string, notes?: string): Promise<boolean> {
        const result = await db.update(expiredProjections)
            .set({
                verificationStatus: status,
                verifiedAt: new Date(),
                verifiedBy,
                verificationNotes: notes || null
            })
            .where(eq(expiredProjections.id, expiredId))
            .returning();

        return result.length > 0;
    }

    async getExpiredProjectionsSummary(): Promise<{ total: number; pending: number; verified: number; cancelled: number; restored: number }> {
        const allExpired = await db.select().from(expiredProjections);

        let pending = 0;
        let verified = 0;
        let cancelled = 0;
        let restored = 0;

        for (const proj of allExpired) {
            switch (proj.verificationStatus) {
                case 'pending': pending++; break;
                case 'verified': verified++; break;
                case 'cancelled': cancelled++; break;
                case 'restored': restored++; break;
            }
        }

        return {
            total: allExpired.length,
            pending,
            verified,
            cancelled,
            restored
        };
    }

    // Communications operations
    async getCommunicationsByEntity(entityType: string, entityId: number): Promise<Communication[]> {
        return await db.select().from(communications)
            .where(and(
                eq(communications.entityType, entityType),
                eq(communications.entityId, entityId)
            ))
            .orderBy(desc(communications.communicationDate));
    }

    async getCommunicationsByPoNumber(poNumber: string): Promise<Communication[]> {
        return await db.select().from(communications)
            .where(eq(communications.poNumber, poNumber))
            .orderBy(desc(communications.communicationDate));
    }

    async createCommunication(communication: InsertCommunication): Promise<Communication> {
        const result = await db.insert(communications).values(communication).returning();
        return result[0];
    }

    async updateCommunication(id: number, communication: Partial<InsertCommunication>): Promise<Communication | undefined> {
        const result = await db.update(communications)
            .set({ ...communication, updatedAt: new Date() })
            .where(eq(communications.id, id))
            .returning();
        return result[0];
    }

    async deleteCommunication(id: number): Promise<boolean> {
        const result = await db.delete(communications).where(eq(communications.id, id)).returning();
        return result.length > 0;
    }

    // AI Summary operations
    async getAiSummary(entityType: string, entityId: number, summaryType: string): Promise<AiSummary | undefined> {
        const result = await db.select().from(aiSummaries)
            .where(and(
                eq(aiSummaries.entityType, entityType),
                eq(aiSummaries.entityId, entityId),
                eq(aiSummaries.summaryType, summaryType)
            ));
        return result[0];
    }

    async createOrUpdateAiSummary(summary: InsertAiSummary): Promise<AiSummary> {
        const existing = await this.getAiSummary(summary.entityType, summary.entityId, summary.summaryType);
        if (existing) {
            const result = await db.update(aiSummaries)
                .set({
                    ...summary,
                    lastUpdated: new Date(),
                    isStale: false
                })
                .where(eq(aiSummaries.id, existing.id))
                .returning();
            return result[0];
        }
        const result = await db.insert(aiSummaries).values(summary).returning();
        return result[0];
    }

    async markAiSummaryStale(entityType: string, entityId: number): Promise<void> {
        await db.update(aiSummaries)
            .set({ isStale: true })
            .where(and(
                eq(aiSummaries.entityType, entityType),
                eq(aiSummaries.entityId, entityId)
            ));
    }

    async deleteAiSummary(id: number): Promise<boolean> {
        const result = await db.delete(aiSummaries).where(eq(aiSummaries.id, id)).returning();
        return result.length > 0;
    }

    // Shipments with PO data for Shipments page
    // Pulls from shipments table (OS650) if available, otherwise generates from purchase_orders (OS340)
    // Includes at-risk status calculation based on business rules
    async getShipmentsWithPoData(filters?: {
        vendor?: string;
        office?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
        client?: string;
        merchandiser?: string;
        merchandisingManager?: string;
        limit?: number;
        offset?: number;
        includeShipped?: boolean;
    }): Promise<(Shipment & { po?: PurchaseOrder; atRiskStatus?: boolean; atRiskReasons?: string[]; revisedReason?: string | null })[]> {
        // Apply default limit of 500 for performance (was loading all 41k records)
        const limit = filters?.limit ?? 500;
        const offset = filters?.offset ?? 0;

        // Build WHERE conditions for filtering
        const whereConditions: any[] = [];

        // Join with po_headers for filtering and vendors table for merchandiser/manager filtering
        // Same pattern as Dashboard operations filters
        let os650Shipments: (Shipment & { revisedReason?: string | null })[];

        // Build dynamic WHERE clause using drizzle sql template
        const conditions: ReturnType<typeof sql>[] = [];

        // By default, exclude shipped orders (those with actual_sailing_date OR delivery_to_consolidator)
        // Per business rules, an order is "shipped" when either field is populated
        // Unless includeShipped filter is true
        if (!filters?.includeShipped) {
            conditions.push(sql`(s.actual_sailing_date IS NULL AND s.delivery_to_consolidator IS NULL)`);
        }

        if (filters?.vendor) {
            // Match vendor by canonical name from vendors table or via aliases
            conditions.push(sql`(
        ph.vendor = ${filters.vendor}
        OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor}))
        OR ph.vendor IN (
          SELECT vca.alias FROM vendor_capacity_aliases vca
          JOIN vendors v ON vca.vendor_id = v.id
          WHERE v.name = ${filters.vendor}
        )
      )`);
        }
        if (filters?.office) {
            conditions.push(sql`ph.office = ${filters.office}`);
        }
        if (filters?.client) {
            // Look up full client name from clients table using the code
            conditions.push(sql`ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
        }
        // Merchandiser filtering via vendors table (same as Dashboard)
        if (filters?.merchandiser) {
            conditions.push(sql`v.merchandiser = ${filters.merchandiser}`);
        }
        // Merchandising Manager filtering via vendors table (same as Dashboard)
        if (filters?.merchandisingManager) {
            conditions.push(sql`(
        v.merchandising_manager = ${filters.merchandisingManager}
        OR v.merchandiser IN (
          SELECT m.name FROM staff m
          JOIN staff mgr ON m.manager_id = mgr.id
          WHERE mgr.name = ${filters.merchandisingManager}
        )
      )`);
        }
        // Date range filtering
        if (filters?.startDate) {
            conditions.push(sql`s.created_at >= ${filters.startDate.toISOString()}`);
        }
        if (filters?.endDate) {
            conditions.push(sql`s.created_at <= ${filters.endDate.toISOString()}`);
        }

        const whereClause = conditions.length > 0
            ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
            : sql``;


        const limitNum = Number(limit);
        const offsetNum = Number(offset);
        const result = await db.execute<any>(sql`
      SELECT s.*, ph.revised_reason FROM shipments s
      LEFT JOIN po_headers ph ON s.po_number = ph.po_number
      LEFT JOIN vendors v ON v.name = ph.vendor
      ${whereClause}
      ORDER BY s.cargo_ready_date DESC NULLS LAST, s.created_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `);

        os650Shipments = result.rows.map((row: any) => ({
            id: row.id,
            poId: row.po_id,
            poNumber: row.po_number,
            shipmentNumber: row.shipment_number,
            deliveryToConsolidator: row.delivery_to_consolidator,
            qtyShipped: row.qty_shipped,
            shippedValue: row.shipped_value,
            actualPortOfLoading: row.actual_port_of_loading,
            actualSailingDate: row.actual_sailing_date,
            eta: row.eta,
            actualShipMode: row.actual_ship_mode,
            poe: row.poe,
            vesselFlight: row.vessel_flight,
            cargoReadyDate: row.cargo_ready_date,
            loadType: row.load_type,
            ptsNumber: row.pts_number,
            logisticStatus: row.logistic_status,
            lateReasonCode: row.late_reason_code,
            hodStatus: row.hod_status,
            soFirstSubmissionDate: row.so_first_submission_date,
            ptsStatus: row.pts_status,
            cargoReceiptStatus: row.cargo_receipt_status,
            reason: row.reason,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lineItemId: row.line_item_id,
            style: row.style,
            revisedReason: row.revised_reason,
        }));

        if (os650Shipments.length > 0) {
            // Use OS650 shipments data
            const poNumbers = [...new Set(os650Shipments.map(s => s.poNumber).filter(Boolean))];
            const poMap = await this.getPurchaseOrdersByNumbers(poNumbers);

            // Get inspection data for all POs to check at-risk criteria
            // Build inspections map from existing data if we have PO numbers
            const inspectionMap = new Map<string, { has_inline_booked: boolean; has_final_booked: boolean }>();
            const qaMap = new Map<string, { has_passed_qa: boolean }>();

            if (poNumbers.length > 0) {
                // Query inspections for these PO numbers
                const inspectionData = await db.execute<{
                    po_number: string;
                    inspection_type: string;
                }>(sql`
          SELECT DISTINCT po_number, inspection_type
          FROM inspections
          WHERE po_number IN (${sql.join(poNumbers.map(p => sql`${p}`), sql`, `)})
        `);

                // Build inspection map
                for (const row of inspectionData.rows) {
                    if (!inspectionMap.has(row.po_number)) {
                        inspectionMap.set(row.po_number, { has_inline_booked: false, has_final_booked: false });
                    }
                    const entry = inspectionMap.get(row.po_number)!;
                    if (row.inspection_type?.toLowerCase().includes('inline')) {
                        entry.has_inline_booked = true;
                    }
                    if (row.inspection_type?.toLowerCase().includes('final')) {
                        entry.has_final_booked = true;
                    }
                }

                // Query QA test data - simpler approach, just check if any passed QA exists
                const qaTestData = await db.execute<{
                    po_number: string;
                    has_passed: boolean;
                }>(sql`
          SELECT DISTINCT 
            ph.po_number,
            EXISTS(
              SELECT 1 FROM quality_tests qt 
              JOIN skus s ON qt.sku_id = s.id 
              WHERE s.sku = pli.sku AND qt.result = 'Pass'
            ) as has_passed
          FROM po_headers ph
          LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
          WHERE ph.po_number IN (${sql.join(poNumbers.map(p => sql`${p}`), sql`, `)})
        `);

                for (const row of qaTestData.rows) {
                    qaMap.set(row.po_number, { has_passed_qa: row.has_passed });
                }
            }

            const enrichedShipments = os650Shipments.map(shipment => {
                const po = poMap.get(shipment.poNumber);
                const inspections = inspectionMap.get(shipment.poNumber);
                const qa = qaMap.get(shipment.poNumber);

                // Calculate at-risk status based on business rules
                const atRiskReasons: string[] = [];
                const now = new Date();
                const hod = po?.revisedShipDate ? new Date(po.revisedShipDate) : null;

                // Only check at-risk for shipments that haven't shipped yet (hodStatus not On-Time, Late, or explicitly shipped)
                const isShipped = shipment.hodStatus === 'On Time' || shipment.hodStatus === 'On-Time' ||
                    shipment.hodStatus === 'Late' || shipment.hodStatus === 'Shipped';

                if (!isShipped && hod && hod > now) {
                    const daysUntilHod = Math.ceil((hod.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                    // 1. Inline inspection not booked 2 weeks before HOD
                    if (daysUntilHod <= 14 && !inspections?.has_inline_booked) {
                        atRiskReasons.push('Inline inspection not booked (due 2 weeks before HOD)');
                    }

                    // 2. Final inspection not booked 1 week before HOD
                    if (daysUntilHod <= 7 && !inspections?.has_final_booked) {
                        atRiskReasons.push('Final inspection not booked (due 1 week before HOD)');
                    }

                    // 3. QA test report not available 45 days before HOD
                    if (daysUntilHod <= 45 && !qa?.has_passed_qa) {
                        atRiskReasons.push('QA test report not available (due 45 days before HOD)');
                    }
                }

                return {
                    ...shipment,
                    po: po || undefined,
                    atRiskStatus: atRiskReasons.length > 0,
                    atRiskReasons
                };
            });
            // Note: Client/vendor/office filters are already applied in the SQL query, no need to re-filter here

            // Also include unshipped POs from OS340 that have upcoming HOD dates (for at-risk tracking)
            // Only include POs that haven't shipped yet and have a HOD date within 60 days
            const shippedPoNumbers = new Set(os650Shipments.map(s => s.poNumber));
            const sixtyDaysFromNow = new Date();
            sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60);

            // Build conditions for pending POs query
            const pendingConditions = [
                sql`ph.status NOT IN ('Closed', 'Cancelled', 'Shipped')`,
                sql`ph.shipment_status IS NULL`,
                sql`ph.revised_ship_date IS NOT NULL`,
                sql`ph.revised_ship_date <= ${sixtyDaysFromNow.toISOString()}`,
                sql`COALESCE(ph.total_value, 0) > 0`
            ];
            // Apply same client filter to pending POs
            if (filters?.client) {
                pendingConditions.push(sql`ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
            }
            if (filters?.vendor) {
                pendingConditions.push(sql`(
          ph.vendor = ${filters.vendor}
          OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor}))
        )`);
            }
            if (filters?.office) {
                pendingConditions.push(sql`ph.office = ${filters.office}`);
            }

            const pendingWhereClause = sql`WHERE ${sql.join(pendingConditions, sql` AND `)}`;

            const unshippedPOs = await db.execute<{
                id: number;
                po_number: string;
                vendor: string | null;
                office: string | null;
                client: string | null;
                status: string | null;
                revised_ship_date: string | null;
                revised_cancel_date: string | null;
                original_ship_date: string | null;
                total_value: number | null;
                total_quantity: number | null;
                sku: string | null;
            }>(sql`
        SELECT DISTINCT ON (ph.po_number)
          ph.id, ph.po_number, ph.vendor, ph.office, ph.client, ph.status,
          ph.revised_ship_date::text, ph.revised_cancel_date::text, ph.original_ship_date::text,
          ph.total_value, ph.total_quantity, pli.sku
        FROM po_headers ph
        LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
        ${pendingWhereClause}
        ORDER BY ph.po_number, ph.revised_ship_date
      `);

            // Filter out POs that already have OS650 shipments
            const filteredPendingPOs = unshippedPOs.rows.filter(po => !shippedPoNumbers.has(po.po_number));

            // Get inspection and QA data for pending POs
            const pendingPoNumbers = filteredPendingPOs.map(p => p.po_number);
            const pendingInspectionMap = new Map<string, { has_inline_booked: boolean; has_final_booked: boolean }>();
            const pendingQaMap = new Map<string, { has_passed_qa: boolean }>();

            if (pendingPoNumbers.length > 0) {
                const pendingInspectionData = await db.execute<{
                    po_number: string;
                    inspection_type: string;
                }>(sql`
          SELECT DISTINCT po_number, inspection_type
          FROM inspections
          WHERE po_number IN (${sql.join(pendingPoNumbers.map(p => sql`${p}`), sql`, `)})
        `);

                for (const row of pendingInspectionData.rows) {
                    if (!pendingInspectionMap.has(row.po_number)) {
                        pendingInspectionMap.set(row.po_number, { has_inline_booked: false, has_final_booked: false });
                    }
                    const entry = pendingInspectionMap.get(row.po_number)!;
                    if (row.inspection_type?.toLowerCase().includes('inline')) {
                        entry.has_inline_booked = true;
                    }
                    if (row.inspection_type?.toLowerCase().includes('final')) {
                        entry.has_final_booked = true;
                    }
                }

                const pendingQaData = await db.execute<{
                    po_number: string;
                    has_passed: boolean;
                }>(sql`
          SELECT DISTINCT 
            ph.po_number,
            EXISTS(
              SELECT 1 FROM quality_tests qt 
              JOIN skus s ON qt.sku_id = s.id 
              WHERE s.sku = pli.sku AND qt.result = 'Pass'
            ) as has_passed
          FROM po_headers ph
          LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
          WHERE ph.po_number IN (${sql.join(pendingPoNumbers.map(p => sql`${p}`), sql`, `)})
        `);

                for (const row of pendingQaData.rows) {
                    pendingQaMap.set(row.po_number, { has_passed_qa: row.has_passed });
                }
            }

            // Convert pending POs to shipment-like format with at-risk calculation
            const now = new Date();
            const pendingShipments = filteredPendingPOs.map((po, index) => {
                const inspections = pendingInspectionMap.get(po.po_number);
                const qa = pendingQaMap.get(po.po_number);
                const hod = po.revised_ship_date ? new Date(po.revised_ship_date) : null;

                const atRiskReasons: string[] = [];

                if (hod && hod > now) {
                    const daysUntilHod = Math.ceil((hod.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                    // 1. Inline inspection not booked 2 weeks before HOD
                    if (daysUntilHod <= 14 && !inspections?.has_inline_booked) {
                        atRiskReasons.push('Inline inspection not booked (due 2 weeks before HOD)');
                    }

                    // 2. Final inspection not booked 1 week before HOD
                    if (daysUntilHod <= 7 && !inspections?.has_final_booked) {
                        atRiskReasons.push('Final inspection not booked (due 1 week before HOD)');
                    }

                    // 3. QA test report not available 45 days before HOD
                    if (daysUntilHod <= 45 && !qa?.has_passed_qa) {
                        atRiskReasons.push('QA test report not available (due 45 days before HOD)');
                    }
                } else if (hod && hod <= now) {
                    // Past HOD date - mark as overdue
                    atRiskReasons.push('Past HOD date - overdue');
                }

                return {
                    id: po.id + 1000000, // Offset ID to avoid collision with OS650 IDs
                    poId: po.id,
                    poNumber: po.po_number,
                    shipmentNumber: index + 1,
                    deliveryToConsolidator: null,
                    qtyShipped: null,
                    shippedValue: null,
                    actualPortOfLoading: null,
                    actualSailingDate: null,
                    eta: null,
                    actualShipMode: null,
                    poe: null,
                    vesselFlight: null,
                    cargoReadyDate: po.original_ship_date ? new Date(po.original_ship_date) : null,
                    loadType: null,
                    ptsNumber: null,
                    logisticStatus: null,
                    lateReasonCode: null,
                    hodStatus: null, // Not shipped yet
                    soFirstSubmissionDate: null,
                    ptsStatus: null,
                    cargoReceiptStatus: null,
                    reason: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lineItemId: null,
                    style: null,
                    po: {
                        id: po.id,
                        poNumber: po.po_number,
                        vendor: po.vendor,
                        office: po.office,
                        client: po.client,
                        status: po.status,
                        revisedShipDate: po.revised_ship_date ? new Date(po.revised_ship_date) : null,
                        revisedCancelDate: po.revised_cancel_date ? new Date(po.revised_cancel_date) : null,
                        totalValue: po.total_value,
                        orderQuantity: po.total_quantity,
                    } as any,
                    atRiskStatus: atRiskReasons.length > 0,
                    atRiskReasons
                };
            });

            // Combine shipped and pending shipments, respecting the limit
            const combined = [...enrichedShipments, ...pendingShipments];
            return combined.slice(0, limit);
        }

        // Fall back to generating shipment records from po_headers (OS340 data)
        // This fallback only generates "shipped" POs, so if includeShipped is false, return empty
        if (!filters?.includeShipped) {
            // When includeShipped is false, the fallback path should return no shipped records
            // The fallback only generates shipped POs, so return empty array
            return [];
        }

        // Get shipped POs (those with shipment_status of 'On-Time' or 'Late' or with ship dates)
        const fallbackConditions: SQL<unknown>[] = [];

        // Only include POs that have shipped (have a shipment status or ship dates)
        fallbackConditions.push(
            or(
                inArray(poHeaders.shipmentStatus, ['On-Time', 'Late']),
                isNotNull(poHeaders.revisedShipDate),
                isNotNull(poHeaders.originalShipDate)
            )!
        );

        // Apply filters
        if (filters?.vendor) {
            fallbackConditions.push(eq(poHeaders.vendor, filters.vendor));
        }
        if (filters?.office) {
            fallbackConditions.push(eq(poHeaders.office, filters.office));
        }
        if (filters?.client) {
            fallbackConditions.push(eq(poHeaders.client, filters.client));
        }
        if (filters?.startDate) {
            fallbackConditions.push(gte(poHeaders.poDate, filters.startDate));
        }
        if (filters?.endDate) {
            fallbackConditions.push(lte(poHeaders.poDate, filters.endDate));
        }

        // Query unique POs with shipment data
        const poQuery = await db.selectDistinctOn([poHeaders.poNumber], {
            id: poHeaders.id,
            poNumber: poHeaders.poNumber,
            vendor: poHeaders.vendor,
            office: poHeaders.office,
            client: poHeaders.client,
            shipmentStatus: poHeaders.shipmentStatus,
            originalShipDate: poHeaders.originalShipDate,
            revisedShipDate: poHeaders.revisedShipDate,
            originalCancelDate: poHeaders.originalCancelDate,
            revisedCancelDate: poHeaders.revisedCancelDate,
            totalValue: poHeaders.totalValue,
            orderQuantity: poHeaders.totalQuantity,
            scheduleShipMode: poHeaders.scheduleShipMode,
            schedulePoe: poHeaders.schedulePoe,
            createdAt: poHeaders.createdAt,
        })
            .from(poHeaders)
            .where(and(...fallbackConditions))
            .orderBy(poHeaders.poNumber, desc(poHeaders.createdAt));

        // Convert PO data to shipment-like format
        const virtualShipments: (Shipment & { po?: PurchaseOrder })[] = poQuery.map((po, index) => {
            // Determine HOD status based on shipment_status
            let hodStatus: string | null = null;
            if (po.shipmentStatus === 'On-Time') {
                hodStatus = 'On-Time';
            } else if (po.shipmentStatus === 'Late') {
                hodStatus = 'Late';
            }

            return {
                id: po.id, // Use PO id as virtual shipment id
                poId: po.id,
                poNumber: po.poNumber,
                shipmentNumber: index + 1,
                deliveryToConsolidator: po.revisedShipDate || po.originalShipDate,
                qtyShipped: po.orderQuantity,
                shippedValue: po.totalValue,
                actualPortOfLoading: po.schedulePoe || null,
                actualSailingDate: po.revisedShipDate || po.originalShipDate,
                eta: po.revisedCancelDate || po.originalCancelDate,
                actualShipMode: po.scheduleShipMode || null,
                poe: po.schedulePoe || null,
                vesselFlight: null,
                createdAt: po.createdAt,
                updatedAt: po.createdAt,
                lineItemId: null,
                style: null,
                cargoReadyDate: po.originalShipDate,
                loadType: null,
                ptsNumber: null,
                logisticStatus: po.shipmentStatus === 'On-Time' ? 'Delivered' : (po.shipmentStatus === 'Late' ? 'Delayed' : 'In Transit'),
                lateReasonCode: null,
                hodStatus: hodStatus,
                soFirstSubmissionDate: null,
                ptsStatus: null,
                cargoReceiptStatus: null,
                reason: null,
                // Include full PO data
                po: {
                    id: po.id,
                    poNumber: po.poNumber,
                    copNumber: null,
                    client: po.client,
                    clientDivision: null,
                    clientDepartment: null,
                    buyer: null,
                    vendor: po.vendor,
                    factory: null,
                    productGroup: null,
                    productCategory: null,
                    season: null,
                    sku: null,
                    style: null,
                    sellerStyle: null,
                    newSku: null,
                    newStyle: null,
                    bigBets: null,
                    cbxItem: null,
                    orderClassification: null,
                    programDescription: null,
                    program: null,
                    merchandiseProgram: null,
                    office: po.office,
                    mrSection: null,
                    poDate: null,
                    month: null,
                    originalShipDate: po.originalShipDate,
                    originalCancelDate: po.originalCancelDate,
                    revisedShipDate: po.revisedShipDate,
                    revisedCancelDate: po.revisedCancelDate,
                    revisedBy: null,
                    revisedReason: null,
                    orderQuantity: po.orderQuantity,
                    balanceQuantity: null,
                    unitPrice: null,
                    totalValue: po.totalValue,
                    scheduleShipMode: po.scheduleShipMode,
                    schedulePoe: po.schedulePoe,
                    status: null,
                    shipmentStatus: po.shipmentStatus,
                    createdAt: po.createdAt,
                    updatedAt: null,
                    createdBy: null,
                    updatedBy: null,
                } as unknown as PurchaseOrder,
            };
        });

        return virtualShipments;
    }

    async getShipmentDetail(id: number): Promise<{ shipment: Shipment | null; po: PurchaseOrder | null; allShipments: Shipment[] }> {
        const shipmentResult = await db.select().from(shipments).where(eq(shipments.id, id));
        const shipment = shipmentResult[0] || null;

        if (!shipment) {
            return { shipment: null, po: null, allShipments: [] };
        }

        // Get the PO
        const po = shipment.poNumber ? await this.getPurchaseOrderByNumber(shipment.poNumber) : null;

        // Get all shipments for this PO
        const allShipments = shipment.poNumber
            ? await db.select().from(shipments).where(eq(shipments.poNumber, shipment.poNumber)).orderBy(shipments.shipmentNumber)
            : [];

        return { shipment, po: po || null, allShipments };
    }

    // ========== CATEGORY TIMELINE AVERAGES ==========

    async getCategoryTimelineAverages(): Promise<CategoryTimelineAverage[]> {
        return await db.select().from(categoryTimelineAverages).orderBy(categoryTimelineAverages.productCategory);
    }

    async recalculateCategoryTimelineAverages(): Promise<void> {
        // This method recalculates averages from historical inspection data
        // Group inspections by category and calculate average days from PO date to each inspection type
        const query = sql`
      WITH inspection_days AS (
        SELECT 
          ph.product_category,
          i.inspection_type,
          AVG(DATE_PART('day', i.inspection_date::timestamp - ph.po_date::timestamp)) as avg_days
        FROM inspections i
        JOIN po_headers ph ON i.po_number = ph.po_number
        WHERE ph.product_category IS NOT NULL 
          AND ph.po_date IS NOT NULL 
          AND i.inspection_date IS NOT NULL
        GROUP BY ph.product_category, i.inspection_type
      )
      SELECT 
        product_category,
        COALESCE(MAX(CASE WHEN inspection_type ILIKE '%raw material%' OR inspection_type ILIKE '%initial%' THEN avg_days END), 45) as raw_materials_avg,
        COALESCE(MAX(CASE WHEN inspection_type ILIKE '%initial%' AND inspection_type NOT ILIKE '%raw%' THEN avg_days END), 60) as initial_inspection_avg,
        COALESCE(MAX(CASE WHEN inspection_type ILIKE '%inline%' OR inspection_type ILIKE '%during%' THEN avg_days END), 75) as inline_inspection_avg,
        COALESCE(MAX(CASE WHEN inspection_type ILIKE '%final%' THEN avg_days END), 90) as final_inspection_avg,
        COALESCE(MAX(CASE WHEN inspection_type ILIKE '%final%' THEN avg_days + 14 END), 105) as ship_date_avg,
        COUNT(DISTINCT product_category) as sample_count
      FROM inspection_days
      GROUP BY product_category
    `;

        const result = await db.execute(query);

        // Clear existing averages and insert new ones
        await db.delete(categoryTimelineAverages);

        for (const row of result.rows as any[]) {
            await db.insert(categoryTimelineAverages).values({
                productCategory: row.product_category,
                avgDaysToRawMaterials: Math.round(row.raw_materials_avg) || 45,
                avgDaysToInitialInspection: Math.round(row.initial_inspection_avg) || 60,
                avgDaysToInlineInspection: Math.round(row.inline_inspection_avg) || 75,
                avgDaysToFinalInspection: Math.round(row.final_inspection_avg) || 90,
                avgDaysToShipDate: Math.round(row.ship_date_avg) || 105,
                sampleCount: Math.round(row.sample_count) || 0,
            });
        }
    }

    async getTimelineGenerationPreview(): Promise<{
        totalPOs: number;
        posWithTimelines: number;
        posWithoutTimelines: number;
        byCategory: { category: string; count: number; hasAverages: boolean }[];
    }> {
        // Get all POs from poHeaders
        const allPOs = await db.select({
            id: poHeaders.id,
            productCategory: poHeaders.productCategory
        }).from(poHeaders);

        // Get POs that already have timelines
        const existingTimelines = await db.select({ poId: poTimelines.poId }).from(poTimelines);
        const posWithTimelineIds = new Set(existingTimelines.map(t => t.poId));

        // Get category averages
        const averages = await this.getCategoryTimelineAverages();
        const categoriesWithAverages = new Set(averages.map(a => a.productCategory));

        // Count by category
        const categoryCountMap = new Map<string, number>();
        let posWithTimelines = 0;
        let posWithoutTimelines = 0;

        for (const po of allPOs) {
            if (posWithTimelineIds.has(po.id)) {
                posWithTimelines++;
            } else {
                posWithoutTimelines++;
                const category = po.productCategory || 'Unknown';
                categoryCountMap.set(category, (categoryCountMap.get(category) || 0) + 1);
            }
        }

        const byCategory = Array.from(categoryCountMap.entries())
            .map(([category, count]) => ({
                category,
                count,
                hasAverages: categoriesWithAverages.has(category)
            }))
            .sort((a, b) => b.count - a.count);

        return {
            totalPOs: allPOs.length,
            posWithTimelines,
            posWithoutTimelines,
            byCategory
        };
    }

    async bulkGenerateTimelinesFromCategoryAverages(dryRun: boolean, limit: number): Promise<{
        success: boolean;
        timelinesCreated: number;
        milestonesCreated: number;
        errors: string[];
        dryRun: boolean;
    }> {
        const errors: string[] = [];
        let timelinesCreated = 0;
        let milestonesCreated = 0;

        // Get category averages
        const averages = await this.getCategoryTimelineAverages();
        const averagesByCategory = new Map(averages.map(a => [a.productCategory, a]));

        // Get default averages for categories without specific data
        const defaultAverage = {
            avgDaysToRawMaterials: 45,
            avgDaysToInitialInspection: 60,
            avgDaysToInlineInspection: 75,
            avgDaysToFinalInspection: 90,
            avgDaysToShipDate: 105
        };

        // Get POs without timelines using a subquery for efficiency
        const existingTimelinePoIds = db.select({ poId: poTimelines.poId }).from(poTimelines);

        // Get POs that don't have timelines yet
        const posWithoutTimelines = await db.select()
            .from(poHeaders)
            .where(
                and(
                    isNotNull(poHeaders.poDate),
                    sql`${poHeaders.id} NOT IN (SELECT po_id FROM po_timelines)`
                )
            )
            .limit(limit);

        if (dryRun) {
            return {
                success: true,
                timelinesCreated: posWithoutTimelines.length,
                milestonesCreated: posWithoutTimelines.length * 5, // 5 milestones per timeline
                errors: [],
                dryRun: true
            };
        }

        // Process POs in batches for better performance
        const BATCH_SIZE = 50;
        for (let i = 0; i < posWithoutTimelines.length; i += BATCH_SIZE) {
            const batch = posWithoutTimelines.slice(i, i + BATCH_SIZE);

            // Prepare all timeline and milestone data for batch insert
            const timelineValues: { poId: number }[] = [];

            for (const po of batch) {
                timelineValues.push({ poId: po.id });
            }

            try {
                // Bulk insert timelines with ON CONFLICT DO NOTHING to prevent duplicates
                // The poTimelines table has a unique constraint on po_id
                const createdTimelines = await db.insert(poTimelines)
                    .values(timelineValues)
                    .onConflictDoNothing({ target: poTimelines.poId })
                    .returning();

                timelinesCreated += createdTimelines.length;

                // Build milestone values for all created timelines
                const milestoneValues: {
                    timelineId: number;
                    milestone: string;
                    plannedDate: Date;
                    sortOrder: number;
                }[] = [];

                for (let j = 0; j < createdTimelines.length; j++) {
                    const timeline = createdTimelines[j];
                    const po = batch[j];
                    const poDate = new Date(po.poDate!);
                    // Use category-specific averages if available, otherwise use default values
                    // This ensures all POs get planned dates even if their category has no historical data
                    const categoryKey = po.productCategory?.trim() || '';
                    const categoryAvg = averagesByCategory.get(categoryKey) || defaultAverage;

                    const milestones = [
                        { name: 'raw_materials', days: categoryAvg.avgDaysToRawMaterials || 45, sortOrder: 1 },
                        { name: 'initial_inspection', days: categoryAvg.avgDaysToInitialInspection || 60, sortOrder: 2 },
                        { name: 'inline_inspection', days: categoryAvg.avgDaysToInlineInspection || 75, sortOrder: 3 },
                        { name: 'final_inspection', days: categoryAvg.avgDaysToFinalInspection || 90, sortOrder: 4 },
                        { name: 'ship_date', days: categoryAvg.avgDaysToShipDate || 105, sortOrder: 5 },
                    ];

                    for (const m of milestones) {
                        milestoneValues.push({
                            timelineId: timeline.id,
                            milestone: m.name,
                            plannedDate: new Date(poDate.getTime() + m.days * 24 * 60 * 60 * 1000),
                            sortOrder: m.sortOrder
                        });
                    }
                }

                // Bulk insert milestones
                if (milestoneValues.length > 0) {
                    await db.insert(poTimelineMilestones).values(milestoneValues);
                    milestonesCreated += milestoneValues.length;
                }
            } catch (error: any) {
                errors.push(`Batch starting at index ${i}: ${error.message}`);
            }
        }

        return {
            success: errors.length === 0,
            timelinesCreated,
            milestonesCreated,
            errors,
            dryRun: false
        };
    }

    // Quality Test Report - Pivot table style aggregation by test type with status buckets
    // Uses compliance_styles table (OS630 source data) for accurate reporting matching Excel
    async getQualityTestReport(filters?: {
        clientDivision?: string;
        clientDepartment?: string;
        merchandiser?: string;
        merchandisingManager?: string;
    }): Promise<{
        filterOptions: {
            clientDivisions: string[];
            clientDepartments: string[];
        };
        mandatoryTest: {
            valid: number;
            validWaiver: number;
            expired: number;
            outstanding: number;
            notRequired: number;
            expiringIn60Days: number;
            grandTotal: number;
        };
        performanceTest: {
            valid: number;
            validWaiver: number;
            expired: number;
            outstanding: number;
            notRequired: number;
            expiringIn60Days: number;
            grandTotal: number;
        };
    }> {
        // Get filter options from compliance_styles (OS630 source data)
        const divisionsResult = await db.execute<{ client_division: string }>(sql`
      SELECT DISTINCT client_division 
      FROM compliance_styles
      WHERE client_division IS NOT NULL AND client_division != ''
      ORDER BY client_division
    `);

        const departmentsResult = await db.execute<{ client_department: string }>(sql`
      SELECT DISTINCT client_department 
      FROM compliance_styles
      WHERE client_department IS NOT NULL AND client_department != ''
      ORDER BY client_department
    `);

        // Build the aggregated report from compliance_styles table
        // This uses the source_status from the Excel file for accurate filtering
        // Filters for "Booked-to-ship" using the source_status column (preserved from Excel)
        const reportResult = await db.execute<{
            test_category: string;
            valid_count: number;
            valid_waiver_count: number;
            expired_count: number;
            outstanding_count: number;
            not_required_count: number;
            expiring_60_days_count: number;
            grand_total: number;
        }>(sql`
      WITH filtered_styles AS (
        SELECT DISTINCT ON (cs.style) 
          cs.style,
          cs.client_division,
          cs.client_department,
          cs.vendor_name,
          COALESCE(cs.mandatory_status, 'Outstanding') as mandatory_status,
          COALESCE(cs.performance_status, 'Outstanding') as performance_status
        FROM compliance_styles cs
        LEFT JOIN skus sk ON sk.sku = cs.style
        WHERE cs.source_status = 'Booked-to-ship'
          AND (sk.discontinued_at IS NULL OR sk.id IS NULL)
        ${filters?.clientDivision && filters.clientDivision !== 'all' ? sql`AND cs.client_division = ${filters.clientDivision}` : sql``}
        ${filters?.clientDepartment && filters.clientDepartment !== 'all' ? sql`AND cs.client_department = ${filters.clientDepartment}` : sql``}
        ${filters?.merchandiser && filters.merchandiser !== 'all' ? sql`AND cs.vendor_name IN (SELECT name FROM vendors WHERE merchandiser = ${filters.merchandiser})` : sql``}
        ${filters?.merchandisingManager && filters.merchandisingManager !== 'all' ? sql`AND cs.vendor_name IN (SELECT name FROM vendors WHERE merchandising_manager = ${filters.merchandisingManager} OR merchandiser IN (SELECT m.name FROM staff m JOIN staff mgr ON m.manager_id = mgr.id WHERE mgr.name = ${filters.merchandisingManager}))` : sql``}
        ORDER BY cs.style
      )
      SELECT 
        test_category,
        SUM(CASE WHEN status = 'Valid' THEN 1 ELSE 0 END)::int as valid_count,
        SUM(CASE WHEN status IN ('Valid (Waiver)', 'Waiver') THEN 1 ELSE 0 END)::int as valid_waiver_count,
        SUM(CASE WHEN status = 'Expired' THEN 1 ELSE 0 END)::int as expired_count,
        SUM(CASE WHEN status IN ('Outstanding', 'Re-Test') OR status IS NULL OR status = '' THEN 1 ELSE 0 END)::int as outstanding_count,
        SUM(CASE WHEN status = 'Not Required' THEN 1 ELSE 0 END)::int as not_required_count,
        SUM(CASE WHEN status = 'Expired in 60 Days' THEN 1 ELSE 0 END)::int as expiring_60_days_count,
        COUNT(*)::int as grand_total
      FROM (
        SELECT style, 'Mandatory' as test_category, mandatory_status as status FROM filtered_styles
        UNION ALL
        SELECT style, 'Performance' as test_category, performance_status as status FROM filtered_styles
      ) pivoted
      GROUP BY test_category
    `);

        // Initialize with zeros
        const mandatoryTest = {
            valid: 0,
            validWaiver: 0,
            expired: 0,
            outstanding: 0,
            notRequired: 0,
            expiringIn60Days: 0,
            grandTotal: 0
        };

        const performanceTest = {
            valid: 0,
            validWaiver: 0,
            expired: 0,
            outstanding: 0,
            notRequired: 0,
            expiringIn60Days: 0,
            grandTotal: 0
        };

        for (const row of reportResult.rows) {
            const target = row.test_category === 'Mandatory' ? mandatoryTest : performanceTest;
            target.valid = row.valid_count;
            target.validWaiver = row.valid_waiver_count;
            target.expired = row.expired_count;
            target.outstanding = row.outstanding_count;
            target.notRequired = row.not_required_count;
            target.expiringIn60Days = row.expiring_60_days_count;
            target.grandTotal = row.grand_total;
        }

        // Filter out 'CBH' - it's the client/parent company, not a brand
        // Actual brands are: CB, CB2, C&K. Also normalize 'CK' to 'C&K'
        const filteredDivisions = [...new Set(
            divisionsResult.rows
                .map(r => r.client_division)
                .filter((d): d is string => d != null && d.trim() !== '' && d.toUpperCase() !== 'CBH')
                .map(d => d === 'CK' ? 'C&K' : d)
        )].sort();

        return {
            filterOptions: {
                clientDivisions: filteredDivisions,
                clientDepartments: departmentsResult.rows.map(r => r.client_department)
            },
            mandatoryTest,
            performanceTest
        };
    }

    // Todo Dismissals
    async getTodoDismissals(userId: string): Promise<{ itemType: string; itemId: string }[]> {
        const results = await db
            .select({
                itemType: todoDismissals.itemType,
                itemId: todoDismissals.itemId,
            })
            .from(todoDismissals)
            .where(eq(todoDismissals.userId, userId));
        return results;
    }

    async dismissTodoItem(userId: string, itemType: string, itemId: string): Promise<void> {
        await db.insert(todoDismissals).values({
            userId,
            itemType,
            itemId,
        });
    }

    async restoreTodoItem(userId: string, itemType: string, itemId: string): Promise<void> {
        await db
            .delete(todoDismissals)
            .where(
                and(
                    eq(todoDismissals.userId, userId),
                    eq(todoDismissals.itemType, itemType),
                    eq(todoDismissals.itemId, itemId)
                )
            );
    }
}