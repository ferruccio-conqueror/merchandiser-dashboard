import { ColorPanelHistory, InsertColorPanelHistory, colorPanelHistory } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db";
import { IColorPanelHistoryService } from "../Abstractions/IColorPanelHistoryService";

export class ColorPanelHistoryService implements IColorPanelHistoryService {

    async getColorPanelHistory(colorPanelId: number): Promise<ColorPanelHistory[]> {
        return db
            .select()
            .from(colorPanelHistory)
            .where(eq(colorPanelHistory.colorPanelId, colorPanelId))
            .orderBy(desc(colorPanelHistory.versionNumber));
    }

    async createColorPanelHistory(history: InsertColorPanelHistory): Promise<ColorPanelHistory> {
        const result = await db
            .insert(colorPanelHistory)
            .values(history as any)
            .returning();
        
        return result[0];
    }

    async bulkCreateColorPanelHistory(history: InsertColorPanelHistory[]): Promise<ColorPanelHistory[]> {
        if (history.length === 0) return [];
        
        const result = await db
            .insert(colorPanelHistory)
            .values(history as any)
            .returning();
        
        return result;
    }
}