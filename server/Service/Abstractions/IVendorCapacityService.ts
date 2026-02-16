import { VendorCapacityData, VendorCapacitySummary, InsertVendorCapacityData, InsertVendorCapacitySummary } from "@shared/schema";

export interface IVentorCapasityService {
    // Vendor Capacity operations
    getVendorCapacityData(filters?: { vendorCode?: string; year?: number; client?: string }): Promise<VendorCapacityData[]>;
    getVendorCapacityByVendor(vendorCode: string, year?: number): Promise<VendorCapacityData[]>;
    getVendorCapacitySummaries(year?: number): Promise<VendorCapacitySummary[]>;
    getVendorCapacitySummary(vendorCode: string, year: number): Promise<VendorCapacitySummary | undefined>;
    createVendorCapacityData(data: InsertVendorCapacityData): Promise<VendorCapacityData>;
    bulkCreateVendorCapacityData(data: InsertVendorCapacityData[]): Promise<VendorCapacityData[]>;
    createVendorCapacitySummary(summary: InsertVendorCapacitySummary): Promise<VendorCapacitySummary>;
    bulkCreateVendorCapacitySummary(summaries: InsertVendorCapacitySummary[]): Promise<VendorCapacitySummary[]>;
    clearVendorCapacityData(vendorCode?: string, year?: number): Promise<number>;
    clearVendorCapacitySummary(vendorCode?: string, year?: number): Promise<number>;
    clearUnlockedVendorCapacityData(years: number[]): Promise<number>;
    clearUnlockedVendorCapacitySummary(years: number[]): Promise<number>;
    getLockedCapacityYears(): Promise<number[]>;
    lockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }>;
    unlockCapacityYear(year: number): Promise<{ dataRows: number; summaryRows: number }>;
    getShippedValuesByVendor(year: number): Promise<Record<string, number>>;
}