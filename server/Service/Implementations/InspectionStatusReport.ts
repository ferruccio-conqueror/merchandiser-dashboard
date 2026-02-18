import { } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IInspectionStatusReport } from "../Abstractions/IInspectionStatusReport";

export class InspectionStatusReport implements IInspectionStatusReport {


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
}