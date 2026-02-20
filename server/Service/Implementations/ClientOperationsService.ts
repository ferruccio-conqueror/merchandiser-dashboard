import { Client, InsertClient, clients, poHeaders, vendors, staff, staffClientAssignments } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { IClientOperationService } from "../Abstractions/IClientOperationsService";

export class ClientOperationsService implements IClientOperationService {

    async getClients(): Promise<Client[]> {
        return db
            .select()
            .from(clients)
            .orderBy(clients.name);
    }

    async getClientById(id: number): Promise<Client | undefined> {
        const result = await db
            .select()
            .from(clients)
            .where(eq(clients.id, id));
        
        return result[0];
    }

    async getClientByName(name: string): Promise<Client | undefined> {
        const result = await db
            .select()
            .from(clients)
            .where(eq(clients.name, name));
        
        return result[0];
    }

    async createClient(client: InsertClient): Promise<Client> {
        const result = await db
            .insert(clients)
            .values(client as any)
            .returning();
        
        return result[0];
    }

    async updateClient(id: number, client: Partial<InsertClient>): Promise<Client | undefined> {
        const result = await db
            .update(clients)
            .set({ ...client, updatedAt: new Date() })
            .where(eq(clients.id, id))
            .returning();
        
        return result[0];
    }

    async getClientKPIs(clientId: number): Promise<{
        totalPOs: number;
        totalValue: number;
        openPOs: number;
        shippedPOs: number;
        otdPercentage: number;
        atRiskPOs: number;
        vendorCount: number;
    }> {
        // Get client name
        const client = await this.getClientById(clientId);
        if (!client) {
            return {
                totalPOs: 0,
                totalValue: 0,
                openPOs: 0,
                shippedPOs: 0,
                otdPercentage: 0,
                atRiskPOs: 0,
                vendorCount: 0,
            };
        }

        const clientName = client.name;

        // Total POs
        const totalPOsResult = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(poHeaders)
            .where(eq(poHeaders.client, clientName));
        const totalPOs = Number(totalPOsResult[0]?.count) || 0;

        // Total value
        const totalValueResult = await db
            .select({ sum: sql<number>`COALESCE(SUM(${poHeaders.totalValue}), 0)` })
            .from(poHeaders)
            .where(eq(poHeaders.client, clientName));
        const totalValue = Number(totalValueResult[0]?.sum) || 0;

        // Open POs (status = 'Booked-to-ship')
        const openPOsResult = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(poHeaders)
            .where(
                and(
                    eq(poHeaders.client, clientName),
                    eq(poHeaders.status, 'Booked-to-ship')
                )
            );
        const openPOs = Number(openPOsResult[0]?.count) || 0;

        // Shipped POs
        const shippedPOsResult = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(poHeaders)
            .where(
                and(
                    eq(poHeaders.client, clientName),
                    sql`${poHeaders.shipmentStatus} IS NOT NULL`
                )
            );
        const shippedPOs = Number(shippedPOsResult[0]?.count) || 0;

        // OTD calculation (simplified - actual logic would compare ship dates)
        const onTimePOsResult = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(poHeaders)
            .where(
                and(
                    eq(poHeaders.client, clientName),
                    sql`${poHeaders.shipmentStatus} IS NOT NULL`,
                    sql`${poHeaders.revisedShipDate} IS NULL OR ${poHeaders.revisedShipDate} <= ${poHeaders.originalShipDate}`
                )
            );
        const onTimePOs = Number(onTimePOsResult[0]?.count) || 0;
        const otdPercentage = shippedPOs > 0 ? Math.round((onTimePOs / shippedPOs) * 100) : 0;

        // At-risk POs (past original ship date and not shipped)
        const today = new Date();
        const atRiskPOsResult = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(poHeaders)
            .where(
                and(
                    eq(poHeaders.client, clientName),
                    eq(poHeaders.status, 'Booked-to-ship'),
                    sql`${poHeaders.originalShipDate} < ${today}`,
                    sql`${poHeaders.shipmentStatus} IS NULL`
                )
            );
        const atRiskPOs = Number(atRiskPOsResult[0]?.count) || 0;

        // Vendor count
        const vendorCountResult = await db
            .select({ count: sql<number>`COUNT(DISTINCT ${poHeaders.vendor})` })
            .from(poHeaders)
            .where(eq(poHeaders.client, clientName));
        const vendorCount = Number(vendorCountResult[0]?.count) || 0;

        return {
            totalPOs,
            totalValue,
            openPOs,
            shippedPOs,
            otdPercentage,
            atRiskPOs,
            vendorCount,
        };
    }

    async getStaffClientAssignments(clientId: number): Promise<Array<{
        staffId: number;
        staffName: string;
        role: string;
        isPrimary: boolean;
    }>> {
        const results = await db
            .select({
                staffId: staff.id,
                staffName: staff.name,
                role: staffClientAssignments.role,
                isPrimary: staffClientAssignments.isPrimary,
            })
            .from(staffClientAssignments)
            .innerJoin(staff, eq(staffClientAssignments.staffId, staff.id))
            .where(eq(staffClientAssignments.clientId, clientId));

        return results.map((r: any) => ({
            staffId: r.staffId,
            staffName: r.staffName,
            role: r.role || 'merchandiser',
            isPrimary: r.isPrimary,
        }));
    }

    async getClientsForStaff(staffId: number): Promise<Array<{
        clientId: number;
        clientName: string;
        role: string;
        isPrimary: boolean;
    }>> {
        const results = await db
            .select({
                clientId: clients.id,
                clientName: clients.name,
                role: staffClientAssignments.role,
                isPrimary: staffClientAssignments.isPrimary,
            })
            .from(staffClientAssignments)
            .innerJoin(clients, eq(staffClientAssignments.clientId, clients.id))
            .where(eq(staffClientAssignments.staffId, staffId));

        return results.map((r: any) => ({
            clientId: r.clientId,
            clientName: r.clientName,
            role: r.role || 'merchandiser',
            isPrimary: r.isPrimary,
        }));
    }

    async assignStaffToClient(staffId: number, clientId: number, role: string, isPrimary: boolean): Promise<void> {
        // Check if assignment already exists
        const existing = await db
            .select()
            .from(staffClientAssignments)
            .where(
                and(
                    eq(staffClientAssignments.staffId, staffId),
                    eq(staffClientAssignments.clientId, clientId)
                )
            );

        if (existing.length > 0) {
            // Update existing
            await db
                .update(staffClientAssignments)
                .set({ role, isPrimary })
                .where(
                    and(
                        eq(staffClientAssignments.staffId, staffId),
                        eq(staffClientAssignments.clientId, clientId)
                    )
                );
        } else {
            // Create new
            await db
                .insert(staffClientAssignments)
                .values({
                    staffId,
                    clientId,
                    role,
                    isPrimary,
                } as any);
        }
    }

    async removeStaffFromClient(staffId: number, clientId: number): Promise<void> {
        await db
            .delete(staffClientAssignments)
            .where(
                and(
                    eq(staffClientAssignments.staffId, staffId),
                    eq(staffClientAssignments.clientId, clientId)
                )
            );
    }
}