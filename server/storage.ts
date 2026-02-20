import { DbStorage } from "./Service/Implementations/DbStorage";

// ============================================================================
// SHARED AT-RISK CRITERIA CONFIGURATION
// ============================================================================
// IMPORTANT: This is the SINGLE SOURCE OF TRUTH for at-risk logic.
// All at-risk calculations MUST use these constants and helpers.
// 
// At-Risk Criteria (Updated January 2026):
// 1. Failed final inspection
// 2. Inline inspection not booked within 14 days of HOD (Hand-off Date)
// 3. Final inspection not booked within 7 days of HOD
// 4. QA test not passed within 45 days of HOD
// ============================================================================

export const AT_RISK_THRESHOLDS = {
  INLINE_INSPECTION_DAYS: 14,  // Inline inspection must be booked within this many days of HOD
  FINAL_INSPECTION_DAYS: 7,    // Final inspection must be booked within this many days of HOD
  QA_TEST_DAYS: 45,            // QA test must be passed within this many days of HOD
} as const;

// SQL CTE fragments for at-risk inspection/QA lookups
// These are standard CTEs that should be included in any query needing at-risk logic
export const AT_RISK_CTES = {
  // CTE for POs with failed final inspections
  FAILED_INSPECTIONS: `
    SELECT DISTINCT po_number
    FROM inspections
    WHERE inspection_type = 'Final Inspection'
      AND result IN ('Failed', 'Failed - Critical Failure')
  `,

  // CTE for POs with inline inspections booked
  INLINE_INSPECTIONS_BOOKED: `
    SELECT DISTINCT po_number
    FROM inspections
    WHERE inspection_type ILIKE '%inline%'
  `,

  // CTE for POs with final inspections booked
  FINAL_INSPECTIONS_BOOKED: `
    SELECT DISTINCT po_number
    FROM inspections
    WHERE inspection_type ILIKE '%final%'
  `,

  // CTE for SKUs that have passed QA tests
  QA_PASSED: `
    SELECT DISTINCT s.sku
    FROM skus s
    INNER JOIN quality_tests qt ON qt.sku_id = s.id
    WHERE qt.result = 'Pass'
  `,
} as const;

// Helper function to generate the at-risk condition SQL
// Parameters:
// - poAlias: alias for the PO table (e.g., 'up', 'bp', 'ndp')
// - daysUntilHodColumn: column name for days until HOD (e.g., 'days_until_hod')
// - skuColumn: column name for SKU (e.g., 'sku'), or null if SKU-level QA check not needed
// - fiAlias: alias for failed_inspections CTE
// - iibAlias: alias for inline_inspections_booked CTE
// - fibAlias: alias for final_inspections_booked CTE  
// - qapAlias: alias for qa_passed CTE (or null to skip QA check)
export function getAtRiskConditionSql(
  fiAlias: string = 'fi',
  iibAlias: string = 'iib',
  fibAlias: string = 'fib',
  daysUntilHodExpr: string = 'days_until_hod',
  qapAlias?: string,
  skuExpr?: string
): string {
  const conditions = [
    `${fiAlias}.po_number IS NOT NULL`,  // Failed final inspection
    `(${daysUntilHodExpr} <= ${AT_RISK_THRESHOLDS.INLINE_INSPECTION_DAYS} AND ${daysUntilHodExpr} > 0 AND ${iibAlias}.po_number IS NULL)`,  // Inline not booked
    `(${daysUntilHodExpr} <= ${AT_RISK_THRESHOLDS.FINAL_INSPECTION_DAYS} AND ${daysUntilHodExpr} > 0 AND ${fibAlias}.po_number IS NULL)`,   // Final not booked
  ];

  // Add QA condition if aliases provided
  if (qapAlias && skuExpr) {
    conditions.push(`(${daysUntilHodExpr} <= ${AT_RISK_THRESHOLDS.QA_TEST_DAYS} AND ${daysUntilHodExpr} > 0 AND ${qapAlias}.${skuExpr} IS NULL)`);
  }

  return conditions.join(' OR ');
}

// Compliance filter type for quality dashboard filtering
export interface ComplianceFilters {
  vendor?: string;
  merchandiser?: string;
  merchandisingManager?: string;
  startDate?: Date;
  endDate?: Date;
}

// Existing service imports
import { LogService } from "./Service/Implementations/LogService";
import { UserService } from "./Service/Implementations/UserService";
import { StaffService } from "./Service/Implementations/StaffService";
import { VendorService } from "./Service/Implementations/VendorService";
import { VendorContactService } from "./Service/Implementations/VendorContactService";

// New service imports - Sudarshan's services (15 services)
import { ImportHistoryService } from "./Service/Implementations/ImportHistoryService";
import { ColorPanelService } from "./Service/Implementations/ColorPanelService";
import { POHeaderService } from "./Service/Implementations/POHeaderService";
import { ColorPanelHistoryService } from "./Service/Implementations/ColorPanelHistoryService";
import { SKUColorPanelJunctionService } from "./Service/Implementations/SKUColorPanelJunctionService";
import { POTasksService } from "./Service/Implementations/POTasksService";
import { POTimelineService } from "./Service/Implementations/POTimelineService";
import { VendorCapacityService } from "./Service/Implementations/VendorCapacityService";
import { NewCapacityDataService } from "./Service/Implementations/NewCapacityDataService";
import { CategoryTimelineAveragesService } from "./Service/Implementations/CategoryTimelineAveragesService";
import { TimelineOperationsService } from "./Service/Implementations/TimelineOperationsService";
import { VendorTimelineTemplateService } from "./Service/Implementations/VendorTimelineTemplateService";
import { CommunicationsService } from "./Service/Implementations/CommunicationsService";
import { ClientOperationsService } from "./Service/Implementations/ClientOperationsService";
import { ComplianceStylesOperations } from "./Service/Implementations/ComplianceStylesOperations";

// Existing service instances
export const storage = new DbStorage();
export const logService = new LogService();
export const userService = new UserService();
export const staffService = new StaffService();
export const vendorService = new VendorService();
export const vendorContactService = new VendorContactService();

// New service instances - Sudarshan's services (15 services)
export const importHistoryService = new ImportHistoryService();
export const colorPanelService = new ColorPanelService();
export const poHeaderService = new POHeaderService();
export const colorPanelHistoryService = new ColorPanelHistoryService();
export const skuColorPanelJunctionService = new SKUColorPanelJunctionService();
export const poTasksService = new POTasksService();
export const poTimelineService = new POTimelineService();
export const vendorCapacityService = new VendorCapacityService();
export const newCapacityDataService = new NewCapacityDataService();
export const categoryTimelineAveragesService = new CategoryTimelineAveragesService();
export const timelineOperationsService = new TimelineOperationsService();
export const vendorTimelineTemplateService = new VendorTimelineTemplateService();
export const communicationsService = new CommunicationsService();
export const clientOperationsService = new ClientOperationsService();
export const complianceStylesOperations = new ComplianceStylesOperations();