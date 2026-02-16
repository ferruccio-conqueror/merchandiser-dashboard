import { ColorPanel, InsertColorPanel } from "@shared/schema";

export interface IColorPanelService {
    // Color Panel operations
    getColorPanels(filters?: {
        status?: string;
        brand?: string;
        vendorId?: number;
    }): Promise<(ColorPanel & { skuCount: number })[]>;
    getColorPanelById(id: number): Promise<(ColorPanel & { skuCount: number }) | undefined>;
    createColorPanel(panel: InsertColorPanel): Promise<ColorPanel>;
    updateColorPanel(id: number, panel: Partial<InsertColorPanel>): Promise<ColorPanel | undefined>;
    bulkCreateColorPanels(panels: InsertColorPanel[]): Promise<ColorPanel[]>;
}