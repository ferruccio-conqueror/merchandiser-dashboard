import { Vendor, InsertVendor, Sku, Inspection, QualityTest } from "@shared/schema";

export interface IVendorService {
    // Vendor operations
    getVendors(filters?: { client?: string }): Promise<Vendor[]>;
    getVendorById(id: number): Promise<Vendor | undefined>;
    getVendorByName(name: string): Promise<Vendor | undefined>;
    createVendor(vendor: InsertVendor): Promise<Vendor>;
    updateVendor(id: number, vendor: Partial<InsertVendor>): Promise<Vendor | undefined>;
    bulkCreateVendors(vendors: InsertVendor[]): Promise<Vendor[]>;
    getVendorDetailPerformance(vendorId: number, startDate?: Date, endDate?: Date): Promise<{
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
    }>;
    getVendorYTDPerformance(vendorId: number, startDate?: Date, endDate?: Date): Promise<{
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
    }>;
    getVendorSkus(vendorId: number): Promise<Sku[]>;
    getVendorInspections(vendorId: number): Promise<Inspection[]>;
    getVendorQualityTests(vendorId: number): Promise<QualityTest[]>;
    getVendorYoYSales(vendorId: number, startDate?: Date, endDate?: Date): Promise<Array<{
        year: number;
        month: number;
        monthName: string;
        totalSales: number;
        orderCount: number;
    }>>;
    getVendorOtdYoY(vendorId: number, startDate?: Date, endDate?: Date): Promise<Array<{
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
    }>>;

}