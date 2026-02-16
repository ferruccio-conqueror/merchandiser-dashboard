export interface IOTDBreakdownService {
    // Get monthly OTD breakdown by vendor for dashboard comparison
    getOtdByVendor(filters?: {
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
    }>>;

    getSkuYoYSales(skuCode: string): Promise<Array<{
        year: number;
        month: number;
        monthName: string;
        totalSales: number;
        orderCount: number;
    }>>;

    getSkuShippingStats(skuCode: string): Promise<{
        firstShippedDate: string | null;
        lastShippedDate: string | null;
        totalShippedSales: number;
        totalShippedOrders: number;
        totalShippedQuantity: number;
        salesThisYear: number;
        salesLastYear: number;
    } | null>;
}