import { inspections, poHeaders, PoTimeline, PoTimelineMilestone, poTimelineMilestones, poTimelines, PurchaseOrder, shipments, vendorTemplateMilestones } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IQualityDashboardService } from "../Abstractions/IQualityDashboardService";

export class QualityDashboardService implements IQualityDashboardService {


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

}