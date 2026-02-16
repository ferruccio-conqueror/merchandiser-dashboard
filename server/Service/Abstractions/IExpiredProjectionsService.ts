export interface IProjectionMatchingAndValidationService {
    // Expired Projections operations
    checkAndExpireProjections(): Promise<{ expiredCount: number; regularExpired: number; spoExpired: number }>;
    getExpiredProjections(filters?: { vendorId?: number; brand?: string; year?: number; month?: number; status?: string }): Promise<any[]>;
    restoreExpiredProjection(expiredId: number, restoredBy: string): Promise<boolean>;
    verifyExpiredProjection(expiredId: number, status: 'verified' | 'cancelled', verifiedBy: string, notes?: string): Promise<boolean>;
    getExpiredProjectionsSummary(): Promise<{ total: number; pending: number; verified: number; cancelled: number; restored: number }>;
}