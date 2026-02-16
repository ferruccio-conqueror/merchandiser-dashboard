import { ActiveProjection } from "@shared/schema";

export interface IProjectionMatchingAndValidationService {
    // Projection matching and validation operations
    matchProjectionsToPOs(importedPOs: Array<{ poNumber: string; vendor: string | null; sku: string | null; orderQuantity: number; totalValue: number; poDate: Date | null; originalShipDate: Date | null; programDescription?: string | null }>): Promise<{ matched: number; variances: number; errors: string[] }>;
    getOverdueProjections(thresholdDays?: number, filters?: { vendorId?: number; brand?: string; year?: number; month?: number }): Promise<Array<ActiveProjection & { daysUntilDue: number; isOverdue: boolean }>>;
    getProjectionsWithVariance(minVariancePct?: number, filters?: { vendorId?: number; brand?: string; year?: number; month?: number }): Promise<ActiveProjection[]>;
    getSpoProjections(filters?: { vendorId?: number; brand?: string; year?: number; month?: number }): Promise<Array<ActiveProjection & { daysUntilDue?: number; isOverdue?: boolean }>>;
    getProjectionFilterOptions(): Promise<{ vendors: Array<{ id: number; name: string; vendorCode: string }>; brands: string[] }>;
    markProjectionRemoved(projectionId: number, reason: string): Promise<ActiveProjection | undefined>;
    unmatchProjection(projectionId: number): Promise<ActiveProjection | undefined>;
    manualMatchProjection(projectionId: number, poNumber: string): Promise<ActiveProjection | undefined>;
    updateProjectionOrderType(projectionId: number, orderType: 'regular' | 'mto'): Promise<ActiveProjection | undefined>;
    getProjectionValidationSummary(vendorId?: number, filters?: { vendorId?: number; brand?: string; year?: number; month?: number }): Promise<{
        totalProjections: number;
        unmatched: number;
        matched: number;
        removed: number;
        overdueCount: number;
        atRiskCount: number;
        withVariance: number;
        spoTotal: number;
        spoMatched: number;
        spoUnmatched: number;
    }>;
}