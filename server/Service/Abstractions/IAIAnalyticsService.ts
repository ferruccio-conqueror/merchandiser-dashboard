export interface IAIAnalyticsService {

    // AI Analytics operations
    getShippingAnalyticsSummary(): Promise<{
        overview: {
            totalActivePOs: number;
            totalLateOrders: number;
            trueOTD: number;
            originalOTD: number;
            avgDaysLate: number;
        };
        lateByVendor: Array<{ vendor: string; count: number; avgDaysLate: number }>;
        lateByStatus: Array<{ status: string; count: number; avgDaysLate: number }>;
        lateBySeverity: Array<{ bucket: string; count: number; avgDaysLate: number }>;
        topIssues: Array<{ issue: string; count: number; description: string }>;
        trends: {
            thisMonthLate: number;
            lastMonthLate: number;
            trendDirection: string;
            percentChange: number;
        };
    }>;

    getVendorPerformanceSummary(): Promise<{
        totalVendors: number;
        vendorsWithLateOrders: number;
    }>;

    getQualityInspectionSummary(): Promise<{
        pendingInspections: number;
        failedInspections: number;
    }>;

    getAIAnalystDataContext(): Promise<{
        latePOs: Array<{
            poNumber: string;
            vendor: string;
            daysLate: number;
            value: number;
            category: string;
            cancelDate: string;
        }>;
        atRiskPOs: Array<{
            poNumber: string;
            vendor: string;
            reason: string;
            cancelDate: string;
            value: number;
        }>;
        recentShipments: Array<{
            poNumber: string;
            vendor: string;
            status: string;
            shipDate: string;
            value: number;
        }>;
        upcomingDeadlines: Array<{
            poNumber: string;
            vendor: string;
            cancelDate: string;
            daysUntilDue: number;
            value: number;
        }>;
        vendorPerformance: Array<{
            vendor: string;
            totalPOs: number;
            latePOs: number;
            onTimeRate: number;
            totalValue: number;
        }>;
        categoryBreakdown: Array<{
            category: string;
            totalPOs: number;
            latePOs: number;
            totalValue: number;
        }>;
        failedInspections: Array<{
            poNumber: string;
            vendor: string;
            sku: string;
            inspectionType: string;
            inspectionDate: string;
        }>;
        staffPerformance: Array<{
            name: string;
            role: string;
            activePOs: number;
            latePOs: number;
            onTimeRate: number;
        }>;
    }>;
}