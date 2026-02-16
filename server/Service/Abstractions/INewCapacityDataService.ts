export interface INewCapacityDataService {
    // New capacity data sources (replacing SS551 for Orders on Hand and Projections)
    getOrdersOnHandFromOS340(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }>;
    getAllOrdersFromOS340(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
        shippedByVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }>;
    getProjectionsFromSkuProjections(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }>;
}