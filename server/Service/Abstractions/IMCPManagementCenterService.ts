import { ColorPanel, Sku, Vendor } from "@shared/schema";

export interface IMCPManagementCenterService {
    // MCP Management Center - Get panels due for renewal (expiring within N days)
    getColorPanelsDueForRenewal(filters?: {
        daysUntilExpiry?: number;
        merchandiserId?: number;
        merchandisingManagerId?: number;
        vendorId?: number;
        skuCode?: string;
        status?: string;
    }): Promise<Array<{
        panel: ColorPanel & { skuCount: number };
        workflow: any | null;
        linkedSkus: Sku[];
        vendor: Vendor | null;
        daysUntilExpiry: number;
        requiresAction: boolean;
    }>>;
}