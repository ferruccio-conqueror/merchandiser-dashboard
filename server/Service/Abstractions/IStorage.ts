import { PurchaseOrder, Vendor, Sku, Timeline, InsertTimeline, Shipment, InsertShipment, ImportHistory, InsertImportHistory, BrandAssignment, VendorContact, InsertVendorContact, ColorPanel, InsertColorPanel, ColorPanelHistory, InsertColorPanelHistory, SkuColorPanel, ActivityLog, InsertActivityLog, PoTimeline, PoTimelineMilestone, VendorTimelineTemplate, VendorTemplateMilestone, InsertVendorTimelineTemplate, InsertVendorTemplateMilestone, PoTask, InsertPoTask, VendorCapacityData, VendorCapacitySummary, InsertVendorCapacityData, InsertVendorCapacitySummary, InsertActiveProjection, ActiveProjection, VendorSkuProjectionHistory, Communication, InsertCommunication, AiSummary, InsertAiSummary, CategoryTimelineAverage } from "@shared/schema";
import { ComplianceFilters } from "server/storage";

export interface IStorage {


    // MCP Communications operations
    getColorPanelCommunications(colorPanelId: number): Promise<any[]>;
    createColorPanelCommunication(communication: any): Promise<any>;
    updateColorPanelCommunication(id: number, communication: any): Promise<any | undefined>;

    // MCP Messages operations
    getColorPanelMessages(communicationId: number): Promise<any[]>;
    createColorPanelMessage(message: any): Promise<any>;

    // MCP AI Events operations
    getColorPanelAiEvents(colorPanelId: number): Promise<any[]>;
    createColorPanelAiEvent(event: any): Promise<any>;
    updateColorPanelAiEvent(id: number, event: any): Promise<any | undefined>;

    // MCP Issues operations
    getColorPanelIssues(colorPanelId: number): Promise<any[]>;
    createColorPanelIssue(issue: any): Promise<any>;
    updateColorPanelIssue(id: number, issue: any): Promise<any | undefined>;

    // MCP Detail with all related data
    getColorPanelDetail(colorPanelId: number): Promise<{
        panel: ColorPanel & { skuCount: number };
        vendor: Vendor | null;
        history: ColorPanelHistory[];
        linkedSkus: Sku[];
        workflow: any | null;
        communications: any[];
        aiEvents: any[];
        issues: any[];
    } | null>;

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

    // Activity Log operations
    getActivityLogsByEntity(entityType: string, entityId: string): Promise<ActivityLog[]>;
    createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
    updateActivityLog(id: number, log: Partial<InsertActivityLog>): Promise<ActivityLog | undefined>;
    markActivityLogComplete(id: number): Promise<ActivityLog | undefined>;
    getPendingActionsByUser(createdBy?: string): Promise<ActivityLog[]>;
    getActivityLogById(id: number): Promise<ActivityLog | undefined>;

    // PO Timeline operations
    getPoTimelineByPoId(poId: number): Promise<{
        timeline: PoTimeline | null;
        milestones: PoTimelineMilestone[];
    }>;
    createPoTimeline(poId: number, templateId?: number): Promise<PoTimeline>;
    updatePoTimelineMilestone(id: number, data: { revisedDate?: Date | null; actualDate?: Date | null; actualSource?: string | null; notes?: string | null }): Promise<PoTimelineMilestone | undefined>;
    lockPoTimeline(poId: number, lockedBy: string): Promise<PoTimeline | undefined>;
    syncPoTimelineActuals(poId: number): Promise<PoTimelineMilestone[]>;
    initializePoTimelineFromTemplate(poId: number, templateId: number, poDate: Date): Promise<PoTimelineMilestone[]>;
    getAtRiskTimelineMilestones(client?: string, daysThreshold?: number): Promise<Array<{
        id: number;
        milestone: string;
        poId: number;
        poNumber: string;
        vendor: string | null;
        targetDate: Date;
        daysUntilDue: number;
        status: 'at-risk' | 'overdue';
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

    // Vendor Timeline Template operations
    getVendorTimelineTemplates(vendorId: number): Promise<VendorTimelineTemplate[]>;
    getVendorTimelineTemplateById(id: number): Promise<{
        template: VendorTimelineTemplate | null;
        milestones: VendorTemplateMilestone[];
    }>;
    createVendorTimelineTemplate(template: InsertVendorTimelineTemplate): Promise<VendorTimelineTemplate>;
    updateVendorTimelineTemplate(id: number, template: Partial<InsertVendorTimelineTemplate>): Promise<VendorTimelineTemplate | undefined>;
    deleteVendorTimelineTemplate(id: number): Promise<boolean>;
    setVendorTemplateMilestones(templateId: number, milestones: InsertVendorTemplateMilestone[]): Promise<VendorTemplateMilestone[]>;

    // PO Tasks operations
    getPoTasksByPoNumber(poNumber: string, includeCompleted?: boolean): Promise<PoTask[]>;
    getPoTaskById(id: number): Promise<PoTask | undefined>;
    createPoTask(task: InsertPoTask): Promise<PoTask>;
    updatePoTask(id: number, task: Partial<InsertPoTask>): Promise<PoTask | undefined>;
    completePoTask(id: number, completedBy: string): Promise<PoTask | undefined>;
    uncompletePoTask(id: number): Promise<PoTask | undefined>;
    deletePoTask(id: number): Promise<boolean>;
    generatePoTasksFromData(poNumber: string): Promise<PoTask[]>;
    regenerateTasksForImportedPOs(poNumbers: string[]): Promise<{ poNumber: string; tasksGenerated: number }[]>;

    // Vendor Capacity operations
    getVendorCapacityData(filters?: { vendorCode?: string; year?: number; client?: string }): Promise<VendorCapacityData[]>;
    getVendorCapacityByVendor(vendorCode: string, year?: number): Promise<VendorCapacityData[]>;
    getVendorCapacitySummaries(year?: number): Promise<VendorCapacitySummary[]>;
    getVendorCapacitySummary(vendorCode: string, year: number): Promise<VendorCapacitySummary | undefined>;
    createVendorCapacityData(data: InsertVendorCapacityData): Promise<VendorCapacityData>;
    bulkCreateVendorCapacityData(data: InsertVendorCapacityData[]): Promise<VendorCapacityData[]>;
    createVendorCapacitySummary(summary: InsertVendorCapacitySummary): Promise<VendorCapacitySummary>;
    bulkCreateVendorCapacitySummary(summaries: InsertVendorCapacitySummary[]): Promise<VendorCapacitySummary[]>;
    clearVendorCapacityData(vendorCode?: string, year?: number): Promise<number>;
    clearVendorCapacitySummary(vendorCode?: string, year?: number): Promise<number>;
    clearUnlockedVendorCapacityData(years: number[]): Promise<number>;
    clearUnlockedVendorCapacitySummary(years: number[]): Promise<number>;
    getLockedCapacityYears(): Promise<number[]>;
    lockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }>;
    unlockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }>;
    getShippedValuesByVendor(year: number): Promise<Record<string, number>>;

    // New capacity data sources (replacing SS551 for Orders on Hand and Projections)
    getOrdersOnHandFromOS340(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }>;
    getAllOrdersFromOS340(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
        shippedByVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }>;
    getProjectionsFromSkuProjections(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }>;

    // Active Projections operations
    archiveActiveProjections(vendorId: number): Promise<number>;
    createActiveProjection(projection: InsertActiveProjection): Promise<ActiveProjection>;
    getActiveProjections(vendorId: number, year?: number, month?: number): Promise<ActiveProjection[]>;
    getVendorSkuProjectionHistory(vendorId: number, sku?: string, year?: number): Promise<VendorSkuProjectionHistory[]>;



    // Communications operations
    getCommunicationsByEntity(entityType: string, entityId: number): Promise<Communication[]>;
    getCommunicationsByPoNumber(poNumber: string): Promise<Communication[]>;
    createCommunication(communication: InsertCommunication): Promise<Communication>;
    updateCommunication(id: number, communication: Partial<InsertCommunication>): Promise<Communication | undefined>;
    deleteCommunication(id: number): Promise<boolean>;

    // AI Summary operations
    getAiSummary(entityType: string, entityId: number, summaryType: string): Promise<AiSummary | undefined>;
    createOrUpdateAiSummary(summary: InsertAiSummary): Promise<AiSummary>;
    markAiSummaryStale(entityType: string, entityId: number): Promise<void>;
    deleteAiSummary(id: number): Promise<boolean>;

    // Shipments with PO data for Shipments page
    getShipmentsWithPoData(filters?: {
        vendor?: string;
        office?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
        client?: string;
        merchandiser?: string;
        merchandisingManager?: string;
    }): Promise<(Shipment & { po?: PurchaseOrder })[]>;
    getShipmentDetail(id: number): Promise<{ shipment: Shipment | null; po: PurchaseOrder | null; allShipments: Shipment[] }>;



    // Todo Dismissals
    getTodoDismissals(userId: string): Promise<{ itemType: string; itemId: string }[]>;
    dismissTodoItem(userId: string, itemType: string, itemId: string): Promise<void>;
    restoreTodoItem(userId: string, itemType: string, itemId: string): Promise<void>;
}