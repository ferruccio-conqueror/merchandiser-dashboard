import { VendorCapacityData, VendorCapacitySummary, InsertVendorCapacityData, InsertVendorCapacitySummary, vendorCapacityData, vendorCapacitySummary, poHeaders, shipments } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { IVentorCapasityService } from "../Abstractions/IVendorCapacityService";

export class VendorCapacityService implements IVentorCapasityService {

    async getVendorCapacityData(filters?: {
        vendorCode?: string;
        year?: number;
        client?: string;
    }): Promise<VendorCapacityData[]> {
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

        return db
            .select()
            .from(vendorCapacityData)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(vendorCapacityData.year, vendorCapacityData.month);
    }

    async getVendorCapacityByVendor(vendorCode: string, year?: number): Promise<VendorCapacityData[]> {
        return this.getVendorCapacityData({ vendorCode, year });
    }

    async getVendorCapacitySummaries(year?: number): Promise<VendorCapacitySummary[]> {
        const query = db.select().from(vendorCapacitySummary);

        if (year) {
            return query.where(eq(vendorCapacitySummary.year, year));
        }

        return query;
    }

    async getVendorCapacitySummary(vendorCode: string, year: number): Promise<VendorCapacitySummary | undefined> {
        const result = await db
            .select()
            .from(vendorCapacitySummary)
            .where(
                and(
                    eq(vendorCapacitySummary.vendorCode, vendorCode),
                    eq(vendorCapacitySummary.year, year)
                )
            );

        return result[0];
    }

    async createVendorCapacityData(data: InsertVendorCapacityData): Promise<VendorCapacityData> {
        const result = await db
            .insert(vendorCapacityData)
            .values(data as any)
            .returning();

        return result[0];
    }

    async bulkCreateVendorCapacityData(data: InsertVendorCapacityData[]): Promise<VendorCapacityData[]> {
        if (data.length === 0) return [];

        const result = await db
            .insert(vendorCapacityData)
            .values(data as any)
            .returning();

        return result;
    }

    async createVendorCapacitySummary(summary: InsertVendorCapacitySummary): Promise<VendorCapacitySummary> {
        const result = await db
            .insert(vendorCapacitySummary)
            .values(summary as any)
            .returning();

        return result[0];
    }

    async bulkCreateVendorCapacitySummary(summaries: InsertVendorCapacitySummary[]): Promise<VendorCapacitySummary[]> {
        if (summaries.length === 0) return [];

        const result = await db
            .insert(vendorCapacitySummary)
            .values(summaries as any)
            .returning();

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

        const result = await db
            .delete(vendorCapacityData)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .returning();

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

        const result = await db
            .delete(vendorCapacitySummary)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .returning();

        return result.length;
    }

    async clearUnlockedVendorCapacityData(years: number[]): Promise<number> {
        if (years.length === 0) return 0;

        const result = await db
            .delete(vendorCapacityData)
            .where(
                and(
                    inArray(vendorCapacityData.year, years),
                    eq(vendorCapacityData.isLocked, false)
                )
            )
            .returning();

        return result.length;
    }

    async clearUnlockedVendorCapacitySummary(years: number[]): Promise<number> {
        if (years.length === 0) return 0;

        const result = await db
            .delete(vendorCapacitySummary)
            .where(
                and(
                    inArray(vendorCapacitySummary.year, years),
                    eq(vendorCapacitySummary.isLocked, false)
                )
            )
            .returning();

        return result.length;
    }

    async getLockedCapacityYears(): Promise<number[]> {
        const dataYears = await db
            .selectDistinct({ year: vendorCapacityData.year })
            .from(vendorCapacityData)
            .where(eq(vendorCapacityData.isLocked, true));

        const summaryYears = await db
            .selectDistinct({ year: vendorCapacitySummary.year })
            .from(vendorCapacitySummary)
            .where(eq(vendorCapacitySummary.isLocked, true));

        const allYears = new Set<number>();
        for (let i = 0; i < dataYears.length; i++) {
            if (dataYears[i].year) {
                allYears.add(dataYears[i].year);
            }
        }
        for (let i = 0; i < summaryYears.length; i++) {
            if (summaryYears[i].year) {
                allYears.add(summaryYears[i].year);
            }
        }

        return Array.from(allYears).sort();
    }

    async lockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }> {
        const dataResult = await db
            .update(vendorCapacityData)
            .set({ isLocked: true })
            .where(eq(vendorCapacityData.year, year))
            .returning();

        const summaryResult = await db
            .update(vendorCapacitySummary)
            .set({ isLocked: true })
            .where(eq(vendorCapacitySummary.year, year))
            .returning();

        return {
            dataRows: dataResult.length,
            summaryRows: summaryResult.length,
        };
    }

    async unlockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }> {
        const dataResult = await db
            .update(vendorCapacityData)
            .set({ isLocked: false })
            .where(eq(vendorCapacityData.year, year))
            .returning();

        const summaryResult = await db
            .update(vendorCapacitySummary)
            .set({ isLocked: false })
            .where(eq(vendorCapacitySummary.year, year))
            .returning();

        return {
            dataRows: dataResult.length,
            summaryRows: summaryResult.length,
        };
    }

    async getShippedValuesByVendor(year: number): Promise<Record<string, number>> {
        // Calculate actual shipped values from PO headers for a given year
        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59);

        const results = await db
            .select({
                vendor: poHeaders.vendor,
                totalShipped: sql<number>`COALESCE(SUM(${poHeaders.shippedValue}), 0)`.as('total_shipped'),
            })
            .from(poHeaders)
            .where(
                and(
                    sql`${poHeaders.poDate} >= ${startOfYear}`,
                    sql`${poHeaders.poDate} <= ${endOfYear}`
                )
            )
            .groupBy(poHeaders.vendor);

        const vendorMap: Record<string, number> = {};
        for (let i = 0; i < results.length; i++) {
            const row = results[i] as any;
            if (row.vendor) {
                vendorMap[row.vendor] = Number(row.totalShipped) || 0;
            }
        }

        return vendorMap;
    }
}