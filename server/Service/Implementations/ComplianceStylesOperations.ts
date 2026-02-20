import { complianceStyles } from "@shared/schema";
import { db } from "../../db";
import { IComplianceStylesOperations } from "../Abstractions/IComplianceStylesOperations";

export class ComplianceStylesOperations implements IComplianceStylesOperations {

    async bulkInsertComplianceStyles(styles: any[]): Promise<{ inserted: number }> {
        if (styles.length === 0) {
            return { inserted: 0 };
        }

        const result = await db
            .insert(complianceStyles)
            .values(styles as any)
            .returning();

        return { inserted: result.length };
    }

    async clearComplianceStyles(): Promise<void> {
        await db.delete(complianceStyles);
    }
}