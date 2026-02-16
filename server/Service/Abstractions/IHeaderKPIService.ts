export interface IHeaderKpiService {
    // Header KPIs with YoY comparison
    getHeaderKPIs(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<{
        totalSkus: number;
        totalSkusPrevYear: number;
        ytdTotalSales: number;
        ytdTotalSalesPrevYear: number;
        ytdTotalOrders: number;
        ytdTotalOrdersPrevYear: number;
        totalPosForYear: number;
        totalPosForYearPrevYear: number;
        ytdTotalPos: number;
        ytdTotalPosPrevYear: number;
        totalActivePOs: number;
        totalActivePosPrevYear: number;
        ytdPosUnshipped: number;
        ytdPosUnshippedPrevYear: number;
        ytdSalesNewSkus: number;
        ytdSalesExistingSkus: number;
        ytdProjections: number;
        ytdProjectionsPrevYear: number;
        ytdPotential: number;
        ytdPotentialPrevYear: number;
        newSkusYtd: number;
        newSkusYtdPrevYear: number;
        totalSales: number;
        shippedOrders: number;
        newSkus: number;
    }>;
}