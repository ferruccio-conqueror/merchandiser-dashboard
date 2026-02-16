import { ComplianceFilters } from "server/storage";

export interface IQualityAndComplianceDashboardService {
    // Quality & Compliance Dashboard - Alert System
    getBookingConfirmedNeedingInspection(filters?: ComplianceFilters): Promise<Array<{
        id: number;
        po_number: string;
        vendor: string | null;
        sku: string | null;
        revised_cancel_date: Date | null;
        status: string;
        days_until_ship: number | null;
        needed_inspections: string[];
    }>>;

    getMissingInlineInspections(filters?: ComplianceFilters): Promise<Array<{
        id: number;
        po_number: string;
        vendor: string | null;
        sku: string | null;
        cargo_ready_date: Date | null;
        days_until_crd: number | null;
        status: string;
    }>>;

    getFailedInspections(filters?: ComplianceFilters, limit?: number): Promise<Array<{
        id: number;
        po_number: string;
        vendor_name: string | null;
        sku: string | null;
        inspection_type: string;
        result: string | null;
        inspection_date: Date | null;
        notes: string | null;
    }>>;

    getExpiringCertificates90Days(filters?: ComplianceFilters): Promise<Array<{
        id: number;
        po_number: string;
        sku: string | null;
        sku_description: string | null;
        test_type: string;
        result: string | null;
        status: string | null;
        expiry_date: Date | null;
        ship_date: Date | null;
        days_until_expiry: number | null;
        po_count?: number;
    }>>;

    getInspectionPerformanceByVendor(): Promise<Array<{
        vendor_name: string;
        total_inspections: number;
        passed_count: number;
        failed_count: number;
        pass_rate: number;
    }>>;

    getInspectionPerformanceBySku(): Promise<Array<{
        sku: string;
        total_inspections: number;
        passed_count: number;
        failed_count: number;
        pass_rate: number;
    }>>;

    getQualityComplianceAlertCounts(filters?: ComplianceFilters): Promise<{
        bookingConfirmedNeedingInspection: number;
        missingInlineInspections: number;
        missingFinalInspections: number;
        failedInspections: number;
        expiringCertificates: number;
    }>;

    getMissingFinalInspections(filters?: ComplianceFilters): Promise<Array<{
        id: number;
        po_number: string;
        vendor: string | null;
        sku: string | null;
        revised_ship_date: Date | null;
        days_until_ship: number | null;
        status: string;
    }>>;
}