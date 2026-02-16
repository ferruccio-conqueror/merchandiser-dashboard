import { Staff, InsertStaff, Vendor, staff } from "@shared/schema";
import { eq, sql} from "drizzle-orm";
import { db } from "../../db";
import { IStaffService } from "../Abstractions/IStaffService";
import { VendorService } from "../Implementations/VendorService";

export class StaffService implements IStaffService {
    constructor(private vendorService: VendorService) {}
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
        const result = await db.insert(staff).values(member as any).returning();
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
        const result = await db.insert(staff).values(members as any).returning();
        return result;
    }
        async updateVendorStaffAssignment(
        vendorName: string,
        merchandiserName: string,
        merchandisingManagerName: string
    ): Promise<Vendor | undefined> {
        const vendor = await this.vendorService.getVendorByName(vendorName);
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

        const updates: Partial<Vendor> = {
            merchandiser: merchandiserName,
            merchandisingManager: merchandisingManagerName,
            merchandiserId: merchandiser.id,
            merchandisingManagerId: merchandisingManager.id,
        };

        return this.vendorService.updateVendor(vendor.id, updates);
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
}
