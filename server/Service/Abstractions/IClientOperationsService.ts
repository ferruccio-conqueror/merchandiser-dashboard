import { Client, InsertClient } from "@shared/schema";

export interface IClientOperationService {
    // Client operations
    getClients(): Promise<Client[]>;
    getClientById(id: number): Promise<Client | undefined>;
    getClientByName(name: string): Promise<Client | undefined>;
    createClient(client: InsertClient): Promise<Client>;
    updateClient(id: number, client: Partial<InsertClient>): Promise<Client | undefined>;
    getClientKPIs(clientId: number): Promise<{
        totalPOs: number;
        totalValue: number;
        openPOs: number;
        shippedPOs: number;
        otdPercentage: number;
        atRiskPOs: number;
        vendorCount: number;
    }>;
    getStaffClientAssignments(clientId: number): Promise<Array<{ staffId: number; staffName: string; role: string; isPrimary: boolean }>>;
    getClientsForStaff(staffId: number): Promise<Array<{ clientId: number; clientName: string; role: string; isPrimary: boolean }>>;
    assignStaffToClient(staffId: number, clientId: number, role: string, isPrimary: boolean): Promise<void>;
    removeStaffFromClient(staffId: number, clientId: number): Promise<void>;
}