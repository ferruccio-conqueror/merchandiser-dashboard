import { BrandAssignment } from "@shared/schema";

export interface IBrandAssignmentService {
    // Brand Assignment operations
    getBrandAssignments(): Promise<BrandAssignment[]>;
    getBrandAssignmentByCode(brandCode: string): Promise<BrandAssignment | undefined>;
}