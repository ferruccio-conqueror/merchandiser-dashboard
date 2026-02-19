import { ColorPanel, colorPanels, Sku, SkuColorPanel, skuColorPanels, skus } from "@shared/schema";
import { eq, and, desc, sql, inArray, SQL, gte, lte, or, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { ISKUColorPanelJunctionService } from "../Abstractions/ISKUColorPanelJunctionService";

export class SKUColorPanelJunctionService implements ISKUColorPanelJunctionService {
    unlinkSkuFromColorPanel(skuId: number, colorPanelId: number): Promise<void> {
        throw new Error("Method not implemented.");
    }
    getSkuColorPanelById(skuId: number, colorPanelId: number): Promise<SkuColorPanel | undefined> {
        throw new Error("Method not implemented.");
    }


    // SKU-Color Panel Junction operations
    async linkSkuToColorPanel(skuId: number, colorPanelId: number): Promise<SkuColorPanel> {
        const result = await db.insert(skuColorPanels).values({
            skuId,
            colorPanelId,
            isActive: true,
        }).returning();
        return result[0];
    }

    async getSkusForColorPanel(colorPanelId: number): Promise<Sku[]> {
        const result = await db
            .select({
                id: skus.id,
                sku: skus.sku,
                style: skus.style,
                description: skus.description,
                category: skus.category,
                productGroup: skus.productGroup,
                season: skus.season,
                isNew: skus.isNew,
                unitPrice: skus.unitPrice,
                createdAt: skus.createdAt,
                updatedAt: skus.updatedAt,
            })
            .from(skuColorPanels)
            .innerJoin(skus, eq(skuColorPanels.skuId, skus.id))
            .where(and(
                eq(skuColorPanels.colorPanelId, colorPanelId),
                eq(skuColorPanels.isActive, true)
            ))
            .orderBy(skus.sku);
        return result;
    }

    async getColorPanelsForSku(skuId: number): Promise<ColorPanel[]> {
        const result = await db
            .select({
                id: colorPanels.id,
                vendorId: colorPanels.vendorId,
                merchandiserId: colorPanels.merchandiserId,
                brand: colorPanels.brand,
                vendorName: colorPanels.vendorName,
                collection: colorPanels.collection,
                skuDescription: colorPanels.skuDescription,
                material: colorPanels.material,
                finishName: colorPanels.finishName,
                sheenLevel: colorPanels.sheenLevel,
                finishSystem: colorPanels.finishSystem,
                paintSupplier: colorPanels.paintSupplier,
                validityMonths: colorPanels.validityMonths,
                currentMcpNumber: colorPanels.currentMcpNumber,
                currentApprovalDate: colorPanels.currentApprovalDate,
                currentExpirationDate: colorPanels.currentExpirationDate,
                status: colorPanels.status,
                notes: colorPanels.notes,
                lastReminderSent: colorPanels.lastReminderSent,
                reminderCount: colorPanels.reminderCount,
                createdAt: colorPanels.createdAt,
                updatedAt: colorPanels.updatedAt,
            })
            .from(skuColorPanels)
            .innerJoin(colorPanels, eq(skuColorPanels.colorPanelId, colorPanels.id))
            .where(and(
                eq(skuColorPanels.skuId, skuId),
                eq(skuColorPanels.isActive, true)
            ));
        return result;
    }

    async bulkLinkSkusToColorPanel(colorPanelId: number, skuIds: number[]): Promise<SkuColorPanel[]> {
        if (skuIds.length === 0) return [];
        const links = skuIds.map(skuId => ({
            skuId,
            colorPanelId,
            isActive: true,
        }));
        const result = await db.insert(skuColorPanels).values(links).returning();
        return result;
    }
}