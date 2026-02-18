import { InsertPurchaseOrder, PoHeader, poHeaders, PoLineItem, poLineItems, PurchaseOrder, PurchaseOrderWithComputedFields } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IPurchaseOrderService } from "../Abstractions/IPurchaseOrderService";

export class PurchaseOrderService implements IPurchaseOrderService {

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


    async getPoHeaderByNumber(poNumber: string): Promise<PoHeader | undefined> {
        const result = await db.select().from(poHeaders).where(eq(poHeaders.poNumber, poNumber));
        return result[0];
    }


}