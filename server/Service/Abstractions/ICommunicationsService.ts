import { Communication, InsertCommunication } from "@shared/schema";

export interface ICommunicationsService {
    // Communications operations
    getCommunicationsByEntity(entityType: string, entityId: number): Promise<Communication[]>;
    getCommunicationsByPoNumber(poNumber: string): Promise<Communication[]>;
    createCommunication(communication: InsertCommunication): Promise<Communication>;
    updateCommunication(id: number, communication: Partial<InsertCommunication>): Promise<Communication | undefined>;
    deleteCommunication(id: number): Promise<boolean>;
}