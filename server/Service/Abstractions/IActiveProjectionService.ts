import { ActiveProjection, InsertActiveProjection, VendorSkuProjectionHistory } from "@shared/schema";

export interface IActiveProjectionService {
    // Active Projections operations
    archiveActiveProjections(vendorId: number): Promise<number>;
    createActiveProjection(projection: InsertActiveProjection): Promise<ActiveProjection>;
    getActiveProjections(vendorId: number, year?: number, month?: number): Promise<ActiveProjection[]>;
    getVendorSkuProjectionHistory(vendorId: number, sku?: string, year?: number): Promise<VendorSkuProjectionHistory[]>;
}   