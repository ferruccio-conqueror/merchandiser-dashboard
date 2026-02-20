import { InsertPoHeader, PoHeader, InsertPoLineItem, PoLineItem, poHeaders, poLineItems } from "@shared/schema";
import { eq, inArray, lt } from "drizzle-orm";
import { db } from "../../db";
import { IPOHeaderService } from "../Abstractions/IPOHeaderService";

export class POHeaderService implements IPOHeaderService {

    async createPoHeader(header: InsertPoHeader): Promise<PoHeader> {
        const result = await db
            .insert(poHeaders)
            .values(header as any)
            .returning();
        
        return result[0];
    }

    async updatePoHeader(id: number, header: Partial<InsertPoHeader>): Promise<PoHeader | undefined> {
        const result = await db
            .update(poHeaders)
            .set({ ...header, updatedAt: new Date() })
            .where(eq(poHeaders.id, id))
            .returning();
        
        return result[0];
    }

    async bulkCreatePoHeaders(headers: InsertPoHeader[]): Promise<PoHeader[]> {
        if (headers.length === 0) return [];
        
        const result = await db
            .insert(poHeaders)
            .values(headers as any)
            .returning();
        
        return result;
    }

    async bulkCreatePoLineItems(items: InsertPoLineItem[]): Promise<PoLineItem[]> {
        if (items.length === 0) return [];
        
        const result = await db
            .insert(poLineItems)
            .values(items as any)
            .returning();
        
        return result;
    }

    async bulkUpsertPoHeaders(headers: InsertPoHeader[]): Promise<{ 
        inserted: number; 
        updated: number; 
        headerMap: Map<string, number> 
    }> {
        if (headers.length === 0) {
            return { inserted: 0, updated: 0, headerMap: new Map() };
        }

        // Extract PO numbers
        const poNumbers: string[] = [];
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i] as any;
            poNumbers.push(h.poNumber);
        }
        
        const existing = await this.getPoHeadersByNumbers(poNumbers);
        
        const toInsert: InsertPoHeader[] = [];
        const toUpdate: { id: number; header: Partial<InsertPoHeader> }[] = [];
        
        // Separate inserts from updates
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i] as any;
            const existingHeader = existing.get(header.poNumber);
            if (existingHeader) {
                toUpdate.push({ id: existingHeader.id, header });
            } else {
                toInsert.push(header);
            }
        }

        let inserted = 0;
        let updated = 0;
        const headerMap = new Map<string, number>();

        // Insert new headers
        if (toInsert.length > 0) {
            const insertedHeaders = await this.bulkCreatePoHeaders(toInsert);
            inserted = insertedHeaders.length;
            for (let i = 0; i < insertedHeaders.length; i++) {
                const h = insertedHeaders[i];
                headerMap.set(h.poNumber, h.id);
            }
        }

        // Update existing headers
        for (let i = 0; i < toUpdate.length; i++) {
            const item = toUpdate[i];
            const updatedHeader = await this.updatePoHeader(item.id, item.header);
            if (updatedHeader) {
                updated++;
                headerMap.set(updatedHeader.poNumber, updatedHeader.id);
            }
        }

        // Add existing headers to map
        const existingArray = Array.from(existing);
        for (let i = 0; i < existingArray.length; i++) {
            const poNumber = existingArray[i][0];
            const header = existingArray[i][1];
            if (!headerMap.has(poNumber)) {
                headerMap.set(poNumber, header.id);
            }
        }

        return { inserted, updated, headerMap };
    }

    async getPoHeadersByNumbers(poNumbers: string[]): Promise<Map<string, PoHeader>> {
        if (poNumbers.length === 0) return new Map();
        
        const headers = await db
            .select()
            .from(poHeaders)
            .where(inArray(poHeaders.poNumber, poNumbers));
        
        const map = new Map<string, PoHeader>();
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            map.set(h.poNumber, h);
        }
        return map;
    }

    async getAllPoHeaders(): Promise<PoHeader[]> {
        return db.select().from(poHeaders);
    }

    async clearAllPoHeaders(): Promise<void> {
        await db.delete(poHeaders);
    }

    async clearAllPoLineItems(): Promise<void> {
        await db.delete(poLineItems);
    }

    async clearPoHeadersOutsideRetention(): Promise<{ deleted: number }> {
        const retentionDate = new Date();
        retentionDate.setDate(retentionDate.getDate() - 1825);
        
        const result = await db
            .delete(poHeaders)
            .where(lt(poHeaders.poDate, retentionDate))
            .returning();
        
        return { deleted: result.length };
    }

    async clearPoLineItemsOutsideRetention(): Promise<{ deleted: number }> {
        const retentionDate = new Date();
        retentionDate.setDate(retentionDate.getDate() - 1825);
        
        const oldHeaders = await db
            .select({ id: poHeaders.id })
            .from(poHeaders)
            .where(lt(poHeaders.poDate, retentionDate));
        
        if (oldHeaders.length === 0) {
            return { deleted: 0 };
        }
        
        const headerIds: number[] = [];
        for (let i = 0; i < oldHeaders.length; i++) {
            headerIds.push(oldHeaders[i].id);
        }
        
        const result = await db
            .delete(poLineItems)
            .where(inArray(poLineItems.poHeaderId, headerIds))
            .returning();
        
        return { deleted: result.length };
    }

    async clearPoLineItemsByHeaderIds(headerIds: number[]): Promise<void> {
        if (headerIds.length === 0) return;
        
        await db
            .delete(poLineItems)
            .where(inArray(poLineItems.poHeaderId, headerIds));
    }
}