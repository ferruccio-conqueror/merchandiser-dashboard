export interface IQualityDashboardService {
    // Quality Dashboard methods
    getQualityKpis(filters?: { inspector?: string }): Promise<{
        posDueNext2Weeks: number;
        scheduledInspections: number;
        completedInspectionsThisMonth: number;
        expiringCertifications: number;
        failedFinalInspections: number;
        inspectionsOutsideWindow: number;
        pendingQABeyond45Days: number;
        lateMaterialsAtFactory: number;
    }>;

    getAtRiskPurchaseOrders(filters?: { inspector?: string }): Promise<Array<{
        id: number;
        po_number: string;
        vendor: string | null;
        status: string;
        risk_criteria: string[];
        days_until_hod: number;
    }>>;
}