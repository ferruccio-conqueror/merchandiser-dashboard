import { Shipment, InsertShipment } from "@shared/schema";

export interface IShipmentService {
    // Shipment operations
    getShipmentsByPoId(poId: number): Promise<Shipment[]>;
    getShipmentsByPoNumber(poNumber: string): Promise<Shipment[]>;
    createShipment(shipment: InsertShipment): Promise<Shipment>;
    bulkCreateShipments(shipments: InsertShipment[]): Promise<Shipment[]>;
    bulkUpsertShipments(shipments: InsertShipment[]): Promise<{ inserted: number; updated: number }>;
    enrichShipmentsWithOS650(enrichmentData: Map<string, any[]>): Promise<{ inserted: number; updated: number }>;
    clearAllShipments(): Promise<void>;
    clearShipmentsOutsideRetention(): Promise<{ deleted: number }>;
    clearAllPoHeaders(): Promise<void>;
    clearAllPoLineItems(): Promise<void>;
}