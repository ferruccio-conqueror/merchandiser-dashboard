import { } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IQualityAndComplianceDashboardService } from "../Abstractions/IQualityAndComplianceDashboardService";
import { ComplianceFilters } from "server/storage";

export class QualityAndComplianceDashboardService implements IQualityAndComplianceDashboardService {


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

}