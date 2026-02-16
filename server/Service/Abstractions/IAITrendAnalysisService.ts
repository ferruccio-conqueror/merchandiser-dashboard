export interface IAITrendAnalysisService {
    // AI Trend Analysis operations
    getVendorTrendAnalysis(): Promise<{
        vendors: Array<{
            vendor: string;
            monthlyTrends: Array<{
                month: string;
                monthNum: number;
                totalPOs: number;
                onTimePOs: number;
                latePOs: number;
                otdRate: number;
                totalValue: number;
            }>;
            yearOverYear: {
                currentYearOTD: number;
                previousYearOTD: number;
                otdChange: number;
                currentYearValue: number;
                previousYearValue: number;
                valueChange: number;
            };
            trendDirection: string;
            riskLevel: string;
        }>;
    }>;

    getStaffTrendAnalysis(): Promise<{
        staff: Array<{
            name: string;
            role: string;
            monthlyTrends: Array<{
                month: string;
                monthNum: number;
                activePOs: number;
                shippedPOs: number;
                latePOs: number;
                otdRate: number;
                totalValue: number;
            }>;
            yearOverYear: {
                currentYearOTD: number;
                previousYearOTD: number;
                currentYearVolume: number;
                previousYearVolume: number;
            };
            performanceTrend: string;
        }>;
    }>;

    getSkuTrendAnalysis(): Promise<{
        skus: Array<{
            skuCode: string;
            description: string;
            vendor: string;
            monthlyTrends: Array<{
                month: string;
                monthNum: number;
                orderCount: number;
                totalValue: number;
                onTimeCount: number;
                lateCount: number;
                failedInspections: number;
            }>;
            qualityTrend: string;
            deliveryTrend: string;
            totalYTDValue: number;
            totalYTDOrders: number;
        }>;
    }>;

    getAITrendContext(): Promise<{
        vendorTrends: Array<{
            vendor: string;
            q1OTD: number;
            q2OTD: number;
            q3OTD: number;
            q4OTD: number;
            ytdOTD: number;
            trendDirection: string;
            riskLevel: string;
        }>;
        staffTrends: Array<{
            name: string;
            role: string;
            q1OTD: number;
            q2OTD: number;
            q3OTD: number;
            q4OTD: number;
            ytdOTD: number;
            performanceTrend: string;
        }>;
        skuTrends: Array<{
            skuCode: string;
            vendor: string;
            monthlyOrders: number[];
            monthlyFailures: number[];
            qualityTrend: string;
            deliveryTrend: string;
        }>;
        seasonalPatterns: {
            peakMonths: string[];
            slowMonths: string[];
            avgMonthlyVolume: number;
        };
        yearOverYearComparison: {
            currentYearOTD: number;
            previousYearOTD: number;
            otdImprovement: number;
            currentYearValue: number;
            previousYearValue: number;
            valueGrowth: number;
        };
        futurePOs: Array<{
            month: string;
            poCount: number;
            totalValue: number;
            vendorCount: number;
            topVendors: string[];
        }>;
    }>;

    getDetailedPOsForAI(): Promise<{
        activePOs: Array<{
            poNumber: string;
            copNumber: string | null;
            vendor: string;
            client: string;
            category: string;
            program: string;
            totalValue: number;
            shippedValue: number;
            totalQuantity: number;
            balanceQuantity: number;
            status: string;
            shipmentStatus: string;
            poDate: string | null;
            originalCancelDate: string | null;
            revisedCancelDate: string | null;
            revisedBy: string | null;
            revisedReason: string | null;
            daysUntilDue: number | null;
            daysLate: number | null;
            skus: string[];
            shipments: Array<{
                shipmentNumber: number;
                deliveryDate: string | null;
                sailingDate: string | null;
                qtyShipped: number;
                shippedValue: number;
                ptsNumber: string | null;
                logisticStatus: string | null;
                hodStatus: string | null;
            }>;
        }>;
        summary: {
            totalActivePOs: number;
            totalActiveValue: number;
            missingCOP: number;
            withShipments: number;
            withoutShipments: number;
        };
    }>;

    getProjectionsForAI(): Promise<{
        currentProjections: Array<{
            vendorCode: string;
            sku: string;
            skuDescription: string | null;
            brand: string;
            collection: string | null;
            year: number;
            month: number;
            monthName: string;
            projectedValue: number;
            projectedQuantity: number;
            matchStatus: string;
            matchedPoNumber: string | null;
            actualValue: number | null;
            actualQuantity: number | null;
            variancePct: number | null;
            orderType: string;
        }>;
        historicalAccuracy: Array<{
            year: number;
            month: number;
            monthName: string;
            totalProjections: number;
            matchedCount: number;
            unmatchedCount: number;
            expiredCount: number;
            matchRatePct: number;
        }>;
        accuracySummary: {
            totalProjections: number;
            matched: number;
            unmatched: number;
            expired: number;
            accurateCount: number;
            overOrderedCount: number;
            underOrderedCount: number;
            avgVariancePct: number;
        };
        vendorAccuracy: Array<{
            vendorCode: string;
            totalProjections: number;
            matchedCount: number;
            avgVariancePct: number;
        }>;
    }>;

    getSKUDataForAI(): Promise<{
        topSellingSkus: Array<{
            sku: string;
            description: string | null;
            vendor: string;
            category: string | null;
            totalOrders: number;
            totalValue: number;
            totalQuantity: number;
            avgOrderValue: number;
            shipmentCount: number;
            lastOrderDate: string | null;
        }>;
        skusByCategory: Array<{
            category: string;
            skuCount: number;
            totalValue: number;
            avgOrderValue: number;
        }>;
        skusByVendor: Array<{
            vendor: string;
            skuCount: number;
            totalValue: number;
            totalOrders: number;
        }>;
        summary: {
            totalActiveSKUs: number;
            totalSKUValue: number;
            avgSKUOrderValue: number;
        };
    }>;
}