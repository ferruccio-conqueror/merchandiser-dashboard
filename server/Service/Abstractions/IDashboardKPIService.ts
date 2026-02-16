export interface IDashboardKPIService {
    // Dashboard KPIs
    getDashboardKPIs(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<{
        otdPercentage: number;
        otdOriginalPercentage: number;
        avgLateDays: number;
        totalOrders: number;
        lateOrders: number;
        onTimeOrders: number;
        atRiskOrders: number;
        onTimeValue: number;
        lateValue: number;
        atRiskValue: number;
    }>;
}   