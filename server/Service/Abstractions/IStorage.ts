export interface IStorage {
    // Filter Options
    getDashboardFilterOptions(): Promise<{
        merchandisers: string[];
        managers: string[];
        vendors: string[];
        brands: string[];
    }>;

    // Vendor Performance
    getVendorPerformance(): Promise<Array<{
        vendor: string;
        totalPOs: number;
        onTimePercentage: number;
        avgDelay: number;
    }>>;

    // Year-over-Year Late Shipments with value-based OTD metrics
    getYearOverYearLateShipments(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
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
    }>>;

    // Get unique revision reasons for filter dropdown
    getRevisionReasons(): Promise<string[]>;

    // Year-over-Year Original OTD with reason filtering (includes value-based metrics)
    getOriginalOtdYoY(filters?: {
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
        on_time_value: number;
        total_value: number;
        late_value: number;
        original_otd_value_pct: number;
    }>>;

    // Vendor Late and At-Risk Shipments
    getVendorLateAndAtRisk(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
        vendor: string;
        late_count: number;
        at_risk_count: number;
    }>>;

    // Late Shipments by Reason Code
    getLateShipmentsByReason(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
        reason: string;
        count: number;
        avg_days_late: number;
        total_value: number;
    }>>;

    // Late Shipments by Status
    getLateShipmentsByStatus(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
        status: string;
        count: number;
        avg_days_late: number;
        total_value: number;
    }>>;

    // Late and At-Risk POs for Dashboard
    getLateAndAtRiskPOs(filters?: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<Array<{
        id: number;
        po_number: string;
        vendor: string | null;
        revised_reason: string | null;
        status: string;
    }>>;

    // Missing Inspections for To-Do list (uses shared AT_RISK_THRESHOLDS)
    getMissingInspections(filters?: { client?: string; merchandiser?: string }): Promise<Array<{
        id: number;
        poNumber: string;
        vendor: string | null;
        merchandiser: string | null;
        revisedShipDate: Date | null;
        daysUntilHod: number;
        missingInlineInspection: boolean;
        missingFinalInspection: boolean;
        totalValue: number | null;
    }>>;

    // Todo Dismissals
    getTodoDismissals(userId: string): Promise<{ itemType: string; itemId: string }[]>;
    dismissTodoItem(userId: string, itemType: string, itemId: string): Promise<void>;
    restoreTodoItem(userId: string, itemType: string, itemId: string): Promise<void>;
}