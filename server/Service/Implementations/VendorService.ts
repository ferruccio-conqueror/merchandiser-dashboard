import { Vendor, InsertVendor, Sku, Inspection, QualityTest, vendors, vendorClientAssignments, clients, inspections, qualityTests, poHeaders, shipments, poLineItems } from "@shared/schema";
import { eq, sql, desc, inArray, and, or, not } from "drizzle-orm";
import { db } from "../../db";
import { IVendorService } from "../Abstractions/IVendorService";

export class VendorService implements IVendorService {
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
                return result as Vendor[] || [];
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
        const result = await db.insert(vendors).values(vendor as any).returning();
        return result[0];
    }

    async updateVendor(id: number, vendor: Partial<InsertVendor>): Promise<Vendor | undefined> {
        const result = await db
            .update(vendors)
            .set({ ...(vendor as any), updatedAt: new Date() })
            .where(eq(vendors.id, id))
            .returning();
        return result[0];
    }

    async bulkCreateVendors(vendorsToCreate: InsertVendor[]): Promise<Vendor[]> {
        if (vendorsToCreate.length === 0) return [];
        const result = await db.insert(vendors).values(vendorsToCreate as any).returning();
        return result as Vendor[];
    }

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

        const currentYear = new Date().getFullYear();
        const ytdStart = startDate || new Date(currentYear, 0, 1);
        const ytdEnd = endDate || new Date();

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

        const skuResult = await db.execute(sql`
      SELECT DISTINCT pli.sku
      FROM po_headers ph
      JOIN po_line_items pli ON pli.po_header_id = ph.id
      WHERE ph.vendor = ${vendor.name}
        AND pli.sku IS NOT NULL
    `);
        const vendorSkus = skuResult.rows.map((row: any) => row.sku as string).filter(Boolean);

        const vendorInspections = vendorSkus.length > 0
            ? await db
                .select()
                .from(inspections)
                .where(inArray(inspections.sku, vendorSkus))
            : [];

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

        const currentYear = new Date().getFullYear();
        const ytdStart = startDate || new Date(currentYear, 0, 1);
        const ytdEnd = endDate || new Date();

        const baseVendorName = vendor.name.includes(' - ')
            ? vendor.name.split(' - ')[0]
            : vendor.name;

        const result = await db.execute<{
            month_num: number;
            month_name: string;
            total_orders: number;
            on_time_orders: number;
            late_orders: number;
            at_risk_orders: number;
        }>(sql`
      WITH po_statuses AS (
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
            EXISTS(
              SELECT 1 FROM inspections i 
              WHERE i.po_number = ph.po_number 
                AND i.inspection_type = 'Final Inspection'
                AND i.result IN ('Failed', 'Failed - Critical Failure')
            )
            OR (
              EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) <= 14
              AND EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) > 0
              AND NOT EXISTS(SELECT 1 FROM inspections i WHERE i.po_number = ph.po_number AND i.inspection_type ILIKE '%inline%')
            )
            OR (
              EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) <= 7
              AND EXTRACT(DAY FROM (ph.revised_ship_date - CURRENT_DATE)) > 0
              AND NOT EXISTS(SELECT 1 FROM inspections i WHERE i.po_number = ph.po_number AND i.inspection_type ILIKE '%final%')
            )
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
            yearsToInclude = [twoYearsAgo, previousYear, currentYear].filter(y => y >= MIN_YEAR);
        }

        if (yearsToInclude.length === 0) {
            yearsToInclude = [currentYear];
        }

        const baseVendorName = vendor.name.includes(' - ')
            ? vendor.name.split(' - ')[0]
            : vendor.name;

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
          CASE 
            WHEN first_delivery_date <= effective_cancel_date THEN 1 
            ELSE 0 
          END as is_on_time
        FROM vendor_shipped_pos
      ),
      vendor_shipped_agg AS (
        SELECT 
          due_year as year,
          due_month as month,
          month_name,
          SUM(is_on_time) as shipped_on_time,
          COUNT(*) as total_shipped,
          SUM(CASE WHEN is_on_time = 1 THEN shipped_value ELSE 0 END) as on_time_value,
          SUM(shipped_value) as total_value
        FROM po_with_otd
        GROUP BY due_year, due_month, month_name
      ),
      vendor_overdue AS (
        SELECT 
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as year,
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as month,
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon') as month_name,
          COUNT(DISTINCT ph.po_number) as overdue_count,
          SUM(COALESCE(ph.total_value, 0)) as overdue_value
        FROM po_headers ph
        LEFT JOIN shipments s ON s.po_number = ph.po_number AND s.actual_sailing_date IS NOT NULL
        WHERE (ph.vendor = ${vendor.name} OR ph.vendor = ${baseVendorName})
          AND s.id IS NULL
          AND COALESCE(ph.revised_cancel_date, ph.original_cancel_date) < CURRENT_DATE
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) IN ${yearsFilter}
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
        GROUP BY 
          EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)),
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)),
          TO_CHAR(COALESCE(ph.revised_cancel_date, ph.original_cancel_date), 'Mon')
      )
      SELECT 
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
        CASE WHEN (COALESCE(vs.total_shipped, 0) + COALESCE(vo.overdue_count, 0)) > 0 
          THEN ROUND((COALESCE(vs.shipped_on_time, 0)::numeric / (COALESCE(vs.total_shipped, 0) + COALESCE(vo.overdue_count, 0))::numeric) * 100, 1)
          ELSE 0 
        END as revised_otd_pct,
        CASE WHEN (COALESCE(vs.total_value, 0) + COALESCE(vo.overdue_value, 0)) > 0 
          THEN ROUND((COALESCE(vs.on_time_value, 0)::numeric / (COALESCE(vs.total_value, 0) + COALESCE(vo.overdue_value, 0))::numeric) * 100, 1)
          ELSE 0 
        END as revised_otd_value_pct
      FROM vendor_shipped_agg vs
      FULL OUTER JOIN vendor_overdue vo 
        ON vs.year = vo.year 
        AND vs.month = vo.month
      WHERE COALESCE(vs.total_shipped, 0) + COALESCE(vo.overdue_count, 0) > 0
      ORDER BY year, month
    `);

        return result.rows.map(row => ({
            year: Number(row.year),
            month: Number(row.month),
            monthName: String(row.month_name),
            shippedOnTime: Number(row.shipped_on_time || 0),
            totalShipped: Number(row.total_shipped || 0),
            otdPct: Number(row.otd_pct || 0),
            onTimeValue: Number(row.on_time_value || 0),
            totalValue: Number(row.total_value || 0),
            lateValue: Number(row.total_value || 0) - Number(row.on_time_value || 0),
            otdValuePct: Number(row.otd_value_pct || 0),
            overdueUnshipped: Number(row.overdue_unshipped || 0),
            overdueBacklogValue: Number(row.overdue_backlog_value || 0),
            revisedOtdPct: Number(row.revised_otd_pct || 0),
            revisedOtdValuePct: Number(row.revised_otd_value_pct || 0),
        }));
    }
}
