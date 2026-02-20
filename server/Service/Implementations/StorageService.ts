import { activityLogs, InsertPoTask, inspections, MILESTONE_LABELS, poHeaders, PoTask, poTasks, poTimelineMilestones, poTimelines, qualityTests, shipments } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IStorage } from "../Abstractions/IStorage";;

export class StorageService implements IStorage {

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

    // Year-over-Year Original OTD with optional reason filtering getOriginalOtdYoY
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

}