import { ColorPanel, InsertColorPanel, colorPanels, skuColorPanels } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { IColorPanelService } from "../Abstractions/IColorPanelService";

export class ColorPanelService implements IColorPanelService {

    async getColorPanels(filters?: {
        status?: string;
        brand?: string;
        vendorId?: number;
    }): Promise<(ColorPanel & { skuCount: number })[]> {
        // Build WHERE conditions
        const conditions = [];
        
        if (filters?.status) {
            conditions.push(eq(colorPanels.status, filters.status));
        }
        if (filters?.brand) {
            conditions.push(eq(colorPanels.brand, filters.brand));
        }
        if (filters?.vendorId) {
            conditions.push(eq(colorPanels.vendorId, filters.vendorId));
        }

        // Query with SKU count
        const results = await db
            .select({
                colorPanel: colorPanels,
                skuCount: sql<number>`COALESCE(COUNT(DISTINCT ${skuColorPanels.skuId}), 0)`.as('sku_count'),
            })
            .from(colorPanels)
            .leftJoin(skuColorPanels, eq(colorPanels.id, skuColorPanels.colorPanelId))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .groupBy(colorPanels.id)
            .orderBy(colorPanels.createdAt);

        return results.map(r => ({
            ...r.colorPanel,
            skuCount: Number(r.skuCount) || 0,
        }));
    }

    async getColorPanelById(id: number): Promise<(ColorPanel & { skuCount: number }) | undefined> {
        const results = await db
            .select({
                colorPanel: colorPanels,
                skuCount: sql<number>`COALESCE(COUNT(DISTINCT ${skuColorPanels.skuId}), 0)`.as('sku_count'),
            })
            .from(colorPanels)
            .leftJoin(skuColorPanels, eq(colorPanels.id, skuColorPanels.colorPanelId))
            .where(eq(colorPanels.id, id))
            .groupBy(colorPanels.id);

        if (results.length === 0) return undefined;

        const r = results[0];
        return {
            ...r.colorPanel,
            skuCount: Number(r.skuCount) || 0,
        };
    }

    async createColorPanel(panel: InsertColorPanel): Promise<ColorPanel> {
        const result = await db
            .insert(colorPanels)
            .values(panel as any)
            .returning();
        
        return result[0];
    }

    async updateColorPanel(id: number, panel: Partial<InsertColorPanel>): Promise<ColorPanel | undefined> {
        const result = await db
            .update(colorPanels)
            .set({ ...panel, updatedAt: new Date() })
            .where(eq(colorPanels.id, id))
            .returning();
        
        return result[0];
    }

    async bulkCreateColorPanels(panels: InsertColorPanel[]): Promise<ColorPanel[]> {
        if (panels.length === 0) return [];
        
        const result = await db
            .insert(colorPanels)
            .values(panels as any)
            .returning();
        
        return result;
    }
}