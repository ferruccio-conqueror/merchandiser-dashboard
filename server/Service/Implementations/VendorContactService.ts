import { VendorContact, InsertVendorContact, vendorContacts } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { IVendorContactService } from "../Abstractions/IVendorContactService";

export class VendorContactService implements IVendorContactService {
    async getVendorContacts(vendorId: number): Promise<VendorContact[]> {
        return db.select().from(vendorContacts)
            .where(eq(vendorContacts.vendorId, vendorId))
            .orderBy(desc(vendorContacts.isPrimary), vendorContacts.name);
    }

    async createVendorContact(contact: InsertVendorContact): Promise<VendorContact> {
        const result = await db.insert(vendorContacts).values(contact as any).returning();
        return result[0];
    }

    async bulkCreateVendorContacts(contacts: InsertVendorContact[]): Promise<VendorContact[]> {
        if (contacts.length === 0) return [];
        const result = await db.insert(vendorContacts).values(contacts as any).returning();
        return result as VendorContact[];
    }
}
