import { InsertSku, Sku, skus } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { ISKUService } from "../Abstractions/ISKUService";

export class SKUService implements ISKUService {

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



}
