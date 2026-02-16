import { PurchaseOrder, PurchaseOrderWithComputedFields, PoLineItem, PoHeader, InsertPurchaseOrder } from "@shared/schema";

export interface IPurchaseOrderService {
    // Purchase Order operations
    getPurchaseOrders(filters?: {
        vendor?: string;
        office?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
        client?: string;
        merchandiser?: string;
    }): Promise<PurchaseOrderWithComputedFields[]>;
    getPurchaseOrderById(id: number): Promise<PurchaseOrder | undefined>;
    getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | undefined>;
    getPurchaseOrdersByNumbers(poNumbers: string[]): Promise<Map<string, PurchaseOrder>>;
    getPurchaseOrderLineItems(poNumber: string): Promise<PoLineItem[]>;
    createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
    updatePurchaseOrder(id: number, po: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined>;
    bulkCreatePurchaseOrders(pos: InsertPurchaseOrder[]): Promise<PurchaseOrder[]>;
    bulkUpsertPurchaseOrders(pos: InsertPurchaseOrder[]): Promise<{ inserted: number; updated: number }>;
    clearAllPurchaseOrders(): Promise<void>;
    getPoHeaderByNumber(poNumber: string): Promise<PoHeader | undefined>;
}