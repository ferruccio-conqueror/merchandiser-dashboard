import { VendorContact, InsertVendorContact } from "@shared/schema";

export interface IVendorContactService {
    // Vendor Contact operations
    getVendorContacts(vendorId: number): Promise<VendorContact[]>;
    createVendorContact(contact: InsertVendorContact): Promise<VendorContact>;
    bulkCreateVendorContacts(contacts: InsertVendorContact[]): Promise<VendorContact[]>;
}