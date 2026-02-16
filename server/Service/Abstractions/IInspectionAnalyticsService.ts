export interface IInspectionAnalyticsService {
    // Inspection Analytics
    getBusinessLevelInspectionMetrics(filters?: {
        inspector?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<{
        totalInspections: number;
        firstTimePassRate: number;
        avgInspectionsPerShipment: number;
        failureAnalysis: Array<{ inspectionType: string; failedCount: number; totalCount: number; failureRate: number }>;
    }>;

    getSkuLevelInspectionMetrics(filters?: {
        inspector?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
        skuId: number;
        sku: string;
        description: string | null;
        vendorName: string | null;
        totalInspections: number;
        firstTimePassRate: number;
        avgInspectionsPerShipment: number;
        failedCount: number;
    }>>;

    getVendorLevelInspectionMetrics(filters?: {
        inspector?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
        vendorId: number | null;
        vendorName: string;
        totalInspections: number;
        firstTimePassRate: number;
        avgInspectionsPerShipment: number;
        failedCount: number;
    }>>;

    getYearOverYearFirstTimePassRate(filters?: {
        inspector?: string;
    }): Promise<Array<{
        year: number;
        month: number;
        monthName: string;
        firstTimePassRate: number;
        totalInspections: number;
        passedFirstTime: number;
    }>>;

    getInspectionDelayCorrelation(filters?: {
        inspector?: string;
    }): Promise<Array<{
        year: number;
        month: number;
        monthName: string;
        failedInspections: number;
        lateShipments: number;
        correlatedDelays: number;
    }>>;
}