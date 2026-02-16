import { ColorPanel, Vendor, ColorPanelHistory, Sku } from "@shared/schema";

export interface IMCPDetailService {
    // MCP Detail with all related data
    getColorPanelDetail(colorPanelId: number): Promise<{
        panel: ColorPanel & { skuCount: number };
        vendor: Vendor | null;
        history: ColorPanelHistory[];
        linkedSkus: Sku[];
        workflow: any | null;
        communications: any[];
        aiEvents: any[];
        issues: any[];
    } | null>;
}