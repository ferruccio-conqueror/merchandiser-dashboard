import { Client, clients, InsertClient } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IClientOperationService } from "../Abstractions/IClientOperationsService";

export class ClientOperationService implements IClientOperationService {

    // Client operations
    async getClients(): Promise<Client[]> {
        return db.select().from(clients).orderBy(clients.name);
    }

    async getClientById(id: number): Promise<Client | undefined> {
        const result = await db.select().from(clients).where(eq(clients.id, id));
        return result[0];
    }

    async getClientByName(name: string): Promise<Client | undefined> {
        const result = await db.select().from(clients).where(eq(clients.name, name));
        return result[0];
    }

    async createClient(client: InsertClient): Promise<Client> {
        const result = await db.insert(clients).values(client).returning();
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
        const client = await this.getClientById(clientId);
        if (!client) {
            return { totalPOs: 0, totalValue: 0, openPOs: 0, shippedPOs: 0, otdPercentage: 0, atRiskPOs: 0, vendorCount: 0 };
        }

        // Method B: shipped = delivery_to_consolidator IS NOT NULL OR actual_sailing_date IS NOT NULL
        // On-time = MIN(delivery_to_consolidator) <= COALESCE(revised_cancel_date, original_cancel_date)
        const result = await db.execute<{
            total_pos: number;
            total_value: number;
            open_pos: number;
            shipped_on_time: number;
            shipped_late: number;
            at_risk_pos: number;
            vendor_count: number;
        }>(sql`
          WITH po_ship_status AS (
            SELECT 
              ph.po_number,
              ph.total_value,
              ph.status,
              ph.revised_cancel_date,
              ph.original_cancel_date,
              ph.vendor,
              BOOL_OR(s.delivery_to_consolidator IS NOT NULL OR s.actual_sailing_date IS NOT NULL) as is_shipped,
              MIN(s.delivery_to_consolidator) as first_delivery
            FROM po_headers ph
            LEFT JOIN shipments s ON s.po_number = ph.po_number
            WHERE ph.client = ${client.name}
              AND COALESCE(ph.total_value, 0) > 0
              AND NOT (ph.po_number LIKE 'SMP%' OR ph.po_number LIKE '8X8%')
            GROUP BY ph.po_number, ph.total_value, ph.status, ph.revised_cancel_date, ph.original_cancel_date, ph.vendor
          )
          SELECT 
            COUNT(DISTINCT po_number)::int as total_pos,
            COALESCE(SUM(total_value), 0)::numeric as total_value,
            COUNT(DISTINCT CASE WHEN status NOT IN ('Closed', 'Shipped', 'Cancelled') THEN po_number END)::int as open_pos,
            COUNT(DISTINCT CASE 
              WHEN is_shipped AND first_delivery <= COALESCE(revised_cancel_date, original_cancel_date) 
              THEN po_number 
            END)::int as shipped_on_time,
            COUNT(DISTINCT CASE 
              WHEN is_shipped AND (first_delivery > COALESCE(revised_cancel_date, original_cancel_date) OR first_delivery IS NULL)
              THEN po_number 
            END)::int as shipped_late,
            COUNT(DISTINCT CASE 
              WHEN status NOT IN ('Closed', 'Shipped', 'Cancelled') 
              AND revised_cancel_date < CURRENT_DATE 
              AND NOT is_shipped
              THEN po_number 
            END)::int as at_risk_pos,
            COUNT(DISTINCT vendor)::int as vendor_count
          FROM po_ship_status
        `);

        const row = result.rows[0] || {
            total_pos: 0, total_value: 0, open_pos: 0,
            shipped_on_time: 0, shipped_late: 0, at_risk_pos: 0, vendor_count: 0
        };

        const shippedTotal = Number(row.shipped_on_time) + Number(row.shipped_late);
        const otdPercentage = shippedTotal > 0
            ? (Number(row.shipped_on_time) / shippedTotal) * 100
            : 0;

        return {
            totalPOs: Number(row.total_pos),
            totalValue: Number(row.total_value),
            openPOs: Number(row.open_pos),
            shippedPOs: shippedTotal,
            otdPercentage,
            atRiskPOs: Number(row.at_risk_pos),
            vendorCount: Number(row.vendor_count),
        };
    }

    async getStaffClientAssignments(clientId: number): Promise<Array<{
        staffId: number;
        staffName: string;
        role: string;
        isPrimary: boolean
    }>> {
        const result = await db.execute<{
            staff_id: number;
            staff_name: string;
            role: string;
            is_primary: boolean;
        }>(sql`
          SELECT 
            sca.staff_id,
            s.name as staff_name,
            COALESCE(sca.role, 'merchandiser') as role,
            sca.is_primary
          FROM staff_client_assignments sca
          JOIN staff s ON sca.staff_id = s.id
          WHERE sca.client_id = ${clientId}
          ORDER BY sca.is_primary DESC, s.name
        `);

        return result.rows.map(row => ({
            staffId: row.staff_id,
            staffName: row.staff_name,
            role: row.role,
            isPrimary: row.is_primary,
        }));
    }

    async getClientsForStaff(staffId: number): Promise<Array<{
        clientId: number;
        clientName: string;
        role: string;
        isPrimary: boolean
    }>> {
        const result = await db.execute<{
            client_id: number;
            client_name: string;
            role: string;
            is_primary: boolean;
        }>(sql`
          SELECT 
            sca.client_id,
            c.name as client_name,
            COALESCE(sca.role, 'merchandiser') as role,
            sca.is_primary
          FROM staff_client_assignments sca
          JOIN clients c ON sca.client_id = c.id
          WHERE sca.staff_id = ${staffId}
          ORDER BY sca.is_primary DESC, c.name
        `);

        return result.rows.map(row => ({
            clientId: row.client_id,
            clientName: row.client_name,
            role: row.role,
            isPrimary: row.is_primary,
        }));
    }

    async assignStaffToClient(staffId: number, clientId: number, role: string, isPrimary: boolean): Promise<void> {
        await db.execute(sql`
          INSERT INTO staff_client_assignments (staff_id, client_id, role, is_primary)
          VALUES (${staffId}, ${clientId}, ${role}, ${isPrimary})
          ON CONFLICT (staff_id, client_id) DO UPDATE SET
            role = EXCLUDED.role,
            is_primary = EXCLUDED.is_primary
        `);
    }

    async removeStaffFromClient(staffId: number, clientId: number): Promise<void> {
        await db.execute(sql`
          DELETE FROM staff_client_assignments 
          WHERE staff_id = ${staffId} AND client_id = ${clientId}
        `);
    }


}
