import { ColorPanelHistory, InsertColorPanelHistory } from "@shared/schema";

export interface IColorPanelHistoryService {
    // Color Panel History operations
    getColorPanelHistory(colorPanelId: number): Promise<ColorPanelHistory[]>;
    createColorPanelHistory(history: InsertColorPanelHistory): Promise<ColorPanelHistory>;
    bulkCreateColorPanelHistory(history: InsertColorPanelHistory[]): Promise<ColorPanelHistory[]>;
}