import { InsertSku, Sku } from "@shared/schema";

export interface ISKUService {
    // SKU operations
    getSkus(): Promise<Sku[]>;
    getSkuById(id: number): Promise<Sku | undefined>;
    getSkuByCode(sku: string): Promise<Sku | undefined>;
    createSku(sku: InsertSku): Promise<Sku>;
    upsertSku(sku: { sku: string }): Promise<Sku>;
    bulkCreateSkus(skus: InsertSku[]): Promise<Sku[]>;
    bulkUpsertSkusFromOS340(skuData: Array<{
        sku: string;
        style?: string | null;
        description?: string | null;
        category?: string | null;
        productGroup?: string | null;
        season?: string | null;
        isNew?: boolean;
    }>): Promise<{ created: number; updated: number; skipped: number; errors: string[] }>;
    getSkuListWithMetrics(filters?: { brand?: string }): Promise<Array<{
        skuCode: string;
        description: string | null;
        supplier: string | null;
        lastOrderFobPrice: number;
        totalSalesYtd: number;
        totalOrdersYtd: number;
        lastOrderDate: Date | null;
    }>>;
    getSkuSummaryKpis(): Promise<{
        totalSkus: number;
        newSkusYtd: number;
        ytdTotalSales: number;
        ytdSalesNewSkus: number;
        ytdSalesExistingSkus: number;
        ytdTotalOrders: number;
    }>;
    getSkuShipmentHistory(skuCode: string): Promise<Array<{
        id: number;
        poNumber: string;
        vendor: string | null;
        orderQuantity: number;
        unitPrice: number;
        totalValue: number;
        poDate: string | null;
        revisedShipDate: string | null;
        status: string;
        shipmentStatus: string | null;
    }>>;
    getSkuComplianceStatus(skuCode: string): Promise<Array<{
        id: number;
        poNumber: string;
        testType: string | null;
        testCategory: string | null;
        reportDate: string | null;
        result: string | null;
        expiryDate: string | null;
        status: string;
        poCount?: number;
    }>>;
}