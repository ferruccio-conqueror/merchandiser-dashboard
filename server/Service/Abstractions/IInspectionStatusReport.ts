export interface IInspectionStatusReport {
    // Inspection Status Report - lateness based on ship dates
    getInspectionStatusReport(filters?: {
        vendor?: string;
        merchandiser?: string;
        merchandisingManager?: string;
    }): Promise<{
        finalInspection: {
            onTime: number;
            late: number;
            pending: number;
            total: number;
        };
        inlineInspection: {
            onTime: number;
            late: number;
            pending: number;
            total: number;
        };
        vendors: string[];
    }>;
}