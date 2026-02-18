import { } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IComplianceStylesOperations } from "../Abstractions/IComplianceStylesOperations";

export class ComplianceStylesOperations implements IComplianceStylesOperations {


    // Compliance Styles operations (OS630 source data - separate table)
    async bulkInsertComplianceStyles(styleList: any[]): Promise<{ inserted: number }> {
        if (styleList.length === 0) return { inserted: 0 };

        // Clear existing data first (full replace on each import)
        await this.clearComplianceStyles();

        const BATCH_SIZE = 100; // Smaller batches for safety
        let totalInserted = 0;
        const totalBatches = Math.ceil(styleList.length / BATCH_SIZE);

        console.log(`Processing ${styleList.length} compliance styles in ${totalBatches} batches`);

        for (let i = 0; i < styleList.length; i += BATCH_SIZE) {
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const batch = styleList.slice(i, i + BATCH_SIZE);

            try {
                // Use individual inserts for each record in the batch
                for (const s of batch) {
                    await db.execute(sql`
                INSERT INTO compliance_styles (
                  style, po_number, source_status, client_division, client_department, vendor_name,
                  mandatory_status, mandatory_expiry_date, mandatory_report_number,
                  performance_status, performance_expiry_date, performance_report_number,
                  transit_status, transit_expiry_date
                ) VALUES (
                  ${s.style}, ${s.poNumber}, ${s.sourceStatus}, ${s.clientDivision}, ${s.clientDepartment}, ${s.vendorName},
                  ${s.mandatoryStatus}, ${s.mandatoryExpiryDate}, ${s.mandatoryReportNumber},
                  ${s.performanceStatus}, ${s.performanceExpiryDate}, ${s.performanceReportNumber},
                  ${s.transitStatus}, ${s.transitExpiryDate}
                )
              `);
                    totalInserted++;
                }

                if (batchNum % 20 === 0 || batchNum === totalBatches) {
                    console.log(`Compliance styles batch ${batchNum}/${totalBatches} complete`);
                }
            } catch (error: any) {
                console.error(`Compliance styles batch ${batchNum} failed:`, error.message);
                throw error;
            }
        }

        return { inserted: totalInserted };
    }

    async clearComplianceStyles(): Promise<void> {
        console.log("Clearing compliance styles for full data refresh...");
        await db.execute(sql`DELETE FROM compliance_styles`);
    }

}