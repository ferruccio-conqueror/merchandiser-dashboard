import { Staff, InsertStaff, Vendor } from "@shared/schema";

export interface IStaffService {
    // Staff operations
    getStaff(): Promise<Staff[]>;
    getStaffById(id: number): Promise<Staff | undefined>;
    getStaffByName(name: string): Promise<Staff | undefined>;
    createStaff(member: InsertStaff): Promise<Staff>;
    updateStaff(id: number, member: Partial<InsertStaff>): Promise<Staff | undefined>;
    bulkCreateStaff(members: InsertStaff[]): Promise<Staff[]>;
    updateVendorStaffAssignment(vendorName: string, merchandiserName: string, merchandisingManagerName: string): Promise<Vendor | undefined>;
    getStaffKPIs(staffId: number): Promise<{
        activePOs: number;
        atRiskPOs: number;
        totalOrderValue: number;
        assignedVendors: number;
        otdPercentage: number;
        ftotdPercentage: number;
        rpotdPercentage: number;
        avgCycleTime: number;
        shippedTotal: number;
        shippedOnTime: number;
        overdueUnshipped: number;
    }>;
}