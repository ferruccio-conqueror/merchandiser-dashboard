import { InsertVendorCapacityData, InsertVendorCapacitySummary, poHeaders, VendorCapacityData, vendorCapacityData, vendorCapacitySummary, VendorCapacitySummary, vendors } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IVentorCapasityService } from "../Abstractions/IVendorCapacityService";

export class VentorCapasityService implements IVentorCapasityService {


    // Vendor Capacity operations
    async getVendorCapacityData(filters?: { vendorCode?: string; year?: number; client?: string }): Promise<VendorCapacityData[]> {
        const conditions = [];

        if (filters?.vendorCode) {
            conditions.push(eq(vendorCapacityData.vendorCode, filters.vendorCode));
        }
        if (filters?.year) {
            conditions.push(eq(vendorCapacityData.year, filters.year));
        }
        if (filters?.client) {
            conditions.push(eq(vendorCapacityData.client, filters.client));
        }

        const result = conditions.length > 0
            ? await db.select().from(vendorCapacityData).where(and(...conditions)).orderBy(vendorCapacityData.year, vendorCapacityData.month, vendorCapacityData.client)
            : await db.select().from(vendorCapacityData).orderBy(vendorCapacityData.year, vendorCapacityData.month, vendorCapacityData.client);

        return result;
    }

    async getVendorCapacityByVendor(vendorCode: string, year?: number): Promise<VendorCapacityData[]> {
        const conditions = [eq(vendorCapacityData.vendorCode, vendorCode)];

        if (year) {
            conditions.push(eq(vendorCapacityData.year, year));
        }

        const result = await db.select().from(vendorCapacityData)
            .where(and(...conditions))
            .orderBy(vendorCapacityData.year, vendorCapacityData.month, vendorCapacityData.client);

        return result;
    }

    async getVendorCapacitySummaries(year?: number): Promise<(VendorCapacitySummary & { canonicalVendorName?: string; canonicalVendorId?: number })[]> {
        const query = db.select({
            id: vendorCapacitySummary.id,
            vendorId: vendorCapacitySummary.vendorId,
            vendorCode: vendorCapacitySummary.vendorCode,
            vendorName: vendorCapacitySummary.vendorName,
            office: vendorCapacitySummary.office,
            year: vendorCapacitySummary.year,
            totalShipmentAnnual: vendorCapacitySummary.totalShipmentAnnual,
            totalProjectionAnnual: vendorCapacitySummary.totalProjectionAnnual,
            totalReservedCapacityAnnual: vendorCapacitySummary.totalReservedCapacityAnnual,
            avgUtilizationPct: vendorCapacitySummary.avgUtilizationPct,
            cbShipmentAnnual: vendorCapacitySummary.cbShipmentAnnual,
            cb2ShipmentAnnual: vendorCapacitySummary.cb2ShipmentAnnual,
            ckShipmentAnnual: vendorCapacitySummary.ckShipmentAnnual,
            isLocked: vendorCapacitySummary.isLocked,
            importDate: vendorCapacitySummary.importDate,
            createdAt: vendorCapacitySummary.createdAt,
            updatedAt: vendorCapacitySummary.updatedAt,
            canonicalVendorName: vendors.name,
            canonicalVendorId: vendors.id,
        })
            .from(vendorCapacitySummary)
            .leftJoin(vendors, eq(vendorCapacitySummary.vendorId, vendors.id));

        if (year) {
            return await query
                .where(eq(vendorCapacitySummary.year, year))
                .orderBy(vendors.name, vendorCapacitySummary.vendorCode);
        }
        return await query.orderBy(vendorCapacitySummary.year, vendors.name, vendorCapacitySummary.vendorCode);
    }

    async getVendorCapacitySummary(vendorCode: string, year: number): Promise<VendorCapacitySummary | undefined> {
        const result = await db.select().from(vendorCapacitySummary)
            .where(and(
                eq(vendorCapacitySummary.vendorCode, vendorCode),
                eq(vendorCapacitySummary.year, year)
            ));
        return result[0];
    }

    async createVendorCapacityData(data: VendorCapacityData): Promise<VendorCapacityData> {
        const result = await db.insert(vendorCapacityData).values(data).returning();
        return result[0];
    }

    async bulkCreateVendorCapacityData(data: InsertVendorCapacityData[]): Promise<VendorCapacityData[]> {
        if (data.length === 0) return [];
        const result = await db.insert(vendorCapacityData).values(data).returning();
        return result;
    }

    async createVendorCapacitySummary(summary: InsertVendorCapacitySummary): Promise<VendorCapacitySummary> {
        const result = await db.insert(vendorCapacitySummary).values(summary).returning();
        return result[0];
    }

    async bulkCreateVendorCapacitySummary(summaries: InsertVendorCapacitySummary[]): Promise<VendorCapacitySummary[]> {
        if (summaries.length === 0) return [];
        const result = await db.insert(vendorCapacitySummary).values(summaries).returning();
        return result;
    }

    async clearVendorCapacityData(vendorCode?: string, year?: number): Promise<number> {
        const conditions = [];
        if (vendorCode) {
            conditions.push(eq(vendorCapacityData.vendorCode, vendorCode));
        }
        if (year) {
            conditions.push(eq(vendorCapacityData.year, year));
        }

        if (conditions.length > 0) {
            const result = await db.delete(vendorCapacityData).where(and(...conditions)).returning();
            return result.length;
        }
        const result = await db.delete(vendorCapacityData).returning();
        return result.length;
    }

    async clearVendorCapacitySummary(vendorCode?: string, year?: number): Promise<number> {
        const conditions = [];
        if (vendorCode) {
            conditions.push(eq(vendorCapacitySummary.vendorCode, vendorCode));
        }
        if (year) {
            conditions.push(eq(vendorCapacitySummary.year, year));
        }

        if (conditions.length > 0) {
            const result = await db.delete(vendorCapacitySummary).where(and(...conditions)).returning();
            return result.length;
        }
        const result = await db.delete(vendorCapacitySummary).returning();
        return result.length;
    }

    async clearUnlockedVendorCapacityData(years: number[]): Promise<number> {
        if (years.length === 0) return 0;
        // Only delete rows where isLocked is false AND year is in the list
        const result = await db.delete(vendorCapacityData)
            .where(and(
                eq(vendorCapacityData.isLocked, false),
                inArray(vendorCapacityData.year, years)
            ))
            .returning();
        return result.length;
    }

    async clearUnlockedVendorCapacitySummary(years: number[]): Promise<number> {
        if (years.length === 0) return 0;
        // Only delete rows where isLocked is false AND year is in the list
        const result = await db.delete(vendorCapacitySummary)
            .where(and(
                eq(vendorCapacitySummary.isLocked, false),
                inArray(vendorCapacitySummary.year, years)
            ))
            .returning();
        return result.length;
    }

    async getLockedCapacityYears(): Promise<number[]> {
        const lockedData = await db.selectDistinct({ year: vendorCapacityData.year })
            .from(vendorCapacityData)
            .where(eq(vendorCapacityData.isLocked, true));
        const lockedSummary = await db.selectDistinct({ year: vendorCapacitySummary.year })
            .from(vendorCapacitySummary)
            .where(eq(vendorCapacitySummary.isLocked, true));

        const yearsSet = new Set([
            ...lockedData.map(r => r.year),
            ...lockedSummary.map(r => r.year)
        ]);
        return Array.from(yearsSet).sort((a, b) => a - b);
    }

    async lockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }> {
        const dataResult = await db.update(vendorCapacityData)
            .set({ isLocked: true })
            .where(eq(vendorCapacityData.year, year))
            .returning();
        const summaryResult = await db.update(vendorCapacitySummary)
            .set({ isLocked: true })
            .where(eq(vendorCapacitySummary.year, year))
            .returning();
        return { dataRows: dataResult.length, summaryRows: summaryResult.length };
    }

    async unlockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }> {
        const dataResult = await db.update(vendorCapacityData)
            .set({ isLocked: false })
            .where(eq(vendorCapacityData.year, year))
            .returning();
        const summaryResult = await db.update(vendorCapacitySummary)
            .set({ isLocked: false })
            .where(eq(vendorCapacitySummary.year, year))
            .returning();
        return { dataRows: dataResult.length, summaryRows: summaryResult.length };
    }

    async getShippedValuesByVendor(year: number): Promise<Record<string, number>> {
        // Use ship date for shipped orders since we're looking at when they actually shipped
        const result = await db
            .select({
                vendor: poHeaders.vendor,
                shippedValue: sql<number>`SUM(CASE WHEN ${poHeaders.shipmentStatus} IN ('On-Time', 'Late') THEN ${poHeaders.totalValue} ELSE 0 END)`
            })
            .from(poHeaders)
            .where(sql`${poHeaders.shipmentStatus} IN ('On-Time', 'Late') 
            AND EXTRACT(YEAR FROM COALESCE(${poHeaders.revisedShipDate}, ${poHeaders.originalShipDate})) = ${year}`)
            .groupBy(poHeaders.vendor);

        const vendorShipped: Record<string, number> = {};
        for (const row of result) {
            if (row.vendor && row.shippedValue) {
                vendorShipped[row.vendor] = Number(row.shippedValue);
            }
        }
        return vendorShipped;
    }

}