import { Shipment, PurchaseOrder } from "@shared/schema";

export interface IShipmentWithPODataService {
    // Shipments with PO data for Shipments page
    getShipmentsWithPoData(filters?: {
        vendor?: string;
        office?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
        client?: string;
        merchandiser?: string;
        merchandisingManager?: string;
    }): Promise<(Shipment & { po?: PurchaseOrder })[]>;
    getShipmentDetail(id: number): Promise<{ shipment: Shipment | null; po: PurchaseOrder | null; allShipments: Shipment[] }>;
}