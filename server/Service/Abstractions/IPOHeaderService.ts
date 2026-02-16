import { InsertPoHeader, PoHeader, InsertPoLineItem, PoLineItem } from "@shared/schema";

export interface IPOHeaderService {
    // PO Header/Line Item operations (normalized structure)
    createPoHeader(header: InsertPoHeader): Promise<PoHeader>;
    updatePoHeader(id: number, header: Partial<InsertPoHeader>): Promise<PoHeader | undefined>;
    bulkCreatePoHeaders(headers: InsertPoHeader[]): Promise<PoHeader[]>;
    bulkCreatePoLineItems(items: InsertPoLineItem[]): Promise<PoLineItem[]>;
    bulkUpsertPoHeaders(headers: InsertPoHeader[]): Promise<{ inserted: number; updated: number; headerMap: Map<string, number> }>;
    getPoHeadersByNumbers(poNumbers: string[]): Promise<Map<string, PoHeader>>;
    getAllPoHeaders(): Promise<PoHeader[]>;
    clearAllPoHeaders(): Promise<void>;
    clearAllPoLineItems(): Promise<void>;
    clearPoHeadersOutsideRetention(): Promise<{ deleted: number }>;
    clearPoLineItemsOutsideRetention(): Promise<{ deleted: number }>;
    clearPoLineItemsByHeaderIds(headerIds: number[]): Promise<void>;
}