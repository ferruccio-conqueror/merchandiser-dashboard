import { ColorPanel, Sku, SkuColorPanel, skuColorPanels, skus, colorPanels } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { ISKUColorPanelJunctionService } from "../Abstractions/ISKUColorPanelJunctionService";

export class SKUColorPanelJunctionService implements ISKUColorPanelJunctionService {

    async linkSkuToColorPanel(skuId: number, colorPanelId: number): Promise<SkuColorPanel> {
        const result = await db
            .insert(skuColorPanels)
            .values({
                skuId,
                colorPanelId,
                isActive: true,
            } as any)
            .returning();
        
        return result[0];
    }

    async getSkusForColorPanel(colorPanelId: number): Promise<Sku[]> {
        const results = await db
            .select({ sku: skus })
            .from(skuColorPanels)
            .innerJoin(skus, eq(skuColorPanels.skuId, skus.id))
            .where(
                and(
                    eq(skuColorPanels.colorPanelId, colorPanelId),
                    eq(skuColorPanels.isActive, true)
                )
            );
        
        return results.map((r: any) => r.sku);
    }

    async getColorPanelsForSku(skuId: number): Promise<ColorPanel[]> {
        const results = await db
            .select({ colorPanel: colorPanels })
            .from(skuColorPanels)
            .innerJoin(colorPanels, eq(skuColorPanels.colorPanelId, colorPanels.id))
            .where(
                and(
                    eq(skuColorPanels.skuId, skuId),
                    eq(skuColorPanels.isActive, true)
                )
            );
        
        return results.map((r: any) => r.colorPanel);
    }

    async unlinkSkuFromColorPanel(skuId: number, colorPanelId: number): Promise<void> {
        await db
            .update(skuColorPanels)
            .set({ isActive: false })
            .where(
                and(
                    eq(skuColorPanels.skuId, skuId),
                    eq(skuColorPanels.colorPanelId, colorPanelId)
                )
            );
    }

    async getSkuColorPanelById(skuId: number, colorPanelId: number): Promise<SkuColorPanel | undefined> {
        const result = await db
            .select()
            .from(skuColorPanels)
            .where(
                and(
                    eq(skuColorPanels.skuId, skuId),
                    eq(skuColorPanels.colorPanelId, colorPanelId)
                )
            );
        
        return result[0];
    }
}