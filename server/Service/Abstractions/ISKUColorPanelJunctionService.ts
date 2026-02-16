import { ColorPanel, Sku, SkuColorPanel } from "@shared/schema";

export interface ISKUColorPanelJunctionService {
    // SKU-Color Panel Junction operations
    linkSkuToColorPanel(skuId: number, colorPanelId: number): Promise<SkuColorPanel>;
    getSkusForColorPanel(colorPanelId: number): Promise<Sku[]>;
    getColorPanelsForSku(skuId: number): Promise<ColorPanel[]>;
    unlinkSkuFromColorPanel(skuId: number, colorPanelId: number): Promise<void>;
    getSkuColorPanelById(skuId: number, colorPanelId: number): Promise<SkuColorPanel | undefined>;
}