import { } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IOTDBreakdownService } from "../Abstractions/IOTDBreakdownService";

export class OTDBreakdownService implements IOTDBreakdownService {


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

}