import type { Express, Response } from "express";
import { storage, logService } from "./storage";
import { db } from "./db";
import { sql, eq, and, or, inArray, isNull, desc } from "drizzle-orm";
import { actualAgg, vendorCapacityData, poLineItems, poHeaders, skus, projectionSnapshots, activeProjections } from "@shared/schema";
import { setupAuth, isAuthenticated, requireFullAccess, hasFullAccess, getMerchandiserFilter, getManagerFilter, getMerchandiserFilterFromUser, canViewStaffKPIs } from "./auth";
import {
  insertPurchaseOrderSchema,
  insertPoHeaderSchema,
  insertVendorSchema,
  insertSkuSchema,
  insertTimelineSchema,
  insertShipmentSchema,
  insertInspectionSchema,
  insertQualityTestSchema,
  insertImportHistorySchema,
  insertStaffSchema,
  insertColorPanelSchema,
  insertColorPanelHistorySchema,
  insertVendorContactSchema,
  insertActivityLogSchema,
  insertCommunicationSchema,
} from "@shared/schema";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import Papa from "papaparse";
import multer from "multer";
import * as XLSX from "xlsx";
import OpenAI from "openai";
import { executeSafeQuery, formatQueryResults } from "./ai-sql-executor";
import { AI_SCHEMA_DOCUMENTATION } from "./ai-schema-docs";

// Extend Express Request type to include file and user
declare global {
  namespace Express {
    interface Request {
      file?: Express.Multer.File;
      user?: {
        username?: string;
        email?: string;
        id?: string;
      };
    }
  }
}

// Configure multer for file uploads (in-memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// Pending imports storage for two-phase import with vendor review
// Stores parsed projection data while awaiting user's vendor mapping decisions
interface PendingImportData {
  uploadId: number;
  categoryGroup: string;
  projectionRunDate: Date;
  parsedRows: any[];
  unknownVendors: Map<string, {
    vendorCode: string;
    vendorName: string;
    rowCount: number;
    totalValue: number;
    rows: any[]; // The actual row data for these vendors
  }>;
  knownVendorProjections: Map<number, any[]>; // vendorId -> projections
  fileName: string; // Original filename for import history
  importedBy?: string; // Username who initiated the import
  clientId: number | null; // Client ID for client-specific projections
  stats: any;
  expiresAt: Date;
}
const pendingImports = new Map<string, PendingImportData>();

// Clean up expired pending imports every 10 minutes
setInterval(() => {
  let now = new Date();
  pendingImports.entries().forEach(([key, data]) => {
    if (data.expiresAt < now) {
      pendingImports.delete(key);
    }
  })
}, 10 * 60 * 1000);

// Helper function to find a column value by normalizing whitespace in column names
// This handles Excel columns that may have \r\n, \n, or spaces in their headers
function getColumnValue(row: any, ...possibleNames: string[]): any {
  // First try exact matches
  for (const name of possibleNames) {
    if (row[name] !== undefined) return row[name];
  }

  // If no exact match, try normalized matching
  const rowKeys = Object.keys(row);
  for (const name of possibleNames) {
    const normalizedName = name.replace(/[\r\n\s]+/g, ' ').toLowerCase().trim();
    for (const key of rowKeys) {
      const normalizedKey = key.replace(/[\r\n\s]+/g, ' ').toLowerCase().trim();
      if (normalizedKey === normalizedName) {
        return row[key];
      }
    }
  }

  return undefined;
}

// Helper functions to handle Excel data type issues
function parseExcelInt(value: any): number | null {
  // Explicitly handle null/undefined
  if (value === null || value === undefined) return null;

  // Convert Excel booleans to 0/1 (common in Excel calculations)
  if (typeof value === 'boolean') return value ? 1 : 0;

  // Handle strings - trim and check for empty
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // Handle string booleans from Excel
    if (trimmed.toLowerCase() === 'true') return 1;
    if (trimmed.toLowerCase() === 'false') return 0;
    const num = parseFloat(trimmed);
    if (isNaN(num)) return null;
    return Math.round(num);
  }

  // Handle numbers directly (including 0)
  if (typeof value === 'number') {
    if (isNaN(value)) return null;
    return Math.round(value);
  }

  // Fallback for other types - convert to string and parse
  const str = String(value).trim();
  if (!str) return null;
  const num = parseFloat(str);
  if (isNaN(num)) return null;
  return Math.round(num);
}

function parseExcelFloat(value: any): number | null {
  // Explicitly handle null/undefined
  if (value === null || value === undefined) return null;

  // Convert Excel booleans to 0/1 (common in Excel calculations)
  if (typeof value === 'boolean') return value ? 1 : 0;

  // Handle strings - trim and check for empty
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // Handle string booleans from Excel
    if (trimmed.toLowerCase() === 'true') return 1;
    if (trimmed.toLowerCase() === 'false') return 0;
    // Remove thousand separators (commas) before parsing - handles "2,007.75" format
    const cleaned = trimmed.replace(/,/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    return num;
  }

  // Handle numbers directly (including 0)
  if (typeof value === 'number') {
    if (isNaN(value)) return null;
    return value;
  }

  // Fallback for other types - convert to string and parse
  const str = String(value).trim().replace(/,/g, '');
  if (!str) return null;
  const num = parseFloat(str);
  if (isNaN(num)) return null;
  return num;
}

function parseExcelDate(value: any): Date | null {
  if (!value || value === '') return null;

  // Handle Excel serial date numbers (days since 1900-01-01)
  if (typeof value === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    const daysOffset = value - 2; // Excel incorrectly treats 1900 as leap year
    const date = new Date(excelEpoch.getTime() + daysOffset * 86400000);
    return isNaN(date.getTime()) ? null : date;
  }

  // Handle string dates
  const str = String(value).trim();
  if (!str) return null;

  // Check if this is a PURE numeric string (only digits, possibly with decimal point)
  // Don't treat strings with dashes/slashes as Excel serial numbers - those are date formats!
  if (/^\d+(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    if (!isNaN(num) && num > 1 && num < 100000) {
      // This looks like an Excel serial date (reasonable range: 1900-2173)
      const excelEpoch = new Date(1900, 0, 1);
      const daysOffset = num - 2;
      const date = new Date(excelEpoch.getTime() + daysOffset * 86400000);
      if (!isNaN(date.getTime())) return date;
    }
  }

  // Try parsing as a date string (handles ISO dates, MM/DD/YYYY, etc.)
  try {
    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

// Helper functions to map database snake_case to frontend camelCase
function mapColorPanel(panel: any) {
  if (!panel) return panel;
  return {
    id: panel.id,
    vendorId: panel.vendor_id,
    merchandiserId: panel.merchandiser_id,
    brand: panel.brand,
    vendorName: panel.vendor_name,
    collection: panel.collection,
    skuDescription: panel.sku_description,
    material: panel.material,
    finishName: panel.finish_name,
    sheenLevel: panel.sheen_level,
    finishSystem: panel.finish_system,
    paintSupplier: panel.paint_supplier,
    validityMonths: panel.validity_months,
    currentMcpNumber: panel.current_mcp_number,
    currentApprovalDate: panel.current_approval_date,
    currentExpirationDate: panel.current_expiration_date,
    status: panel.status,
    notes: panel.notes,
    lastReminderSent: panel.last_reminder_sent,
    reminderCount: panel.reminder_count,
    skuCount: panel.skuCount || panel.sku_count || 0,
    createdAt: panel.created_at,
    updatedAt: panel.updated_at,
  };
}

function mapColorPanelHistory(history: any) {
  if (!history) return history;
  return {
    id: history.id,
    colorPanelId: history.colorPanelId ?? history.color_panel_id,
    mcpNumber: history.mcpNumber ?? history.mcp_number,
    approvalDate: history.approvalDate ?? history.approval_date,
    expirationDate: history.expirationDate ?? history.expiration_date,
    versionNumber: history.versionNumber ?? history.version_number,
    notes: history.notes,
    createdAt: history.createdAt ?? history.created_at,
  };
}

function mapVendorContact(contact: any) {
  if (!contact) return contact;
  return {
    id: contact.id,
    vendorId: contact.vendor_id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    role: contact.role,
    isPrimary: contact.is_primary,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
  };
}

function mapBrandAssignment(assignment: any) {
  if (!assignment) return assignment;
  return {
    id: assignment.id,
    brandCode: assignment.brand_code,
    brandName: assignment.brand_name,
    merchandiserId: assignment.merchandiser_id,
    merchandiserName: assignment.merchandiser_name,
    merchandisingManagerId: assignment.merchandising_manager_id,
    merchandisingManagerName: assignment.merchandising_manager_name,
    createdAt: assignment.created_at,
    updatedAt: assignment.updated_at,
  };
}

function mapSku(sku: any) {
  if (!sku) return sku;
  return {
    id: sku.id,
    sku: sku.sku,
    style: sku.style,
    description: sku.description,
    category: sku.category,
    productGroup: sku.product_group,
    season: sku.season,
    isNew: sku.is_new,
    unitPrice: sku.unit_price,
    createdAt: sku.created_at,
    updatedAt: sku.updated_at,
  };
}

// Helper function to build AI summary prompts
function buildAiSummaryPrompt(context: any): string {
  const parts: string[] = [];

  parts.push(`Entity Type: ${context.entityType}`);
  parts.push(`Entity ID: ${context.entityId}`);
  parts.push(`Summary Type: ${context.summaryType}`);

  if (context.po) {
    parts.push(`\n## Purchase Order Details`);
    parts.push(`PO Number: ${context.po.poNumber}`);
    parts.push(`Vendor: ${context.po.vendor}`);
    parts.push(`Status: ${context.po.status}`);
    parts.push(`Shipment Status: ${context.po.shipmentStatus || 'N/A'}`);
    parts.push(`Revised Ship Date: ${context.po.revisedShipDate || 'N/A'}`);
    parts.push(`Revised Cancel Date: ${context.po.revisedCancelDate || 'N/A'}`);
    parts.push(`Total Value: $${(context.po.totalValue || 0) / 100}`);
  }

  if (context.shipment) {
    parts.push(`\n## Shipment Details`);
    parts.push(`Shipment Number: ${context.shipment.shipmentNumber}`);
    parts.push(`PO Number: ${context.shipment.poNumber}`);
    parts.push(`Cargo Ready Date: ${context.shipment.cargoReadyDate || 'N/A'}`);
    parts.push(`ETA: ${context.shipment.eta || 'N/A'}`);
    parts.push(`HOD Status: ${context.shipment.hodStatus || 'N/A'}`);
    parts.push(`Logistic Status: ${context.shipment.logisticStatus || 'N/A'}`);
    parts.push(`PTS Status: ${context.shipment.ptsStatus || 'N/A'}`);
  }

  if (context.mcp) {
    parts.push(`\n## Master Color Panel Details`);
    parts.push(`Finish Name: ${context.mcp.finishName}`);
    parts.push(`Vendor: ${context.mcp.vendorName}`);
    parts.push(`Status: ${context.mcp.status}`);
    parts.push(`Current MCP Number: ${context.mcp.currentMcpNumber || 'N/A'}`);
    parts.push(`Expiration Date: ${context.mcp.currentExpirationDate || 'N/A'}`);
  }

  if (context.sku) {
    parts.push(`\n## SKU Details`);
    parts.push(`SKU: ${context.sku.sku}`);
    parts.push(`Style: ${context.sku.style || 'N/A'}`);
    parts.push(`Description: ${context.sku.description || 'N/A'}`);
  }

  if (context.communications && context.communications.length > 0) {
    parts.push(`\n## Communications History (${context.communications.length} items)`);
    context.communications.slice(0, 50).forEach((comm: any, idx: number) => {
      parts.push(`\n### Communication ${idx + 1}`);
      parts.push(`Type: ${comm.communicationType}`);
      parts.push(`Date: ${comm.communicationDate}`);
      parts.push(`Subject: ${comm.subject || 'N/A'}`);
      parts.push(`Sender: ${comm.sender || 'N/A'}`);
      parts.push(`Content: ${(comm.content || '').substring(0, 500)}${comm.content?.length > 500 ? '...' : ''}`);
    });
  } else {
    parts.push(`\n## Communications: No communications found for this entity.`);
  }

  if (context.activityLogs && context.activityLogs.length > 0) {
    parts.push(`\n## Activity Log (${context.activityLogs.length} items)`);
    context.activityLogs.slice(0, 20).forEach((log: any, idx: number) => {
      parts.push(`- [${log.createdAt}] ${log.activityType}: ${log.content}`);
    });
  }

  if (context.shipments && context.shipments.length > 0) {
    parts.push(`\n## Related Shipments (${context.shipments.length} total)`);
    context.shipments.forEach((ship: any, idx: number) => {
      parts.push(`- Shipment ${ship.shipmentNumber}: CRD=${ship.cargoReadyDate || 'N/A'}, ETA=${ship.eta || 'N/A'}, Status=${ship.hodStatus || 'N/A'}`);
    });
  }

  return parts.join('\n');
}

// Helper function to run SKU-level projection-to-PO matching on active_projections table
// This is a simpler approach - active_projections has ONE record per vendor/SKU/year/month
// Matches projections to actual POs based on vendor, month, and SKU
async function runProjectionMatching(targetYear?: number, vendorId?: number): Promise<{
  success: boolean;
  matched: number;
  partialMatches: number;
  unmatched: number;
  totalProjections: number;
  poSkuCombinations: number;
  message: string;
}> {
  const year = targetYear || new Date().getFullYear();

  console.log(`Running projection matching on active_projections for year ${year}...`);

  // Get PO line items aggregated by vendor_id + month + SKU
  const poLineData = await db.execute(sql`
    SELECT 
      ph.vendor_id,
      DATE_PART('month', ph.original_ship_date)::int as month,
      pli.sku,
      SUM(pli.order_quantity) as total_quantity,
      SUM(pli.line_total) as total_value,
      ARRAY_AGG(DISTINCT ph.po_number) as po_numbers
    FROM po_line_items pli
    JOIN po_headers ph ON pli.po_header_id = ph.id
    WHERE DATE_PART('year', ph.original_ship_date) = ${year}
      AND pli.sku IS NOT NULL AND pli.sku != ''
      ${vendorId ? sql`AND ph.vendor_id = ${vendorId}` : sql``}
    GROUP BY ph.vendor_id, DATE_PART('month', ph.original_ship_date), pli.sku
  `);

  const poLines = poLineData.rows as any[];
  console.log(`Found ${poLines.length} unique vendor+month+SKU combinations in POs`);

  if (poLines.length === 0) {
    return {
      success: true,
      message: "No PO line items found for matching",
      matched: 0,
      unmatched: 0,
      partialMatches: 0,
      totalProjections: 0,
      poSkuCombinations: 0
    };
  }

  // Build PO lookup map by vendorId_month_sku -> {quantity, value, poNumbers}
  const posBySku = new Map<string, { totalQty: number; totalValue: number; poNumbers: string[] }>();
  for (const po of poLines) {
    const key = `${po.vendor_id}_${po.month}_${po.sku}`;
    posBySku.set(key, {
      totalQty: Number(po.total_quantity) || 0,
      totalValue: Number(po.total_value) || 0,
      poNumbers: po.po_numbers || []
    });
  }

  // Get unmatched active projections for the year
  const unmatchedProjections = await db.select()
    .from(activeProjections)
    .where(and(
      or(
        isNull(activeProjections.matchStatus),
        eq(activeProjections.matchStatus, 'unmatched')
      ),
      eq(activeProjections.year, year),
      vendorId ? eq(activeProjections.vendorId, vendorId) : sql`TRUE`
    ));

  console.log(`Found ${unmatchedProjections.length} unmatched active projections for year ${year}`);

  if (unmatchedProjections.length === 0) {
    return {
      success: true,
      message: "No unmatched projections found",
      matched: 0,
      unmatched: 0,
      partialMatches: 0,
      totalProjections: 0,
      poSkuCombinations: poLines.length
    };
  }

  let matchedCount = 0;
  let partialMatchCount = 0;
  let unmatchedCount = 0;

  // Match each projection to PO data
  for (const proj of unmatchedProjections) {
    const key = `${proj.vendorId}_${proj.month}_${proj.sku}`;
    const poData = posBySku.get(key);

    const projQty = Number(proj.quantity) || 0;
    const projValue = Number(proj.projectionValue) || 0;

    if (!poData || poData.totalQty === 0) {
      // No PO for this SKU - leave as unmatched
      unmatchedCount++;
      continue;
    }

    const actualQty = poData.totalQty;
    const actualValue = poData.totalValue;
    const variancePct = projValue > 0
      ? Math.round(((actualValue - projValue) / projValue) * 100)
      : 0;

    if (actualQty >= projQty) {
      // Fully matched - PO covers the entire projection
      await db.update(activeProjections)
        .set({
          matchStatus: 'matched',
          matchedPoNumber: poData.poNumbers.slice(0, 3).join(', ') + (poData.poNumbers.length > 3 ? '...' : ''),
          matchedAt: new Date(),
          actualQuantity: actualQty,
          actualValue: actualValue,
          quantityVariance: actualQty - projQty,
          valueVariance: actualValue - projValue,
          variancePct: variancePct,
          updatedAt: new Date()
        })
        .where(eq(activeProjections.id, proj.id));
      matchedCount++;
    } else {
      // Partial match - PO has less quantity than projected
      await db.update(activeProjections)
        .set({
          matchStatus: 'partial',
          matchedPoNumber: poData.poNumbers.slice(0, 3).join(', ') + (poData.poNumbers.length > 3 ? '...' : ''),
          matchedAt: new Date(),
          actualQuantity: actualQty,
          actualValue: actualValue,
          quantityVariance: actualQty - projQty, // Negative shows under-ordered
          valueVariance: actualValue - projValue,
          variancePct: variancePct,
          updatedAt: new Date()
        })
        .where(eq(activeProjections.id, proj.id));
      partialMatchCount++;
    }
  }

  console.log(`Matching complete: ${matchedCount} matched, ${partialMatchCount} partial, ${unmatchedCount} unmatched`);

  return {
    success: true,
    message: `Matched ${matchedCount} projections fully, ${partialMatchCount} partially. ${unmatchedCount} remain unmatched.`,
    matched: matchedCount,
    partialMatches: partialMatchCount,
    unmatched: unmatchedCount,
    totalProjections: unmatchedProjections.length,
    poSkuCombinations: poLines.length
  };
}

export async function registerRoutes(app: Express) {
  // Setup authentication routes and middleware
  await setupAuth(app);

  // Dashboard Filter Options
  app.get("/api/dashboard/filter-options", async (req: Express.Request, res: Response) => {
    try {
      const options = await storage.getDashboardFilterOptions();
      res.json(options);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Dashboard KPIs
  app.get("/api/dashboard/kpis", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = String(req.query.merchandiser);
        if (req.query.merchandisingManager) filters.merchandisingManager = String(req.query.merchandisingManager);
      }
      if (req.query.vendor) filters.vendor = String(req.query.vendor);
      if (req.query.client) filters.client = String(req.query.client);
      if (req.query.brand) filters.brand = String(req.query.brand);
      if (req.query.startDate) filters.startDate = new Date(String(req.query.startDate));
      if (req.query.endDate) filters.endDate = new Date(String(req.query.endDate));

      const kpis = await storage.getDashboardKPIs(filters);
      res.json(kpis);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Header KPIs with YoY comparison (Total SKUs, YTD Sales, YTD Orders)
  app.get("/api/dashboard/header-kpis", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = String(req.query.merchandiser);
        if (req.query.merchandisingManager) filters.merchandisingManager = String(req.query.merchandisingManager);
      }
      if (req.query.vendor) filters.vendor = String(req.query.vendor);
      if (req.query.client) filters.client = String(req.query.client);
      if (req.query.brand) filters.brand = String(req.query.brand);
      if (req.query.startDate) filters.startDate = new Date(String(req.query.startDate));
      if (req.query.endDate) filters.endDate = new Date(String(req.query.endDate));

      const headerKpis = await storage.getHeaderKPIs(filters);
      res.json(headerKpis);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // KPI Monthly Trends for sparklines
  app.get("/api/dashboard/kpi-trends", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = String(req.query.merchandiser);
        if (req.query.merchandisingManager) filters.merchandisingManager = String(req.query.merchandisingManager);
      }
      if (req.query.vendor) filters.vendor = String(req.query.vendor);
      if (req.query.client) filters.client = String(req.query.client);
      if (req.query.brand) filters.brand = String(req.query.brand);
      if (req.query.startDate) filters.startDate = new Date(String(req.query.startDate));
      if (req.query.endDate) filters.endDate = new Date(String(req.query.endDate));

      const trends = await storage.getKpiMonthlyTrends(filters);
      res.json(trends);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vendor Performance
  app.get("/api/dashboard/vendor-performance", async (req: Express.Request, res: Response) => {
    try {
      const performance = await storage.getVendorPerformance();
      res.json(performance);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Year-over-Year Late Shipments
  app.get("/api/dashboard/late-shipments-yoy", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = String(req.query.merchandiser);
        if (req.query.merchandisingManager) filters.merchandisingManager = String(req.query.merchandisingManager);
      }
      if (req.query.vendor) filters.vendor = String(req.query.vendor);
      if (req.query.client) filters.client = String(req.query.client);
      if (req.query.brand) filters.brand = String(req.query.brand);
      if (req.query.startDate) filters.startDate = new Date(String(req.query.startDate));
      if (req.query.endDate) filters.endDate = new Date(String(req.query.endDate));

      const data = await storage.getYearOverYearLateShipments(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Revision Reasons for dropdown filter
  app.get("/api/dashboard/revision-reasons", async (req: Express.Request, res: Response) => {
    try {
      const reasons = await storage.getRevisionReasons();
      res.json(reasons);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Original OTD Year-over-Year with reason filtering
  app.get("/api/dashboard/original-otd-yoy", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
        reasons?: string[];
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = String(req.query.merchandiser);
        if (req.query.merchandisingManager) filters.merchandisingManager = String(req.query.merchandisingManager);
      }
      if (req.query.vendor) filters.vendor = String(req.query.vendor);
      if (req.query.client) filters.client = String(req.query.client);
      if (req.query.brand) filters.brand = String(req.query.brand);
      if (req.query.startDate) filters.startDate = new Date(String(req.query.startDate));
      if (req.query.endDate) filters.endDate = new Date(String(req.query.endDate));
      // Parse reasons as JSON array from query string
      if (req.query.reasons) {
        try {
          filters.reasons = JSON.parse(String(req.query.reasons));
        } catch {
          // If not valid JSON, treat as comma-separated
          filters.reasons = String(req.query.reasons).split(',').map(r => r.trim());
        }
      }

      const data = await storage.getOriginalOtdYoY(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vendor Late and At-Risk Shipments
  app.get("/api/dashboard/vendor-late-at-risk", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = String(req.query.merchandiser);
        if (req.query.merchandisingManager) filters.merchandisingManager = String(req.query.merchandisingManager);
      }
      if (req.query.vendor) filters.vendor = String(req.query.vendor);
      if (req.query.client) filters.client = String(req.query.client);
      if (req.query.brand) filters.brand = String(req.query.brand);
      if (req.query.startDate) filters.startDate = new Date(String(req.query.startDate));
      if (req.query.endDate) filters.endDate = new Date(String(req.query.endDate));

      const data = await storage.getVendorLateAndAtRisk(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // OTD Breakdown by Vendor - shows each vendor's OTD performance by month with filter support
  app.get("/api/dashboard/otd-by-vendor", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        year?: number;
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      if (req.query.year) filters.year = parseInt(String(req.query.year));
      if (req.query.merchandiser) filters.merchandiser = String(req.query.merchandiser);
      if (req.query.merchandisingManager) filters.merchandisingManager = String(req.query.merchandisingManager);
      if (req.query.vendor) filters.vendor = String(req.query.vendor);
      if (req.query.client) filters.client = String(req.query.client);
      if (req.query.startDate) filters.startDate = new Date(String(req.query.startDate));
      if (req.query.endDate) filters.endDate = new Date(String(req.query.endDate));

      const data = await storage.getOtdByVendor(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Late Shipments by Reason Code
  app.get("/api/dashboard/late-shipments-by-reason", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = String(req.query.merchandiser);
        if (req.query.merchandisingManager) filters.merchandisingManager = String(req.query.merchandisingManager);
      }
      if (req.query.vendor) filters.vendor = String(req.query.vendor);
      if (req.query.client) filters.client = String(req.query.client);
      if (req.query.brand) filters.brand = String(req.query.brand);
      if (req.query.startDate) filters.startDate = new Date(String(req.query.startDate));
      if (req.query.endDate) filters.endDate = new Date(String(req.query.endDate));

      const data = await storage.getLateShipmentsByReason(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Late Shipments by Status
  app.get("/api/dashboard/late-shipments-by-status", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = String(req.query.merchandiser);
        if (req.query.merchandisingManager) filters.merchandisingManager = String(req.query.merchandisingManager);
      }
      if (req.query.vendor) filters.vendor = String(req.query.vendor);
      if (req.query.client) filters.client = String(req.query.client);
      if (req.query.brand) filters.brand = String(req.query.brand);
      if (req.query.startDate) filters.startDate = new Date(String(req.query.startDate));
      if (req.query.endDate) filters.endDate = new Date(String(req.query.endDate));

      const data = await storage.getLateShipmentsByStatus(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Late and At-Risk POs for Dashboard
  app.get("/api/dashboard/late-at-risk-pos", async (req: Express.Request, res: Response) => {
    try {
      // Parse filter parameters
      const filters: {
        merchandiser?: string;
        merchandisingManager?: string;
        vendor?: string;
        client?: string;
        brand?: string;
        startDate?: Date;
        endDate?: Date;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = req.query.merchandiser as string;
        if (req.query.merchandisingManager) filters.merchandisingManager = req.query.merchandisingManager as string;
      }
      if (req.query.vendor) filters.vendor = req.query.vendor as string;
      if (req.query.client) filters.client = req.query.client as string;
      if (req.query.brand) filters.brand = req.query.brand as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

      const data = await storage.getLateAndAtRiskPOs(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Monthly Orders YoY Comparison
  // Groups ALL POs by revised cancel date month, compares current year to last year
  // Shows total value AND shipped value per month for historical YoY shipment comparison
  // Use case: Compare this year's monthly shipments to last year's to track performance
  app.get("/api/dashboard/orders-on-hand-yoy", async (req: Express.Request, res: Response) => {
    try {
      const currentYear = new Date().getFullYear();
      const lastYear = currentYear - 1;

      // Merchandiser and Manager filters require vendor join
      const needsVendorJoin = !!(req.query.merchandiser || req.query.merchandisingManager);
      const vendorJoin = needsVendorJoin ? sql`LEFT JOIN vendors v ON v.name = ph.vendor` : sql``;

      // Parse optional filters - include all page filters
      const vendorFilter = req.query.vendor ? sql`AND LOWER(ph.vendor) LIKE ${('%' + String(req.query.vendor).toLowerCase() + '%')}` : sql``;
      // Brand is derived from client_division/client fields using CASE logic (CB, CB2, C&K)
      const brandFilter = req.query.brand ? sql`AND (
        CASE 
          WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
          WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
          ELSE 'CB'
        END
      ) = ${String(req.query.brand)}` : sql``;
      const clientFilter = req.query.client ? sql`AND ph.client = (SELECT c.name FROM clients c WHERE c.code = ${String(req.query.client)})` : sql``;
      const merchandiserFilter = req.query.merchandiser ? sql`AND v.merchandiser = ${String(req.query.merchandiser)}` : sql``;
      const mmFilter = req.query.merchandisingManager ? sql`AND v.merchandising_manager = ${String(req.query.merchandisingManager)}` : sql``;

      // Monthly shipped values - MUST match YTD Shipped KPI calculation exactly:
      // CURRENT YEAR: If has actual_sailing_date -> use shipped_value; If only ETD -> use total_value (planned)
      // LAST YEAR: Use shipped_value by actual_sailing_date only (historical record)
      // Pending values grouped by cancel_date
      const result = await db.execute(sql`
        WITH current_year_actual_shipped AS (
          -- Current year: Shipments with actual_sailing_date use shipped_value
          SELECT 
            EXTRACT(MONTH FROM s.actual_sailing_date)::int as month,
            SUM(COALESCE(s.shipped_value, 0)) as shipped_value
          FROM shipments s
          JOIN po_headers ph ON ph.po_number = s.po_number
          ${vendorJoin}
          WHERE EXTRACT(YEAR FROM s.actual_sailing_date) = ${currentYear}
            AND COALESCE(s.shipped_value, 0) > 0
            ${vendorFilter}
            ${brandFilter}
            ${clientFilter}
            ${merchandiserFilter}
            ${mmFilter}
          GROUP BY EXTRACT(MONTH FROM s.actual_sailing_date)
        ),
        current_year_etd_only AS (
          -- Current year: POs with ETD but no actual_sailing_date use total_value (planned amount)
          SELECT 
            EXTRACT(MONTH FROM s.estimated_vessel_etd)::int as month,
            SUM(COALESCE(ph.total_value, 0)) as shipped_value
          FROM shipments s
          JOIN po_headers ph ON ph.po_number = s.po_number
          ${vendorJoin}
          WHERE EXTRACT(YEAR FROM s.estimated_vessel_etd) = ${currentYear}
            AND s.actual_sailing_date IS NULL
            AND COALESCE(ph.total_value, 0) > 0
            ${vendorFilter}
            ${brandFilter}
            ${clientFilter}
            ${merchandiserFilter}
            ${mmFilter}
          GROUP BY EXTRACT(MONTH FROM s.estimated_vessel_etd)
        ),
        current_year_shipped AS (
          -- Combine actual shipped + ETD planned for current year
          SELECT month, SUM(shipped_value) as shipped_value
          FROM (
            SELECT month, shipped_value FROM current_year_actual_shipped
            UNION ALL
            SELECT month, shipped_value FROM current_year_etd_only
          ) combined
          GROUP BY month
        ),
        last_year_shipped AS (
          -- Last year: Use shipped_value by actual_sailing_date only (historical)
          SELECT 
            EXTRACT(MONTH FROM s.actual_sailing_date)::int as month,
            SUM(COALESCE(s.shipped_value, 0)) as shipped_value
          FROM shipments s
          JOIN po_headers ph ON ph.po_number = s.po_number
          ${vendorJoin}
          WHERE EXTRACT(YEAR FROM s.actual_sailing_date) = ${lastYear}
            AND COALESCE(s.shipped_value, 0) > 0
            ${vendorFilter}
            ${brandFilter}
            ${clientFilter}
            ${merchandiserFilter}
            ${mmFilter}
          GROUP BY EXTRACT(MONTH FROM s.actual_sailing_date)
        ),
        pending_by_cancel_date AS (
          -- Pending values grouped by cancel_date (when orders are due)
          SELECT 
            EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as year,
            EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as month,
            COUNT(DISTINCT ph.po_number) as order_count,
            SUM(COALESCE(ph.total_value, 0)) as total_value,
            SUM(GREATEST(0, COALESCE(ph.total_value, 0) - COALESCE(ph.shipped_value, 0))) as pending_value
          FROM po_headers ph
          ${vendorJoin}
          WHERE (ph.revised_cancel_date IS NOT NULL OR ph.original_cancel_date IS NOT NULL)
            AND COALESCE(ph.total_value, 0) > 0
            AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) IN (${currentYear}, ${lastYear})
            ${vendorFilter}
            ${brandFilter}
            ${clientFilter}
            ${merchandiserFilter}
            ${mmFilter}
          GROUP BY 
            EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)),
            EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))
        ),
        all_months AS (
          SELECT generate_series(1, 12) as month
        )
        SELECT 
          am.month::int,
          COALESCE(MAX(CASE WHEN p.year = ${currentYear} THEN p.order_count END), 0) as current_year_orders,
          COALESCE(MAX(CASE WHEN p.year = ${currentYear} THEN p.total_value END), 0) as current_year_value,
          COALESCE(MAX(cys.shipped_value), 0) as current_year_shipped,
          COALESCE(MAX(CASE WHEN p.year = ${currentYear} THEN p.pending_value END), 0) as current_year_unshipped,
          COALESCE(MAX(CASE WHEN p.year = ${lastYear} THEN p.order_count END), 0) as last_year_orders,
          COALESCE(MAX(CASE WHEN p.year = ${lastYear} THEN p.total_value END), 0) as last_year_value,
          COALESCE(MAX(lys.shipped_value), 0) as last_year_shipped,
          COALESCE(MAX(CASE WHEN p.year = ${lastYear} THEN p.pending_value END), 0) as last_year_unshipped
        FROM all_months am
        LEFT JOIN current_year_shipped cys ON cys.month = am.month
        LEFT JOIN last_year_shipped lys ON lys.month = am.month
        LEFT JOIN pending_by_cancel_date p ON p.month = am.month
        GROUP BY am.month
        ORDER BY am.month
      `);

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      // Fetch projections from active_projections for current year
      // These represent future business forecasts not yet converted to orders
      // Filter by client (via clients table join) and brand
      const clientProjFilter = req.query.client
        ? sql`AND ap.client_id = (SELECT c.id FROM clients c WHERE c.code = ${String(req.query.client)})`
        : sql``;
      const brandProjFilter = req.query.brand
        ? sql`AND LOWER(ap.brand) = ${String(req.query.brand).toLowerCase()}`
        : sql``;
      const vendorProjFilter = req.query.vendor
        ? sql`AND LOWER(ap.vendor_code) LIKE ${('%' + String(req.query.vendor).toLowerCase() + '%')}`
        : sql``;

      const projectionsResult = await db.execute(sql`
        SELECT 
          ap.month,
          SUM(COALESCE(ap.projection_value, 0)) as projection_value
        FROM active_projections ap
        WHERE ap.year = ${currentYear}
          AND ap.match_status NOT IN ('matched', 'partial')
          ${clientProjFilter}
          ${brandProjFilter}
          ${vendorProjFilter}
        GROUP BY ap.month
        ORDER BY ap.month
      `);

      // Create projection lookup map (month -> value in cents)
      const projectionsByMonth: Record<number, number> = {};
      for (const row of projectionsResult.rows as any[]) {
        projectionsByMonth[Number(row.month)] = Number(row.projection_value || 0);
      }

      // Build complete 12-month response
      const data = [];
      for (let m = 1; m <= 12; m++) {
        const row = result.rows.find((r: any) => r.month === m) || {};
        const projectionValue = projectionsByMonth[m] || 0;
        data.push({
          month: m,
          monthName: monthNames[m - 1],
          currentYear: {
            year: currentYear,
            orders: Number(row.current_year_orders || 0),
            totalValue: Number(row.current_year_value || 0) / 100,
            shippedValue: Number(row.current_year_shipped || 0) / 100,
            unshippedValue: Number(row.current_year_unshipped || 0) / 100,
            projectionValue: projectionValue / 100, // Convert cents to dollars
          },
          lastYear: {
            year: lastYear,
            orders: Number(row.last_year_orders || 0),
            totalValue: Number(row.last_year_value || 0) / 100,
            shippedValue: Number(row.last_year_shipped || 0) / 100,
            unshippedValue: Number(row.last_year_unshipped || 0) / 100,
          },
          yoyChange: {
            ordersChange: Number(row.current_year_orders || 0) - Number(row.last_year_orders || 0),
            valueChange: (Number(row.current_year_value || 0) - Number(row.last_year_value || 0)) / 100,
            valuePctChange: Number(row.last_year_value || 0) > 0
              ? ((Number(row.current_year_value || 0) - Number(row.last_year_value || 0)) / Number(row.last_year_value || 0) * 100)
              : null,
          }
        });
      }

      res.json({
        currentYear,
        lastYear,
        data,
      });
    } catch (error: any) {
      console.error("Error fetching orders on hand YoY:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ========== QUALITY DASHBOARD ENDPOINTS ==========

  // Quality KPIs
  app.get("/api/quality/kpis", async (req: Express.Request, res: Response) => {
    try {
      const filters: { inspector?: string } = {};
      if (req.query.inspector) filters.inspector = req.query.inspector as string;

      const kpis = await storage.getQualityKpis(filters);
      res.json(kpis);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // At-Risk Purchase Orders
  app.get("/api/quality/at-risk-pos", async (req: Express.Request, res: Response) => {
    try {
      const filters: { inspector?: string } = {};
      if (req.query.inspector) filters.inspector = req.query.inspector as string;

      const atRiskPOs = await storage.getAtRiskPurchaseOrders(filters);
      res.json(atRiskPOs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Quality Test Report - Pivot table style aggregation
  app.get("/api/quality/test-report", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        clientDivision?: string;
        clientDepartment?: string;
        merchandiser?: string;
        merchandisingManager?: string;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = req.query.merchandiser as string;
        if (req.query.merchandisingManager) filters.merchandisingManager = req.query.merchandisingManager as string;
      }

      if (req.query.clientDivision) filters.clientDivision = req.query.clientDivision as string;
      if (req.query.clientDepartment) filters.clientDepartment = req.query.clientDepartment as string;

      const report = await storage.getQualityTestReport(filters);
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Inspection Status Report - Final/Inline lateness based on ship dates
  app.get("/api/quality/inspection-status", async (req: Express.Request, res: Response) => {
    try {
      const filters: {
        vendor?: string;
        merchandiser?: string;
        merchandisingManager?: string;
      } = {};

      // Apply role-based filters for limited access users
      const merchandiserFilter = getMerchandiserFilter(req);
      const managerFilter = getManagerFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      } else if (managerFilter) {
        filters.merchandisingManager = managerFilter;
      } else {
        if (req.query.merchandiser) filters.merchandiser = req.query.merchandiser as string;
        if (req.query.merchandisingManager) filters.merchandisingManager = req.query.merchandisingManager as string;
      }

      if (req.query.vendor) filters.vendor = req.query.vendor as string;

      const report = await storage.getInspectionStatusReport(filters);
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== QUALITY & COMPLIANCE ALERT SYSTEM ENDPOINTS ==========

  // Define compliance filter interface
  interface ComplianceFilters {
    vendor?: string;
    merchandiser?: string;
    merchandisingManager?: string;
    startDate?: Date;
    endDate?: Date;
  }

  // Helper to parse compliance filters from request
  const parseComplianceFilters = (req: Express.Request): ComplianceFilters => {
    const filters: ComplianceFilters = {};
    if (req.query.vendor) filters.vendor = req.query.vendor as string;
    if (req.query.merchandiser) filters.merchandiser = req.query.merchandiser as string;
    if (req.query.merchandisingManager) filters.merchandisingManager = req.query.merchandisingManager as string;
    if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
    if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
    return filters;
  };

  // Alert counts for dashboard summary bar
  app.get("/api/quality-compliance/alert-counts", async (req: Express.Request, res: Response) => {
    try {
      const filters = parseComplianceFilters(req);
      const counts = await storage.getQualityComplianceAlertCounts(filters);
      res.json(counts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POs with Booking Confirmed needing inspection booked
  app.get("/api/quality-compliance/booking-confirmed-needing-inspection", async (req: Express.Request, res: Response) => {
    try {
      const filters = parseComplianceFilters(req);
      const data = await storage.getBookingConfirmedNeedingInspection(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POs within 7-day HOD/CRD window missing inline inspection
  app.get("/api/quality-compliance/missing-inline-inspections", async (req: Express.Request, res: Response) => {
    try {
      const filters = parseComplianceFilters(req);
      const data = await storage.getMissingInlineInspections(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POs within 7-day HOD window missing final inspection (have inline but no final)
  app.get("/api/quality-compliance/missing-final-inspections", async (req: Express.Request, res: Response) => {
    try {
      const filters = parseComplianceFilters(req);
      const data = await storage.getMissingFinalInspections(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Failed inspections with failure reasons
  app.get("/api/quality-compliance/failed-inspections", async (req: Express.Request, res: Response) => {
    try {
      const filters = parseComplianceFilters(req);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const data = await storage.getFailedInspections(filters, limit);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Certificates expiring within 90 days
  app.get("/api/quality-compliance/expiring-certificates", async (req: Express.Request, res: Response) => {
    try {
      const filters = parseComplianceFilters(req);
      const data = await storage.getExpiringCertificates90Days(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Inspection performance by vendor
  app.get("/api/quality-compliance/performance/vendor", async (req: Express.Request, res: Response) => {
    try {
      const data = await storage.getInspectionPerformanceByVendor();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Inspection performance by SKU
  app.get("/api/quality-compliance/performance/sku", async (req: Express.Request, res: Response) => {
    try {
      const data = await storage.getInspectionPerformanceBySku();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== INSPECTION ANALYTICS ENDPOINTS ==========

  // Get list of inspectors for filter dropdown
  app.get("/api/inspections/inspectors", async (req: Express.Request, res: Response) => {
    try {
      const inspectors = await storage.getInspectors();
      res.json(inspectors);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Business-level inspection metrics
  app.get("/api/inspections/metrics/business", async (req: Express.Request, res: Response) => {
    try {
      const filters: { inspector?: string; startDate?: Date; endDate?: Date } = {};
      if (req.query.inspector) filters.inspector = req.query.inspector as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

      const metrics = await storage.getBusinessLevelInspectionMetrics(filters);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKU-level inspection metrics
  app.get("/api/inspections/metrics/sku", async (req: Express.Request, res: Response) => {
    try {
      const filters: { inspector?: string; startDate?: Date; endDate?: Date } = {};
      if (req.query.inspector) filters.inspector = req.query.inspector as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

      const metrics = await storage.getSkuLevelInspectionMetrics(filters);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vendor-level inspection metrics
  app.get("/api/inspections/metrics/vendor", async (req: Express.Request, res: Response) => {
    try {
      const filters: { inspector?: string; startDate?: Date; endDate?: Date } = {};
      if (req.query.inspector) filters.inspector = req.query.inspector as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

      const metrics = await storage.getVendorLevelInspectionMetrics(filters);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Year-over-Year First Time Pass Rate
  app.get("/api/inspections/metrics/yoy-pass-rate", async (req: Express.Request, res: Response) => {
    try {
      const filters: { inspector?: string } = {};
      if (req.query.inspector) filters.inspector = req.query.inspector as string;

      const data = await storage.getYearOverYearFirstTimePassRate(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Inspection-to-Delay Correlation
  app.get("/api/inspections/metrics/delay-correlation", async (req: Express.Request, res: Response) => {
    try {
      const filters: { inspector?: string } = {};
      if (req.query.inspector) filters.inspector = req.query.inspector as string;

      const data = await storage.getInspectionDelayCorrelation(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKU Inspection History - detailed list of inspections for a specific SKU (by code)
  app.get("/api/skus/:skuCode/inspections", async (req: Express.Request, res: Response) => {
    try {
      const skuCode = req.params.skuCode;
      if (!skuCode) {
        return res.status(400).json({ error: "Invalid SKU code" });
      }

      const data = await storage.getSkuInspectionHistoryByCode(skuCode);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKU Summary - basic info about a specific SKU (by code)
  app.get("/api/skus/:skuCode", async (req: Express.Request, res: Response) => {
    try {
      const skuCode = req.params.skuCode;
      if (!skuCode) {
        return res.status(400).json({ error: "Invalid SKU code" });
      }

      const data = await storage.getSkuSummaryByCode(skuCode);
      if (!data) {
        return res.status(404).json({ error: "SKU not found" });
      }
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKU Detail - includes SKU summary and status information
  app.get("/api/skus/:skuCode/detail", async (req: Express.Request, res: Response) => {
    try {
      const skuCode = req.params.skuCode;
      if (!skuCode) {
        return res.status(400).json({ error: "Invalid SKU code" });
      }

      const data = await storage.getSkuSummaryByCode(skuCode);
      if (!data) {
        return res.status(404).json({ error: "SKU not found" });
      }

      // Get SKU status from the skus table
      const skuRecord = await db.select({
        id: skus.id,
        status: skus.status,
        discontinuedAt: skus.discontinuedAt,
        discontinuedReason: skus.discontinuedReason,
      }).from(skus).where(eq(skus.sku, skuCode)).limit(1);

      const skuStatus = skuRecord.length > 0 ? skuRecord[0] : null;

      res.json({
        ...data,
        skuId: skuStatus?.id || null,
        status: skuStatus?.status || 'active',
        discontinuedAt: skuStatus?.discontinuedAt || null,
        discontinuedReason: skuStatus?.discontinuedReason || null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKU Year-over-Year Sales
  app.get("/api/skus/:skuCode/yoy-sales", async (req: Express.Request, res: Response) => {
    try {
      const skuCode = req.params.skuCode;
      if (!skuCode) {
        return res.status(400).json({ error: "Invalid SKU code" });
      }

      const salesData = await storage.getSkuYoYSales(skuCode);
      res.json(salesData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKU Shipping Stats - First shipped date and total sales to date
  app.get("/api/skus/:skuCode/shipping-stats", async (req: Express.Request, res: Response) => {
    try {
      const skuCode = req.params.skuCode;
      if (!skuCode) {
        return res.status(400).json({ error: "Invalid SKU code" });
      }

      const stats = await storage.getSkuShippingStats(skuCode);
      res.json(stats || {
        firstShippedDate: null,
        lastShippedDate: null,
        totalShippedSales: 0,
        totalShippedOrders: 0,
        totalShippedQuantity: 0,
        salesThisYear: 0,
        salesLastYear: 0
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Purchase Orders
  app.get("/api/purchase-orders", async (req: Express.Request, res: Response) => {
    try {
      const { vendor, office, status, startDate, endDate, client } = req.query;

      const filters: any = {};
      if (vendor) filters.vendor = vendor as string;
      if (office) filters.office = office as string;
      if (status) filters.status = status as string;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (client) filters.client = client as string;

      const merchandiserFilter = getMerchandiserFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      }

      const pos = await storage.getPurchaseOrders(filters);
      res.json(pos);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Export purchase orders - supports SKU level (line items) or PO level (headers only)
  app.get("/api/purchase-orders/export", async (req: Express.Request, res: Response) => {
    try {
      const { vendor, office, status, startDate, endDate, client, level } = req.query;
      const exportLevel = (level as string) || 'sku'; // Default to SKU level

      const filters: any = {};
      if (vendor) filters.vendor = vendor as string;
      if (office) filters.office = office as string;
      if (status) filters.status = status as string;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (client) filters.client = client as string;

      const merchandiserFilter = getMerchandiserFilter(req);
      if (merchandiserFilter) {
        filters.merchandiser = merchandiserFilter;
      }

      // Get base PO data
      const pos = await storage.getPurchaseOrders(filters);

      // Add daysSinceOrdering to each PO
      const today = new Date();
      const posWithDays = pos.map(po => {
        const poDateVal = po.poDate ? new Date(po.poDate) : null;
        const daysSinceOrdering = poDateVal
          ? Math.floor((today.getTime() - poDateVal.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          ...po,
          daysSinceOrdering,
        };
      });

      // For PO-level export, return headers only
      if (exportLevel === 'po') {
        res.json(posWithDays);
        return;
      }

      // For SKU-level export, fetch and expand line items
      const poNumbers = pos.map(po => po.poNumber).filter(Boolean) as string[];
      const allLineItems = poNumbers.length > 0
        ? await db.select().from(poLineItems).where(inArray(poLineItems.poNumber, poNumbers))
        : [];

      // Group line items by PO number
      const lineItemsByPo = new Map<string, typeof allLineItems>();
      for (const item of allLineItems) {
        if (!item.poNumber) continue;
        const existing = lineItemsByPo.get(item.poNumber) || [];
        existing.push(item);
        lineItemsByPo.set(item.poNumber, existing);
      }

      // Build expanded rows with poDate and daysSinceOrdering
      const expandedRows: any[] = [];

      for (const po of posWithDays) {
        if (!po.poNumber) continue;

        const lineItems = lineItemsByPo.get(po.poNumber) || [];

        if (lineItems.length === 0) {
          // If no line items, include PO with empty SKU fields
          expandedRows.push({
            ...po,
            skuNumber: po.sku || '',
            skuName: po.programDescription || '',
            lineQuantity: po.orderQuantity,
            lineValue: po.totalValue,
          });
        } else {
          // Expand each line item as a separate row
          for (const item of lineItems) {
            expandedRows.push({
              ...po,
              skuNumber: item.sku || '',
              // Use line item sellerStyle, fall back to PO programDescription
              skuName: item.sellerStyle || po.programDescription || '',
              lineQuantity: item.orderQuantity || 0,
              lineValue: item.lineTotal || 0,
            });
          }
        }
      }

      res.json(expandedRows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Search purchase orders by PO number
  app.get("/api/purchase-orders/search/:query", async (req: Express.Request, res: Response) => {
    try {
      const query = req.params.query;
      if (!query || query.length < 3) {
        return res.json([]);
      }

      const results = await storage.searchPurchaseOrders(query);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get POs needing confirmation (EDI/Initial status with 7+ days since PO date)
  // Matches the PO page criteria: EDI/Initial and days >= 7 since PO date
  // IMPORTANT: This route MUST be defined BEFORE /api/purchase-orders/:id to avoid route matching issues
  app.get("/api/purchase-orders/needs-confirmation", async (req: Express.Request, res: Response) => {
    try {
      const { client } = req.query;

      // Prevent caching to ensure fresh data
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      // Query po_headers for EDI/Initial status that are 7+ days old
      // This matches the PO page criteria for "needs confirming"
      // Filter out: POs where all SKUs are discontinued, 8x8 POs, zero-value POs
      const results = await db.execute(sql`
        SELECT 
          ph.id,
          ph.po_number as "poNumber",
          ph.vendor,
          ph.status,
          ph.cop_number as "copNumber",
          ph.po_date as "orderDate",
          ph.revised_cancel_date as "revisedCancelDate",
          ph.total_value as "totalOrderValue",
          ph.client_division as "clientDivision",
          ph.confirmation_date as "confirmationDate",
          EXTRACT(DAY FROM (NOW() - ph.po_date))::integer as "daysSincePo",
          CASE 
            WHEN ph.cop_number IS NULL OR ph.cop_number = '' THEN true 
            ELSE false 
          END as "missingCop"
        FROM po_headers ph
        WHERE ph.status = 'EDI/Initial'
          AND ph.po_date <= NOW() - INTERVAL '7 days'
          ${client ? sql`AND ph.client_division = ${client as string}` : sql``}
          AND (ph.total_value IS NOT NULL AND ph.total_value > 0)
          AND (ph.program_description IS NULL OR ph.program_description NOT ILIKE '8X8 %')
          AND EXISTS (
            SELECT 1 FROM po_line_items pli
            LEFT JOIN skus s ON pli.sku = s.sku
            WHERE pli.po_header_id = ph.id
              AND (s.status IS NULL OR s.status != 'discontinued')
          )
        ORDER BY ph.po_date DESC
      `);

      res.json(results.rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Legacy endpoint - redirect to needs-confirmation
  app.get("/api/purchase-orders/missing-cop", async (req: Express.Request, res: Response) => {
    try {
      const { client } = req.query;
      const redirectUrl = client
        ? `/api/purchase-orders/needs-confirmation?client=${encodeURIComponent(client as string)}`
        : '/api/purchase-orders/needs-confirmation';
      res.redirect(redirectUrl);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/purchase-orders/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      // Helper function to calculate estimated inspection dates and get actual inspection dates
      const getInspectionDates = async (po: { poNumber: string; revisedCancelDate: Date | null; originalCancelDate: Date | null }) => {
        // Calculate estimated dates: inline = cancel - 14 days, final = cancel - 7 days
        const cancelDate = po.revisedCancelDate || po.originalCancelDate;
        let estimatedInlineDate: Date | null = null;
        let estimatedFinalDate: Date | null = null;

        if (cancelDate) {
          const cancel = new Date(cancelDate);
          estimatedInlineDate = new Date(cancel);
          estimatedInlineDate.setDate(estimatedInlineDate.getDate() - 14);
          estimatedFinalDate = new Date(cancel);
          estimatedFinalDate.setDate(estimatedFinalDate.getDate() - 7);
        }

        // Get actual inspection dates from inspections table (OS 630 data)
        const inspections = await storage.getInspectionsByPoNumber(po.poNumber);

        // Find the most recent inline and final inspection dates
        let actualInlineDate: Date | null = null;
        let actualFinalDate: Date | null = null;
        let inlineResult: string | null = null;
        let finalResult: string | null = null;

        for (const inspection of inspections) {
          if (inspection.inspectionType?.toLowerCase().includes('inline')) {
            if (!actualInlineDate || (inspection.inspectionDate && new Date(inspection.inspectionDate) > actualInlineDate)) {
              actualInlineDate = inspection.inspectionDate ? new Date(inspection.inspectionDate) : null;
              inlineResult = inspection.result;
            }
          } else if (inspection.inspectionType?.toLowerCase().includes('final')) {
            if (!actualFinalDate || (inspection.inspectionDate && new Date(inspection.inspectionDate) > actualFinalDate)) {
              actualFinalDate = inspection.inspectionDate ? new Date(inspection.inspectionDate) : null;
              finalResult = inspection.result;
            }
          }
        }

        return {
          estimatedInlineDate,
          estimatedFinalDate,
          actualInlineDate,
          actualFinalDate,
          inlineResult,
          finalResult
        };
      };

      // Check if id is NaN - might be a PO number lookup
      if (isNaN(id)) {
        const poNumber = req.params.id;
        const po = await storage.getPurchaseOrderByNumber(poNumber);

        if (!po) {
          return res.status(404).json({ error: "Purchase order not found" });
        }

        const [timelines, shipments, lineItems, vendor, inspectionDates] = await Promise.all([
          storage.getTimelinesByPoId(po.id),
          storage.getShipmentsByPoNumber(po.poNumber),
          storage.getPurchaseOrderLineItems(po.poNumber),
          po.vendor ? storage.getVendorByName(po.vendor) : Promise.resolve(undefined),
          getInspectionDates(po)
        ]);

        // Enrich with vendor info
        const vendorInfo = vendor ? {
          vendorId: vendor.id,
          merchandiser: vendor.merchandiser,
          merchandisingManager: vendor.merchandisingManager
        } : {};

        return res.json({ ...po, ...vendorInfo, ...inspectionDates, timelines, shipments, lineItems });
      }

      const po = await storage.getPurchaseOrderById(id);

      if (!po) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      // Get related data including vendor info and inspection dates
      const [timelines, shipments, lineItems, vendor, inspectionDates] = await Promise.all([
        storage.getTimelinesByPoId(id),
        storage.getShipmentsByPoNumber(po.poNumber),
        storage.getPurchaseOrderLineItems(po.poNumber),
        po.vendor ? storage.getVendorByName(po.vendor) : Promise.resolve(undefined),
        getInspectionDates(po)
      ]);

      // Enrich with vendor info (merchandiser, manager)
      const vendorInfo = vendor ? {
        vendorId: vendor.id,
        merchandiser: vendor.merchandiser,
        merchandisingManager: vendor.merchandisingManager
      } : {};

      res.json({ ...po, ...vendorInfo, ...inspectionDates, timelines, shipments, lineItems });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create new PO - uses normalized po_headers table
  app.post("/api/purchase-orders", async (req: Express.Request, res: Response) => {
    try {
      const validated = insertPoHeaderSchema.parse(req.body);
      const poHeader = await storage.createPoHeader(validated);
      res.status(201).json(poHeader);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: fromZodError(error).message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Update PO - uses normalized po_headers table
  app.patch("/api/purchase-orders/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const poHeader = await storage.updatePoHeader(id, req.body);

      if (!poHeader) {
        return res.status(404).json({ error: "Purchase order not found" });
      }

      res.json(poHeader);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get current user's assigned clients
  app.get("/api/users/me/clients", async (req: Express.Request, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        // Return all clients if not authenticated (for development)
        const clients = await storage.getClients();
        return res.json(clients);
      }

      // Get staff record for current user
      const staff = await storage.getStaffByEmail(user.email);
      if (!staff) {
        // If no staff record, return all clients
        const clients = await storage.getClients();
        return res.json(clients);
      }

      // Get clients assigned to this staff member
      const assignments = await storage.getClientsForStaff(staff.id);
      res.json(assignments);
    } catch (error: any) {
      console.error("Error fetching user clients:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Clients
  app.get("/api/clients", async (req: Express.Request, res: Response) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/clients/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const client = await storage.getClientById(id);

      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      res.json(client);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/clients/:id/kpis", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const kpis = await storage.getClientKPIs(id);
      res.json(kpis);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/clients/:id/staff-assignments", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const assignments = await storage.getStaffClientAssignments(id);
      res.json(assignments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/clients/:id/staff-assignments", async (req: Express.Request, res: Response) => {
    try {
      const clientId = parseInt(req.params.id);
      const { staffId, role, isPrimary } = req.body;
      await storage.assignStaffToClient(staffId, clientId, role || 'merchandiser', isPrimary || false);
      res.status(201).json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/clients/:clientId/staff-assignments/:staffId", async (req: Express.Request, res: Response) => {
    try {
      const clientId = parseInt(req.params.clientId);
      const staffId = parseInt(req.params.staffId);
      await storage.removeStaffFromClient(staffId, clientId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Staff-to-Client assignments (from staff perspective)
  app.get("/api/staff/:id/client-assignments", async (req: Express.Request, res: Response) => {
    try {
      const staffId = parseInt(req.params.id);
      const assignments = await storage.getClientsForStaff(staffId);
      res.json(assignments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/staff/:id/client-assignments", async (req: Express.Request, res: Response) => {
    try {
      const staffId = parseInt(req.params.id);
      const { clientId, role, isPrimary } = req.body;
      await storage.assignStaffToClient(staffId, clientId, role || 'merchandiser', isPrimary || false);
      res.status(201).json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/staff/:staffId/client-assignments/:clientId", async (req: Express.Request, res: Response) => {
    try {
      const staffId = parseInt(req.params.staffId);
      const clientId = parseInt(req.params.clientId);
      await storage.removeStaffFromClient(staffId, clientId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/clients/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const client = await storage.updateClient(id, req.body);

      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      res.json(client);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vendors
  app.get("/api/vendors", async (req: Express.Request, res: Response) => {
    try {
      const { client } = req.query;
      const filters: { client?: string } = {};
      if (client) filters.client = client as string;

      const vendors = await storage.getVendors(filters);
      res.json(vendors);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/vendors/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const vendor = await storage.getVendorById(id);

      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }

      res.json(vendor);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/vendors", async (req: Express.Request, res: Response) => {
    try {
      const validated = insertVendorSchema.parse(req.body);
      const vendor = await storage.createVendor(validated);
      res.status(201).json(vendor);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: fromZodError(error).message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/vendors/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const vendor = await storage.updateVendor(id, req.body);

      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }

      res.json(vendor);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/vendors/:id/performance", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const performance = await storage.getVendorDetailPerformance(id, startDate, endDate);
      res.json(performance);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/vendors/:id/skus", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const skus = await storage.getVendorSkus(id);
      res.json(skus);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/vendors/:id/inspections", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const inspections = await storage.getVendorInspections(id);
      res.json(inspections);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/vendors/:id/quality-tests", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const tests = await storage.getVendorQualityTests(id);
      res.json(tests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/vendors/:id/ytd-performance", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const ytdData = await storage.getVendorYTDPerformance(id, startDate, endDate);
      res.json(ytdData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/vendors/:id/yoy-sales", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const salesData = await storage.getVendorYoYSales(id, startDate, endDate);
      res.json(salesData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vendor OTD Year-over-Year with value-based metrics
  app.get("/api/vendors/:id/otd-yoy", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const otdData = await storage.getVendorOtdYoY(id, startDate, endDate);
      res.json(otdData);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get aggregated purchase orders for a vendor (grouped by PO number)
  app.get("/api/vendors/:id/aggregated-purchase-orders", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const vendor = await storage.getVendorById(id);

      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }

      const aggregatedPOs = await storage.getAggregatedPurchaseOrdersByVendor(vendor.name, startDate, endDate);
      res.json(aggregatedPOs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Staff
  app.get("/api/staff", async (req: Express.Request, res: Response) => {
    try {
      const staff = await storage.getStaff();
      res.json(staff);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/staff/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const staffMember = await storage.getStaffById(id);

      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found" });
      }

      res.json(staffMember);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/staff", async (req: Express.Request, res: Response) => {
    try {
      const validated = insertStaffSchema.parse(req.body);
      const staffMember = await storage.createStaff(validated);
      res.status(201).json(staffMember);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: fromZodError(error).message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/staff/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const staffMember = await storage.updateStaff(id, req.body);

      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found" });
      }

      res.json(staffMember);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update staff access level (admin only)
  app.patch("/api/staff/:id/access-level", requireFullAccess, async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      // Validate access level with Zod
      const accessLevelSchema = z.object({
        accessLevel: z.enum(['full_access', 'level_1', 'level_2'])
      });

      const parsed = accessLevelSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid access level. Must be one of: full_access, level_1, level_2" });
      }

      const staffMember = await storage.updateStaff(id, { accessLevel: parsed.data.accessLevel });

      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found" });
      }

      res.json(staffMember);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/staff/:id/metrics", isAuthenticated, async (req: Express.Request, res: Response) => {
    try {
      const targetStaffId = parseInt(req.params.id);
      const requesterId = req.session.staffId!;
      const requesterRole = req.session.staffRole!;

      // Check if requester can view this staff member's KPIs
      const canView = await canViewStaffKPIs(requesterId, requesterRole, targetStaffId, storage);
      if (!canView) {
        return res.status(403).json({ error: "You don't have permission to view this staff member's performance metrics" });
      }

      const metrics = await storage.getStaffKPIs(targetStaffId);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Staff Goals
  app.get("/api/staff/:id/goals", isAuthenticated, async (req: Express.Request, res: Response) => {
    try {
      const targetStaffId = parseInt(req.params.id);
      const requesterId = req.session.staffId!;
      const requesterRole = req.session.staffRole!;

      // Check if requester can view this staff member's goals
      const canView = await canViewStaffKPIs(requesterId, requesterRole, targetStaffId, storage);
      if (!canView) {
        return res.status(403).json({ error: "You don't have permission to view this staff member's goals" });
      }

      const year = req.query.year ? parseInt(req.query.year as string) : undefined;
      const goals = await storage.getStaffGoals(targetStaffId, year);
      res.json(goals);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/staff/:id/goals", async (req: Express.Request, res: Response) => {
    try {
      const staffId = parseInt(req.params.id);

      // Check if staff already has 5 goals for this year
      const year = req.body.reviewYear || new Date().getFullYear();
      const existingGoals = await storage.getStaffGoals(staffId, year);
      if (existingGoals.length >= 5) {
        return res.status(400).json({ error: "Maximum of 5 goals per review year" });
      }

      const goal = await storage.createStaffGoal({
        ...req.body,
        staffId,
        priority: existingGoals.length + 1,
      });
      res.status(201).json(goal);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/goals/:goalId", async (req: Express.Request, res: Response) => {
    try {
      const goalId = parseInt(req.params.goalId);
      const goal = await storage.getStaffGoalById(goalId);
      if (!goal) {
        return res.status(404).json({ error: "Goal not found" });
      }
      res.json(goal);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/goals/:goalId", async (req: Express.Request, res: Response) => {
    try {
      const goalId = parseInt(req.params.goalId);
      const goal = await storage.updateStaffGoal(goalId, req.body);
      if (!goal) {
        return res.status(404).json({ error: "Goal not found" });
      }
      res.json(goal);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/goals/:goalId", async (req: Express.Request, res: Response) => {
    try {
      const goalId = parseInt(req.params.goalId);
      const deleted = await storage.deleteStaffGoal(goalId);
      if (!deleted) {
        return res.status(404).json({ error: "Goal not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Goal Progress Entries
  app.get("/api/goals/:goalId/progress", async (req: Express.Request, res: Response) => {
    try {
      const goalId = parseInt(req.params.goalId);
      const entries = await storage.getGoalProgressEntries(goalId);
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/goals/:goalId/progress", async (req: Express.Request, res: Response) => {
    try {
      const goalId = parseInt(req.params.goalId);
      const entry = await storage.createGoalProgressEntry({
        ...req.body,
        goalId,
      });
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/progress/:entryId", async (req: Express.Request, res: Response) => {
    try {
      const entryId = parseInt(req.params.entryId);
      const deleted = await storage.deleteGoalProgressEntry(entryId);
      if (!deleted) {
        return res.status(404).json({ error: "Progress entry not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Brand Assignments
  app.get("/api/brand-assignments", async (req: Express.Request, res: Response) => {
    try {
      const assignments = await storage.getBrandAssignments();
      const mapped = assignments.map(mapBrandAssignment);
      res.json(mapped);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vendor Contacts
  app.get("/api/vendors/:id/contacts", async (req: Express.Request, res: Response) => {
    try {
      const vendorId = parseInt(req.params.id);
      const contacts = await storage.getVendorContacts(vendorId);
      const mapped = contacts.map(mapVendorContact);
      res.json(mapped);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Color Panels
  app.get("/api/color-panels", async (req: Express.Request, res: Response) => {
    try {
      const filters = {
        status: req.query.status as string | undefined,
        brand: req.query.brand as string | undefined,
        vendorId: req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined,
      };
      const panels = await storage.getColorPanels(filters);
      const mapped = panels.map(mapColorPanel);
      res.json(mapped);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // MCP Renewals - Returns color panels due for renewal (used by To-Do List)
  app.get("/api/mcp-renewals", async (req: Express.Request, res: Response) => {
    try {
      const daysUntilExpiry = req.query.daysUntilExpiry
        ? parseInt(req.query.daysUntilExpiry as string)
        : 90;

      const results = await storage.getColorPanelsDueForRenewal({ daysUntilExpiry });
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Quality Tests - Returns all quality tests with vendor info (used by To-Do List)
  app.get("/api/quality-tests", async (req: Express.Request, res: Response) => {
    try {
      const results = await storage.getAllQualityTests();
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/color-panels/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const panel = await storage.getColorPanelById(id);

      if (!panel) {
        return res.status(404).json({ error: "Color panel not found" });
      }

      const mapped = mapColorPanel(panel);
      res.json(mapped);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/color-panels/:id/history", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const history = await storage.getColorPanelHistory(id);
      const mapped = history.map(mapColorPanelHistory);
      res.json(mapped);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/color-panels/:id/skus", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const skus = await storage.getSkusForColorPanel(id);
      const mapped = skus.map(mapSku);
      res.json(mapped);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/skus/:id/color-panels", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const panels = await storage.getColorPanelsForSku(id);
      const mapped = panels.map(mapColorPanel);
      res.json(mapped);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/color-panels/import", upload.single("file"), async (req: Express.Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileName = req.file.originalname;
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || req.file.mimetype.includes('spreadsheet');
      const fileType = isExcel ? "excel" : "csv";

      let rows: any[] = [];

      if (isExcel) {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(firstSheet, { raw: false, defval: null });
      } else {
        const csvText = req.file.buffer.toString('utf-8');
        const parsed = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
        });
        rows = parsed.data;
      }

      const panelsToImport: any[] = [];
      const historyToImport: any[] = [];
      const skuLinksToImport: Array<{ panelIndex: number; skuCodes: string[] }> = [];
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          // Map CSV columns to color panel fields
          const panel: any = {
            brand: row['Brand'] || row['brand'],
            vendorName: row['Vendor'] || row['vendor_name'],
            collection: row['Collection'] || row['collection'],
            skuDescription: row['SKU Description'] || row['sku_description'],
            material: row['Material'] || row['material'],
            finishName: row['Finish Name'] || row['finish_name'],
            sheenLevel: row['Sheen Level'] || row['sheen_level'],
            finishSystem: row['Finish System'] || row['finish_system'],
            paintSupplier: row['Paint Supplier'] || row['paint_supplier'],
            validityMonths: row['Validity (months)'] || row['validity_months'] || 12,
            currentMcpNumber: row['Current MCP#'] || row['current_mcp_number'],
            currentApprovalDate: row['Approval Date'] ? new Date(row['Approval Date']) : null,
            currentExpirationDate: row['Expiration Date'] ? new Date(row['Expiration Date']) : null,
            status: row['Status'] || row['status'] || 'active',
            notes: row['Notes'] || row['notes'],
          };

          // Find vendor by name to get vendorId
          if (panel.vendorName) {
            const vendor = await storage.getVendorByName(panel.vendorName);
            if (vendor) {
              panel.vendorId = vendor.id;
            }
          }

          // Find brand assignment to get merchandiser
          if (panel.brand) {
            const brandAssignment = await storage.getBrandAssignmentByCode(panel.brand);
            if (brandAssignment) {
              panel.merchandiserId = brandAssignment.merchandiserId;
            }
          }

          // Parse SKU codes from "SKU number" field (comma-separated)
          const skuField = row['SKU number'] || row['sku_number'] || row['SKU Number'];
          if (skuField && typeof skuField === 'string') {
            const skuCodes = skuField.split(',')
              .map(s => s.trim())
              .filter(s => s.length > 0);

            if (skuCodes.length > 0) {
              skuLinksToImport.push({
                panelIndex: panelsToImport.length,
                skuCodes,
              });
            }
          }

          panelsToImport.push(panel);

          // Parse historical versions if provided
          for (let version = 1; version <= 5; version++) {
            const mcpNumber = row[`MCP${version}#`] || row[`mcp${version}_number`];
            const approvalDate = row[`MCP${version} Approval`] || row[`mcp${version}_approval_date`];
            const expirationDate = row[`MCP${version} Expiration`] || row[`mcp${version}_expiration_date`];

            if (mcpNumber) {
              historyToImport.push({
                colorPanelId: null, // Will be set after panel is created
                mcpNumber,
                approvalDate: approvalDate ? new Date(approvalDate) : null,
                expirationDate: expirationDate ? new Date(expirationDate) : null,
                versionNumber: version,
              });
            }
          }
        } catch (error: any) {
          errors.push(`Row ${i + 1}: ${error.message}`);
        }
      }

      // Import panels
      const createdPanels = await storage.bulkCreateColorPanels(panelsToImport);

      // Import history with linked colorPanelId
      for (let i = 0; i < historyToImport.length; i++) {
        const history = historyToImport[i];
        const panelIndex = Math.floor(i / 5); // Each panel can have up to 5 versions
        if (createdPanels[panelIndex]) {
          history.colorPanelId = createdPanels[panelIndex].id;
        }
      }
      const validHistory = historyToImport.filter(h => h.colorPanelId);
      if (validHistory.length > 0) {
        await storage.bulkCreateColorPanelHistory(validHistory);
      }

      // Link SKUs to color panels
      let skuLinksCreated = 0;
      for (const linkInfo of skuLinksToImport) {
        const panel = createdPanels[linkInfo.panelIndex];
        if (!panel) continue;

        const skuIds: number[] = [];
        for (const skuCode of linkInfo.skuCodes) {
          try {
            // Check if SKU exists
            let existingSku = await storage.getSkuByCode(skuCode);

            // If not, create a minimal SKU entry
            if (!existingSku) {
              existingSku = await storage.createSku({
                sku: skuCode,
                description: `Auto-imported from color panel: ${panel.finishName || 'Unknown'}`,
              });
            }

            if (existingSku) {
              skuIds.push(existingSku.id);
            }
          } catch (skuError: any) {
            errors.push(`SKU ${skuCode}: ${skuError.message}`);
          }
        }

        // Create junction table entries
        if (skuIds.length > 0) {
          try {
            await storage.bulkLinkSkusToColorPanel(panel.id, skuIds);
            skuLinksCreated += skuIds.length;
          } catch (linkError: any) {
            errors.push(`Panel ${panel.id} linking: ${linkError.message}`);
          }
        }
      }

      // Log import
      await storage.createImportHistory({
        fileName,
        fileType,
        recordsImported: createdPanels.length,
        importedBy: req.user?.username,
        status: errors.length > 0 ? "partial_success" : "success",
        errorMessage: errors.length > 0 ? errors.join('; ') : null,
      });

      res.status(201).json({
        panelsImported: createdPanels.length,
        historyRecordsImported: validHistory.length,
        skuLinksCreated,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      console.error('Color panel import error:', error);

      await storage.createImportHistory({
        fileName: req.file?.originalname || "unknown",
        fileType: "csv",
        recordsImported: 0,
        importedBy: req.user?.username,
        status: "error",
        errorMessage: error.message,
      });

      res.status(500).json({ error: error.message });
    }
  });

  // Enhanced MCP Import for WEC Vietnam MCP Library format
  // Handles multiple sheets with different column layouts and parses multi-SKU cells
  app.post("/api/color-panels/import-wec", upload.single("file"), async (req: Express.Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileName = req.file.originalname;
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });

      const results: {
        panelsImported: number;
        historyRecordsImported: number;
        skuLinksCreated: number;
        skuLinksNotFound: string[];
        bySheet: { [key: string]: { panels: number; skuLinks: number } };
      } = {
        panelsImported: 0,
        historyRecordsImported: 0,
        skuLinksCreated: 0,
        skuLinksNotFound: [],
        bySheet: {},
      };

      const errors: string[] = [];

      // Helper: Convert Excel serial date to JavaScript Date
      const excelDateToJS = (excelDate: number | string | null | undefined): Date | null => {
        if (!excelDate) return null;
        if (typeof excelDate === 'string') {
          const parsed = new Date(excelDate);
          if (!isNaN(parsed.getTime())) return parsed;
          return null;
        }
        if (typeof excelDate === 'number') {
          // Excel dates are days since 1900-01-01 (with a leap year bug)
          const date = new Date((excelDate - 25569) * 86400 * 1000);
          if (!isNaN(date.getTime())) return date;
        }
        return null;
      };

      // Helper: Parse SKU cell with multiple SKUs separated by commas, semicolons, newlines
      const parseSkuCell = (cellValue: string | number | null | undefined): string[] => {
        if (!cellValue) return [];
        const text = String(cellValue);

        // Remove common notes/labels like "(discon soon)", "Storage beds:", "new SKU JL bed painted:", etc.
        let cleaned = text
          .replace(/\([^)]*\)/g, '')  // Remove parenthetical notes
          .replace(/[A-Za-z\s]+:/g, ' ')  // Remove labels ending with colon
          .replace(/\r\n|\r|\n/g, ',')  // Replace newlines with commas
          .replace(/;/g, ',');  // Replace semicolons with commas

        // Split by comma and extract numeric SKU codes
        const codes = cleaned.split(',')
          .map(s => s.trim())
          .filter(s => /^\d{5,12}$/.test(s));  // SKU codes are 5-12 digit numbers

        return [...new Set(codes)]; // Remove duplicates
      };

      // Helper: Parse validity months from text like "12 months", "36 months", "n/a"
      const parseValidityMonths = (value: string | number | null | undefined): number => {
        if (!value) return 12;
        const text = String(value).toLowerCase();
        const match = text.match(/(\d+)/);
        if (match) return parseInt(match[1]);
        return 12; // Default to 12 months
      };

      // Define column mappings for different sheet types
      const sheetConfigs: {
        [key: string]: {
          brandCol: number;
          vendorCol: number;
          collectionCol: number;
          skuDescCol: number;
          materialCol: number;
          finishNameCol: number;
          sheenLevelCol: number;
          finishSystemCol: number;
          paintSupplierCol: number;
          validityCol: number;
          latestMcpCol: number;
          latestApprovalCol: number;
          latestExpirationCol: number;
          skuNumberCol: number | null;
          statusCol: number | null;
          remarksCol: number | null;
          mcpHistoryStart: number;
          headerRow: number;
          isDiscontinued: boolean;
        }
      } = {
        // MCP-CB2: Brand in col 0/1, no SKU Numbers column
        'MCP-CB2': {
          brandCol: 1, vendorCol: 2, collectionCol: 3, skuDescCol: 4,
          materialCol: 5, finishNameCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
          paintSupplierCol: 9, validityCol: 10, latestMcpCol: 11, latestApprovalCol: 12,
          latestExpirationCol: 13, skuNumberCol: null, statusCol: 29, remarksCol: 30,
          mcpHistoryStart: 14, headerRow: 1, isDiscontinued: false,
        },
        // CB-CB2 DISCONTINUED: Same as CB2 but marked as discontinued
        'CB-CB2 DISCONTINUED MCP': {
          brandCol: 1, vendorCol: 2, collectionCol: 3, skuDescCol: 4,
          materialCol: 5, finishNameCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
          paintSupplierCol: 9, validityCol: 10, latestMcpCol: 11, latestApprovalCol: 12,
          latestExpirationCol: 13, skuNumberCol: null, statusCol: 29, remarksCol: 30,
          mcpHistoryStart: 14, headerRow: 1, isDiscontinued: true,
        },
        // MCP-CB: Similar to CB2 but different brand column
        'MCP-CB': {
          brandCol: 1, vendorCol: 2, collectionCol: 3, skuDescCol: 4,
          finishNameCol: 5, materialCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
          paintSupplierCol: 9, validityCol: 10, latestMcpCol: 11, latestApprovalCol: 12,
          latestExpirationCol: 13, skuNumberCol: null, statusCol: null, remarksCol: null,
          mcpHistoryStart: 14, headerRow: 1, isDiscontinued: false,
        },
        // MCP-CK: Has SKU Number column
        'MCP-CK': {
          brandCol: 0, vendorCol: 2, collectionCol: 4, skuDescCol: 4,
          finishNameCol: 5, materialCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
          paintSupplierCol: 9, validityCol: null, latestMcpCol: 10, latestApprovalCol: 11,
          latestExpirationCol: 12, skuNumberCol: 3, statusCol: null, remarksCol: null,
          mcpHistoryStart: 14, headerRow: 1, isDiscontinued: false,
        },
        // CK-MCP Handle: Similar to MCP-CK
        'CK-MCP Handle': {
          brandCol: 0, vendorCol: 2, collectionCol: 4, skuDescCol: 4,
          finishNameCol: 5, materialCol: 6, sheenLevelCol: 7, finishSystemCol: 8,
          paintSupplierCol: 9, validityCol: null, latestMcpCol: 10, latestApprovalCol: 11,
          latestExpirationCol: 12, skuNumberCol: 3, statusCol: null, remarksCol: null,
          mcpHistoryStart: 14, headerRow: 0, isDiscontinued: false,
        },
      };

      // Process each sheet
      for (const sheetName of workbook.SheetNames) {
        const config = sheetConfigs[sheetName];
        if (!config) {
          console.log(`Skipping unknown sheet: ${sheetName}`);
          continue;
        }

        const sheet = workbook.Sheets[sheetName];
        const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (data.length <= config.headerRow + 1) {
          console.log(`Sheet ${sheetName} is empty or has only headers`);
          continue;
        }

        results.bySheet[sheetName] = { panels: 0, skuLinks: 0 };

        // Process each row (skip header rows)
        for (let rowIndex = config.headerRow + 1; rowIndex < data.length; rowIndex++) {
          const row = data[rowIndex];

          // Skip empty rows (check if at least brand or vendor exists)
          const brand = row[config.brandCol] || '';
          const vendor = row[config.vendorCol] || '';
          if (!brand && !vendor) continue;

          // Skip rows that look like headers (contain text like "Brand", "Vendor")
          if (String(brand).toLowerCase() === 'brand' || String(vendor).toLowerCase() === 'vendor name') continue;

          try {
            // Get the latest MCP number (this is the current active panel)
            const latestMcpNumber = String(row[config.latestMcpCol] || '').trim();
            if (!latestMcpNumber || latestMcpNumber === '' || latestMcpNumber === '0') continue;

            // Determine expiration status
            const expirationDate = excelDateToJS(row[config.latestExpirationCol]);
            let status = config.isDiscontinued ? 'archived' : 'active';
            if (expirationDate) {
              const today = new Date();
              const daysUntilExpiry = Math.floor((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              if (daysUntilExpiry < 0) status = 'expired';
              else if (daysUntilExpiry <= 30) status = 'expiring';
            }

            // Build the panel object
            const panel: any = {
              brand: String(row[config.brandCol] || '').trim() || null,
              vendorName: String(row[config.vendorCol] || '').trim() || null,
              collection: String(row[config.collectionCol] || '').trim() || null,
              skuDescription: String(row[config.skuDescCol] || '').trim() || null,
              material: String(row[config.materialCol] || '').trim() || null,
              finishName: String(row[config.finishNameCol] || '').trim() || null,
              sheenLevel: String(row[config.sheenLevelCol] || '').trim() || null,
              finishSystem: String(row[config.finishSystemCol] || '').trim() || null,
              paintSupplier: String(row[config.paintSupplierCol] || '').trim() || null,
              validityMonths: config.validityCol !== null ? parseValidityMonths(row[config.validityCol]) : 12,
              currentMcpNumber: latestMcpNumber,
              currentApprovalDate: excelDateToJS(row[config.latestApprovalCol]),
              currentExpirationDate: expirationDate,
              status,
              notes: config.remarksCol !== null ? String(row[config.remarksCol] || '').trim() || null : null,
            };

            // Try to link to existing vendor
            if (panel.vendorName) {
              const vendor = await storage.getVendorByName(panel.vendorName);
              if (vendor) {
                panel.vendorId = vendor.id;
              }
            }

            // Try to get merchandiser from brand assignment
            if (panel.brand) {
              const brandAssignment = await storage.getBrandAssignmentByCode(panel.brand);
              if (brandAssignment) {
                panel.merchandiserId = brandAssignment.merchandiserId;
              }
            }

            // Create the color panel
            const createdPanel = await storage.createColorPanel(panel);
            results.panelsImported++;
            results.bySheet[sheetName].panels++;

            // Parse MCP history (columns after latest MCP)
            // History columns are in groups of 3: MCP#, Approval Date, Expiration Date
            const historyRecords: any[] = [];
            let versionNumber = 1;
            for (let col = config.mcpHistoryStart; col < row.length - 2; col += 3) {
              const mcpNum = String(row[col] || '').trim().replace(/\n.*/g, ''); // Remove any notes after newline
              const approvalDate = excelDateToJS(row[col + 1]);
              const expirationDate = excelDateToJS(row[col + 2]);

              // Only add if we have an MCP number
              if (mcpNum && mcpNum !== '' && mcpNum !== '0' && /\d+/.test(mcpNum)) {
                historyRecords.push({
                  colorPanelId: createdPanel.id,
                  mcpNumber: mcpNum.replace(/[^\d]/g, ''), // Clean to just digits
                  approvalDate,
                  expirationDate,
                  versionNumber,
                });
                versionNumber++;
                if (versionNumber > 15) break; // Safety limit
              }
            }

            // Bulk create history records
            if (historyRecords.length > 0) {
              await storage.bulkCreateColorPanelHistory(historyRecords);
              results.historyRecordsImported += historyRecords.length;
            }

            // Parse and link SKUs if this sheet has SKU numbers
            if (config.skuNumberCol !== null) {
              const skuCodes = parseSkuCell(row[config.skuNumberCol]);
              if (skuCodes.length > 0) {
                const skuIds: number[] = [];
                for (const skuCode of skuCodes) {
                  // Try to find existing SKU
                  const existingSku = await storage.getSkuByCode(skuCode);
                  if (existingSku) {
                    skuIds.push(existingSku.id);
                  } else {
                    results.skuLinksNotFound.push(skuCode);
                  }
                }

                if (skuIds.length > 0) {
                  await storage.bulkLinkSkusToColorPanel(createdPanel.id, skuIds);
                  results.skuLinksCreated += skuIds.length;
                  results.bySheet[sheetName].skuLinks += skuIds.length;
                }
              }
            }
          } catch (rowError: any) {
            errors.push(`${sheetName} Row ${rowIndex + 1}: ${rowError.message}`);
          }
        }
      }

      // Deduplicate unmatched SKUs list
      results.skuLinksNotFound = [...new Set(results.skuLinksNotFound)];

      // Log the import
      await storage.createImportHistory({
        fileName,
        fileType: "excel",
        recordsImported: results.panelsImported,
        importedBy: req.user?.username,
        status: errors.length > 0 ? "partial_success" : "success",
        errorMessage: errors.length > 0 ? errors.slice(0, 20).join('; ') : null,
      });

      res.status(201).json({
        success: true,
        ...results,
        errors: errors.length > 0 ? errors.slice(0, 50) : undefined,
        message: `Imported ${results.panelsImported} color panels with ${results.historyRecordsImported} history records and ${results.skuLinksCreated} SKU links`,
      });
    } catch (error: any) {
      console.error('WEC MCP import error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // MCP Management Center - Get panels due for renewal
  app.get("/api/mcp-management/due-for-renewal", async (req: Express.Request, res: Response) => {
    try {
      const filters: any = {};

      if (req.query.daysUntilExpiry) {
        filters.daysUntilExpiry = parseInt(req.query.daysUntilExpiry as string);
      }
      if (req.query.vendorId) {
        filters.vendorId = parseInt(req.query.vendorId as string);
      }
      if (req.query.merchandiserId) {
        filters.merchandiserId = parseInt(req.query.merchandiserId as string);
      }
      if (req.query.status) {
        filters.status = req.query.status as string;
      }

      const results = await storage.getColorPanelsDueForRenewal(filters);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // MCP Detail - Get comprehensive panel information
  app.get("/api/color-panels/:id/detail", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const detail = await storage.getColorPanelDetail(id);

      if (!detail) {
        return res.status(404).json({ error: "Color panel not found" });
      }

      res.json(detail);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // MCP Workflow operations
  app.get("/api/color-panels/:id/workflow", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const workflow = await storage.getColorPanelWorkflow(id);
      res.json(workflow || null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/color-panels/:id/workflow", async (req: Express.Request, res: Response) => {
    try {
      const colorPanelId = parseInt(req.params.id);
      const workflow = await storage.createColorPanelWorkflow({
        ...req.body,
        colorPanelId,
      });
      res.status(201).json(workflow);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/color-panels/:id/workflow", async (req: Express.Request, res: Response) => {
    try {
      const colorPanelId = parseInt(req.params.id);
      const workflow = await storage.updateColorPanelWorkflow(colorPanelId, req.body);

      if (!workflow) {
        return res.status(404).json({ error: "Workflow not found" });
      }

      res.json(workflow);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // MCP Communications operations
  app.get("/api/color-panels/:id/communications", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const communications = await storage.getColorPanelCommunications(id);
      res.json(communications);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/color-panels/:id/communications", async (req: Express.Request, res: Response) => {
    try {
      const colorPanelId = parseInt(req.params.id);
      const communication = await storage.createColorPanelCommunication({
        ...req.body,
        colorPanelId,
      });
      res.status(201).json(communication);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // MCP Messages operations
  app.get("/api/mcp-communications/:id/messages", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const messages = await storage.getColorPanelMessages(id);
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/mcp-communications/:id/messages", async (req: Express.Request, res: Response) => {
    try {
      const communicationId = parseInt(req.params.id);
      const message = await storage.createColorPanelMessage({
        ...req.body,
        communicationId,
      });
      res.status(201).json(message);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // MCP AI Events operations
  app.get("/api/color-panels/:id/ai-events", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const events = await storage.getColorPanelAiEvents(id);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/color-panels/:id/ai-events", async (req: Express.Request, res: Response) => {
    try {
      const colorPanelId = parseInt(req.params.id);
      const event = await storage.createColorPanelAiEvent({
        ...req.body,
        colorPanelId,
      });
      res.status(201).json(event);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // MCP Issues operations
  app.get("/api/color-panels/:id/issues", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const issues = await storage.getColorPanelIssues(id);
      res.json(issues);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/color-panels/:id/issues", async (req: Express.Request, res: Response) => {
    try {
      const colorPanelId = parseInt(req.params.id);
      const issue = await storage.createColorPanelIssue({
        ...req.body,
        colorPanelId,
      });
      res.status(201).json(issue);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/mcp-issues/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const issue = await storage.updateColorPanelIssue(id, req.body);

      if (!issue) {
        return res.status(404).json({ error: "Issue not found" });
      }

      res.json(issue);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // MCP AI Email Generation - Generate renewal reminder email using AI
  app.post("/api/color-panels/:id/generate-email", async (req: Express.Request, res: Response) => {
    try {
      const colorPanelId = parseInt(req.params.id);
      const { emailType = "reminder" } = req.body;

      // Get panel details for context
      const detail = await storage.getColorPanelDetail(colorPanelId);
      if (!detail) {
        return res.status(404).json({ error: "Color panel not found" });
      }

      const { panel, vendor, linkedSkus } = detail;

      // Get expiration info
      const daysUntilExpiry = panel.currentExpirationDate
        ? Math.ceil((new Date(panel.currentExpirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

      // Initialize OpenAI client
      const openai = new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      });

      // Build email generation prompt
      const emailTypePrompts: Record<string, string> = {
        reminder: "a polite initial reminder requesting the vendor to prepare and submit a new MCP for renewal",
        follow_up: "a follow-up message noting that we haven't received a response to our initial request",
        escalation: "an escalation email with increased urgency, noting this is time-sensitive for production continuity",
        final_notice: "a final notice email emphasizing the critical nature and potential production impacts"
      };

      const systemPrompt = `You are a professional merchandising operations coordinator writing emails to vendors about Master Color Panel (MCP) renewals.

CONTEXT:
- MCPs are color/finish specification panels that vendors must maintain and renew before expiration
- An expired MCP means production cannot proceed, which affects purchase orders
- The tone should be professional, clear, and collaborative

GUIDELINES:
1. Be professional and courteous but direct about the timeline
2. Reference the specific MCP number and brand/collection
3. Mention the number of affected SKUs if relevant
4. Include clear action items for the vendor
5. Keep the email concise (under 200 words)
6. Do not include placeholder text like [Your Name] - end appropriately`;

      const userPrompt = `Generate ${emailTypePrompts[emailType] || emailTypePrompts.reminder}.

PANEL DETAILS:
- MCP Number: ${panel.currentMcpNumber || 'Not assigned'}
- Brand: ${panel.brand || 'N/A'}
- Collection: ${panel.collection || 'N/A'}
- Material: ${panel.material || 'N/A'}
- Finish: ${panel.finishName || 'N/A'}
- Expiration Date: ${panel.currentExpirationDate ? new Date(panel.currentExpirationDate).toLocaleDateString() : 'Not set'}
${daysUntilExpiry !== null ? `- Days Until Expiry: ${daysUntilExpiry} days${daysUntilExpiry < 0 ? ' (EXPIRED)' : daysUntilExpiry <= 30 ? ' (URGENT)' : ''}` : ''}

VENDOR: ${vendor?.name || panel.vendorName || 'Vendor'}
AFFECTED SKUs: ${linkedSkus?.length || panel.skuCount || 0} product(s)

Generate:
1. Subject line
2. Email body`;

      // Log AI event as started
      const aiEvent = await storage.createColorPanelAiEvent({
        colorPanelId,
        eventType: "email_generation",
        inputData: { emailType, panelDetails: panel.currentMcpNumber },
        status: "processing",
      });

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const generatedContent = response.choices[0]?.message?.content || "";

      // Parse subject and body from response
      const subjectMatch = generatedContent.match(/(?:Subject(?:\s+Line)?:?\s*)(.*?)(?:\n|$)/i);
      const subject = subjectMatch ? subjectMatch[1].trim() : `MCP Renewal Request - ${panel.currentMcpNumber || panel.brand}`;

      // Extract body (everything after subject line)
      const bodyStartIndex = generatedContent.indexOf('\n', generatedContent.toLowerCase().indexOf('subject'));
      const body = bodyStartIndex > -1
        ? generatedContent.substring(bodyStartIndex + 1).replace(/^(?:Email\s+)?Body:?\s*/i, '').trim()
        : generatedContent;

      // Update AI event as completed
      await storage.updateColorPanelAiEvent(aiEvent.id, {
        status: "completed",
        outputData: { subject, body, generatedContent },
      });

      res.json({
        success: true,
        email: {
          subject,
          body,
          to: vendor?.email || null,
          vendorName: vendor?.name || panel.vendorName,
        },
        aiEventId: aiEvent.id,
      });
    } catch (error: any) {
      console.error("MCP Email Generation error:", error);
      res.status(500).json({ error: error.message || "Failed to generate email" });
    }
  });

  // MCP Start Renewal Workflow - Initialize renewal process with AI-generated email
  app.post("/api/color-panels/:id/start-renewal", async (req: Express.Request, res: Response) => {
    try {
      const colorPanelId = parseInt(req.params.id);

      // Check if workflow already exists
      let workflow = await storage.getColorPanelWorkflow(colorPanelId);

      if (!workflow) {
        // Create new workflow
        workflow = await storage.createColorPanelWorkflow({
          colorPanelId,
          status: "reminder_pending",
          isAiGenerated: true,
          reminderCount: 0,
        });
      } else if (workflow.status === "idle" || workflow.status === "closed") {
        // Restart workflow
        workflow = await storage.updateColorPanelWorkflow(colorPanelId, {
          status: "reminder_pending",
          reminderCount: 0,
          isAiGenerated: true,
        });
      }

      // Log AI event
      await storage.createColorPanelAiEvent({
        colorPanelId,
        eventType: "workflow_started",
        inputData: { triggeredBy: "user" },
        status: "completed",
        outputData: { workflowId: workflow?.id },
      });

      res.json({
        success: true,
        workflow,
        message: "Renewal workflow started. AI will generate initial reminder email.",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKUs
  app.get("/api/skus", async (req: Express.Request, res: Response) => {
    try {
      const skus = await storage.getSkus();
      res.json(skus);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/skus", async (req: Express.Request, res: Response) => {
    try {
      const validated = insertSkuSchema.parse(req.body);
      const sku = await storage.createSku(validated);
      res.status(201).json(sku);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: fromZodError(error).message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // SKU list with metrics for SKU Home page
  app.get("/api/skus-with-metrics", async (req: Express.Request, res: Response) => {
    try {
      const filters: { brand?: string } = {};
      if (req.query.brand) filters.brand = String(req.query.brand);

      const skuList = await storage.getSkuListWithMetrics(filters);
      res.json(skuList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKU Summary KPIs for SKU Home page - Sales breakdown by new vs existing SKUs
  app.get("/api/sku-summary-kpis", async (req: Express.Request, res: Response) => {
    try {
      const summary = await storage.getSkuSummaryKpis();
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKU shipment history (PO history)
  app.get("/api/skus/:skuCode/shipment-history", async (req: Express.Request, res: Response) => {
    try {
      const skuCode = req.params.skuCode;
      if (!skuCode) {
        return res.status(400).json({ error: "Invalid SKU code" });
      }
      const history = await storage.getSkuShipmentHistory(skuCode);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SKU compliance status (quality tests)
  app.get("/api/skus/:skuCode/compliance", async (req: Express.Request, res: Response) => {
    try {
      const skuCode = req.params.skuCode;
      if (!skuCode) {
        return res.status(400).json({ error: "Invalid SKU code" });
      }
      const compliance = await storage.getSkuComplianceStatus(skuCode);
      res.json(compliance);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update SKU status (manual discontinue/reactivate)
  app.patch("/api/skus/:id/status", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid SKU ID" });
      }

      const { status, reason } = req.body;
      if (!status || !['active', 'discontinued', 'pending'].includes(status)) {
        return res.status(400).json({ error: "Status must be 'active', 'discontinued', or 'pending'" });
      }

      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      if (status === 'discontinued') {
        updateData.discontinuedAt = new Date();
        updateData.discontinuedReason = reason || 'Manual discontinuation';
      } else if (status === 'active') {
        updateData.discontinuedAt = null;
        updateData.discontinuedReason = null;
      }

      const result = await db.update(skus)
        .set(updateData)
        .where(eq(skus.id, id))
        .returning();

      if (result.length === 0) {
        return res.status(404).json({ error: "SKU not found" });
      }

      res.json(result[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Auto-discontinue SKUs with no orders in the last 12 months
  app.post("/api/skus/auto-discontinue", async (req: Express.Request, res: Response) => {
    try {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - 12);

      // Find SKUs with orders in the last 12 months
      const activeSkuResult = await db.execute(sql`
        SELECT DISTINCT pli.sku 
        FROM po_line_items pli
        JOIN po_headers ph ON pli.po_header_id = ph.id
        WHERE ph.po_date >= ${cutoffDate}
        UNION
        SELECT DISTINCT pli.sku
        FROM po_line_items pli
        JOIN po_headers ph ON pli.po_header_id = ph.id
        WHERE ph.created_at >= ${cutoffDate}
      `);

      const activeSkuCodes = new Set((activeSkuResult.rows as any[]).map(r => r.sku));

      // Get all active SKUs
      const allActiveSkus = await db.select({ id: skus.id, sku: skus.sku })
        .from(skus)
        .where(eq(skus.status, 'active'));

      // Find SKUs to discontinue
      const skusToDiscontinue = allActiveSkus.filter(s => !activeSkuCodes.has(s.sku));

      if (skusToDiscontinue.length === 0) {
        return res.json({
          message: "No SKUs to discontinue",
          discontinuedCount: 0,
          skus: []
        });
      }

      // Update SKUs to discontinued status
      const discontinuedIds = skusToDiscontinue.map(s => s.id);
      await db.update(skus)
        .set({
          status: 'discontinued',
          discontinuedAt: new Date(),
          discontinuedReason: 'No orders in 12 months (auto)',
          updatedAt: new Date(),
        })
        .where(inArray(skus.id, discontinuedIds));

      res.json({
        message: `Successfully discontinued ${skusToDiscontinue.length} SKUs`,
        discontinuedCount: skusToDiscontinue.length,
        skus: skusToDiscontinue.map(s => s.sku),
      });
    } catch (error: any) {
      console.error('Auto-discontinue error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Timelines
  app.post("/api/timelines", async (req: Express.Request, res: Response) => {
    try {
      const validated = insertTimelineSchema.parse(req.body);
      const timeline = await storage.createTimeline(validated);
      res.status(201).json(timeline);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: fromZodError(error).message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/timelines/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const timeline = await storage.updateTimeline(id, req.body);

      if (!timeline) {
        return res.status(404).json({ error: "Timeline not found" });
      }

      res.json(timeline);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Shipments
  app.post("/api/shipments", async (req: Express.Request, res: Response) => {
    try {
      const validated = insertShipmentSchema.parse(req.body);
      const shipment = await storage.createShipment(validated);
      res.status(201).json(shipment);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: fromZodError(error).message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Shipments Page - List all shipments with PO data (excludes franchise POs starting with 089)
  app.get("/api/shipments-page", async (req: Express.Request, res: Response) => {
    try {
      const filters: any = {};
      if (req.query.vendor) filters.vendor = req.query.vendor as string;
      if (req.query.office) filters.office = req.query.office as string;
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.client) filters.client = req.query.client as string;
      if (req.query.merchandiser) filters.merchandiser = req.query.merchandiser as string;
      if (req.query.merchandisingManager) filters.merchandisingManager = req.query.merchandisingManager as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
      if (req.query.offset) filters.offset = parseInt(req.query.offset as string);
      // Default to excluding shipped orders unless explicitly requested
      filters.includeShipped = req.query.includeShipped === 'true';

      const shipments = await storage.getShipmentsWithPoData(Object.keys(filters).length > 0 ? filters : undefined);
      // Filter out franchise POs (starting with 089) from regular shipments page
      const filteredShipments = shipments.filter(s => !s.poNumber?.startsWith('089'));
      res.json(filteredShipments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Franchise Shipments Page - List all shipments for franchise POs (starting with 089)
  app.get("/api/franchise-shipments", async (req: Express.Request, res: Response) => {
    try {
      const filters: any = {};
      if (req.query.vendor) filters.vendor = req.query.vendor as string;
      if (req.query.office) filters.office = req.query.office as string;
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.client) filters.client = req.query.client as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);

      const shipments = await storage.getShipmentsWithPoData(Object.keys(filters).length > 0 ? filters : undefined);
      // Filter to only include franchise POs (starting with 089)
      const franchiseShipments = shipments.filter(s => s.poNumber?.startsWith('089'));
      res.json(franchiseShipments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Shipment Detail - Get single shipment with all related data
  app.get("/api/shipments-page/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const detail = await storage.getShipmentDetail(id);

      if (!detail.shipment) {
        return res.status(404).json({ error: "Shipment not found" });
      }

      res.json(detail);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Communications endpoints
  app.get("/api/communications/entity/:entityType/:entityId", async (req: Express.Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      const communications = await storage.getCommunicationsByEntity(entityType, parseInt(entityId));
      res.json(communications);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/communications/po/:poNumber", async (req: Express.Request, res: Response) => {
    try {
      const communications = await storage.getCommunicationsByPoNumber(req.params.poNumber);
      res.json(communications);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/communications", async (req: Express.Request, res: Response) => {
    try {
      const validated = insertCommunicationSchema.parse(req.body);
      const communication = await storage.createCommunication(validated);

      // Mark any existing AI summaries as stale for this entity
      await storage.markAiSummaryStale(validated.entityType, validated.entityId);

      res.status(201).json(communication);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: fromZodError(error).message });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/communications/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const communication = await storage.updateCommunication(id, req.body);

      if (!communication) {
        return res.status(404).json({ error: "Communication not found" });
      }

      res.json(communication);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/communications/:id", async (req: Express.Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const success = await storage.deleteCommunication(id);

      if (!success) {
        return res.status(404).json({ error: "Communication not found" });
      }

      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI Summary endpoints
  app.get("/api/ai-summaries/:entityType/:entityId/:summaryType", async (req: Express.Request, res: Response) => {
    try {
      const { entityType, entityId, summaryType } = req.params;
      const summary = await storage.getAiSummary(entityType, parseInt(entityId), summaryType);

      if (!summary) {
        return res.status(404).json({ error: "Summary not found", needsGeneration: true });
      }

      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai-summaries/generate", async (req: Express.Request, res: Response) => {
    try {
      const { entityType, entityId, summaryType, poNumber } = req.body;

      if (!entityType || !entityId || !summaryType) {
        return res.status(400).json({ error: "entityType, entityId, and summaryType are required" });
      }

      // Gather context based on entity type
      let context: any = { entityType, entityId, summaryType };

      // Get communications for this entity
      const communications = await storage.getCommunicationsByEntity(entityType, entityId);
      context.communications = communications;

      // Get entity-specific data
      if (entityType === 'po') {
        const po = await storage.getPurchaseOrderById(entityId);
        context.po = po;
        if (po) {
          const poShipments = await storage.getShipmentsByPoNumber(po.poNumber);
          context.shipments = poShipments;
          const activityLogs = await storage.getActivityLogsByPo(po.poNumber);
          context.activityLogs = activityLogs;
        }
      } else if (entityType === 'shipment') {
        const detail = await storage.getShipmentDetail(entityId);
        context.shipment = detail.shipment;
        context.po = detail.po;
        context.allShipments = detail.allShipments;
      } else if (entityType === 'mcp') {
        const mcp = await storage.getColorPanelById(entityId);
        context.mcp = mcp;
      } else if (entityType === 'sku') {
        const sku = await storage.getSkuById(entityId);
        context.sku = sku;
      }

      // Generate summary using OpenAI
      const prompt = buildAiSummaryPrompt(context);

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are an expert merchandising operations analyst. Analyze the provided communications, notes, and activity data to generate a comprehensive summary. Focus on:
1. Key events and milestones
2. Timeline of activities
3. Any issues or concerns raised
4. Current status and next steps
5. Recommendations if applicable

Format your response as JSON with the following structure:
{
  "summary": "A concise executive summary of the communications and activities",
  "keyEvents": [
    {"date": "YYYY-MM-DD", "event": "Description of key event", "type": "email|note|milestone|issue"}
  ],
  "recommendations": "Any actionable recommendations based on the analysis"
}`
            },
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: { type: "json_object" }
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content || '{}');

        // Save the summary
        const summary = await storage.createOrUpdateAiSummary({
          entityType,
          entityId,
          summaryType,
          poNumber: poNumber || null,
          summary: aiResponse.summary || 'Unable to generate summary',
          keyEvents: JSON.stringify(aiResponse.keyEvents || []),
          recommendations: aiResponse.recommendations || null,
          modelUsed: 'gpt-4o',
          promptVersion: '1.0',
          inputTokens: completion.usage?.prompt_tokens || null,
          outputTokens: completion.usage?.completion_tokens || null,
        });

        res.json(summary);
      } catch (aiError: any) {
        console.error('OpenAI API error:', aiError);

        // Return a placeholder summary if AI fails
        const fallbackSummary = await storage.createOrUpdateAiSummary({
          entityType,
          entityId,
          summaryType,
          poNumber: poNumber || null,
          summary: `Unable to generate AI summary. ${communications.length} communications found for analysis.`,
          keyEvents: JSON.stringify([]),
          recommendations: 'AI summary generation failed. Please try again later.',
          modelUsed: 'fallback',
          promptVersion: '1.0',
        });

        res.json(fallbackSummary);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Import History
  app.get("/api/import-history", async (req: Express.Request, res: Response) => {
    try {
      const history = await storage.getImportHistory();
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // CSV/Excel Import Endpoint
  app.post("/api/import/purchase-orders", upload.single("file"), async (req: Express.Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileName = req.file.originalname;
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || req.file.mimetype.includes('spreadsheet');
      const fileType = isExcel ? "excel" : "csv";

      // Helper to safely parse integers from Excel (handles floating point errors)
      const parseExcelInt = (value: any): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const num = parseFloat(String(value));
        if (isNaN(num)) return null;
        return Math.round(num);
      };

      // Helper to safely parse floats from Excel
      const parseExcelFloat = (value: any): number | null => {
        if (value === null || value === undefined || value === '') return null;
        // Remove thousand separators (commas) before parsing - handles "2,007.75" format
        const cleaned = String(value).replace(/,/g, '');
        const num = parseFloat(cleaned);
        if (isNaN(num)) return null;
        return num;
      };

      let rows: any[] = [];
      let shipmentRows: any[] = [];

      try {
        if (isExcel) {
          // Parse Excel file
          const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
          // For OS 340, use "Order and Ship Log" sheet if it exists, otherwise use first sheet
          const sheetName = workbook.SheetNames.includes('Order and Ship Log')
            ? 'Order and Ship Log'
            : workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          console.log(`Using sheet: "${sheetName}" from workbook with sheets: ${workbook.SheetNames.join(', ')}`);

          // Try different header row positions (skip title/metadata rows)
          let foundValidData = false;
          for (let headerRow = 0; headerRow < 10 && !foundValidData; headerRow++) {
            const testRows = XLSX.utils.sheet_to_json(worksheet, {
              raw: false,
              defval: null,
              range: headerRow
            });

            // Check if this looks like actual data (has columns with meaningful names, not __EMPTY)
            if (testRows.length > 0) {
              const firstRowKeys = Object.keys(testRows[0]);
              const emptyColumns = firstRowKeys.filter(k => k.startsWith('__EMPTY')).length;
              const totalColumns = firstRowKeys.length;

              // If less than 50% empty columns, we found the data
              if (totalColumns > 0 && emptyColumns / totalColumns < 0.5) {
                rows = testRows;
                foundValidData = true;
                console.log(`Found valid data starting at row ${headerRow + 1} with ${rows.length} rows`);
                break;
              }
            }
          }

          if (!foundValidData) {
            // Fallback to default parsing
            rows = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });
          }
        } else {
          // Parse CSV file
          const fileContent = req.file.buffer.toString("utf-8");
          const parseResult = Papa.parse(fileContent, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim(),
          });

          if (parseResult.errors.length > 0) {
            await storage.createImportHistory({
              fileName,
              fileType,
              recordsImported: 0,
              status: "error",
              errorMessage: `Parse errors: ${parseResult.errors.map(e => e.message).join(", ")}`,
              importedBy: req.user?.username,
            });

            return res.status(400).json({
              error: "Failed to parse CSV",
              details: parseResult.errors,
            });
          }

          rows = parseResult.data as any[];
        }
      } catch (parseError: any) {
        await storage.createImportHistory({
          fileName,
          fileType,
          recordsImported: 0,
          status: "error",
          errorMessage: `Parse error: ${parseError.message}`,
          importedBy: req.user?.username,
        });

        return res.status(400).json({
          error: `Failed to parse ${fileType.toUpperCase()} file`,
          details: parseError.message,
        });
      }

      // Log column names for debugging
      const columnNames = rows.length > 0 ? Object.keys(rows[0]) : [];
      console.log(`OS340 Import: Found ${rows.length} rows with ${columnNames.length} columns`);

      // STEP 0: PRE-IMPORT RECORD COUNTS FOR VERIFICATION
      const preImportCounts = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*) FROM po_headers) as po_headers_count,
          (SELECT COUNT(*) FROM po_line_items) as po_line_items_count,
          (SELECT COUNT(*) FROM shipments) as shipments_count
      `);
      const preImportPoHeaders = Number(preImportCounts.rows[0]?.po_headers_count || 0);
      const preImportPoLineItems = Number(preImportCounts.rows[0]?.po_line_items_count || 0);
      const preImportShipments = Number(preImportCounts.rows[0]?.shipments_count || 0);
      console.log(`OS340 Import: Pre-import counts - Headers: ${preImportPoHeaders}, Line Items: ${preImportPoLineItems}, Shipments: ${preImportShipments}`);

      // Find the Shipped (USD) column - log which one is found
      const shippedColumnVariants = ["Shipped (USD)", "Shipped\r\n(USD)", "Shipped\n(USD)", "shipped_usd"];
      let foundShippedColumn: string | null = null;
      if (rows.length > 0) {
        for (const variant of shippedColumnVariants) {
          if (rows[0][variant] !== undefined) {
            foundShippedColumn = variant;
            break;
          }
        }
        // Try normalized matching if no exact match
        if (!foundShippedColumn) {
          for (const key of columnNames) {
            const normalizedKey = key.replace(/[\r\n\s]+/g, ' ').toLowerCase().trim();
            if (normalizedKey === 'shipped (usd)') {
              foundShippedColumn = key;
              break;
            }
          }
        }
        console.log(`OS340 Import: Shipped (USD) column found: ${foundShippedColumn ? `"${foundShippedColumn.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"` : 'NOT FOUND'}`);

        // Log first row's shipped value for debugging
        if (foundShippedColumn) {
          const sampleValue = rows[0][foundShippedColumn];
          console.log(`OS340 Import: Sample shipped value from first row: "${sampleValue}" (type: ${typeof sampleValue})`);
        } else {
          // Log all columns containing "ship" for debugging
          const shipColumns = columnNames.filter(c => c.toLowerCase().includes('ship'));
          console.log(`OS340 Import: Columns containing 'ship': ${JSON.stringify(shipColumns.map(c => c.replace(/\n/g, '\\n').replace(/\r/g, '\\r')))}`);
        }
      }

      // Use a Map to aggregate multiple rows per PO number
      const poMap = new Map<string, { po: any; totalQty: number; totalValue: number; shippedValue: number; lineCount: number }>();
      const errors: string[] = [];

      // Track individual line items for po_line_items table
      const allLineItems: { poNumber: string; lineSequence: number; data: any }[] = [];

      // Load vendor name to vendor_id mapping for proper FK linking
      const vendorAliasQuery = sql`
        SELECT v.id, v.name, vca.alias
        FROM vendors v
        LEFT JOIN vendor_capacity_aliases vca ON vca.vendor_id = v.id
      `;
      const vendorAliasResult = await db.execute(vendorAliasQuery);
      const vendorNameToId = new Map<string, number>();
      for (const row of vendorAliasResult.rows) {
        const vendorId = row.id as number;
        const vendorName = row.name as string;
        const alias = row.alias as string | null;
        // Map canonical name
        vendorNameToId.set(vendorName.toUpperCase().trim(), vendorId);
        // Map alias if exists
        if (alias) {
          vendorNameToId.set(alias.toUpperCase().trim(), vendorId);
        }
      }
      console.log(`OS340 Import: Loaded ${vendorNameToId.size} vendor name/alias mappings for FK resolution`);

      // Track unique shipments by composite key: PO + Vessel + Sailing Date
      // Multiple SKU rows with same key belong to the same shipment
      const shipmentMap = new Map<string, {
        poNumber: string;
        vessel: string | null;
        sailingDate: Date | null;
        deliveryToConsolidator: Date | null;
        actualPortOfLoading: string | null;
        eta: Date | null;
        actualShipMode: string | null;
        shippedValue: number; // Aggregated from all SKU rows in this shipment
      }>();

      // Map Excel/CSV columns to database schema and aggregate by PO number
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          // Extract PO number - only required field (actual column name is "PO No")
          const poNumber = getColumnValue(row, "PO No", "PO Number", "po_number", "PO#", "PO") || "";

          // Skip rows without PO number - it's the only required field
          if (!poNumber || poNumber.trim() === "") {
            continue;
          }

          const trimmedPoNumber = poNumber.trim();

          // Calculate line values using normalized column matching
          const lineQty = parseExcelInt(getColumnValue(row, "Order Quantity", "order_quantity")) || 0;
          const lineUnitPrice = Math.round((parseExcelFloat(getColumnValue(row, "Unit Price (USD)", "Unit Price", "unit_price")) || 0) * 100);

          // Read Total Value directly from OS340 column AT (may be named "Total USD", "Total (USD)", "Total Value", etc.)
          // Fall back to calculation if column not found
          const totalValueRaw = getColumnValue(row, "Total (USD)", "Total USD", "Total Value", "total_usd", "total_value");
          const lineTotal = totalValueRaw !== null && totalValueRaw !== undefined && totalValueRaw !== ""
            ? Math.round((parseExcelFloat(totalValueRaw) || 0) * 100)
            : lineQty * lineUnitPrice; // fallback to calculation in cents

          // Parse Shipped (USD) from column BH - actual shipped value for YTD calculations
          // Use the found column directly if available, otherwise try getColumnValue
          const shippedRaw = foundShippedColumn ? row[foundShippedColumn] : getColumnValue(row, "Shipped (USD)", "shipped_usd");
          const shippedValueUsd = Math.round((parseExcelFloat(shippedRaw) || 0) * 100);

          // Check if we already have this PO
          const existing = poMap.get(trimmedPoNumber);

          // Extract SKU value for validation
          const skuValue = row["Style"] || row["SKU"] || row["sku"] || row["style"] || null;
          const skuStr = skuValue ? String(skuValue).trim() : "";

          // Skip line items with invalid/placeholder SKU values or zero quantity
          // - Skip if SKU is a single digit (likely row number or placeholder)
          // - Skip if SKU is empty
          // - Skip if order quantity is 0 (cancelled/duplicate rows)
          const isValidLineItem = skuStr.length > 1 && lineQty > 0;

          // Collect line item data for po_line_items table (only valid items)
          if (isValidLineItem) {
            const lineItem = {
              poNumber: trimmedPoNumber,
              lineSequence: existing ? existing.lineCount + 1 : 1,
              data: {
                sku: skuStr,
                style: row["Style"] || row["style"] || null,
                sellerStyle: row["Program \r\nDescription"] || row["Program Description"] || row["Seller Style"] || row["seller_style"] || null,
                newSku: row["New SKU"] || row["new_sku"] || null,
                newStyle: row["New Style"] || row["new_style"] || null,
                bigBets: row["Big Bets"] || row["big_bets"] || null,
                cbxItem: row["CBX Item"] || row["cbx_item"] || null,
                orderQuantity: lineQty,
                balanceQuantity: parseExcelInt(row["Balance Quantity "] || row["Balance Quantity"] || row["balance_quantity"]) || 0,
                unitPrice: lineUnitPrice,
                lineTotal: lineTotal,
              }
            };
            allLineItems.push(lineItem);
          }

          if (existing) {
            // Aggregate: add to totals
            existing.totalQty += lineQty;
            existing.totalValue += lineTotal;
            existing.shippedValue += shippedValueUsd;
            existing.lineCount += 1;
            // Keep other fields from first row (they should be the same for all lines of a PO)
          } else {
            // First row for this PO - create the base record
            const po: any = {
              poNumber: trimmedPoNumber,
              copNumber: row["COP No"] || row["COP Number"] || row["cop_number"] || null,
              client: row["Client"] || row["client"] || null,
              clientDivision: row["Client Division"] || row["client_division"] || null,
              clientDepartment: row["Client Department"] || row["client_department"] || null,
              buyer: row["Buyer"] || row["buyer"] || null,
              vendor: row["Vendor"] || row["vendor"] || null,
              factory: row["Factory"] || row["factory"] || null,
              productGroup: row["Product Group"] || row["product_group"] || null,
              productCategory: row["Product\r\nCategory"] || row["Product Category"] || row["product_category"] || null,
              season: row["Season"] || row["season"] || null,
              sku: row["Style"] || row["SKU"] || row["sku"] || row["style"] || null,
              style: row["Style"] || row["style"] || null,
              sellerStyle: row["Program \r\nDescription"] || row["Program Description"] || row["Seller Style"] || row["seller_style"] || null,
              newSku: row["New SKU"] || row["new_sku"] || null,
              newStyle: row["New Style"] || row["new_style"] || null,
              bigBets: row["Big Bets"] || row["big_bets"] || null,
              cbxItem: row["CBX Item"] || row["cbx_item"] || null,
              orderClassification: row["Order Classification"] || row["order_classification"] || null,
              programDescription: row["Program \r\nDescription"] || row["Program Description"] || row["program_description"] || null,
              program: row["Program"] || row["program"] || null,
              merchandiseProgram: row["Merchandise Program"] || row["merchandise_program"] || null,
              office: row["Office"] || row["office"] || null,
              mrSection: row["MR Section"] || row["mr_section"] || null,
              poDate: (row["PO Date"] || row["po_date"]) ? new Date(row["PO Date"] || row["po_date"]) : null,
              month: row["Month"] || row["month"] || null,
              originalShipDate: (row["Original Ship Date"] || row["original_ship_date"]) ? new Date(row["Original Ship Date"] || row["original_ship_date"]) : null,
              originalCancelDate: (row["Original Cancel Date"] || row["original_cancel_date"]) ? new Date(row["Original Cancel Date"] || row["original_cancel_date"]) : null,
              revisedShipDate: (row["Revised Ship Date"] || row["revised_ship_date"]) ? new Date(row["Revised Ship Date"] || row["revised_ship_date"]) : null,
              revisedCancelDate: (row["Revised Cancel Date"] || row["revised_cancel_date"]) ? new Date(row["Revised Cancel Date"] || row["revised_cancel_date"]) : null,
              revisedBy: row["Revised By"] || row["revised_by"] || null,
              revisedReason: row["Revised Reason"] || row["revised_reason"] || null,
              balanceQuantity: parseExcelInt(row["Balance Quantity "] || row["Balance Quantity"] || row["balance_quantity"]) || 0,
              scheduleShipMode: row["Schedule Ship Mode"] || row["schedule_ship_mode"] || null,
              schedulePoe: row["Schedule POE"] || row["schedule_poe"] || null,
              status: row["Status"] || row["status"] || "Booked-to-ship",
              shipmentStatus: row["Shipment Status"] || row["shipment_status"] || null,
              createdBy: req.user?.username,
              updatedBy: req.user?.username,
            };

            poMap.set(trimmedPoNumber, {
              po,
              totalQty: lineQty,
              totalValue: lineTotal,
              shippedValue: shippedValueUsd,
              lineCount: 1,
            });
          }

          // Extract shipment data if available (OS 340 has shipment info)
          const deliveryToConsolidator = row["Delivery to \r\nConsolidator"] || row["Delivery to Consolidator"] || row["delivery_to_consolidator"];
          const actualPortOfLoading = row["Actual Port of Loading"] || row["actual_port_of_loading"];
          const actualSailingDate = row["Actual \r\nSailing Date"] || row["Actual Sailing Date"] || row["actual_sailing_date"];
          const eta = row["ETA"] || row["eta"];
          const actualShipMode = row["Actual\r\nShip Mode"] || row["Actual Ship Mode"] || row["actual_ship_mode"];
          const vesselName = row["Vessel"] || row["Vessel Name"] || row["vessel"] || row["vessel_name"] || null;

          // Use the same "Shipped (USD)" column (BH) value for shipment-level shipped_value
          // This is the row-level shipped value that should be attributed to this specific sailing date
          const shipmentShippedValueRaw = foundShippedColumn ? row[foundShippedColumn] : getColumnValue(row, "Shipped (USD)", "shipped_usd");
          const shipmentShippedValue = Math.round((parseExcelFloat(shipmentShippedValueRaw) || 0) * 100);

          // Group SKU rows into shipments by PO + Vessel + Sailing Date
          // Multiple SKU rows with same combination = same shipment, aggregate their shipped values
          if (actualSailingDate || vesselName) {
            const sailingDateStr = actualSailingDate ? new Date(actualSailingDate).toISOString().split('T')[0] : 'no-date';
            const vesselStr = (vesselName || 'no-vessel').toString().trim().toUpperCase();
            const shipmentKey = `${trimmedPoNumber}|${vesselStr}|${sailingDateStr}`;

            const existingShipment = shipmentMap.get(shipmentKey);
            if (existingShipment) {
              // Same shipment - aggregate the shipped value from this SKU row
              existingShipment.shippedValue += shipmentShippedValue;
            } else {
              // New unique shipment
              shipmentMap.set(shipmentKey, {
                poNumber: trimmedPoNumber,
                vessel: vesselName ? vesselName.toString().trim() : null,
                sailingDate: actualSailingDate ? new Date(actualSailingDate) : null,
                deliveryToConsolidator: deliveryToConsolidator ? new Date(deliveryToConsolidator) : null,
                actualPortOfLoading: actualPortOfLoading || null,
                eta: eta ? new Date(eta) : null,
                actualShipMode: actualShipMode || null,
                shippedValue: shipmentShippedValue,
              });
            }
          }
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      // Convert shipmentMap to shipmentRows with sequential shipmentNumbers per PO
      // Group by PO, sort by sailing date, then assign sequential numbers
      const shipmentsByPo = new Map<string, Array<typeof shipmentMap extends Map<string, infer V> ? V : never>>();
      for (const shipment of shipmentMap.values()) {
        const existing = shipmentsByPo.get(shipment.poNumber) || [];
        existing.push(shipment);
        shipmentsByPo.set(shipment.poNumber, existing);
      }

      // Assign sequential shipmentNumber per PO, sorted by sailing date
      for (const [poNumber, shipments] of shipmentsByPo.entries()) {
        // Sort by sailing date (nulls last)
        shipments.sort((a, b) => {
          if (!a.sailingDate && !b.sailingDate) return 0;
          if (!a.sailingDate) return 1;
          if (!b.sailingDate) return -1;
          return a.sailingDate.getTime() - b.sailingDate.getTime();
        });

        shipments.forEach((shipment, index) => {
          shipmentRows.push({
            poNumber: shipment.poNumber,
            shipmentNumber: index + 1,
            vessel: shipment.vessel,
            deliveryToConsolidator: shipment.deliveryToConsolidator,
            actualPortOfLoading: shipment.actualPortOfLoading,
            actualSailingDate: shipment.sailingDate,
            eta: shipment.eta,
            actualShipMode: shipment.actualShipMode,
            shippedValue: shipment.shippedValue, // Aggregated from all SKU rows in this shipment
          });
        });
      }

      console.log(`OS340 Import: Created ${shipmentRows.length} unique shipments from ${rows.length} SKU rows (grouped by PO + Vessel + Sailing Date)`);

      // Finalize aggregated POs: set orderQuantity, unitPrice, totalValue, and shippedValue from accumulated values
      const purchaseOrders: any[] = [];
      for (const [poNumber, data] of poMap.entries()) {
        const { po, totalQty, totalValue, shippedValue, lineCount } = data;
        // Set aggregated values
        po.orderQuantity = totalQty;
        po.totalValue = totalValue;
        po.shippedValue = shippedValue; // "Shipped (USD)" from OS340 - used for YTD calculations
        // Calculate weighted average unit price (total value / total quantity) if we have quantity
        po.unitPrice = totalQty > 0 ? Math.round(totalValue / totalQty) : 0;
        purchaseOrders.push(po);
      }

      // Debug: Log shipped value statistics
      const posWithShippedValue = purchaseOrders.filter(po => po.shippedValue > 0).length;
      const totalShippedValue = purchaseOrders.reduce((sum, po) => sum + (po.shippedValue || 0), 0);
      console.log(`Aggregated ${rows.length} Excel rows into ${purchaseOrders.length} unique POs`);
      console.log(`Shipped value stats: ${posWithShippedValue} POs with shipped value, total: $${(totalShippedValue / 100).toFixed(2)}`);

      // STEP 1: Extract and upsert SKUs into the standalone SKU table
      console.log("Extracting unique SKUs from import data...");
      const skuDataForUpsert = purchaseOrders.map(po => ({
        sku: String(po.sku || '').trim(),
        style: po.style || null,
        description: po.programDescription || null,
        category: po.productCategory || null,
        productGroup: po.productGroup || null,
        season: po.season || null,
        isNew: po.newSku === 'Yes' || po.newSku === 'Y' || po.newSku === true,
      })).filter(item => item.sku.length > 0);

      const skuResult = await storage.bulkUpsertSkusFromOS340(skuDataForUpsert);
      console.log(`SKU table updated: ${skuResult.created} created, ${skuResult.updated} updated, ${skuResult.skipped} skipped (invalid/placeholder)`);
      if (skuResult.errors.length > 0) {
        console.warn(`SKU upsert warnings: ${skuResult.errors.slice(0, 5).join(', ')}`);
      }

      // STEP 2: Create po_headers and po_line_items (normalized structure)
      // NOTE: Legacy purchase_orders table removed - all data now in po_headers + po_line_items
      let imported = 0;
      let updatedCount = 0;
      // IMPORTANT: Prepare ALL data FIRST, then clear+insert atomically to prevent data loss
      let headersImported = 0;
      let lineItemsImported = 0;
      if (purchaseOrders.length > 0) {
        console.log(`Preparing ${purchaseOrders.length} PO headers and ${allLineItems.length} line items...`);

        // Debug: Log sample line items to verify raw row data is being captured
        if (allLineItems.length > 0) {
          console.log(`Sample line items (first 3):`, JSON.stringify(allLineItems.slice(0, 3), null, 2));
          // Check if we have multiple line items per PO
          const poItemCounts = new Map<string, number>();
          allLineItems.forEach(item => {
            poItemCounts.set(item.poNumber, (poItemCounts.get(item.poNumber) || 0) + 1);
          });
          const multiItemPOs = Array.from(poItemCounts.entries()).filter(([_, count]) => count > 1);
          console.log(`POs with multiple line items: ${multiItemPOs.length} (e.g., ${multiItemPOs.slice(0, 3).map(([po, c]) => `${po}: ${c} items`).join(', ')})`);
        }

        try {
          // PREPARE all data structures BEFORE clearing tables
          // Build po_headers from the aggregated PO data
          const poHeadersToCreate = purchaseOrders.map((po: any) => {
            // Resolve vendor name to vendor_id using alias lookup
            const vendorKey = po.vendor ? po.vendor.toUpperCase().trim() : '';
            const vendorId = vendorNameToId.get(vendorKey) || null;

            return {
              poNumber: po.poNumber,
              copNumber: po.copNumber,
              client: po.client,
              clientDivision: po.clientDivision,
              clientDepartment: po.clientDepartment,
              buyer: po.buyer,
              vendor: po.vendor,
              vendorId: vendorId, // FK to canonical vendor
              factory: po.factory,
              productGroup: po.productGroup,
              productCategory: po.productCategory,
              season: po.season,
              orderClassification: po.orderClassification,
              programDescription: po.programDescription,
              program: po.program,
              merchandiseProgram: po.merchandiseProgram,
              office: po.office,
              mrSection: po.mrSection,
              poDate: po.poDate,
              month: po.month,
              originalShipDate: po.originalShipDate,
              originalCancelDate: po.originalCancelDate,
              revisedShipDate: po.revisedShipDate,
              revisedCancelDate: po.revisedCancelDate,
              revisedBy: po.revisedBy,
              revisedReason: po.revisedReason,
              totalQuantity: po.orderQuantity || 0,
              balanceQuantity: po.balanceQuantity || 0,
              totalValue: po.totalValue || 0,
              shippedValue: po.shippedValue || 0,
              scheduleShipMode: po.scheduleShipMode,
              schedulePoe: po.schedulePoe,
              status: po.status || "Booked-to-ship",
              shipmentStatus: po.shipmentStatus,
            };
          });

          // Validate data is ready before proceeding
          if (poHeadersToCreate.length === 0) {
            throw new Error("No valid PO headers to create - aborting to preserve existing data");
          }

          console.log(`Data prepared: ${poHeadersToCreate.length} headers ready. Performing FULL-REPLACE...`);

          // STEP 1: Capture POs currently in "EDI/Initial" status BEFORE clearing
          // This enables tracking status transitions to "Booked-to-ship" across imports
          console.log('Capturing EDI/Initial PO statuses for transition tracking...');
          const ediInitialPosResult = await db.execute<{ po_number: string }>(sql`
            SELECT po_number FROM po_headers WHERE UPPER(status) = 'EDI/INITIAL'
          `);
          const ediInitialPoNumbers = new Set(ediInitialPosResult.rows.map(r => r.po_number));
          console.log(`Found ${ediInitialPoNumbers.size} POs currently in EDI/Initial status`);

          // FULL-REPLACE strategy for po_headers and po_line_items (per replit.md)
          // Clear all existing data first, then insert fresh data
          console.log('Clearing existing po_line_items for full data refresh...');
          await storage.clearAllPoLineItems();
          console.log('Clearing existing po_headers for full data refresh...');
          await storage.clearAllPoHeaders();

          // Bulk insert all headers fresh
          const HEADER_BATCH_SIZE = 500;
          const poHeaderIdMap = new Map<string, number>();
          for (let i = 0; i < poHeadersToCreate.length; i += HEADER_BATCH_SIZE) {
            const batch = poHeadersToCreate.slice(i, i + HEADER_BATCH_SIZE);
            const inserted = await db.insert(poHeaders).values(batch).returning();
            for (const h of inserted) {
              poHeaderIdMap.set(h.poNumber, h.id);
            }
            console.log(`Inserted ${Math.min(i + HEADER_BATCH_SIZE, poHeadersToCreate.length)} of ${poHeadersToCreate.length} PO headers...`);
          }
          headersImported = poHeadersToCreate.length;

          console.log(`PO headers: ${headersImported} inserted (full-replace)`);

          // STEP 2: Update confirmation_date for POs that transitioned from EDI/Initial to Booked-to-ship
          // This tracks when a PO was first booked across successive imports
          if (ediInitialPoNumbers.size > 0) {
            console.log('Checking for EDI/Initial → Booked-to-ship status transitions...');
            const transitionedPosResult = await db.execute<{ po_number: string }>(sql`
              SELECT po_number FROM po_headers 
              WHERE UPPER(status) = 'BOOKED-TO-SHIP'
                AND confirmation_date IS NULL
            `);

            // Find POs that were EDI/Initial before AND are now Booked-to-ship
            const transitionedPoNumbers = transitionedPosResult.rows
              .filter(r => ediInitialPoNumbers.has(r.po_number))
              .map(r => r.po_number);

            if (transitionedPoNumbers.length > 0) {
              const importDate = new Date();
              const updateResult = await db
                .update(poHeaders)
                .set({ confirmationDate: importDate })
                .where(
                  and(
                    inArray(poHeaders.poNumber, transitionedPoNumbers),
                    isNull(poHeaders.confirmationDate)
                  )
                )
                .returning({ poNumber: poHeaders.poNumber });
              console.log(`Set confirmation_date for ${updateResult.length} POs that transitioned to Booked-to-ship`);
            } else {
              console.log('No EDI/Initial → Booked-to-ship transitions detected');
            }
          }

          // Re-link quality_tests and inspections to the new po_headers via po_number
          console.log('Re-linking quality_tests and inspections to new po_headers...');
          await db.execute(sql`
            UPDATE quality_tests qt
            SET po_header_id = ph.id
            FROM po_headers ph
            WHERE qt.po_number = ph.po_number AND qt.po_header_id IS NULL
          `);
          await db.execute(sql`
            UPDATE inspections insp
            SET po_header_id = ph.id
            FROM po_headers ph
            WHERE insp.po_number = ph.po_number AND insp.po_header_id IS NULL
          `);
          console.log('Re-linking complete');

          // All POs need line items since we cleared everything
          const modifiedPoNumbers = new Set(poHeadersToCreate.map(h => h.poNumber));

          // Create line items for all POs (full-replace, all data is fresh)
          const lineItemsToCreate = allLineItems
            .map(item => {
              const headerId = poHeaderIdMap.get(item.poNumber);
              if (!headerId) return null;
              return {
                poHeaderId: headerId,
                poNumber: item.poNumber,
                lineSequence: item.lineSequence,
                sku: item.data.sku,
                style: item.data.style,
                sellerStyle: item.data.sellerStyle,
                newSku: item.data.newSku,
                newStyle: item.data.newStyle,
                bigBets: item.data.bigBets,
                cbxItem: item.data.cbxItem,
                orderQuantity: item.data.orderQuantity,
                balanceQuantity: item.data.balanceQuantity,
                unitPrice: item.data.unitPrice,
                lineTotal: item.data.lineTotal,
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          // Batch insert po_line_items
          const LINE_ITEM_BATCH_SIZE = 500;
          const lineItemBatches = [];
          for (let i = 0; i < lineItemsToCreate.length; i += LINE_ITEM_BATCH_SIZE) {
            lineItemBatches.push(lineItemsToCreate.slice(i, i + LINE_ITEM_BATCH_SIZE));
          }

          for (let i = 0; i < lineItemBatches.length; i++) {
            const batch = lineItemBatches[i];
            console.log(`Creating line item batch ${i + 1}/${lineItemBatches.length} (${batch.length} records)`);
            const created = await storage.bulkCreatePoLineItems(batch);
            lineItemsImported += created.length;
          }

          console.log(`Successfully created ${headersImported} PO headers and ${lineItemsImported} line items`);
        } catch (headerError: any) {
          console.error("Error in PO headers/line items operation:", headerError.message);
          errors.push(`PO header/line item creation failed: ${headerError.message}`);
          // Log critical warning - tables may be in inconsistent state
          console.error("CRITICAL: If tables were cleared before this error, data may need to be re-imported");
        }
      }

      // Import shipment records if we have any
      let shipmentsImported = 0;
      if (shipmentRows.length > 0) {
        console.log(`Found ${shipmentRows.length} shipment records to import`);

        // FULL-REPLACE strategy: Clear all existing shipments before inserting new ones
        // This prevents duplicates when re-importing OS340 and ensures shipped_value is accurate
        console.log('Clearing existing shipments for full data refresh (OS340 full-replace strategy)...');
        await storage.clearAllShipments();

        // Build a map of PO Number -> PO ID for linking shipments
        console.log('Building PO number to ID mapping...');
        const poIdMap = new Map<string, number>();
        const allPos = await storage.getPurchaseOrders({});
        allPos.forEach(po => {
          if (po.poNumber) {
            poIdMap.set(po.poNumber.trim(), po.id);
          }
        });
        console.log(`Built mapping for ${poIdMap.size} PO numbers`);

        // Link shipments to POs - poId is optional now (linking via po_number instead)
        const linkedShipments = shipmentRows.map(shipment => {
          const poId = poIdMap.get(shipment.poNumber.trim());
          return {
            ...shipment,
            poId: poId || null, // poId is optional, we link via po_number
          };
        });

        console.log(`Linked ${linkedShipments.length} of ${shipmentRows.length} shipments to POs`);

        if (linkedShipments.length > 0) {
          const SHIPMENT_BATCH_SIZE = 500;
          const shipmentBatches = [];

          for (let i = 0; i < linkedShipments.length; i += SHIPMENT_BATCH_SIZE) {
            shipmentBatches.push(linkedShipments.slice(i, i + SHIPMENT_BATCH_SIZE));
          }

          console.log(`Processing ${linkedShipments.length} shipments in ${shipmentBatches.length} batches`);

          for (let i = 0; i < shipmentBatches.length; i++) {
            const batch = shipmentBatches[i];
            console.log(`Processing shipment batch ${i + 1}/${shipmentBatches.length} (${batch.length} records)`);
            try {
              const created = await storage.bulkCreateShipments(batch);
              shipmentsImported += created.length;
            } catch (batchError: any) {
              console.error(`Shipment batch ${i + 1} failed:`, batchError.message);
              // Continue with other batches even if one fails
            }
          }

          console.log(`Successfully imported ${shipmentsImported} shipment records`);
        }
      }

      // Auto-generate timelines for imported POs based on product category averages
      let timelinesGenerated = 0;
      let milestonesGenerated = 0;
      if (imported > 0) {
        console.log(`Auto-generating timelines for imported POs based on product category averages...`);
        try {
          const timelineResult = await storage.bulkGenerateTimelinesFromCategoryAverages(false, imported + 100);
          timelinesGenerated = timelineResult.timelinesCreated;
          milestonesGenerated = timelineResult.milestonesCreated;
          console.log(`Generated ${timelinesGenerated} timelines with ${milestonesGenerated} milestones`);
          if (timelineResult.errors.length > 0) {
            console.warn(`Timeline generation had ${timelineResult.errors.length} errors:`, timelineResult.errors.slice(0, 5));
          }
        } catch (timelineError: any) {
          console.error('Timeline generation failed:', timelineError.message);
        }
      }

      // Auto-generate tasks for imported POs (run in background - don't block import response)
      const importedPoNumbers = purchaseOrders.map((po: any) => po.poNumber).filter(Boolean);
      if (importedPoNumbers.length > 0) {
        // Run task generation asynchronously in background
        const TASK_GEN_BATCH_SIZE = 100; // Larger batches for efficiency
        console.log(`Queuing background task generation for ${importedPoNumbers.length} imported POs...`);

        // Don't await - let it run in background
        (async () => {
          try {
            let totalTasks = 0;
            for (let i = 0; i < importedPoNumbers.length; i += TASK_GEN_BATCH_SIZE) {
              const batch = importedPoNumbers.slice(i, i + TASK_GEN_BATCH_SIZE);
              try {
                const taskResults = await storage.regenerateTasksForImportedPOs(batch);
                totalTasks += taskResults.reduce((sum, r) => sum + r.tasksGenerated, 0);
              } catch (taskError: any) {
                console.error(`Background task gen batch ${Math.floor(i / TASK_GEN_BATCH_SIZE) + 1} failed:`, taskError.message);
              }
            }
            console.log(`Background: Generated ${totalTasks} tasks across ${importedPoNumbers.length} POs`);
          } catch (bgError: any) {
            console.error('Background task generation failed:', bgError.message);
          }
        })();
      }

      // Match imported POs to existing SKU projections
      let projectionsMatched = 0;
      let projectionVariances = 0;
      if (purchaseOrders.length > 0) {
        console.log(`Matching ${purchaseOrders.length} imported POs to SKU projections...`);
        try {
          // Prepare PO data for matching (need vendor, SKU, quantities, dates, programDescription for SPO matching)
          const posForMatching = purchaseOrders.map((po: any) => ({
            poNumber: po.poNumber,
            vendor: po.vendor,
            sku: po.sku,
            orderQuantity: po.orderQuantity || 0,
            totalValue: po.totalValue || 0,
            poDate: po.poDate,
            originalShipDate: po.originalShipDate,
            programDescription: po.programDescription || null
          }));

          const matchResult = await storage.matchProjectionsToPOs(posForMatching);
          projectionsMatched = matchResult.matched;
          projectionVariances = matchResult.variances;

          if (matchResult.matched > 0) {
            console.log(`Matched ${matchResult.matched} projections (${matchResult.variances} with variance > 10%)`);
          }
          if (matchResult.errors.length > 0) {
            console.warn(`Projection matching had ${matchResult.errors.length} errors:`, matchResult.errors.slice(0, 3));
          }
        } catch (matchError: any) {
          console.error('Projection matching failed:', matchError.message);
          // Non-fatal - continue with import response
        }
      }

      // POST-IMPORT VERIFICATION: Count records after import
      const postImportCounts = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*) FROM po_headers) as po_headers_count,
          (SELECT COUNT(*) FROM po_line_items) as po_line_items_count,
          (SELECT COUNT(*) FROM shipments) as shipments_count
      `);
      const postImportPoHeaders = Number(postImportCounts.rows[0]?.po_headers_count || 0);
      const postImportPoLineItems = Number(postImportCounts.rows[0]?.po_line_items_count || 0);
      const postImportShipments = Number(postImportCounts.rows[0]?.shipments_count || 0);
      console.log(`OS340 Import: Post-import counts - Headers: ${postImportPoHeaders}, Line Items: ${postImportPoLineItems}, Shipments: ${postImportShipments}`);

      // Expected counts from processing
      const expectedPoHeaders = purchaseOrders.length;
      const expectedPoLineItems = allLineItems.length;
      const expectedShipments = shipmentRows.length;

      // Verification: Compare expected vs actual
      const verificationErrors: string[] = [];
      if (postImportPoHeaders !== expectedPoHeaders) {
        verificationErrors.push(`PO Headers mismatch: expected ${expectedPoHeaders}, got ${postImportPoHeaders}`);
      }
      if (postImportPoLineItems !== expectedPoLineItems) {
        verificationErrors.push(`Line Items mismatch: expected ${expectedPoLineItems}, got ${postImportPoLineItems}`);
      }
      if (postImportShipments !== expectedShipments) {
        verificationErrors.push(`Shipments mismatch: expected ${expectedShipments}, got ${postImportShipments}`);
      }

      const verificationStatus = verificationErrors.length === 0 ? 'passed' : 'failed';
      const verificationDetails = verificationErrors.length > 0
        ? verificationErrors.join('; ')
        : `Verified: ${postImportPoHeaders} headers, ${postImportPoLineItems} line items, ${postImportShipments} shipments`;

      console.log(`OS340 Import: Verification ${verificationStatus} - ${verificationDetails}`);

      // Add verification errors to the errors array if any
      if (verificationErrors.length > 0) {
        errors.push(...verificationErrors);
      }

      // Log import with verification data
      await storage.createImportHistory({
        fileName,
        fileType,
        recordsImported: imported + shipmentsImported,
        status: verificationErrors.length > 0 ? "failed" : (errors.length > 0 ? "partial" : "success"),
        errorMessage: errors.length > 0 ? errors.join("; ") : null,
        importedBy: req.user?.username,
        preImportPoHeaders,
        preImportPoLineItems,
        preImportShipments,
        fileRowCount: rows.length,
        expectedPoHeaders,
        expectedPoLineItems,
        expectedShipments,
        postImportPoHeaders,
        postImportPoLineItems,
        postImportShipments,
        verificationStatus,
        verificationDetails,
      });

      res.json({
        success: verificationErrors.length === 0,
        recordsImported: imported,
        shipmentsImported: shipmentsImported,
        headersCreated: headersImported,
        lineItemsCreated: lineItemsImported,
        timelinesGenerated: timelinesGenerated,
        milestonesGenerated: milestonesGenerated,
        skusCreated: skuResult.created,
        skusUpdated: skuResult.updated,
        skusSkipped: skuResult.skipped,
        projectionsMatched: projectionsMatched,
        projectionVariances: projectionVariances,
        totalRows: rows.length,
        verification: {
          status: verificationStatus,
          preImport: { poHeaders: preImportPoHeaders, poLineItems: preImportPoLineItems, shipments: preImportShipments },
          expected: { poHeaders: expectedPoHeaders, poLineItems: expectedPoLineItems, shipments: expectedShipments },
          postImport: { poHeaders: postImportPoHeaders, poLineItems: postImportPoLineItems, shipments: postImportShipments },
          details: verificationDetails,
        },
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      await storage.createImportHistory({
        fileName: req.file?.originalname || "unknown",
        fileType: "csv",
        recordsImported: 0,
        status: "error",
        errorMessage: error.message,
        importedBy: req.user?.username,
      });

      res.status(500).json({ error: error.message });
    }
  });

  // OS 630 Quality Data Import Endpoint (Inspections & Certifications)
  app.post("/api/import/quality-data", upload.single("file"), async (req: Express.Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileName = req.file.originalname;
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || req.file.mimetype.includes('spreadsheet');
      const fileType = isExcel ? "excel" : "csv";

      let rows: any[] = [];

      // Helper function to parse combined date+result format: "2025-11-11 (Passed)"
      const parseDateResult = (value: string | null | undefined): { date: Date | null, result: string | null } => {
        if (!value || typeof value !== 'string' || value.trim() === '') {
          return { date: null, result: null };
        }

        const match = value.match(/^(\d{4}-\d{2}-\d{2})\s*\(([^)]+)\)/);
        if (match) {
          const [, dateStr, result] = match;
          return {
            date: new Date(dateStr),
            result: result.trim()
          };
        }

        // Try parsing as just a date
        try {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return { date, result: null };
          }
        } catch { }

        return { date: null, result: null };
      };

      try {
        if (isExcel) {
          // Parse Excel file
          const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];

          // For OS 630 files, handle multi-level headers with merged cells
          // Parse raw data to build proper column mapping
          const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

          // First, read just the first 10 rows to find the header row
          const headerSearchData: string[][] = [];
          for (let R = range.s.r; R < Math.min(range.s.r + 10, range.e.r + 1); ++R) {
            const row: string[] = [];
            for (let C = range.s.c; C <= range.e.c; ++C) {
              const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
              const cell = worksheet[cellAddress];
              row.push(cell ? String(cell.v || '') : '');
            }
            headerSearchData.push(row);
          }

          // Find header row - look for actual data column names (not merged category headers)
          let headerRowIndex = -1;
          let dataStartIndex = -1;

          for (let i = 0; i < headerSearchData.length; i++) {
            const row = headerSearchData[i];

            // Look for rows that have typical order/inspection data column names
            // These are the actual column headers, not the merged category headers
            const hasDataColumns = row.some(cell => {
              const lower = cell.toLowerCase();
              return lower === 'client' ||
                lower === 'vendor' ||
                lower === 'po' ||
                lower === 'style' ||
                lower === 'cop' ||
                lower === 'factory';
            });

            // Also check it's not just a single merged cell (category header)
            const nonEmptyCells = row.filter(cell => cell && cell.trim() !== '').length;
            const hasMultipleColumns = nonEmptyCells > 5;

            // This looks like the actual header row
            if (hasDataColumns && hasMultipleColumns) {
              headerRowIndex = range.s.r + i;
              dataStartIndex = headerRowIndex + 1;
              break;
            }
          }

          if (headerRowIndex >= 0 && dataStartIndex <= range.e.r) {
            // Build category mapping from merged cells ABOVE the header row only
            // These define report/inspection types that apply to columns below
            const merges = worksheet['!merges'] || [];
            const columnCategories: { [colIndex: number]: string } = {};

            // Process merged cells in rows ABOVE the header row
            for (const merge of merges) {
              // Only look at merges in rows before the header row
              if (merge.s.r < headerRowIndex) {
                const cellAddress = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c });
                const cell = worksheet[cellAddress];
                const categoryValue = cell ? String(cell.v || '').trim() : '';

                if (categoryValue) {
                  // Apply this category to all columns in the merge range
                  for (let c = merge.s.c; c <= merge.e.c; c++) {
                    // Only set if not already set (first category takes precedence)
                    if (!columnCategories[c]) {
                      columnCategories[c] = categoryValue;
                    }
                  }
                }
              }
            }

            // Log category mapping for debugging (helps verify correct file format handling)
            const categoryEntries = Object.entries(columnCategories).slice(0, 30);
            if (categoryEntries.length > 0) {
              console.log('OS 630 Column Categories detected (merged headers above data row):',
                categoryEntries.map(([c, cat]) => `Col ${c}: ${cat}`));
            }

            // Build column names from the header row WITH category prefix from merged headers
            // This creates names like "Mandatory_Result", "Performance_Status", "Transit_Expiry Date"
            const columnNames: string[] = [];
            const headerRow = headerSearchData[headerRowIndex - range.s.r] || [];

            for (let c = 0; c < headerRow.length; c++) {
              const cellValue = headerRow[c]?.trim() || '';
              const category = columnCategories[c];

              if (cellValue) {
                // Prepend category if available (e.g., "Mandatory_Result", "Performance_Status")
                if (category) {
                  columnNames.push(`${category}_${cellValue}`);
                } else {
                  columnNames.push(cellValue);
                }
              } else if (category) {
                // Use category alone if no cell value
                columnNames.push(`${category}_Col_${c}`);
              } else {
                columnNames.push(`Col_${c}`);
              }
            }

            console.log('OS 630 Header row found at index', headerRowIndex, '- first 30 column names:', columnNames.slice(0, 30));

            // Now read ALL data rows from dataStartIndex to the end
            rows = [];
            let debuggedFirstDateCell = false;
            for (let R = dataStartIndex; R <= range.e.r; ++R) {
              const rowData: any[] = [];
              for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = worksheet[cellAddress];
                // Debug first date cell
                if (!debuggedFirstDateCell && cell && typeof cell.v === 'number' && cell.v > 40000) {
                  console.log('First date cell debug - cellAddress:', cellAddress, 'cell.t:', cell.t, 'cell.v:', cell.v, 'type:', typeof cell.v);
                  debuggedFirstDateCell = true;
                }
                // Preserve raw cell values (numbers, strings, etc.) instead of converting everything to strings
                rowData.push(cell ? cell.v : null);
              }

              // Skip completely empty rows
              if (rowData.every(cell => cell === null || cell === '' || cell === undefined)) continue;

              // Convert row to object
              const obj: any = {};
              for (let c = 0; c < rowData.length; c++) {
                if (columnNames[c]) {
                  // Preserve raw value types (numbers, strings, etc.)
                  const value = rowData[c];
                  obj[columnNames[c]] = typeof value === 'string' ? value.trim() || null : value;
                }
              }
              rows.push(obj);
            }

            console.log(`Parsed ${rows.length} rows with multi-level headers from row ${dataStartIndex}:`, columnNames.slice(0, 10));
          } else {
            // Fallback to standard parsing
            rows = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });
          }
        } else {
          const fileContent = req.file.buffer.toString("utf-8");
          const parseResult = Papa.parse(fileContent, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim(),
          });

          if (parseResult.errors.length > 0) {
            return res.status(400).json({
              error: "Failed to parse CSV",
              details: parseResult.errors,
            });
          }

          rows = parseResult.data;
        }
      } catch (parseError: any) {
        return res.status(400).json({
          error: "Failed to parse file",
          details: parseError.message,
        });
      }

      console.log(`Found ${rows.length} rows with columns:`, rows.length > 0 ? Object.keys(rows[0]) : []);

      if (rows.length === 0) {
        return res.status(400).json({ error: "No data found in file" });
      }

      // STEP 0: PRE-IMPORT RECORD COUNTS FOR VERIFICATION
      const preImportCounts = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*) FROM inspections) as inspections_count,
          (SELECT COUNT(*) FROM quality_tests) as quality_tests_count
      `);
      const preImportInspections = Number(preImportCounts.rows[0]?.inspections_count || 0);
      const preImportQualityTests = Number(preImportCounts.rows[0]?.quality_tests_count || 0);
      console.log(`OS630 Import: Pre-import counts - Inspections: ${preImportInspections}, Quality Tests: ${preImportQualityTests}`);

      const errors: string[] = [];
      const inspections: any[] = [];
      const qualityTests: any[] = [];
      const complianceStyles: any[] = []; // OS630 source data for separate compliance table
      const skus: Set<string> = new Set();

      // Process each row
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          // Extract SKU (Style column) - required field
          // Look for Style in order info columns
          const sku = row["Style"] || row["style"] || row["SKU"] || row["Order_Style"] ||
            Object.keys(row).find(k => k.toLowerCase().includes('style') && row[k])
            ? row[Object.keys(row).find(k => k.toLowerCase().includes('style') && row[k])!]
            : "";

          if (!sku || String(sku).trim() === "") {
            continue; // Skip rows without SKU
          }

          const skuValue = String(sku).trim();
          skus.add(skuValue);

          // Extract PO number - optional linkage  
          const poNumber = row["PO"] || row["po"] || row["PO No"] || row["Order_PO"] ||
            Object.keys(row).find(k => k.toLowerCase() === 'po' && row[k])
            ? row[Object.keys(row).find(k => k.toLowerCase() === 'po' && row[k])!]
            : null;

          // Parse all inspection columns by searching for keywords
          // Handle both simple names ("Material", "Initial") and full names ("Material Inspection", "Final Inspection")
          const inspectionKeywords = [
            { keywords: ["material"], type: "Material Inspection" },
            { keywords: ["initial"], type: "Initial Inspection" },
            { keywords: ["inline"], type: "Inline Inspection" },
            { keywords: ["mid-line", "midline"], type: "Mid-Line Inspection" },
            { keywords: ["final"], excludeKeywords: ["re-final", "refinal"], type: "Final Inspection" },
            { keywords: ["re-final", "refinal"], type: "Re-Final Inspection" }
          ];

          for (const { keywords, excludeKeywords, type } of inspectionKeywords) {
            // Find columns that match the keywords - deterministically pick only the FIRST matching column
            // This prevents duplicates when multiple columns match (e.g., "Final" and "Final Inspection")
            const matchingColumns = Object.keys(row).filter(colName => {
              const lower = colName.toLowerCase();
              const hasKeyword = keywords.some(kw => lower.includes(kw));
              const hasExclude = excludeKeywords?.some(kw => lower.includes(kw));
              return hasKeyword && !hasExclude;
            });

            // Only use the FIRST matching column (deterministic selection before checking value)
            if (matchingColumns.length > 0) {
              const column = matchingColumns[0]; // Always pick first column header
              const value = row[column];
              if (value && String(value).trim() !== "") {
                const { date, result } = parseDateResult(String(value));
                if (date || result) {
                  inspections.push({
                    sku: skuValue,
                    style: skuValue,
                    skuId: null,
                    poNumber,
                    inspectionType: type,
                    inspectionDate: date,
                    result,
                    notes: null,
                  });
                }
              }
            }
          }

          // Parse "Result" column which may contain "Failed (Waiver)" format
          const parseResultValue = (value: string | null): { result: string | null, status: string | null } => {
            if (!value || typeof value !== 'string') return { result: null, status: null };
            const match = value.match(/^(Passed|Failed)\s*\(([^)]+)\)/i);
            if (match) {
              return { result: match[1], status: match[2] };
            }
            return { result: value.trim(), status: null };
          };

          // Parse Product Lab Test Reports (columns AE-AM)
          // Helper function to find column value by keyword patterns
          const findColumnValue = (keywords: string[], excludeKeywords?: string[]): any => {
            const matchingKey = Object.keys(row).find(k => {
              const lower = k.toLowerCase();
              const hasKeyword = keywords.every(kw => lower.includes(kw.toLowerCase()));
              const hasExclude = excludeKeywords?.some(kw => lower.includes(kw.toLowerCase()));
              return hasKeyword && !hasExclude;
            });
            return matchingKey ? row[matchingKey] : null;
          };

          // Debug: log all column names for first row
          if (i === 0) {
            console.log('OS 630 Row 0 - All column names:', Object.keys(row));
            console.log('OS 630 Row 0 - Sample values:', {
              labTestResult: findColumnValue(['mandatory', 'result'], ['performance']),
              performanceResult: findColumnValue(['performance', 'result']),
              transitResult: findColumnValue(['transit', 'result'], ['retest'])
            });
          }

          // Find Mandatory test columns (case-insensitive matching for OS 630 format)
          // Now supports prefixed column names like "Mandatory_Result", "Product Lab Test - Mandatory_Result"
          const labTestResult = findColumnValue(['mandatory', 'result'], ['performance']) ||
            findColumnValue(['mandatory', 'tst'], ['performance']);
          const labTestExpiryDate = findColumnValue(['mandatory', 'expiry']);
          const labTestStatus = findColumnValue(['mandatory', 'status']);
          const labTestCAP = findColumnValue(['mandatory', 'corrective']);

          // Find Performance test columns (case-insensitive matching for OS 630)
          // Now supports prefixed column names like "Performance_Result", "Product Lab Test - Performance_Result"
          const performanceResult = findColumnValue(['performance', 'result']);
          const performanceExpiryDate = findColumnValue(['performance', 'expiry']);
          const performanceStatus = findColumnValue(['performance', 'status']);
          const performanceCAP = findColumnValue(['performance', 'corrective']);

          // Create Lab Test record (Mandatory)
          if (labTestResult) {
            const { result, status } = parseResultValue(labTestResult);
            qualityTests.push({
              sku: skuValue,
              style: skuValue,
              skuId: null,
              poNumber,
              testType: "Product Lab Test - Mandatory",
              reportDate: parseExcelDate(labTestExpiryDate),
              reportNumber: null,
              result,
              expiryDate: parseExcelDate(labTestExpiryDate),
              status: status || labTestStatus || null,
              correctiveActionPlan: labTestCAP || null,
              reportLink: null,
            });
          }

          // Create Performance Test record
          if (performanceResult) {
            const { result, status } = parseResultValue(performanceResult);
            qualityTests.push({
              sku: skuValue,
              style: skuValue,
              skuId: null,
              poNumber,
              testType: "Product Lab Test - Performance",
              reportDate: parseExcelDate(performanceExpiryDate),
              reportNumber: null,
              result,
              expiryDate: parseExcelDate(performanceExpiryDate),
              status: status || performanceStatus || null,
              correctiveActionPlan: performanceCAP || null,
              reportLink: null,
            });
          }

          // Parse Transit Test and Lab Reports (columns AN-AV) - case-insensitive for OS 630
          // Now supports prefixed column names like "Transit_Result", "Transit Test_Result"
          const transitResult = findColumnValue(['transit', 'result'], ['retest']);
          const transitExpiryDate = findColumnValue(['transit', 'expiry'], ['retest']) ||
            findColumnValue(['transit', 'report date'], ['retest']);
          const transitStatus = findColumnValue(['transit', 'status'], ['retest']);
          const transitCAP = findColumnValue(['transit', 'corrective'], ['retest']);

          if (transitResult) {
            const { result, status } = parseResultValue(transitResult);
            qualityTests.push({
              sku: skuValue,
              style: skuValue,
              skuId: null,
              poNumber,
              testType: "Transit Test",
              reportDate: parseExcelDate(transitExpiryDate),
              reportNumber: null,
              result,
              expiryDate: parseExcelDate(transitExpiryDate),
              status: status || transitStatus || null,
              correctiveActionPlan: transitCAP || null,
              reportLink: null,
            });
          }

          // Parse retest data if exists
          const retestDate = row["Retest\r\nReport Date"] || row["Retest Report Date"];
          const retestResult = row["Retest\r\nResult"] || row["Retest Result"];
          const retestNumber = row["Retest\r\nReport Number"] || row["Retest Report Number"];
          const retestCAP = row["Retest\r\nCorrective Action Plan"] || row["Retest Corrective Action Plan"];

          if (retestDate || retestNumber || retestResult) {
            qualityTests.push({
              sku: skuValue,
              style: skuValue,
              skuId: null,
              poNumber,
              testType: "Retest",
              reportDate: parseExcelDate(retestDate),
              reportNumber: retestNumber || null,
              result: retestResult || null,
              expiryDate: null,
              status: null,
              correctiveActionPlan: retestCAP || null,
              reportLink: null,
            });
          }

          // Build compliance style record for separate compliance table
          // Extract source status from ORDER INFORMATION_Status column (contains 'Booked-to-ship', etc.)
          // This is the shipment/order status, NOT the test status
          const sourceStatus = row["ORDER INFORMATION_Status"] ||
            findColumnValue(['order information', 'status'], ['test', 'esf']) ||
            row["Status"] || null;

          // Extract client division from ORDER INFORMATION_Client Division column
          const clientDivision = row["ORDER INFORMATION_Client Division"] ||
            findColumnValue(['client division']) ||
            row["Client Division"] || row["Division"] || null;

          // Extract client department from ORDER INFORMATION_Client Department column  
          const clientDepartment = row["ORDER INFORMATION_Client Department"] ||
            findColumnValue(['client department']) ||
            row["Client Department"] || row["Department"] || null;

          // Extract vendor from ORDER INFORMATION_Vendor column
          const vendorName = row["ORDER INFORMATION_Vendor"] ||
            findColumnValue(['order information', 'vendor'], ['number']) ||
            row["Vendor"] || null;

          // Build the compliance style record with source data
          complianceStyles.push({
            style: skuValue,
            poNumber: poNumber ? String(poNumber).trim() : null,
            sourceStatus: sourceStatus ? String(sourceStatus).trim() : null,
            clientDivision: clientDivision ? String(clientDivision).trim() : null,
            clientDepartment: clientDepartment ? String(clientDepartment).trim() : null,
            vendorName: vendorName ? String(vendorName).trim() : null,
            mandatoryStatus: labTestStatus ? String(labTestStatus).trim() : null,
            mandatoryExpiryDate: parseExcelDate(labTestExpiryDate),
            mandatoryReportNumber: null,
            performanceStatus: performanceStatus ? String(performanceStatus).trim() : null,
            performanceExpiryDate: parseExcelDate(performanceExpiryDate),
            performanceReportNumber: null,
            transitStatus: transitStatus ? String(transitStatus).trim() : null,
            transitExpiryDate: parseExcelDate(transitExpiryDate),
          });

        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      // Upsert SKUs first (create if not exists)
      console.log(`Found ${skus.size} unique SKUs`);
      try {
        for (const sku of skus) {
          await storage.upsertSku({ sku });
        }
      } catch (skuErr: any) {
        console.error("Error upserting SKUs:", skuErr.message);
        errors.push(`SKU upsert failed: ${skuErr.message}`);
      }

      // UPSERT inspections and quality tests - preserves existing records and their links
      console.log("Upserting inspections and quality tests (preserving existing data)...");

      // Upsert inspections
      let inspectionsInserted = 0;
      let inspectionsUpdated = 0;
      if (inspections.length > 0) {
        try {
          console.log(`Upserting ${inspections.length} inspections...`);
          const result = await storage.bulkUpsertInspections(inspections);
          inspectionsInserted = result.inserted;
          inspectionsUpdated = result.updated;
          console.log(`Inspections: ${inspectionsInserted} new, ${inspectionsUpdated} updated`);
        } catch (inspErr: any) {
          console.error("Error upserting inspections:", inspErr.message);
          errors.push(`Inspection upsert failed: ${inspErr.message}`);
        }
      }

      // Upsert quality tests
      let testsInserted = 0;
      let testsUpdated = 0;
      if (qualityTests.length > 0) {
        try {
          console.log(`Upserting ${qualityTests.length} quality tests...`);
          const result = await storage.bulkUpsertQualityTests(qualityTests);
          testsInserted = result.inserted;
          testsUpdated = result.updated;
          console.log(`Quality tests: ${testsInserted} new, ${testsUpdated} updated`);
        } catch (testErr: any) {
          console.error("Error upserting quality tests:", testErr.message);
          errors.push(`Quality test upsert failed: ${testErr.message}`);
        }
      }

      // Insert compliance styles to separate compliance table (full replace for accurate reporting)
      let complianceStylesInserted = 0;
      if (complianceStyles.length > 0) {
        try {
          console.log(`Inserting ${complianceStyles.length} compliance style records...`);
          const result = await storage.bulkInsertComplianceStyles(complianceStyles);
          complianceStylesInserted = result.inserted;
          console.log(`Compliance styles: ${complianceStylesInserted} inserted`);
        } catch (compErr: any) {
          console.error("Error inserting compliance styles:", compErr.message);
          errors.push(`Compliance styles insert failed: ${compErr.message}`);
        }
      }

      // For backward compatibility, maintain the total imported counts
      const inspectionsImported = inspectionsInserted + inspectionsUpdated;
      const testsImported = testsInserted + testsUpdated;

      // Auto-generate tasks for affected POs (from inspections and quality tests)
      const affectedPoNumbers = new Set<string>();
      inspections.forEach((insp: any) => {
        if (insp.poNumber && typeof insp.poNumber === 'string') {
          affectedPoNumbers.add(insp.poNumber);
        }
      });
      qualityTests.forEach((test: any) => {
        if (test.poNumber && typeof test.poNumber === 'string') {
          affectedPoNumbers.add(test.poNumber);
        }
      });

      const uniquePoNumbers = Array.from(affectedPoNumbers);
      if (uniquePoNumbers.length > 0) {
        // Run task generation asynchronously in background
        const TASK_GEN_BATCH_SIZE = 100;
        console.log(`Queuing background task generation for ${uniquePoNumbers.length} affected POs...`);

        // Don't await - let it run in background
        (async () => {
          try {
            let totalTasks = 0;
            for (let i = 0; i < uniquePoNumbers.length; i += TASK_GEN_BATCH_SIZE) {
              const batch = uniquePoNumbers.slice(i, i + TASK_GEN_BATCH_SIZE);
              try {
                const taskResults = await storage.regenerateTasksForImportedPOs(batch);
                totalTasks += taskResults.reduce((sum, r) => sum + r.tasksGenerated, 0);
              } catch (taskError: any) {
                console.error(`Background task gen batch ${Math.floor(i / TASK_GEN_BATCH_SIZE) + 1} failed:`, taskError.message);
              }
            }
            console.log(`Background: Generated ${totalTasks} tasks across ${uniquePoNumbers.length} POs`);
          } catch (bgError: any) {
            console.error('Background task generation failed:', bgError.message);
          }
        })();
      }

      // POST-IMPORT VERIFICATION: Count records after import
      const postImportCounts = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*) FROM inspections) as inspections_count,
          (SELECT COUNT(*) FROM quality_tests) as quality_tests_count
      `);
      const postImportInspections = Number(postImportCounts.rows[0]?.inspections_count || 0);
      const postImportQualityTests = Number(postImportCounts.rows[0]?.quality_tests_count || 0);
      console.log(`OS630 Import: Post-import counts - Inspections: ${postImportInspections}, Quality Tests: ${postImportQualityTests}`);

      // Verification: UPSERT logic may insert or update, so compare net change
      const inspectionsChange = postImportInspections - preImportInspections;
      const testsChange = postImportQualityTests - preImportQualityTests;

      const verificationDetails = `Pre-import: ${preImportInspections} inspections, ${preImportQualityTests} tests. ` +
        `Post-import: ${postImportInspections} inspections, ${postImportQualityTests} tests. ` +
        `Net change: ${inspectionsChange >= 0 ? '+' : ''}${inspectionsChange} inspections, ${testsChange >= 0 ? '+' : ''}${testsChange} tests. ` +
        `Processed: ${inspections.length} inspection records, ${qualityTests.length} test records.`;

      console.log(`OS630 Import: Verification - ${verificationDetails}`);

      // Log import with verification data
      try {
        await storage.createImportHistory({
          fileName,
          fileType,
          recordsImported: inspectionsImported + testsImported,
          status: errors.length > 0 ? "partial" : "success",
          errorMessage: errors.length > 0 ? errors.join("; ") : null,
          importedBy: req.user?.username,
          preImportInspections,
          fileRowCount: rows.length,
          postImportInspections,
          verificationStatus: errors.length > 0 ? 'warning' : 'passed',
          verificationDetails,
        });
      } catch (histErr: any) {
        console.error("Error logging import history:", histErr.message);
      }

      console.log(`Import complete: ${inspectionsImported} inspections, ${testsImported} quality tests`);

      res.json({
        success: true,
        recordsImported: {
          inspections: inspectionsImported,
          qualityTests: testsImported,
          totalRecords: inspectionsImported + testsImported,
        },
        totalRows: rows.length,
        uniqueSkus: skus.size,
        verification: {
          status: errors.length > 0 ? 'warning' : 'passed',
          preImport: { inspections: preImportInspections, qualityTests: preImportQualityTests },
          postImport: { inspections: postImportInspections, qualityTests: postImportQualityTests },
          details: verificationDetails,
        },
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      console.error("Top-level import error:", error);

      try {
        await storage.createImportHistory({
          fileName: req.file?.originalname || "unknown",
          fileType: "excel",
          recordsImported: 0,
          status: "error",
          errorMessage: error.message,
          importedBy: req.user?.username,
        });
      } catch (histErr: any) {
        console.error("Could not log error to history:", histErr.message);
      }

      res.status(500).json({ error: error.message, details: error.stack });
    }
  });

  // OS 650 Shipment Data Import Endpoint
  app.post("/api/import/shipments", upload.single("file"), async (req: Express.Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileName = req.file.originalname;
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || req.file.mimetype.includes('spreadsheet');
      const fileType = isExcel ? "excel" : "csv";

      let rows: any[] = [];

      try {
        if (isExcel) {
          const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          rows = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });
        } else {
          const fileContent = req.file.buffer.toString("utf-8");
          const parseResult = Papa.parse(fileContent, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim(),
          });

          if (parseResult.errors.length > 0) {
            return res.status(400).json({
              error: "Failed to parse CSV",
              details: parseResult.errors,
            });
          }

          rows = parseResult.data;
        }
      } catch (parseError: any) {
        return res.status(400).json({
          error: "Failed to parse file",
          details: parseError.message,
        });
      }

      console.log(`Found ${rows.length} shipment records`);

      if (rows.length === 0) {
        return res.status(400).json({ error: "No data found in file" });
      }

      // STEP 0: PRE-IMPORT RECORD COUNTS FOR VERIFICATION
      const preImportCounts = await db.execute(sql`
        SELECT (SELECT COUNT(*) FROM shipments) as shipments_count
      `);
      const preImportShipments = Number(preImportCounts.rows[0]?.shipments_count || 0);
      console.log(`OS650 Import: Pre-import count - Shipments: ${preImportShipments}`);

      // DEBUG: Log the actual column names from the first row
      if (rows.length > 0) {
        const sampleRow = rows[0];
        console.log("OS 650 Column names found:", Object.keys(sampleRow).join(" | "));
        console.log("Sample row data:", JSON.stringify(sampleRow, null, 2).substring(0, 2000));
      }

      const errors: string[] = [];
      const warnings: string[] = [];
      const shipments: any[] = [];
      const missingPoNumbers = new Set<string>();

      // OPTIMIZATION: Collect all unique PO numbers first, then batch lookup
      console.log("Extracting unique PO numbers from import file...");
      const allPoNumbers = new Set<string>();
      for (const row of rows) {
        const poNumber = row["PO No"] || row["PO Number"] || row["po_number"] || row["PO"] || "";
        if (poNumber && String(poNumber).trim() !== "") {
          allPoNumbers.add(String(poNumber).trim());
        }
      }

      console.log(`Found ${allPoNumbers.size} unique PO numbers, fetching from database...`);
      const poMap = await storage.getPurchaseOrdersByNumbers(Array.from(allPoNumbers));
      console.log(`Matched ${poMap.size} PO numbers in database`);

      // Process each row - OS650 ENRICHMENT ONLY (does not create shipments, only enriches existing po_headers)
      // The primary shipment data (values, dates) comes from OS340; OS650 provides logistics details
      const enrichmentData: Map<string, any[]> = new Map(); // po_number -> array of enrichment records

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          // Extract PO number - required field
          const poNumber = row["PO No"] || row["PO Number"] || row["po_number"] || row["PO"] || "";

          if (!poNumber || String(poNumber).trim() === "") {
            errors.push(`Row ${i + 1}: Missing PO number - skipped`);
            continue;
          }

          const poNumberTrimmed = String(poNumber).trim();

          // Use cached PO lookup instead of individual database query
          const po = poMap.get(poNumberTrimmed);

          if (!po) {
            missingPoNumbers.add(poNumberTrimmed);
            continue; // Skip rows without matching PO - we only enrich existing POs
          }

          // Map column names - OS 650 uses newlines in headers like "HOD Status\r\n(based on Latest HOD)"
          // Log available columns on first row to debug PTS Number mapping
          if (i === 0) {
            const allColumns = Object.keys(row);
            const ptsColumns = allColumns.filter(col =>
              col.toLowerCase().includes('pts') ||
              col.toLowerCase().includes('pre-shipment') ||
              col.toLowerCase().includes('preshipment')
            );
            console.log("OS650 PTS-related columns found:", ptsColumns);
            console.log("All OS650 columns:", allColumns.slice(0, 50).join(" | ")); // First 50 columns
            console.log("OS650 columns count:", allColumns.length);
          }

          // Dynamically find PTS Number column - be very flexible with matching
          const allColumnKeys = Object.keys(row);
          const ptsNumberCol = allColumnKeys.find(col => {
            const cleanCol = col.replace(/[\r\n\s]+/g, ' ').trim().toLowerCase();
            // Match various formats: "PTS Number", "PTS No", "PTS#", "Pre-Shipment No", etc.
            return (
              cleanCol === 'pts number' ||
              cleanCol === 'pts no' ||
              cleanCol === 'pts#' ||
              (cleanCol.includes('pts') && (cleanCol.includes('number') || cleanCol.includes('no') || cleanCol.includes('#')))
            );
          });

          // DEBUG: Log PTS column detection on first row
          if (i === 0) {
            console.log("OS650 PTS column detection - found column:", ptsNumberCol);
            if (ptsNumberCol) {
              console.log("OS650 PTS sample value:", row[ptsNumberCol]);
            }
          }

          const ptsNumberValue = ptsNumberCol ? row[ptsNumberCol] : null;

          const hodStatusLatest = row["HOD Status\r\n(based on Latest HOD)"] || row["HOD Status (based on Latest HOD)"] || null;
          const hodStatusOriginal = row["HOD Status\r\n(based on Original HOD)"] || row["HOD Status (based on Original HOD)"] || null;
          const connorCommentsLatest = row["Connor Office Comments (based on Latest HOD)"] || null;
          const connorCommentsOriginal = row["Connor Office Comments (based on Original HOD)"] || null;
          const reasonLatest = row["Reason\r\n(based on Latest HOD)"] || row["Reason (based on Latest HOD)"] || null;
          const reasonOriginal = row["Reason\r\n(based on Original HOD)"] || row["Reason (based on Original HOD)"] || null;

          // Determine shipped status - check if "Shipped" appears in HOD status or Connor comments
          let hodStatus = hodStatusLatest || hodStatusOriginal || null;
          if (connorCommentsLatest && String(connorCommentsLatest).toLowerCase().includes('shipped')) {
            hodStatus = 'Shipped';
          }

          // Build enrichment record with OS650-only fields (per user specification)
          const enrichmentRecord: any = {
            poNumber: poNumberTrimmed,
            lineItemId: row["Line Item Id"] || row["line_item_id"] || null,
            style: row["Style"] || row["style"] || null,
            productDescription: row["Product Description"] || null,
            classField: row["Class"] || null,
            collaborationCollection: row["Collaboration/Collection"] || null,
            orderCollaboration: row["Order Collaboration"] || null,
            gtnLateReasonCode: row["GTN Late Reason Code"] || null,
            originalHod: parseExcelDate(row["Original HOD"]),
            originalEndShipDate: parseExcelDate(row["Original End Ship Date"]),
            hodStatusOriginal: hodStatusOriginal,
            reasonOriginal: reasonOriginal,
            connorCommentsOriginal: connorCommentsOriginal,
            latestShipDate: parseExcelDate(row["Latest Ship Date"]),
            latestHod: parseExcelDate(row["Latest HOD"]),
            cargoReadyDate: parseExcelDate(row["Cargo Ready Date"]),
            latestEndShipDate: parseExcelDate(row["Latest End Ship Date"]),
            hodStatusLatest: hodStatusLatest,
            reasonLatest: reasonLatest,
            connorCommentsLatest: connorCommentsLatest,
            logisticStatus: row["Logistic Status"] || null,
            ptsNumber: ptsNumberValue || null,
            loadType: row["Load Type"] || null,
            soFirstSubmissionDate: parseExcelDate(row["SO First Submission Date"]),
            ptsStatus: row["PTS Status by Freight Forwarder"] || null,
            soReleasedByCarrier: parseExcelDate(row["SO Released by Carrier (CY only)"]),
            cargoReceiptStatus: row["Cargo Receipt Status \r\n(CFS only)"] || row["Cargo Receipt Status (CFS only)"] || null,
            estimatedVesselEtd: parseExcelDate(row["Estimated Vessel ETD (ETD Origin)"] || row["Estimated Vessel ETD"]),
            resolutionForLateShipment: row["Resolution for LATE Shipment"] || null,
            hodStatus: hodStatus, // Derived field for convenience
          };

          // Group by PO number for batch processing
          if (!enrichmentData.has(poNumberTrimmed)) {
            enrichmentData.set(poNumberTrimmed, []);
          }
          enrichmentData.get(poNumberTrimmed)!.push(enrichmentRecord);

          shipments.push(enrichmentRecord);
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message} - skipped`);
          console.error(`Row ${i + 1} parsing error:`, err.message, "Row data:", JSON.stringify(row));
        }
      }

      // ENRICHMENT: Update existing shipment records (from OS340) with OS650 logistics data
      console.log("Enriching existing shipments with OS650 logistics data...");

      // Count how many rows have PTS numbers and ETD data before enrichment
      let rowsWithPts = 0;
      let rowsWithEtd = 0;
      let uniquePosWithPts = new Set<string>();
      let uniquePosWithEtd = new Set<string>();
      for (const [poNum, records] of enrichmentData) {
        for (const rec of records) {
          if (rec.ptsNumber) {
            rowsWithPts++;
            uniquePosWithPts.add(poNum);
          }
          if (rec.estimatedVesselEtd) {
            rowsWithEtd++;
            uniquePosWithEtd.add(poNum);
          }
        }
      }
      console.log(`OS650 PTS data found: ${rowsWithPts} rows with PTS numbers across ${uniquePosWithPts.size} unique POs`);
      console.log(`OS650 ETD data found: ${rowsWithEtd} rows with ETD dates across ${uniquePosWithEtd.size} unique POs`);

      let created = 0;
      let updated = 0;

      if (enrichmentData.size > 0) {
        console.log(`Enriching shipments for ${enrichmentData.size} PO numbers with OS 650 data`);

        try {
          const result = await storage.enrichShipmentsWithOS650(enrichmentData);
          created = result.inserted;
          updated = result.updated;
          console.log(`Shipments enriched: ${updated} updated, ${created} new records (for unmatched line items)`);
        } catch (enrichErr: any) {
          console.error("Error enriching shipments:", enrichErr.message);
          errors.push(`Shipment enrichment failed: ${enrichErr.message}`);
        }

        // Report PO numbers that were not found in database
        if (missingPoNumbers.size > 0) {
          const missingList = Array.from(missingPoNumbers).slice(0, 20).sort().join(", ");
          const additionalCount = missingPoNumbers.size > 20 ? ` (and ${missingPoNumbers.size - 20} more)` : '';
          warnings.push(`${missingPoNumbers.size} PO number(s) not found in database - skipped: ${missingList}${additionalCount}`);
          console.warn(`PO numbers not found (skipped):`, missingList);
        }
      }

      // POST-IMPORT VERIFICATION: Count records after import
      const postImportCounts = await db.execute(sql`
        SELECT (SELECT COUNT(*) FROM shipments) as shipments_count
      `);
      const postImportShipments = Number(postImportCounts.rows[0]?.shipments_count || 0);
      console.log(`OS650 Import: Post-import count - Shipments: ${postImportShipments}`);

      const shipmentsChange = postImportShipments - preImportShipments;
      const verificationDetails = `Pre-import: ${preImportShipments} shipments. ` +
        `Post-import: ${postImportShipments} shipments. ` +
        `Net change: ${shipmentsChange >= 0 ? '+' : ''}${shipmentsChange}. ` +
        `Enriched: ${updated} updated, ${created} new records.`;

      console.log(`OS650 Import: Verification - ${verificationDetails}`);

      // Log import with verification data (OS 650 shipment data)
      // For OS650, count updated records as "imported" since OS650 enriches existing shipments
      await storage.createImportHistory({
        fileName,
        fileType,
        recordsImported: updated + created,
        status: errors.length > 0 ? "partial" : "success",
        errorMessage: errors.length > 0 ? errors.slice(0, 10).join("; ") : null,
        importedBy: req.user?.username,
        preImportShipments,
        fileRowCount: rows.length,
        postImportShipments,
        verificationStatus: errors.length > 0 ? 'warning' : 'passed',
        verificationDetails,
      });

      res.json({
        success: true,
        recordsImported: updated + created,
        totalRows: rows.length,
        skippedRows: rows.length - shipments.length,
        verification: {
          status: errors.length > 0 ? 'warning' : 'passed',
          preImport: { shipments: preImportShipments },
          postImport: { shipments: postImportShipments },
          details: verificationDetails,
        },
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        poNumbersMissing: missingPoNumbers.size > 0 ? Array.from(missingPoNumbers) : undefined,
      });
    } catch (error: any) {
      await storage.createImportHistory({
        fileName: req.file?.originalname || "unknown",
        fileType: "excel",
        recordsImported: 0,
        status: "error",
        errorMessage: error.message,
        importedBy: req.user?.username,
      });

      res.status(500).json({ error: error.message });
    }
  });

  // Vendor-to-Staff Mapping CSV Import
  app.post("/api/import/vendor-staff-mapping", upload.single("file"), async (req: Express.Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileName = req.file.originalname;
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || req.file.mimetype.includes('spreadsheet');
      const fileType = isExcel ? "excel" : "csv";

      let rows: any[] = [];

      try {
        if (isExcel) {
          const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          rows = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: null });
        } else {
          const fileContent = req.file.buffer.toString("utf-8");
          const parseResult = Papa.parse(fileContent, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim(),
          });

          if (parseResult.errors.length > 0) {
            return res.status(400).json({
              error: "Failed to parse CSV",
              details: parseResult.errors,
            });
          }

          rows = parseResult.data as any[];
        }
      } catch (parseError: any) {
        return res.status(400).json({
          error: `Failed to parse ${fileType.toUpperCase()} file`,
          details: parseError.message,
        });
      }

      console.log(`Processing ${rows.length} vendor-to-staff mappings`);

      const errors: string[] = [];
      let vendorsUpdated = 0;
      let staffCreated = 0;
      const createdStaffNames = new Set<string>();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          const vendorName = (row["Vendor"] || row["vendor"] || "").trim();
          const merchandiserName = (row["Merchandiser"] || row["merchandiser"] || "").trim();
          const merchandisingManagerName = (row["MM"] || row["Merchandising Manager"] || row["merchandising_manager"] || "").trim();

          if (!vendorName || !merchandiserName || !merchandisingManagerName) {
            errors.push(`Row ${i + 1}: Missing required fields (Vendor, Merchandiser, or MM)`);
            continue;
          }

          let vendor = await storage.getVendorByName(vendorName);
          if (!vendor) {
            vendor = await storage.createVendor({
              name: vendorName,
              status: "active",
            });
          }

          const merchandiserExists = await storage.getStaffByName(merchandiserName);
          const mmExists = await storage.getStaffByName(merchandisingManagerName);

          const updated = await storage.updateVendorStaffAssignment(
            vendorName,
            merchandiserName,
            merchandisingManagerName
          );

          if (updated) {
            vendorsUpdated++;
            if (!merchandiserExists) {
              createdStaffNames.add(merchandiserName);
            }
            if (!mmExists) {
              createdStaffNames.add(merchandisingManagerName);
            }
          }
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      staffCreated = createdStaffNames.size;

      await storage.createImportHistory({
        fileName,
        fileType,
        recordsImported: vendorsUpdated,
        status: errors.length > 0 ? "partial" : "success",
        errorMessage: errors.length > 0 ? errors.join("; ") : null,
        importedBy: req.user?.username,
      });

      res.json({
        success: true,
        vendorsUpdated,
        staffCreated,
        totalRows: rows.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      await storage.createImportHistory({
        fileName: req.file?.originalname || "unknown",
        fileType: "csv",
        recordsImported: 0,
        status: "error",
        errorMessage: error.message,
        importedBy: req.user?.username,
      });

      res.status(500).json({ error: error.message });
    }
  });

  // Activity Log endpoints
  // Get logs for a specific entity (PO or SKU)
  app.get("/api/activity-logs/:entityType/:entityId", async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;

      if (!['po', 'sku'].includes(entityType)) {
        return res.status(400).json({ error: "Invalid entity type. Must be 'po' or 'sku'" });
      }

      const logs = await logService.getActivityLogsByEntity(entityType, entityId);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new activity log
  app.post("/api/activity-logs", async (req: Request, res: Response) => {
    try {
      const parsed = insertActivityLogSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: fromZodError(parsed.error).message });
      }

      const log = await logService.createActivityLog({
        ...parsed.data,
        createdBy: req.user?.username || parsed.data.createdBy,
      });
      res.status(201).json(log);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update an activity log
  app.patch("/api/activity-logs/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid log ID" });
      }

      const existing = await logService.getActivityLogById(id);
      if (!existing) {
        return res.status(404).json({ error: "Activity log not found" });
      }

      const updated = await logService.updateActivityLog(id, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mark an activity log as complete
  app.patch("/api/activity-logs/:id/complete", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid log ID" });
      }

      const existing = await logService.getActivityLogById(id);
      if (!existing) {
        return res.status(404).json({ error: "Activity log not found" });
      }

      const completed = await logService.markActivityLogComplete(id);
      res.json(completed);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get pending actions (for To-Do list)
  app.get("/api/my-tasks", async (req: Request, res: Response) => {
    try {
      const createdBy = req.query.createdBy as string | undefined;
      const tasks = await logService.getPendingActionsByUser(createdBy);
      res.json(tasks);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Todo Dismissals endpoints - track items checked off from To-Do list
  // Uses staffId if authenticated, falls back to session ID for anonymous users
  app.get("/api/todo-dismissals", async (req: Request, res: Response) => {
    try {
      // Use staffId if authenticated, otherwise use session ID as fallback
      const userId = req.session?.staffId || req.sessionID || 'default-user';
      const dismissals = await storage.getTodoDismissals(String(userId));
      res.json(dismissals);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/todo-dismissals", async (req: Request, res: Response) => {
    try {
      // Use staffId if authenticated, otherwise use session ID as fallback
      const userId = req.session?.staffId || req.sessionID || 'default-user';
      const { itemType, itemId } = req.body;
      if (!itemType || !itemId) {
        return res.status(400).json({ error: "itemType and itemId are required" });
      }
      await storage.dismissTodoItem(String(userId), itemType, itemId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/todo-dismissals", async (req: Request, res: Response) => {
    try {
      // Use staffId if authenticated, otherwise use session ID as fallback
      const userId = req.session?.staffId || req.sessionID || 'default-user';
      const { itemType, itemId } = req.body;
      if (!itemType || !itemId) {
        return res.status(400).json({ error: "itemType and itemId are required" });
      }
      await storage.restoreTodoItem(String(userId), itemType, itemId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PO Tasks endpoints
  // Get all tasks for a specific PO
  app.get("/api/purchase-orders/:poNumber/tasks", async (req: Request, res: Response) => {
    try {
      const { poNumber } = req.params;
      const includeCompleted = req.query.includeCompleted === 'true';
      const tasks = await storage.getPoTasksByPoNumber(poNumber, includeCompleted);
      res.json(tasks);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Generate tasks from PO data
  app.post("/api/purchase-orders/:poNumber/tasks/generate", async (req: Request, res: Response) => {
    try {
      const { poNumber } = req.params;
      const generatedTasks = await storage.generatePoTasksFromData(poNumber);
      res.json({ generated: generatedTasks.length, tasks: generatedTasks });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new task for a PO
  app.post("/api/purchase-orders/:poNumber/tasks", async (req: Request, res: Response) => {
    try {
      const { poNumber } = req.params;
      const task = await storage.createPoTask({
        ...req.body,
        poNumber,
        createdBy: req.user?.username || req.body.createdBy,
      });
      res.status(201).json(task);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific task
  app.get("/api/po-tasks/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid task ID" });
      }

      const task = await storage.getPoTaskById(id);
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json(task);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update a task
  app.patch("/api/po-tasks/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid task ID" });
      }

      const existing = await storage.getPoTaskById(id);
      if (!existing) {
        return res.status(404).json({ error: "Task not found" });
      }

      const updated = await storage.updatePoTask(id, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Complete a task
  app.patch("/api/po-tasks/:id/complete", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid task ID" });
      }

      const existing = await storage.getPoTaskById(id);
      if (!existing) {
        return res.status(404).json({ error: "Task not found" });
      }

      const completedBy = req.user?.username || req.body.completedBy || "Unknown";
      const completed = await storage.completePoTask(id, completedBy);
      res.json(completed);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Uncomplete a task (reopen)
  app.patch("/api/po-tasks/:id/uncomplete", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid task ID" });
      }

      const existing = await storage.getPoTaskById(id);
      if (!existing) {
        return res.status(404).json({ error: "Task not found" });
      }

      const reopened = await storage.uncompletePoTask(id);
      res.json(reopened);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a task
  app.delete("/api/po-tasks/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid task ID" });
      }

      const deleted = await storage.deletePoTask(id);
      if (!deleted) {
        return res.status(404).json({ error: "Task not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PO Timeline endpoints
  // Get timeline for a specific PO
  app.get("/api/purchase-orders/:id/timeline", async (req: Request, res: Response) => {
    try {
      const poId = parseInt(req.params.id);
      if (isNaN(poId)) {
        return res.status(400).json({ error: "Invalid PO ID" });
      }

      const result = await storage.getPoTimelineByPoId(poId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Initialize timeline from template
  app.post("/api/purchase-orders/:id/timeline", async (req: Request, res: Response) => {
    try {
      const poId = parseInt(req.params.id);
      if (isNaN(poId)) {
        return res.status(400).json({ error: "Invalid PO ID" });
      }

      const { templateId, poDate } = req.body;
      if (!templateId || !poDate) {
        return res.status(400).json({ error: "templateId and poDate are required" });
      }

      const milestones = await storage.initializePoTimelineFromTemplate(
        poId,
        parseInt(templateId),
        new Date(poDate)
      );
      res.status(201).json({ milestones });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Lock a PO timeline (locks planned dates)
  app.post("/api/purchase-orders/:id/timeline/lock", async (req: Request, res: Response) => {
    try {
      const poId = parseInt(req.params.id);
      if (isNaN(poId)) {
        return res.status(400).json({ error: "Invalid PO ID" });
      }

      const lockedBy = req.user?.username || req.body.lockedBy || "system";
      const timeline = await storage.lockPoTimeline(poId, lockedBy);

      if (!timeline) {
        return res.status(404).json({ error: "Timeline not found" });
      }

      res.json(timeline);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Sync actual dates from shipments/inspections
  app.post("/api/purchase-orders/:id/timeline/sync", async (req: Request, res: Response) => {
    try {
      const poId = parseInt(req.params.id);
      if (isNaN(poId)) {
        return res.status(400).json({ error: "Invalid PO ID" });
      }

      const updatedMilestones = await storage.syncPoTimelineActuals(poId);
      res.json({ updated: updatedMilestones });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update a timeline milestone (revised/actual dates)
  app.patch("/api/timeline-milestones/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid milestone ID" });
      }

      const { revisedDate, actualDate, actualSource, notes } = req.body;
      const data: any = {};

      if (revisedDate !== undefined) data.revisedDate = revisedDate ? new Date(revisedDate) : null;
      if (actualDate !== undefined) data.actualDate = actualDate ? new Date(actualDate) : null;
      if (actualSource !== undefined) data.actualSource = actualSource;
      if (notes !== undefined) data.notes = notes;

      const updated = await storage.updatePoTimelineMilestone(id, data);
      if (!updated) {
        return res.status(404).json({ error: "Milestone not found" });
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get at-risk timeline milestones across all POs (for To-Do list)
  app.get("/api/timeline-milestones/at-risk", async (req: Request, res: Response) => {
    try {
      const { client, daysThreshold } = req.query;
      const threshold = daysThreshold ? parseInt(daysThreshold as string) : 7;

      const atRiskMilestones = await storage.getAtRiskTimelineMilestones(
        client as string | undefined,
        threshold
      );
      res.json(atRiskMilestones);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get missing inspections for To-Do list (uses shared AT_RISK_THRESHOLDS)
  // Returns POs missing inline inspection (within 14 days of HOD) or final inspection (within 7 days of HOD)
  app.get("/api/missing-inspections", async (req: Request, res: Response) => {
    try {
      const { client, merchandiser } = req.query;

      const missingInspections = await storage.getMissingInspections({
        client: client as string | undefined,
        merchandiser: merchandiser as string | undefined,
      });
      res.json(missingInspections);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vendor Timeline Template endpoints
  // Get all templates for a vendor
  app.get("/api/vendors/:id/timeline-templates", async (req: Request, res: Response) => {
    try {
      const vendorId = parseInt(req.params.id);
      if (isNaN(vendorId)) {
        return res.status(400).json({ error: "Invalid vendor ID" });
      }

      const templates = await storage.getVendorTimelineTemplates(vendorId);
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific template with milestones
  app.get("/api/timeline-templates/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid template ID" });
      }

      const result = await storage.getVendorTimelineTemplateById(id);
      if (!result.template) {
        return res.status(404).json({ error: "Template not found" });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new template for a vendor
  app.post("/api/vendors/:id/timeline-templates", async (req: Request, res: Response) => {
    try {
      const vendorId = parseInt(req.params.id);
      if (isNaN(vendorId)) {
        return res.status(400).json({ error: "Invalid vendor ID" });
      }

      const { name, productCategory, milestones } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Template name is required" });
      }

      const template = await storage.createVendorTimelineTemplate({
        vendorId,
        name,
        productCategory: productCategory || null,
      });

      // Add milestones if provided
      if (milestones && Array.isArray(milestones) && milestones.length > 0) {
        await storage.setVendorTemplateMilestones(template.id, milestones);
      }

      // Return template with milestones
      const result = await storage.getVendorTimelineTemplateById(template.id);
      res.status(201).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update a template
  app.patch("/api/timeline-templates/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid template ID" });
      }

      const { name, productCategory, milestones } = req.body;

      // Update template info
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (productCategory !== undefined) updateData.productCategory = productCategory;

      if (Object.keys(updateData).length > 0) {
        await storage.updateVendorTimelineTemplate(id, updateData);
      }

      // Update milestones if provided
      if (milestones && Array.isArray(milestones)) {
        await storage.setVendorTemplateMilestones(id, milestones);
      }

      // Return updated template with milestones
      const result = await storage.getVendorTimelineTemplateById(id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a template (soft delete)
  app.delete("/api/timeline-templates/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid template ID" });
      }

      const success = await storage.deleteVendorTimelineTemplate(id);
      if (!success) {
        return res.status(404).json({ error: "Template not found" });
      }

      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== BULK TIMELINE GENERATION ==========

  // Get category timeline averages
  app.get("/api/category-timeline-averages", async (req: Request, res: Response) => {
    try {
      const averages = await storage.getCategoryTimelineAverages();
      res.json(averages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Recalculate category timeline averages from historical data
  app.post("/api/category-timeline-averages/recalculate", async (req: Request, res: Response) => {
    try {
      await storage.recalculateCategoryTimelineAverages();
      const averages = await storage.getCategoryTimelineAverages();
      res.json({
        success: true,
        message: "Category averages recalculated successfully",
        averages
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Bulk generate timelines for all POs without timelines
  app.post("/api/timelines/bulk-generate", async (req: Request, res: Response) => {
    try {
      const { dryRun = false, limit = 1000 } = req.body;

      // Get all POs without timelines
      const result = await storage.bulkGenerateTimelinesFromCategoryAverages(
        dryRun,
        parseInt(limit)
      );

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get timeline generation status/preview
  app.get("/api/timelines/bulk-generate/preview", async (req: Request, res: Response) => {
    try {
      const preview = await storage.getTimelineGenerationPreview();
      res.json(preview);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== AI SHIPPING ANALYST ==========

  // Initialize OpenAI client using Replit AI Integrations
  const openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });

  // Get shipping analytics summary for AI context
  app.get("/api/ai/analytics-summary", async (req: Request, res: Response) => {
    try {
      const summary = await storage.getShippingAnalyticsSummary();
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI Chat endpoint for shipping analysis
  app.post("/api/ai/chat", async (req: Request, res: Response) => {
    try {
      const { message, conversationHistory = [] } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: "Message is required" });
      }

      // Get current analytics data for context
      const analytics = await storage.getShippingAnalyticsSummary();

      // Build system prompt with current data context
      const systemPrompt = `You are an AI Shipping Analyst for a merchandising ERP system managing Crate & Barrel purchase orders. Your role is to analyze shipping data, identify trends, and provide actionable insights.

CURRENT DATA SNAPSHOT (as of today):
- Total Active POs: ${analytics.overview.totalActivePOs}
- Currently Late Orders: ${analytics.overview.totalLateOrders} (orders past cancel date that haven't shipped)
- Revised OTD: ${analytics.overview.trueOTD}% (Formula: On-Time Shipped ÷ (Total Shipped + Overdue Unshipped))
- Original OTD: ${analytics.overview.originalOTD}% (Formula: On-Time Shipped ÷ Total Shipped)
- Average Days Late: ${analytics.overview.avgDaysLate} days

LATE ORDERS BY SEVERITY:
${analytics.lateBySeverity.map(s => `- ${s.bucket}: ${s.count} orders (avg ${s.avgDaysLate} days late)`).join('\n')}

LATE ORDERS BY STATUS:
${analytics.lateByStatus.map(s => `- ${s.status}: ${s.count} orders (avg ${s.avgDaysLate} days late)`).join('\n')}

TOP VENDORS WITH LATE ORDERS:
${analytics.lateByVendor.slice(0, 5).map(v => `- ${v.vendor}: ${v.count} late orders (avg ${v.avgDaysLate} days late)`).join('\n')}

MONTH-OVER-MONTH TREND:
- This month: ${analytics.trends.thisMonthLate} late orders
- Last month: ${analytics.trends.lastMonthLate} late orders
- Trend: ${analytics.trends.trendDirection} (${analytics.trends.percentChange > 0 ? '+' : ''}${analytics.trends.percentChange}%)

TOP ISSUES IDENTIFIED:
${analytics.topIssues.map(i => `- ${i.issue}: ${i.description}`).join('\n')}

DEFINITIONS:
- "Late" = Orders past their revised cancel date that haven't shipped (excludes Closed/Shipped/Cancelled status)
- "Revised OTD" = On-Time Shipped ÷ (Total Shipped + Overdue Unshipped) - penalizes for unshipped overdue orders
- "Original OTD" = On-Time Shipped ÷ Total Shipped - only considers already-shipped orders
- Excludes: Zero-value orders, samples (SMP prefix), swatches (8X8 prefix)

GUIDELINES:
1. Provide specific, data-driven insights based on the numbers above
2. Identify patterns and root causes when possible
3. Suggest actionable recommendations
4. Be concise but thorough
5. If asked about specific vendors not in the top list, acknowledge the limitation
6. Always cite the specific metrics when making claims
7. Format numbers clearly and use bullet points for readability`;

      // Build messages array with conversation history
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory.map((msg: { role: string; content: string }) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content
        })),
        { role: "user", content: message }
      ];

      // Call OpenAI
      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      });

      const assistantMessage = response.choices[0]?.message?.content || "I apologize, but I couldn't generate a response. Please try again.";

      res.json({
        message: assistantMessage,
        analytics: {
          trueOTD: analytics.overview.trueOTD,
          lateOrders: analytics.overview.totalLateOrders,
          avgDaysLate: analytics.overview.avgDaysLate
        }
      });
    } catch (error: any) {
      console.error("AI Chat error:", error);
      res.status(500).json({ error: error.message || "Failed to process AI request" });
    }
  });

  // ========== ENHANCED AI DATA ANALYST ==========

  // Enhanced AI Analyst endpoint with comprehensive sourcing/shipping context
  app.post("/api/ai/analyst/chat", async (req: Request, res: Response) => {
    try {
      const { message, conversationHistory = [] } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: "Message is required" });
      }

      // Parse message for SKU mentions (5-7 digit numbers that look like SKUs)
      const skuMatches = message.match(/\b\d{5,7}\b/g);
      const mentionedSkus = skuMatches ? [...new Set(skuMatches)] : [];

      // Get comprehensive analytics data for context - run all queries in parallel
      const [analytics, vendorSummary, qualitySummary, detailedContext, trendContext, detailedPOs, projectionsData, skuData] = await Promise.all([
        storage.getShippingAnalyticsSummary(),
        storage.getVendorPerformanceSummary().catch((e) => { console.error('vendorSummary error:', e.message); return null; }),
        storage.getQualityInspectionSummary().catch((e) => { console.error('qualitySummary error:', e.message); return null; }),
        storage.getAIAnalystDataContext().catch((e) => { console.error('detailedContext error:', e.message); return null; }),
        storage.getAITrendContext().catch((e) => { console.error('trendContext error:', e.message); return null; }),
        storage.getDetailedPOsForAI().catch((e) => { console.error('detailedPOs error:', e.message); return null; }),
        storage.getProjectionsForAI().catch((e) => { console.error('projectionsData error:', e.message); return null; }),
        storage.getSKUDataForAI().catch((e) => { console.error('skuData error:', e.message); return null; })
      ]);

      // Fetch SKU-specific data if SKUs are mentioned
      let skuContextData = '';
      if (mentionedSkus.length > 0) {
        const skuDataPromises = mentionedSkus.slice(0, 3).map(async (skuCode) => {
          try {
            const [shippingStats, yoySales, skuSummary] = await Promise.all([
              storage.getSkuShippingStats(skuCode).catch(() => null),
              storage.getSkuYoYSales(skuCode).catch(() => []),
              storage.getSkuSummaryByCode(skuCode).catch(() => null)
            ]);

            if (!shippingStats && !skuSummary) {
              return null;
            }

            let skuInfo = `\n━━━━━━ SKU: ${skuCode} ━━━━━━\n`;

            if (skuSummary) {
              skuInfo += `Description: ${skuSummary.description || 'N/A'}\n`;
              skuInfo += `Style: ${skuSummary.style || 'N/A'}\n`;
              skuInfo += `Vendors: ${skuSummary.vendors?.join(', ') || 'N/A'}\n`;
              skuInfo += `Total Inspections: ${skuSummary.totalInspections || 0}\n`;
              skuInfo += `First-Time Pass Rate: ${skuSummary.firstTimePassRate || 0}%\n`;
            }

            if (shippingStats) {
              skuInfo += `First Shipped: ${shippingStats.firstShippedDate || 'N/A'}\n`;
              skuInfo += `Last Shipped: ${shippingStats.lastShippedDate || 'N/A'}\n`;
              skuInfo += `Total Sales to Date: $${(shippingStats.totalShippedSales || 0).toLocaleString()}\n`;
              skuInfo += `Total Shipped Orders: ${shippingStats.totalShippedOrders || 0}\n`;
              skuInfo += `Total Quantity Shipped: ${(shippingStats.totalShippedQuantity || 0).toLocaleString()}\n`;
            }

            if (yoySales && yoySales.length > 0) {
              skuInfo += `\nMonthly Sales History:\n`;
              // Group by year
              const byYear: Record<number, typeof yoySales> = {};
              yoySales.forEach((m: any) => {
                if (!byYear[m.year]) byYear[m.year] = [];
                byYear[m.year].push(m);
              });

              Object.keys(byYear).sort().reverse().forEach(year => {
                const yearData = byYear[parseInt(year)];
                const yearTotal = yearData.reduce((sum: number, m: any) => sum + (m.totalSales || 0), 0);
                skuInfo += `  ${year}: $${yearTotal.toLocaleString()} total\n`;
                yearData.forEach((m: any) => {
                  skuInfo += `    - ${m.monthName}: $${(m.totalSales || 0).toLocaleString()} (${m.orderCount || 0} orders)\n`;
                });
              });
            }

            return skuInfo;
          } catch (e) {
            console.error(`Error fetching data for SKU ${skuCode}:`, e);
            return null;
          }
        });

        const skuResults = await Promise.all(skuDataPromises);
        const validSkuData = skuResults.filter(Boolean);
        if (validSkuData.length > 0) {
          skuContextData = `
════════════════════════════════════════════════════
SKU-SPECIFIC DATA (User asked about these SKUs):
════════════════════════════════════════════════════
${validSkuData.join('\n')}
`;
        }
      }

      // Build data context with explicit availability markers
      const thisMonthLate = analytics.trends?.thisMonthLate;
      const lastMonthLate = analytics.trends?.lastMonthLate;
      const hasLastMonthData = lastMonthLate !== null && lastMonthLate !== undefined && lastMonthLate > 0;
      const hasTrendData = hasLastMonthData && thisMonthLate !== null && thisMonthLate !== undefined;

      // Format detailed PO data for the AI
      const formatCurrency = (val: number) => `$${val.toLocaleString()}`;

      const latePOsList = detailedContext?.latePOs?.length
        ? detailedContext.latePOs.map(po =>
          `  - ${po.poNumber}: ${po.vendor}, ${po.daysLate} days late, ${formatCurrency(po.value)}, Category: ${po.category}`
        ).join('\n')
        : 'No late POs found';

      const atRiskList = detailedContext?.atRiskPOs?.length
        ? detailedContext.atRiskPOs.map(po =>
          `  - ${po.poNumber}: ${po.vendor}, ${po.reason}, ${formatCurrency(po.value)}`
        ).join('\n')
        : 'No at-risk POs found';

      const upcomingList = detailedContext?.upcomingDeadlines?.length
        ? detailedContext.upcomingDeadlines.slice(0, 15).map(po =>
          `  - ${po.poNumber}: ${po.vendor}, due ${po.cancelDate} (${po.daysUntilDue} days), ${formatCurrency(po.value)}`
        ).join('\n')
        : 'No upcoming deadlines';

      const recentShipmentsList = detailedContext?.recentShipments?.length
        ? detailedContext.recentShipments.map(s =>
          `  - ${s.poNumber}: ${s.vendor}, ${s.status}, shipped ${s.shipDate}, ${formatCurrency(s.value)}`
        ).join('\n')
        : 'No recent shipments';

      const vendorPerfList = detailedContext?.vendorPerformance?.length
        ? detailedContext.vendorPerformance.map(v =>
          `  - ${v.vendor}: ${v.totalPOs} POs, ${v.latePOs} late, ${v.onTimeRate}% on-time, ${formatCurrency(v.totalValue)}`
        ).join('\n')
        : 'No vendor data';

      const categoryList = detailedContext?.categoryBreakdown?.length
        ? detailedContext.categoryBreakdown.map(c =>
          `  - ${c.category}: ${c.totalPOs} POs, ${c.latePOs} late, ${formatCurrency(c.totalValue)}`
        ).join('\n')
        : 'No category data';

      const failedInspList = detailedContext?.failedInspections?.length
        ? detailedContext.failedInspections.map(i =>
          `  - ${i.poNumber}: ${i.vendor}, SKU ${i.sku}, ${i.inspectionType} on ${i.inspectionDate}`
        ).join('\n')
        : 'No failed inspections in last 90 days';

      const staffPerfList = detailedContext?.staffPerformance?.length
        ? detailedContext.staffPerformance.map(s =>
          `  - ${s.name}: ${s.activePOs} active POs, ${s.latePOs} late, ${s.onTimeRate}% on-time`
        ).join('\n')
        : 'No staff performance data';

      // Format trend context for AI analysis
      const vendorTrendsList = trendContext?.vendorTrends?.length
        ? trendContext.vendorTrends.map(v =>
          `  - ${v.vendor}: Q1:${v.q1OTD}% Q2:${v.q2OTD}% Q3:${v.q3OTD}% Q4:${v.q4OTD}% YTD:${v.ytdOTD}% | Trend: ${v.trendDirection} | Risk: ${v.riskLevel}`
        ).join('\n')
        : 'No vendor trend data';

      const staffTrendsList = trendContext?.staffTrends?.length
        ? trendContext.staffTrends.map(s =>
          `  - ${s.name}: Q1:${s.q1OTD}% Q2:${s.q2OTD}% Q3:${s.q3OTD}% Q4:${s.q4OTD}% YTD:${s.ytdOTD}% | Trend: ${s.performanceTrend}`
        ).join('\n')
        : 'No staff trend data';

      const skuTrendsList = trendContext?.skuTrends?.slice(0, 10).length
        ? trendContext.skuTrends.slice(0, 10).map(s =>
          `  - ${s.skuCode} (${s.vendor}): Quality: ${s.qualityTrend} | Delivery: ${s.deliveryTrend} | Monthly orders: ${s.monthlyOrders.join(', ')}`
        ).join('\n')
        : 'No SKU trend data';

      const seasonalInfo = trendContext?.seasonalPatterns
        ? `Peak months: ${trendContext.seasonalPatterns.peakMonths.join(', ') || 'N/A'} | Slow months: ${trendContext.seasonalPatterns.slowMonths.join(', ') || 'N/A'} | Avg monthly volume: ${trendContext.seasonalPatterns.avgMonthlyVolume}`
        : 'No seasonal data';

      const yoyInfo = trendContext?.yearOverYearComparison
        ? `Rolling 12-Month OTD: ${trendContext.yearOverYearComparison.currentYearOTD}% | Previous 12-Month OTD: ${trendContext.yearOverYearComparison.previousYearOTD}% | Improvement: ${trendContext.yearOverYearComparison.otdImprovement > 0 ? '+' : ''}${trendContext.yearOverYearComparison.otdImprovement}% | Value Growth: ${trendContext.yearOverYearComparison.valueGrowth > 0 ? '+' : ''}${trendContext.yearOverYearComparison.valueGrowth}%`
        : 'No year-over-year data';

      // Format future POs for forecasting insights
      const futurePOsList = trendContext?.futurePOs?.length
        ? trendContext.futurePOs.map(f =>
          `  - ${f.month}: ${f.poCount} POs, ${formatCurrency(f.totalValue)}, ${f.vendorCount} vendors`
        ).join('\n')
        : 'No upcoming orders in the next 6 months';

      // Format detailed PO data for comprehensive analysis
      const detailedPOsSummary = detailedPOs?.summary
        ? `Summary: ${detailedPOs.summary.totalActivePOs} active POs (${formatCurrency(detailedPOs.summary.totalActiveValue)}) | Missing COP: ${detailedPOs.summary.missingCOP} | With shipments: ${detailedPOs.summary.withShipments} | Without shipments: ${detailedPOs.summary.withoutShipments}`
        : 'No detailed PO data available';

      const detailedPOsList = detailedPOs?.activePOs?.slice(0, 50).length
        ? detailedPOs.activePOs.slice(0, 50).map(po => {
          const status = po.daysLate ? `LATE ${po.daysLate}d` : po.daysUntilDue ? `Due in ${po.daysUntilDue}d` : po.shipmentStatus;
          const copInfo = po.copNumber ? `COP:${po.copNumber}` : 'NO COP';
          const shipInfo = po.shipments.length > 0 ? `${po.shipments.length} shipment(s)` : 'no shipments';
          return `  - ${po.poNumber}: ${po.vendor} | ${formatCurrency(po.totalValue)} | ${status} | ${copInfo} | ${shipInfo} | SKUs: ${po.skus.slice(0, 3).join(', ')}${po.skus.length > 3 ? '...' : ''}`;
        }).join('\n')
        : 'No detailed PO records available';

      // Format projections data for forecasting analysis
      const projectionsSummary = projectionsData?.accuracySummary
        ? `Total: ${projectionsData.accuracySummary.totalProjections} | Matched: ${projectionsData.accuracySummary.matched} | Unmatched: ${projectionsData.accuracySummary.unmatched} | Expired: ${projectionsData.accuracySummary.expired} | Avg Variance: ${projectionsData.accuracySummary.avgVariancePct}%`
        : 'No projection data available';

      const projectionsAccuracyInfo = projectionsData?.accuracySummary
        ? `Accurate (±10%): ${projectionsData.accuracySummary.accurateCount} | Over-ordered (>10%): ${projectionsData.accuracySummary.overOrderedCount} | Under-ordered (<-10%): ${projectionsData.accuracySummary.underOrderedCount}`
        : 'No accuracy metrics available';

      const vendorProjectionAccuracy = projectionsData?.vendorAccuracy?.length
        ? projectionsData.vendorAccuracy.slice(0, 10).map(v =>
          `  - ${v.vendorCode}: ${v.totalProjections} projections, ${v.matchedCount} matched, Avg variance: ${v.avgVariancePct}%`
        ).join('\n')
        : 'No vendor projection accuracy data';

      const recentProjectionsList = projectionsData?.currentProjections?.slice(0, 30).length
        ? projectionsData.currentProjections.slice(0, 30).map(p => {
          const variance = p.variancePct !== null ? `${p.variancePct > 0 ? '+' : ''}${p.variancePct}%` : 'N/A';
          const matchInfo = p.matchedPoNumber ? `→ ${p.matchedPoNumber}` : '';
          return `  - ${p.vendorCode}/${p.sku}: ${p.monthName} ${p.year} | ${formatCurrency(p.projectedValue)} | ${p.matchStatus} ${matchInfo} | Var: ${variance}`;
        }).join('\n')
        : 'No current projections available';

      // Format historical projection accuracy by month
      const historicalAccuracyList = projectionsData?.historicalAccuracy?.length
        ? projectionsData.historicalAccuracy.map(h =>
          `  - ${h.monthName} ${h.year}: ${h.totalProjections} projections, ${h.matchedCount} matched (${h.matchRatePct}%), ${h.unmatchedCount} unmatched, ${h.expiredCount} expired`
        ).join('\n')
        : 'No historical projection accuracy data available';

      // Format top selling SKUs data
      const topSkusSummary = skuData?.summary
        ? `Total Active SKUs: ${skuData.summary.totalActiveSKUs} | Total Value: ${formatCurrency(skuData.summary.totalSKUValue)} | Avg Order Value: ${formatCurrency(skuData.summary.avgSKUOrderValue)}`
        : 'No SKU summary available';

      const topSellingSkusList = skuData?.topSellingSkus?.slice(0, 20).length
        ? skuData.topSellingSkus.slice(0, 20).map((s, i) =>
          `  ${i + 1}. ${s.sku}${s.description ? ` (${s.description})` : ''}: ${s.vendor} | ${formatCurrency(s.totalValue)} | ${s.totalOrders} orders | ${s.shipmentCount} shipments`
        ).join('\n')
        : 'No top SKU data available';

      const skusByCategoryList = skuData?.skusByCategory?.length
        ? skuData.skusByCategory.map(c =>
          `  - ${c.category}: ${c.skuCount} SKUs, ${formatCurrency(c.totalValue)} total, ${formatCurrency(c.avgOrderValue)} avg`
        ).join('\n')
        : 'No SKU by category data';

      const skusByVendorList = skuData?.skusByVendor?.length
        ? skuData.skusByVendor.map(v =>
          `  - ${v.vendor}: ${v.skuCount} SKUs, ${v.totalOrders} orders, ${formatCurrency(v.totalValue)}`
        ).join('\n')
        : 'No SKU by vendor data';

      // Build comprehensive system prompt for sourcing/shipping specialist
      const systemPrompt = `You are an expert AI Data Analyst specializing in sourcing and shipping operations for a merchandising ERP system managing Crate & Barrel purchase orders.

CRITICAL ACCURACY RULES - YOU MUST FOLLOW THESE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. ONLY report numbers that are explicitly provided in the data below
2. NEVER invent, estimate, or guess any numbers
3. If data is marked as "UNAVAILABLE" or "N/A", say "Data not available" - do NOT make up values
4. If asked to compare time periods and one period's data is unavailable, clearly state that comparison cannot be made
5. When uncertain about any data point, acknowledge the uncertainty rather than guessing
6. Your accuracy is paramount - users rely on this data for business decisions

════════════════════════════════════════════════════
CURRENT OPERATIONS SUMMARY (verified as of now):
════════════════════════════════════════════════════
• Total Active POs: ${analytics.overview.totalActivePOs}
• Currently Late Orders: ${analytics.overview.totalLateOrders} (past cancel date, unshipped)
• Revised OTD: ${analytics.overview.trueOTD}% 
  Formula: On-Time Shipped ÷ (Total Shipped + Overdue Unshipped)
• Original OTD: ${analytics.overview.originalOTD}%
  Formula: On-Time Shipped ÷ Total Shipped
• Average Days Late: ${analytics.overview.avgDaysLate} days

════════════════════════════════════════════════════
DETAILED LATE POs (Top 25):
════════════════════════════════════════════════════
${latePOsList}

════════════════════════════════════════════════════
AT-RISK POs (Due within 14 days, not shipped):
════════════════════════════════════════════════════
${atRiskList}

════════════════════════════════════════════════════
UPCOMING DEADLINES (Next 30 days):
════════════════════════════════════════════════════
${upcomingList}

════════════════════════════════════════════════════
RECENT SHIPMENTS (Last 30 days):
════════════════════════════════════════════════════
${recentShipmentsList}

════════════════════════════════════════════════════
VENDOR PERFORMANCE (YTD):
════════════════════════════════════════════════════
${vendorPerfList}

════════════════════════════════════════════════════
CATEGORY BREAKDOWN (YTD):
════════════════════════════════════════════════════
${categoryList}

════════════════════════════════════════════════════
FAILED INSPECTIONS (Last 90 days):
════════════════════════════════════════════════════
${failedInspList}

════════════════════════════════════════════════════
STAFF/MERCHANDISER PERFORMANCE (YTD):
════════════════════════════════════════════════════
${staffPerfList}

════════════════════════════════════════════════════
LATE ORDERS BY SEVERITY:
════════════════════════════════════════════════════
${analytics.lateBySeverity.map(s => `• ${s.bucket}: ${s.count} orders (avg ${s.avgDaysLate} days late)`).join('\n')}

════════════════════════════════════════════════════
TOP VENDORS WITH LATE ORDERS:
════════════════════════════════════════════════════
${analytics.lateByVendor.slice(0, 10).map((v, i) => `${i + 1}. ${v.vendor}: ${v.count} late (avg ${v.avgDaysLate} days)`).join('\n')}

════════════════════════════════════════════════════
MONTH-OVER-MONTH TREND DATA:
════════════════════════════════════════════════════
• This Month Late Orders: ${thisMonthLate ?? 'UNAVAILABLE'}
• Last Month Late Orders: ${hasLastMonthData ? lastMonthLate : 'UNAVAILABLE - no historical data available'}
• Trend Analysis: ${hasTrendData ? `${analytics.trends.trendDirection} (${analytics.trends.percentChange > 0 ? '+' : ''}${analytics.trends.percentChange}%)` : 'CANNOT BE CALCULATED - insufficient historical data'}

NOTE: If "Last Month" shows as UNAVAILABLE, you MUST NOT make comparisons or calculate changes. Simply report current month data only.

════════════════════════════════════════════════════
KEY ISSUES IDENTIFIED:
════════════════════════════════════════════════════
${analytics.topIssues.map(i => `• ${i.issue}: ${i.description}`).join('\n')}

${vendorSummary && vendorSummary.totalVendors !== undefined ? `
════════════════════════════════════════════════════
VENDOR OVERVIEW:
════════════════════════════════════════════════════
• Total Active Vendors: ${vendorSummary.totalVendors}
• Vendors with Late Orders: ${vendorSummary.vendorsWithLateOrders}
` : ''}
${qualitySummary && qualitySummary.pendingInspections !== undefined ? `
════════════════════════════════════════════════════
QUALITY METRICS:
════════════════════════════════════════════════════
• Pending Inspections: ${qualitySummary.pendingInspections}
• Failed Inspections: ${qualitySummary.failedInspections}
` : ''}

════════════════════════════════════════════════════
ROLLING 12-MONTH TREND ANALYSIS:
════════════════════════════════════════════════════
(All trend data below uses a rolling 12-month window for analysis, comparing recent quarters against each other)

VENDOR QUARTERLY PERFORMANCE TRENDS:
${vendorTrendsList}

STAFF/MERCHANDISER QUARTERLY TRENDS:
${staffTrendsList}

SKU QUALITY & DELIVERY TRENDS (Top 10):
${skuTrendsList}

SEASONAL PATTERNS:
${seasonalInfo}

ROLLING 12-MONTH vs PREVIOUS 12-MONTH COMPARISON:
${yoyInfo}

════════════════════════════════════════════════════
FORWARD-LOOKING ORDERS (Next 6 Months):
════════════════════════════════════════════════════
${futurePOsList}

NOTE: Use this data for forecasting workload, vendor capacity planning, and identifying upcoming busy periods.

════════════════════════════════════════════════════
DETAILED PURCHASE ORDER DATA (OS340 Info):
════════════════════════════════════════════════════
${detailedPOsSummary}

Active POs with Full Details (top 50):
${detailedPOsList}

Each PO includes: PO#, Vendor, Value, Status/Days Late/Due, COP Number, Shipment Count, SKUs

════════════════════════════════════════════════════
PROJECTIONS & FORECAST ACCURACY DATA:
════════════════════════════════════════════════════
${projectionsSummary}
${projectionsAccuracyInfo}

Vendor Projection Accuracy:
${vendorProjectionAccuracy}

Historical Projection Accuracy by Month (Last 12 Months):
${historicalAccuracyList}

Recent Projections (Vendor/SKU level):
${recentProjectionsList}

Use this data to analyze:
- Forecast accuracy by vendor (which vendors consistently over/under project)
- Projection-to-order matching status over time (e.g., "what % of projections from 3 months ago now have orders")
- Identify unmatched or expired projections for follow-up
- Capacity planning based on projected vs actual volumes

════════════════════════════════════════════════════
SKU SALES & SHIPPING DATA (Last 24 Months):
════════════════════════════════════════════════════
${topSkusSummary}

Top Selling SKUs (by total value):
${topSellingSkusList}

SKUs by Category:
${skusByCategoryList}

SKUs by Vendor:
${skusByVendorList}

Use this data to analyze:
- Top selling products and shipping frequency
- Category performance and vendor SKU concentration
- SKU order trends and value distribution

════════════════════════════════════════════════════
DEFINITIONS:
════════════════════════════════════════════════════
• "Late" = Orders past revised cancel date that haven't shipped (excludes Closed/Shipped/Cancelled)
• "Revised OTD" = Penalizes for unshipped overdue orders (stricter metric)
• "At Risk" = Orders flagged for failed inspections, inspection timing issues, or material delays
• Excludes: Zero-value orders, samples (SMP prefix), swatches (8X8 prefix), franchise POs (089 prefix)

NOTE: Detailed PO data uses SIMPLIFIED status logic:
- "Late" = past cancel date + not shipped (uses cancel dates only)
- Does NOT include: HOD timing criteria, inspection booking status, PTS submission deadlines, or material delays
- For full operational At-Risk detection, refer to the Operations Dashboard which applies all criteria

${skuContextData}

════════════════════════════════════════════════════
ADVANCED ANALYTICS CAPABILITIES:
════════════════════════════════════════════════════
You can help users with:

1. VENDOR RISK SCORING
   - Composite risk scores (0-100) based on OTD, quality, trends, and concentration
   - Risk levels: Critical, High, Medium, Low
   - Specific recommendations for each vendor

2. LATE ORDER PREDICTION
   - Predict which active POs are likely to be late
   - Risk probability scores with contributing factors
   - Actionable recommendations (expedite, call vendor, etc.)

3. QUALITY PATTERN ANALYSIS
   - Identify recurring quality issues by vendor and SKU
   - Failure rate trends (improving/stable/worsening)
   - Repeat offender identification

4. DEMAND FORECASTING
   - Predict order volumes by category and month
   - Seasonal patterns (peak vs slow months)
   - Growth trends by product category

5. WORKLOAD BALANCING
   - Analyze merchandiser capacity (overloaded/optimal/underutilized)
   - Suggest vendor-to-staff reallocation opportunities
   - Workload variance metrics

6. EXECUTIVE SUMMARIES
   - Weekly or monthly performance briefings
   - Key highlights and concerns
   - Comparison to previous period
   - Top/bottom performing vendors

7. WHAT-IF SCENARIO MODELING
   - "What if we drop Vendor X?" - Impact analysis
   - Revenue, order count, and OTD impact projections
   - Risks and benefits assessment

8. CUSTOM REPORT GENERATION
   - Generate structured reports on any topic
   - Use tables and formatted lists for clarity
   - Export-ready data summaries

════════════════════════════════════════════════════
RESPONSE GUIDELINES:
════════════════════════════════════════════════════
1. ONLY use numbers explicitly provided above - never fabricate data
2. You now have access to SPECIFIC PO numbers, vendor names, and values - use them in your analysis
3. When asked about specific vendors or POs, reference the actual data provided
4. Provide actionable insights with specific numbers and PO references
5. Use clear formatting with bullet points and sections
6. When asked for reports, structure data in clear tables/lists
7. If data for comparison is missing, state: "Historical data for comparison is not available"
8. Be conservative - it's better to say "I don't have that data" than to guess
9. When identifying issues, cite specific POs and vendors as examples
10. When asked for executive summaries, weekly/monthly reports, or what-if scenarios, mention you can provide detailed analysis
11. For vendor risk or late prediction questions, offer to provide detailed risk assessments
12. For workload questions, offer to analyze staff capacity and suggest rebalancing`;

      // Build messages array with conversation history
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory.map((msg: { role: string; content: string }) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content
        })),
        { role: "user", content: message }
      ];

      // Call OpenAI with parameters optimized for accuracy over creativity
      // Using lower temperature (0.3) to reduce hallucination and increase factual consistency
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.3,
        max_tokens: 2000,
      });

      const assistantMessage = response.choices[0]?.message?.content || "I apologize, but I couldn't generate a response. Please try again.";

      // Parse for structured report data if applicable
      let reportData = null;

      // Check if response contains table-like data
      if (assistantMessage.includes('|') && assistantMessage.includes('---')) {
        reportData = {
          type: "table" as const,
          title: "Analysis Report",
          data: [],
          columns: []
        };
      }

      res.json({
        message: assistantMessage,
        reportData,
        analytics: {
          trueOTD: analytics.overview.trueOTD,
          lateOrders: analytics.overview.totalLateOrders,
          avgDaysLate: analytics.overview.avgDaysLate
        }
      });
    } catch (error: any) {
      console.error("AI Analyst Chat error:", error);
      res.status(500).json({ error: error.message || "Failed to process AI request" });
    }
  });

  // SQL-Powered AI Analyst with Function Calling
  // This endpoint allows the AI to generate and execute SQL queries to answer any question about the data
  // SECURITY: Requires authentication and full access (admin/manager level)
  app.post("/api/ai/analyst/sql-chat", isAuthenticated, requireFullAccess, async (req: Request, res: Response) => {
    try {
      const { message, conversationHistory = [] } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: "Message is required" });
      }

      // Define the SQL execution tool for OpenAI
      const tools: OpenAI.ChatCompletionTool[] = [
        {
          type: "function",
          function: {
            name: "execute_sql_query",
            description: "Execute a read-only SQL query against the ERP database to answer user questions. Use this to explore data, find patterns, answer ad-hoc questions, and generate reports. The query MUST be a SELECT statement only.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The SQL SELECT query to execute. Must be read-only (SELECT only). Use proper PostgreSQL syntax. All monetary values are in CENTS."
                },
                reasoning: {
                  type: "string",
                  description: "Brief explanation of why this query will answer the user's question"
                }
              },
              required: ["query", "reasoning"]
            }
          }
        }
      ];

      // Build system prompt with schema documentation
      const systemPrompt = `You are an expert AI Data Analyst with DIRECT DATABASE ACCESS for a merchandising ERP system managing Crate & Barrel purchase orders.

YOUR SUPERPOWER: You can write and execute SQL queries to answer ANY question about the data!

${AI_SCHEMA_DOCUMENTATION}

QUERY WRITING GUIDELINES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. All monetary values are stored in CENTS - divide by 100 for dollars in your results
2. Use snake_case for column names (e.g., po_number, total_value, actual_sailing_date)
3. Common date columns: po_date, original_cancel_date, revised_cancel_date, delivery_to_consolidator, actual_sailing_date
4. For OTD calculations, exclude franchise POs (po_number LIKE '089%') and 8X8 programs (program_description LIKE '8X8 %')
5. Use COALESCE for nullable date comparisons
6. Limit results to avoid overwhelming output (LIMIT 50-100 for lists)

WORKFLOW:
1. Understand what the user is asking
2. Formulate a SQL query to answer it
3. Execute the query using the execute_sql_query function
4. Analyze the results and provide insights
5. Offer follow-up analysis if relevant

EXAMPLE QUERIES:
- "Show me late POs": SELECT po_number, vendor, total_value/100 as value_usd, revised_cancel_date FROM po_headers WHERE revised_cancel_date < CURRENT_DATE AND shipment_status != 'Shipped' LIMIT 50
- "Vendor OTD": Use joins between po_headers and shipments, compare delivery_to_consolidator to cancel dates
- "Top SKUs by value": Join po_line_items with po_headers, aggregate by SKU

RESPONSE GUIDELINES:
1. When asked a data question, ALWAYS try to write a SQL query first
2. Explain what query you're running and why
3. Present results in clear, formatted tables or summaries
4. Highlight key insights and patterns
5. Suggest related questions the user might want to explore
6. If a query fails, explain the error and try an alternative approach`;

      // Build messages for OpenAI
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...conversationHistory.slice(-10).map((msg: { role: string; content: string }) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content
        })),
        { role: "user", content: message }
      ];

      // First API call - let the AI decide if it needs to run a query
      let response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 2000,
      });

      let assistantMessage = response.choices[0]?.message;
      let queryResults: any[] = [];
      let finalResponse = "";

      // Check if the AI wants to execute a SQL query
      while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolCall = assistantMessage.tool_calls[0];

        if (toolCall.function.name === "execute_sql_query") {
          let args;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            args = { query: "", reasoning: "Failed to parse arguments" };
          }

          const { query, reasoning } = args;

          console.log(`AI SQL Query: ${query}`);
          console.log(`Reasoning: ${reasoning}`);

          // Execute the query safely
          const result = await executeSafeQuery(query);
          const formattedResult = formatQueryResults(result);

          // Store query results for the response
          queryResults.push({
            query,
            reasoning,
            success: result.success,
            rowCount: result.rowCount,
            executionTimeMs: result.executionTimeMs,
            data: result.data?.slice(0, 100), // Cap at 100 rows for response
            error: result.error
          });

          // Add the tool response to messages
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: assistantMessage.tool_calls
          } as any);

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: formattedResult
          });

          // Get the AI's analysis of the results
          response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0.2,
            max_tokens: 2000,
          });

          assistantMessage = response.choices[0]?.message;
        } else {
          break;
        }

        // Safety limit - max 5 queries per request
        if (queryResults.length >= 5) {
          break;
        }
      }

      // Get the final text response
      finalResponse = assistantMessage?.content || "I apologize, but I couldn't generate a response. Please try again.";

      res.json({
        message: finalResponse,
        queries: queryResults,
        analytics: {
          queriesExecuted: queryResults.length,
          totalRows: queryResults.reduce((sum, q) => sum + (q.rowCount || 0), 0)
        }
      });
    } catch (error: any) {
      console.error("AI SQL Chat error:", error);
      res.status(500).json({ error: error.message || "Failed to process AI request" });
    }
  });

  // Export conversation as Excel
  app.post("/api/ai/analyst/export/excel", async (req: Request, res: Response) => {
    try {
      const { messages, reportData } = req.body;

      const workbook = XLSX.utils.book_new();

      // Helper function to safely format timestamp
      const formatTimestamp = (timestamp: any): string => {
        if (!timestamp) return "";
        try {
          const date = new Date(timestamp);
          return isNaN(date.getTime()) ? "" : date.toLocaleString();
        } catch {
          return "";
        }
      };

      // Create conversation sheet
      const conversationData = messages?.map((msg: any, index: number) => ({
        "#": index + 1,
        "Role": msg.role === "user" ? "You" : "AI Analyst",
        "Message": msg.content || "",
        "Timestamp": formatTimestamp(msg.timestamp)
      })) || [];

      const conversationSheet = XLSX.utils.json_to_sheet(conversationData);
      XLSX.utils.book_append_sheet(workbook, conversationSheet, "Conversation");

      // Add report data sheet if available
      if (reportData?.data && reportData.data.length > 0) {
        const reportSheet = XLSX.utils.json_to_sheet(reportData.data);
        XLSX.utils.book_append_sheet(workbook, reportSheet, reportData.title || "Report");
      }

      // Add analytics summary sheet
      const analytics = await storage.getShippingAnalyticsSummary();
      const summaryData = [
        { Metric: "Total Active POs", Value: analytics.overview.totalActivePOs },
        { Metric: "Late Orders", Value: analytics.overview.totalLateOrders },
        { Metric: "Revised OTD %", Value: analytics.overview.trueOTD },
        { Metric: "Original OTD %", Value: analytics.overview.originalOTD },
        { Metric: "Avg Days Late", Value: analytics.overview.avgDaysLate },
        { Metric: "This Month Late", Value: analytics.trends.thisMonthLate },
        { Metric: "Last Month Late", Value: analytics.trends.lastMonthLate },
        { Metric: "Trend", Value: `${analytics.trends.trendDirection} (${analytics.trends.percentChange}%)` }
      ];
      const summarySheet = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Analytics Summary");

      // Write to buffer
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=ai-analysis-${new Date().toISOString().split('T')[0]}.xlsx`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Excel export error:", error);
      res.status(500).json({ error: error.message || "Failed to export Excel" });
    }
  });

  // Export conversation as PDF (simple text format)
  app.post("/api/ai/analyst/export/pdf", async (req: Request, res: Response) => {
    try {
      const { messages, reportData } = req.body;

      // Helper function to safely format timestamp
      const formatTimestamp = (timestamp: any): string => {
        if (!timestamp) return "";
        try {
          const date = new Date(timestamp);
          return isNaN(date.getTime()) ? "" : date.toLocaleString();
        } catch {
          return "";
        }
      };

      // Build PDF-like content (plain text for now, can be enhanced with a PDF library)
      let content = "AI DATA ANALYST REPORT\n";
      content += "=".repeat(50) + "\n\n";
      content += `Generated: ${new Date().toLocaleString()}\n\n`;

      // Add analytics summary
      const analytics = await storage.getShippingAnalyticsSummary();
      content += "CURRENT METRICS SNAPSHOT\n";
      content += "-".repeat(30) + "\n";
      content += `Total Active POs: ${analytics.overview.totalActivePOs}\n`;
      content += `Late Orders: ${analytics.overview.totalLateOrders}\n`;
      content += `Revised OTD: ${analytics.overview.trueOTD}%\n`;
      content += `Original OTD: ${analytics.overview.originalOTD}%\n`;
      content += `Avg Days Late: ${analytics.overview.avgDaysLate}\n\n`;

      // Add conversation
      content += "CONVERSATION TRANSCRIPT\n";
      content += "-".repeat(30) + "\n\n";

      messages?.forEach((msg: any, index: number) => {
        const role = msg.role === "user" ? "YOU" : "AI ANALYST";
        const timestamp = formatTimestamp(msg.timestamp);
        content += `[${role}] ${timestamp}\n`;
        content += (msg.content || "") + "\n\n";
      });

      // Return as text file (PDF generation would require additional library)
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename=ai-analysis-${new Date().toISOString().split('T')[0]}.txt`);
      res.send(content);
    } catch (error: any) {
      console.error("PDF export error:", error);
      res.status(500).json({ error: error.message || "Failed to export PDF" });
    }
  });

  // ========== ADVANCED AI ANALYTICS ENDPOINTS ==========

  // Vendor Risk Scoring - get composite risk scores for all vendors
  app.get("/api/ai/analytics/vendor-risk", async (req: Request, res: Response) => {
    try {
      const data = await storage.getVendorRiskScoring();
      res.json(data);
    } catch (error: any) {
      console.error("Vendor risk scoring error:", error);
      res.status(500).json({ error: error.message || "Failed to get vendor risk scores" });
    }
  });

  // Late Order Prediction - predict which POs are likely to be late
  app.get("/api/ai/analytics/late-prediction", async (req: Request, res: Response) => {
    try {
      const data = await storage.getLateOrderPrediction();
      res.json(data);
    } catch (error: any) {
      console.error("Late order prediction error:", error);
      res.status(500).json({ error: error.message || "Failed to get late order predictions" });
    }
  });

  // Quality Pattern Analysis - identify recurring quality issues
  app.get("/api/ai/analytics/quality-patterns", async (req: Request, res: Response) => {
    try {
      const data = await storage.getQualityPatternAnalysis();
      res.json(data);
    } catch (error: any) {
      console.error("Quality pattern analysis error:", error);
      res.status(500).json({ error: error.message || "Failed to get quality patterns" });
    }
  });

  // Demand Forecasting - predict order volumes by category and season
  app.get("/api/ai/analytics/demand-forecast", async (req: Request, res: Response) => {
    try {
      const data = await storage.getDemandForecast();
      res.json(data);
    } catch (error: any) {
      console.error("Demand forecast error:", error);
      res.status(500).json({ error: error.message || "Failed to get demand forecast" });
    }
  });

  // Workload Balancing - analyze merchandiser capacity and suggest rebalancing
  app.get("/api/ai/analytics/workload-balance", async (req: Request, res: Response) => {
    try {
      const data = await storage.getWorkloadBalancing();
      res.json(data);
    } catch (error: any) {
      console.error("Workload balancing error:", error);
      res.status(500).json({ error: error.message || "Failed to get workload balancing" });
    }
  });

  // Executive Summary - generate weekly or monthly briefings
  app.get("/api/ai/analytics/executive-summary", async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as 'weekly' | 'monthly') || 'weekly';
      const data = await storage.getExecutiveSummary(period);
      res.json(data);
    } catch (error: any) {
      console.error("Executive summary error:", error);
      res.status(500).json({ error: error.message || "Failed to get executive summary" });
    }
  });

  // What-If Scenario Modeling - simulate impact of changes
  app.post("/api/ai/analytics/what-if", async (req: Request, res: Response) => {
    try {
      const { scenarioType, params } = req.body;
      if (!scenarioType) {
        return res.status(400).json({ error: "scenarioType is required" });
      }
      const data = await storage.getWhatIfScenario(scenarioType, params || {});
      res.json(data);
    } catch (error: any) {
      console.error("What-if scenario error:", error);
      res.status(500).json({ error: error.message || "Failed to process what-if scenario" });
    }
  });

  // Vendor Capacity Tracking Routes
  app.get("/api/vendor-capacity", async (req: Express.Request, res: Response) => {
    try {
      const { vendorCode, year, client } = req.query;
      const filters: { vendorCode?: string; year?: number; client?: string } = {};

      if (vendorCode && typeof vendorCode === 'string') filters.vendorCode = vendorCode;
      if (year) filters.year = parseInt(year as string);
      if (client && typeof client === 'string') filters.client = client;

      const data = await storage.getVendorCapacityData(filters);
      res.json(data);
    } catch (error: any) {
      console.error("Error fetching vendor capacity data:", error);
      res.status(500).json({ error: error.message || "Failed to fetch vendor capacity data" });
    }
  });

  app.get("/api/vendor-capacity/vendor/:vendorCode", async (req: Express.Request, res: Response) => {
    try {
      const { vendorCode } = req.params;
      const { year, clientId } = req.query;
      const targetYear = year ? parseInt(year as string) : new Date().getFullYear();
      const filterClientId = clientId ? parseInt(clientId as string) : null;

      // Auto-trigger expiration check to mark past-window projections as 'expired'
      // This ensures expired projections are properly marked before returning capacity data
      await storage.checkAndExpireProjections();

      // Try to find vendor in vendors table for better matching
      let vendorName = vendorCode;
      const vendorResult = await db.execute(sql`
        SELECT name FROM vendors 
        WHERE LOWER(name) LIKE ${vendorCode.toLowerCase() + '%'}
        OR LOWER(name) LIKE ${'%' + vendorCode.toLowerCase() + '%'}
        LIMIT 1
      `);
      if (vendorResult.rows.length > 0) {
        vendorName = vendorResult.rows[0].name as string;
      }

      // Get Reserved Capacity from SS551 (match by vendor_code OR vendor_name)
      const ss551Result = await db.execute(sql`
        SELECT * FROM vendor_capacity_data
        WHERE (
          LOWER(vendor_code) = ${vendorCode.toLowerCase()}
          OR LOWER(vendor_name) LIKE ${vendorCode.toLowerCase() + '%'}
          OR LOWER(vendor_name) LIKE ${'%' + vendorCode.toLowerCase() + '%'}
          OR LOWER(vendor_name) = ${vendorName.toLowerCase()}
        )
        AND year = ${targetYear}
        ORDER BY month, client
      `);

      // Convert to expected format
      // IMPORTANT: SS551 stores values in DOLLARS, not cents
      // Multiply by 100 to convert to cents for consistency with OS340/FURNITURE data
      const ss551Data: any[] = ss551Result.rows.map(row => ({
        id: row.id,
        vendorCode: row.vendor_code,
        vendorName: row.vendor_name,
        office: row.office,
        client: row.client,
        year: row.year,
        month: row.month,
        totalShipment: (parseInt(row.total_shipment as string) || 0) * 100, // dollars to cents
        totalProjection: (parseInt(row.total_projection as string) || 0) * 100, // dollars to cents
        reservedCapacity: (parseInt(row.reserved_capacity as string) || 0) * 100 // dollars to cents
      }));

      // Update vendorName from SS551 if available
      if (ss551Data.length > 0 && ss551Data[0].vendorName) {
        vendorName = ss551Data[0].vendorName;
      }

      // Get Orders on Hand from OS340 (unshipped orders by brand/month)
      // Uses GREATEST of original_cancel_date and revised_cancel_date (whichever is later)
      const ordersOnHandResult = await db.execute(sql`
        WITH orders_with_brand AS (
          SELECT 
            CASE 
              WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
              WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
              ELSE 'CB'
            END as client,
            EXTRACT(MONTH FROM GREATEST(
              COALESCE(ph.original_cancel_date, ph.revised_cancel_date),
              COALESCE(ph.revised_cancel_date, ph.original_cancel_date)
            ))::int as month,
            ph.total_value
          FROM po_headers ph
          WHERE (
            LOWER(ph.vendor) LIKE ${vendorCode.toLowerCase() + '%'}
            OR LOWER(ph.vendor) = ${vendorName.toLowerCase()}
            OR LOWER(SPLIT_PART(ph.vendor, ' ', 1)) = ${vendorCode.toLowerCase()}
            OR LOWER(SPLIT_PART(ph.vendor, ',', 1)) = ${vendorCode.toLowerCase()}
          )
            AND (ph.shipment_status IS NULL OR ph.shipment_status NOT IN ('On-Time', 'Late'))
            AND EXTRACT(YEAR FROM GREATEST(
              COALESCE(ph.original_cancel_date, ph.revised_cancel_date),
              COALESCE(ph.revised_cancel_date, ph.original_cancel_date)
            )) = ${targetYear}
            AND ph.total_value > 0
            AND ph.po_number NOT LIKE 'SMP%'
            AND ph.po_number NOT LIKE '8X8%'
        )
        SELECT client, month, SUM(total_value) as total_shipment
        FROM orders_with_brand
        GROUP BY client, month
        ORDER BY month, client
      `);

      // Get SHIPPED Orders from OS340 (historical shipped orders by brand/month)
      // Uses GREATEST of original_cancel_date and revised_cancel_date (whichever is later)
      const shippedOrdersResult = await db.execute(sql`
        WITH shipped_orders AS (
          SELECT 
            CASE 
              WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
              WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
              ELSE 'CB'
            END as client,
            EXTRACT(MONTH FROM GREATEST(
              COALESCE(ph.original_cancel_date, ph.revised_cancel_date),
              COALESCE(ph.revised_cancel_date, ph.original_cancel_date)
            ))::int as month,
            ph.total_value
          FROM po_headers ph
          WHERE (
            LOWER(ph.vendor) LIKE ${vendorCode.toLowerCase() + '%'}
            OR LOWER(ph.vendor) = ${vendorName.toLowerCase()}
            OR LOWER(SPLIT_PART(ph.vendor, ' ', 1)) = ${vendorCode.toLowerCase()}
            OR LOWER(SPLIT_PART(ph.vendor, ',', 1)) = ${vendorCode.toLowerCase()}
          )
            AND ph.shipment_status IN ('On-Time', 'Late')
            AND EXTRACT(YEAR FROM GREATEST(
              COALESCE(ph.original_cancel_date, ph.revised_cancel_date),
              COALESCE(ph.revised_cancel_date, ph.original_cancel_date)
            )) = ${targetYear}
            AND ph.total_value > 0
            AND ph.po_number NOT LIKE 'SMP%'
            AND ph.po_number NOT LIKE '8X8%'
        )
        SELECT client, month, SUM(total_value) as shipped_value
        FROM shipped_orders
        GROUP BY client, month
        ORDER BY month, client
      `);

      // Get Projections from active_projections (by brand/month)
      // IMPORTANT: Show only unmatched projection values:
      // - matched: Fully converted to POs - exclude entirely (counted in Orders on Hand)
      // - partial: Partially converted - show only unmatched portion (projection_value - actual_value)
      // - unmatched: Not yet ordered - show full projection_value
      // - expired: Past order window - shown separately as red bars (excluded here)
      // Also separate regular projections from MTO projections
      // NOTE: active_projections already represents latest state per vendor/SKU
      const projectionsResult = await db.execute(sql`
        SELECT 
          ap.brand as client,
          ap.month,
          SUM(
            CASE 
              WHEN LOWER(ap.order_type) = 'mto' OR LOWER(ap.order_type) = 'spo' THEN 0
              WHEN ap.match_status = 'partial' THEN GREATEST(0, ap.projection_value - COALESCE(ap.actual_value, 0))
              ELSE ap.projection_value 
            END
          ) as total_projection,
          SUM(
            CASE 
              WHEN LOWER(ap.order_type) = 'mto' OR LOWER(ap.order_type) = 'spo' THEN 
                CASE 
                  WHEN ap.match_status = 'partial' THEN GREATEST(0, ap.projection_value - COALESCE(ap.actual_value, 0))
                  ELSE ap.projection_value 
                END
              ELSE 0 
            END
          ) as mto_projection
        FROM active_projections ap
        JOIN vendors v ON ap.vendor_id = v.id
        WHERE (
          LOWER(v.name) LIKE ${vendorCode.toLowerCase() + '%'}
          OR LOWER(v.name) = ${vendorName.toLowerCase()}
          OR LOWER(SPLIT_PART(v.name, ' ', 1)) = ${vendorCode.toLowerCase()}
        )
          AND ap.year = ${targetYear}
          AND COALESCE(ap.match_status, 'unmatched') NOT IN ('matched', 'expired')
          ${filterClientId ? sql`AND ap.client_id = ${filterClientId}` : sql``}
        GROUP BY ap.brand, ap.month
        ORDER BY ap.month, ap.brand
      `);

      // Get EXPIRED Projections separately (for red bars on chart)
      // NOTE: active_projections already represents latest state per vendor/SKU
      const expiredProjectionsResult = await db.execute(sql`
        SELECT 
          ap.brand as client,
          ap.month,
          SUM(ap.projection_value) as total_projection
        FROM active_projections ap
        JOIN vendors v ON ap.vendor_id = v.id
        WHERE (
          LOWER(v.name) LIKE ${vendorCode.toLowerCase() + '%'}
          OR LOWER(v.name) = ${vendorName.toLowerCase()}
          OR LOWER(SPLIT_PART(v.name, ' ', 1)) = ${vendorCode.toLowerCase()}
        )
          AND ap.year = ${targetYear}
          AND ap.match_status = 'expired'
          ${filterClientId ? sql`AND ap.client_id = ${filterClientId}` : sql``}
        GROUP BY ap.brand, ap.month
        ORDER BY ap.month, ap.brand
      `);

      // Build combined response data
      // Structure: array of records with client/month/values
      type CapacityRow = {
        id: number;
        vendorCode: string;
        vendorName: string;
        office: string | null;
        client: string;
        year: number;
        month: number;
        totalShipment: number; // Orders on Hand (unshipped) from OS340
        shippedOrders: number; // Historical shipped orders from OS340
        totalProjection: number; // Active Projections from FURNITURE imports
        expiredProjection: number; // Expired Projections (for red bars on chart)
        reservedCapacity: number; // From SS551
        totalShipmentPlusProjection: number;
        balance: number;
        utilizedCapacityPct: number | null;
      };

      const capacityByMonthBrand: Record<string, CapacityRow> = {};

      // Initialize with Reserved Capacity from SS551 (CAPACITY_DATA rows)
      for (const row of ss551Data) {
        if (row.client === 'CAPACITY_DATA') {
          const key = `${row.month}_CAPACITY_DATA`;
          capacityByMonthBrand[key] = {
            id: row.id,
            vendorCode: row.vendorCode,
            vendorName: row.vendorName,
            office: row.office,
            client: 'CAPACITY_DATA',
            year: targetYear,
            month: row.month,
            totalShipment: 0,
            shippedOrders: 0,
            totalProjection: 0,
            mtoProjection: 0,
            expiredProjection: 0,
            reservedCapacity: row.reservedCapacity || 0,
            totalShipmentPlusProjection: 0,
            balance: row.reservedCapacity || 0,
            utilizedCapacityPct: null
          };
        }
      }

      // Add Orders on Hand from OS340
      let idCounter = 100000;
      for (const row of ordersOnHandResult.rows) {
        const client = row.client as string;
        const month = parseInt(row.month as string) || 0;
        const totalShipment = parseInt(row.total_shipment as string) || 0;

        if (month === 0) continue;

        const key = `${month}_${client}`;
        if (!capacityByMonthBrand[key]) {
          capacityByMonthBrand[key] = {
            id: idCounter++,
            vendorCode,
            vendorName,
            office: null,
            client,
            year: targetYear,
            month,
            totalShipment: 0,
            shippedOrders: 0,
            totalProjection: 0,
            mtoProjection: 0,
            expiredProjection: 0,
            reservedCapacity: 0,
            totalShipmentPlusProjection: 0,
            balance: 0,
            utilizedCapacityPct: null
          };
        }
        capacityByMonthBrand[key].totalShipment = totalShipment;
      }

      // Add SHIPPED Orders (historical shipped orders)
      for (const row of shippedOrdersResult.rows) {
        const client = row.client as string;
        const month = parseInt(row.month as string) || 0;
        const shippedValue = parseInt(row.shipped_value as string) || 0;

        if (month === 0) continue;

        const key = `${month}_${client}`;
        if (!capacityByMonthBrand[key]) {
          capacityByMonthBrand[key] = {
            id: idCounter++,
            vendorCode,
            vendorName,
            office: null,
            client,
            year: targetYear,
            month,
            totalShipment: 0,
            shippedOrders: 0,
            totalProjection: 0,
            mtoProjection: 0,
            expiredProjection: 0,
            reservedCapacity: 0,
            totalShipmentPlusProjection: 0,
            balance: 0,
            utilizedCapacityPct: null
          };
        }
        capacityByMonthBrand[key].shippedOrders = shippedValue;
      }

      // Add Projections from active_projections (FURNITURE/HOME-GOODS imports)
      const hasProjectionsFromFurniture = projectionsResult.rows.length > 0;

      for (const row of projectionsResult.rows) {
        const client = row.client as string;
        const month = parseInt(row.month as string) || 0;
        const totalProjection = parseInt(row.total_projection as string) || 0;

        if (month === 0) continue;

        const key = `${month}_${client}`;
        if (!capacityByMonthBrand[key]) {
          capacityByMonthBrand[key] = {
            id: idCounter++,
            vendorCode,
            vendorName,
            office: null,
            client,
            year: targetYear,
            month,
            totalShipment: 0,
            shippedOrders: 0,
            totalProjection: 0,
            mtoProjection: 0,
            expiredProjection: 0,
            reservedCapacity: 0,
            totalShipmentPlusProjection: 0,
            balance: 0,
            utilizedCapacityPct: null
          };
        }
        capacityByMonthBrand[key].totalProjection = totalProjection;
        const mtoProjection = parseInt(row.mto_projection as string) || 0;
        capacityByMonthBrand[key].mtoProjection = mtoProjection;
      }

      // Add EXPIRED Projections (for red bars on chart - not included in calculations)
      for (const row of expiredProjectionsResult.rows) {
        const client = row.client as string;
        const month = parseInt(row.month as string) || 0;
        const expiredProjection = parseInt(row.total_projection as string) || 0;

        if (month === 0) continue;

        const key = `${month}_${client}`;
        if (!capacityByMonthBrand[key]) {
          capacityByMonthBrand[key] = {
            id: idCounter++,
            vendorCode,
            vendorName,
            office: null,
            client,
            year: targetYear,
            month,
            totalShipment: 0,
            shippedOrders: 0,
            totalProjection: 0,
            mtoProjection: 0,
            expiredProjection: 0,
            reservedCapacity: 0,
            totalShipmentPlusProjection: 0,
            balance: 0,
            utilizedCapacityPct: null
          };
        }
        capacityByMonthBrand[key].expiredProjection = expiredProjection;
      }

      // Note: No fallback to SS551 projections or shipments
      // Data sources are strictly:
      // - Orders on Hand: OS340 po_headers (unshipped POs)
      // - Projections: FURNITURE/HOME-GOODS imports (active_projections)
      // - Reserved Capacity: SS551 vendor_capacity_data (CAPACITY_DATA rows)

      // Calculate totals and balances
      const monthlyCapacity: Record<number, number> = {};
      for (const row of Object.values(capacityByMonthBrand)) {
        if (row.client === 'CAPACITY_DATA') {
          monthlyCapacity[row.month] = row.reservedCapacity;
        }
      }

      for (const row of Object.values(capacityByMonthBrand)) {
        // Include MTO projections in total capacity utilization
        row.totalShipmentPlusProjection = row.totalShipment + row.totalProjection + (row.mtoProjection || 0);
        const capacity = monthlyCapacity[row.month] || 0;
        row.balance = capacity - row.totalShipmentPlusProjection;
        row.utilizedCapacityPct = capacity > 0
          ? Math.round((row.totalShipmentPlusProjection / capacity) * 100)
          : null;
      }

      // Convert to array and sort
      const result = Object.values(capacityByMonthBrand).sort((a, b) => {
        if (a.month !== b.month) return a.month - b.month;
        return a.client.localeCompare(b.client);
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching vendor capacity by vendor:", error);
      res.status(500).json({ error: error.message || "Failed to fetch vendor capacity data" });
    }
  });

  app.get("/api/vendor-capacity/summaries", async (req: Express.Request, res: Response) => {
    try {
      const { year, client } = req.query;
      const targetYear = year ? parseInt(year as string) : new Date().getFullYear();

      // Map frontend client names to capacity data client codes
      const clientCodeMap: Record<string, string> = {
        'crate and barrel': 'CB',
        'crate & barrel': 'CB',
        'cb': 'CB',
        'cb2': 'CB2',
        'crate & kids': 'C&K',
        'crate and kids': 'C&K',
        'c&k': 'C&K',
        'ck': 'C&K',
      };
      const clientCode = client && typeof client === 'string'
        ? clientCodeMap[client.toLowerCase()] || null
        : null;

      // Get base summaries from SS551 import for Reserved Capacity only
      const summaries = await storage.getVendorCapacitySummaries(targetYear);

      // NEW: Get Orders on Hand from OS340 (actual unshipped orders)
      const ordersOnHandData = await storage.getOrdersOnHandFromOS340(targetYear);

      // NEW: Get Projections from active_projections (FURNITURE/HOME-GOODS imports)
      const projectionsData = await storage.getProjectionsFromSkuProjections(targetYear);

      // Get actual shipped values from OS 340 purchase orders
      const shippedByVendor = await storage.getShippedValuesByVendor(targetYear);

      // Get current month for filtering capacity issues
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      const minMonthForIssues = targetYear < currentYear ? 1 : currentMonth;

      // Check monthly capacity issues using new data sources
      // Reserved capacity still comes from SS551 (vendor_capacity_data)
      const capacityIssueQuery = sql`
        SELECT 
          vendor_code,
          MAX(reserved_capacity) as has_any_capacity,
          month
        FROM vendor_capacity_data
        WHERE year = ${targetYear} AND client = 'CAPACITY_DATA'
        GROUP BY vendor_code, month
      `;

      const capacityResult = await db.execute(capacityIssueQuery);
      const reservedCapacityByVendor: Record<string, Record<number, number>> = {};
      for (const row of capacityResult.rows) {
        const vendorCode = row.vendor_code as string;
        const month = parseInt(row.month as string) || 0;
        // SS551 stores in DOLLARS - convert to cents for consistency
        const capacity = (parseInt(row.has_any_capacity as string) || 0) * 100;
        if (!reservedCapacityByVendor[vendorCode]) {
          reservedCapacityByVendor[vendorCode] = {};
        }
        reservedCapacityByVendor[vendorCode][month] = capacity;
      }

      // Build enriched summaries using new data sources
      const enrichedSummaries = summaries.map(summary => {
        const vendorName = summary.canonicalVendorName || summary.vendorName;

        // SS551 stores reserved capacity in DOLLARS - convert to cents for consistency
        const reservedCapacityInCents = (summary.totalReservedCapacityAnnual || 0) * 100;

        // Get Orders on Hand from OS340 (by vendor name)
        let ordersOnHand = ordersOnHandData.byVendor[vendorName] || 0;

        // Get Projections from SKU projections (by vendor name)
        // No fallback to SS551 - FURNITURE is the authoritative source for projections
        let projections = projectionsData.byVendor[vendorName] || 0;

        // No fallback to SS551 shipments - OS340 is the authoritative source for orders on hand

        // Apply brand filter if specified
        if (clientCode && ordersOnHandData.byVendorBrandMonth[vendorName]) {
          ordersOnHand = 0;
          const brandData = ordersOnHandData.byVendorBrandMonth[vendorName][clientCode];
          if (brandData) {
            ordersOnHand = Object.values(brandData).reduce((sum, val) => sum + val, 0);
          }
        }

        if (clientCode && projectionsData.byVendorBrandMonth[vendorName]) {
          projections = 0;
          const brandData = projectionsData.byVendorBrandMonth[vendorName][clientCode];
          if (brandData) {
            projections = Object.values(brandData).reduce((sum, val) => sum + val, 0);
          }
        }

        // Get actual shipped from OS340
        let matchedShipped = shippedByVendor[vendorName] || 0;
        if (!matchedShipped) {
          // Fallback: fuzzy match
          const vendorCodeLower = summary.vendorCode.toLowerCase();
          for (const [fullVendorName, shippedValue] of Object.entries(shippedByVendor)) {
            const nameLower = fullVendorName.toLowerCase();
            if (nameLower.includes(vendorCodeLower) ||
              vendorCodeLower.includes(nameLower.split(' ')[0]) ||
              nameLower.startsWith(vendorCodeLower)) {
              matchedShipped = shippedValue as number;
              break;
            }
          }
        }

        // Calculate total pipeline for utilization
        const totalPipeline = ordersOnHand + projections;

        // Determine capacity issue status
        // Check MONTHLY data - if ANY month exceeds capacity, flag as Potential Risk
        const vendorCapacity = reservedCapacityByVendor[summary.vendorCode];
        let capacityIssueStatus: string | null = null;
        let hasAnyCapacity = false;

        if (vendorCapacity) {
          hasAnyCapacity = Object.values(vendorCapacity).some(c => c > 0);
          const totalAnnualCapacity = Object.values(vendorCapacity).reduce((sum, c) => sum + c, 0);

          if (!hasAnyCapacity) {
            capacityIssueStatus = 'No Set Capacity';
          } else {
            // Check each month for capacity issues
            let hasMonthlyCapacityIssue = false;
            let hasMonthlyOverCapacity = false; // Orders alone exceed capacity

            for (let month = 1; month <= 12; month++) {
              const monthCapacity = vendorCapacity[month] || 0;
              if (monthCapacity <= 0) continue; // Skip months with no set capacity

              // Calculate monthly pipeline (orders + projections)
              let monthlyOrders = 0;
              let monthlyProjections = 0;

              // Get monthly orders on hand
              if (ordersOnHandData.byVendorBrandMonth[vendorName]) {
                for (const brand of ['CB', 'CB2', 'C&K']) {
                  if (clientCode && clientCode !== brand) continue; // Apply brand filter
                  monthlyOrders += ordersOnHandData.byVendorBrandMonth[vendorName][brand]?.[month] || 0;
                }
              }

              // Get monthly projections
              if (projectionsData.byVendorBrandMonth[vendorName]) {
                for (const brand of ['CB', 'CB2', 'C&K']) {
                  if (clientCode && clientCode !== brand) continue; // Apply brand filter
                  monthlyProjections += projectionsData.byVendorBrandMonth[vendorName][brand]?.[month] || 0;
                }
              }

              const monthlyPipeline = monthlyOrders + monthlyProjections;

              // Check if this month exceeds capacity
              if (monthlyPipeline > monthCapacity) {
                hasMonthlyCapacityIssue = true;
                if (monthlyOrders > monthCapacity) {
                  hasMonthlyOverCapacity = true;
                }
              }
            }

            // Set status based on monthly analysis
            if (hasMonthlyOverCapacity) {
              capacityIssueStatus = 'Capacity Issue';
            } else if (hasMonthlyCapacityIssue) {
              capacityIssueStatus = 'Potential Risk';
            }
            // Also check annual totals as fallback
            else if (totalPipeline > totalAnnualCapacity) {
              capacityIssueStatus = ordersOnHand > totalAnnualCapacity ? 'Capacity Issue' : 'Potential Risk';
            }
          }
        } else {
          capacityIssueStatus = 'No Set Capacity';
        }

        return {
          ...summary,
          displayVendorName: vendorName,
          linkedVendorId: summary.canonicalVendorId || null,
          // NEW: Orders on Hand from OS340
          totalShipmentAnnual: ordersOnHand,
          // NEW: Projections from FURNITURE/HOME-GOODS imports
          totalProjectionAnnual: projections,
          // Reserved capacity converted to cents for consistency
          totalReservedCapacityAnnual: reservedCapacityInCents,
          // Actual shipped from OS340
          actualShipped: matchedShipped > 0 ? matchedShipped : 0,
          // Recalculate utilization using cents-converted capacity
          avgUtilizationPct: reservedCapacityInCents > 0
            ? Math.round((totalPipeline / reservedCapacityInCents) * 100)
            : (totalPipeline > 0 ? 100 : 0),
          capacityIssueStatus
        };
      });

      // Also include vendors that have OS340 orders or projections but no SS551 entry
      const summaryVendorNames = new Set(summaries.map(s => s.canonicalVendorName || s.vendorName));
      const additionalVendors: any[] = [];

      // Check OS340 orders for vendors not in SS551
      for (const vendorName of Object.keys(ordersOnHandData.byVendor)) {
        if (!summaryVendorNames.has(vendorName)) {
          let ordersOnHand = ordersOnHandData.byVendor[vendorName] || 0;
          let projections = projectionsData.byVendor[vendorName] || 0;

          if (clientCode) {
            ordersOnHand = 0;
            projections = 0;
            if (ordersOnHandData.byVendorBrandMonth[vendorName]?.[clientCode]) {
              ordersOnHand = Object.values(ordersOnHandData.byVendorBrandMonth[vendorName][clientCode]).reduce((sum, val) => sum + val, 0);
            }
            if (projectionsData.byVendorBrandMonth[vendorName]?.[clientCode]) {
              projections = Object.values(projectionsData.byVendorBrandMonth[vendorName][clientCode]).reduce((sum, val) => sum + val, 0);
            }
          }

          if (ordersOnHand > 0 || projections > 0) {
            additionalVendors.push({
              vendorCode: vendorName.substring(0, 20),
              vendorName: vendorName,
              displayVendorName: vendorName,
              year: targetYear,
              totalReservedCapacityAnnual: 0,
              totalShipmentAnnual: ordersOnHand,
              totalProjectionAnnual: projections,
              actualShipped: shippedByVendor[vendorName] || 0,
              avgUtilizationPct: 0,
              capacityIssueStatus: 'No Set Capacity'
            });
          }
        }
      }

      // Check projections for vendors not in SS551 or OS340
      for (const vendorName of Object.keys(projectionsData.byVendor)) {
        if (!summaryVendorNames.has(vendorName) && !additionalVendors.find(v => v.vendorName === vendorName)) {
          let projections = projectionsData.byVendor[vendorName] || 0;

          if (clientCode) {
            projections = 0;
            if (projectionsData.byVendorBrandMonth[vendorName]?.[clientCode]) {
              projections = Object.values(projectionsData.byVendorBrandMonth[vendorName][clientCode]).reduce((sum, val) => sum + val, 0);
            }
          }

          if (projections > 0) {
            additionalVendors.push({
              vendorCode: vendorName.substring(0, 20),
              vendorName: vendorName,
              displayVendorName: vendorName,
              year: targetYear,
              totalReservedCapacityAnnual: 0,
              totalShipmentAnnual: 0,
              totalProjectionAnnual: projections,
              actualShipped: 0,
              avgUtilizationPct: 0,
              capacityIssueStatus: 'No Set Capacity'
            });
          }
        }
      }

      const allSummaries = [...enrichedSummaries, ...additionalVendors];

      // Get vendor aliases for consolidation
      const aliasQuery = sql`
        SELECT vca.alias, v.name as canonical_name, v.id as canonical_vendor_id
        FROM vendor_capacity_aliases vca
        JOIN vendors v ON vca.vendor_id = v.id
      `;
      const aliasResult = await db.execute(aliasQuery);
      const aliasToCanonical: Record<string, { name: string; id: number }> = {};
      for (const row of aliasResult.rows) {
        const alias = row.alias as string;
        const canonicalName = row.canonical_name as string;
        const canonicalId = row.canonical_vendor_id as number;

        // Add both original and trimmed/uppercase versions for robust matching
        aliasToCanonical[alias] = { name: canonicalName, id: canonicalId };
        aliasToCanonical[alias.trim()] = { name: canonicalName, id: canonicalId };
        aliasToCanonical[alias.toUpperCase().trim()] = { name: canonicalName, id: canonicalId };

        // Also add the canonical name itself with variations
        aliasToCanonical[canonicalName] = { name: canonicalName, id: canonicalId };
        aliasToCanonical[canonicalName.trim()] = { name: canonicalName, id: canonicalId };
        aliasToCanonical[canonicalName.toUpperCase().trim()] = { name: canonicalName, id: canonicalId };
      }

      // Consolidate entries that share the same canonical vendor
      const consolidatedMap: Record<string, any> = {};

      for (const summary of allSummaries) {
        const vendorName = summary.displayVendorName || summary.vendorName || summary.vendorCode;

        // Look up canonical name via aliases - try multiple variations for robust matching
        const canonical = aliasToCanonical[vendorName]
          || aliasToCanonical[vendorName?.trim()]
          || aliasToCanonical[vendorName?.toUpperCase().trim()]
          || aliasToCanonical[summary.vendorCode]
          || aliasToCanonical[summary.vendorCode?.toUpperCase().trim()];
        const canonicalKey = canonical?.name || vendorName;

        if (consolidatedMap[canonicalKey]) {
          // Merge with existing entry
          const existing = consolidatedMap[canonicalKey];
          existing.totalShipmentAnnual = (existing.totalShipmentAnnual || 0) + (summary.totalShipmentAnnual || 0);
          existing.totalProjectionAnnual = (existing.totalProjectionAnnual || 0) + (summary.totalProjectionAnnual || 0);
          existing.actualShipped = (existing.actualShipped || 0) + (summary.actualShipped || 0);

          // Keep the entry with capacity if one has it
          if ((summary.totalReservedCapacityAnnual || 0) > (existing.totalReservedCapacityAnnual || 0)) {
            existing.totalReservedCapacityAnnual = summary.totalReservedCapacityAnnual;
            existing.vendorCode = summary.vendorCode;
          }

          // Update linked vendor ID if we have one
          if (canonical?.id && !existing.linkedVendorId) {
            existing.linkedVendorId = canonical.id;
            existing.canonicalVendorId = canonical.id;
          }

          // Recalculate utilization after merge
          const pipeline = existing.totalShipmentAnnual + existing.totalProjectionAnnual;
          if ((existing.totalReservedCapacityAnnual || 0) > 0) {
            existing.avgUtilizationPct = Math.round((pipeline / existing.totalReservedCapacityAnnual) * 100);

            // Preserve the most severe capacity issue status from pre-computed monthly analysis
            // Priority: Capacity Issue > Potential Risk > null > No Set Capacity
            const statusPriority: Record<string, number> = {
              'Capacity Issue': 4,
              'Potential Risk': 3,
              'null': 1,
              'No Set Capacity': 0
            };
            const existingPriority = statusPriority[existing.capacityIssueStatus || 'null'] || 0;
            const summaryPriority = statusPriority[summary.capacityIssueStatus || 'null'] || 0;
            if (summaryPriority > existingPriority) {
              existing.capacityIssueStatus = summary.capacityIssueStatus;
            }
          } else {
            existing.capacityIssueStatus = 'No Set Capacity';
          }
        } else {
          // New entry
          consolidatedMap[canonicalKey] = {
            ...summary,
            displayVendorName: canonical?.name || vendorName,
            linkedVendorId: canonical?.id || summary.linkedVendorId || null,
            canonicalVendorId: canonical?.id || summary.canonicalVendorId || null
          };
        }
      }

      const consolidatedSummaries = Object.values(consolidatedMap);

      // If client filter is applied, filter out vendors with no data for that client
      const filteredSummaries = clientCode
        ? consolidatedSummaries.filter(s => (s.totalShipmentAnnual || 0) > 0 || (s.totalProjectionAnnual || 0) > 0)
        : consolidatedSummaries;

      res.json(filteredSummaries);
    } catch (error: any) {
      console.error("Error fetching vendor capacity summaries:", error);
      res.status(500).json({ error: error.message || "Failed to fetch vendor capacity summaries" });
    }
  });

  app.get("/api/vendor-capacity/summary/:vendorCode/:year", async (req: Express.Request, res: Response) => {
    try {
      const { vendorCode, year } = req.params;
      const summary = await storage.getVendorCapacitySummary(vendorCode, parseInt(year));
      if (!summary) {
        res.status(404).json({ error: "Vendor capacity summary not found" });
        return;
      }
      // Convert SS551 values from dollars to cents for frontend consistency
      // SS551 stores values in DOLLARS, frontend expects CENTS
      res.json({
        ...summary,
        totalShipmentAnnual: (summary.totalShipmentAnnual || 0) * 100,
        totalProjectionAnnual: (summary.totalProjectionAnnual || 0) * 100,
        totalReservedCapacityAnnual: (summary.totalReservedCapacityAnnual || 0) * 100,
        cbShipmentAnnual: (summary.cbShipmentAnnual || 0) * 100,
        cb2ShipmentAnnual: (summary.cb2ShipmentAnnual || 0) * 100,
        ckShipmentAnnual: (summary.ckShipmentAnnual || 0) * 100,
      });
    } catch (error: any) {
      console.error("Error fetching vendor capacity summary:", error);
      res.status(500).json({ error: error.message || "Failed to fetch vendor capacity summary" });
    }
  });

  // Get monthly order data from OS340 purchase orders by vendor and year
  // Returns both confirmed orders (by cancel date) AND actual shipped (by ship date)
  app.get("/api/vendor-capacity/os340-shipped/:vendorCode/:year", async (req: Express.Request, res: Response) => {
    try {
      const { vendorCode, year } = req.params;
      const yearNum = parseInt(year);
      const vendorCodeLower = vendorCode.toLowerCase();

      // Query for CONFIRMED orders (by cancel date - when order is due)
      const confirmedResult = await db.execute(sql`
        SELECT 
          EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))::int as month,
          SUM(COALESCE(ph.total_value, 0)) as order_value
        FROM po_headers ph
        WHERE (
          LOWER(ph.vendor) LIKE ${vendorCodeLower + '%'}
          OR LOWER(SPLIT_PART(ph.vendor, ' ', 1)) = ${vendorCodeLower}
          OR LOWER(SPLIT_PART(ph.vendor, ',', 1)) = ${vendorCodeLower}
        )
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date)) = ${yearNum}
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
        GROUP BY EXTRACT(MONTH FROM COALESCE(ph.revised_cancel_date, ph.original_cancel_date))
      `);

      // Query for SHIPPED orders (by ship date, only shipped status) with client breakdown
      const shippedResult = await db.execute(sql`
        SELECT 
          EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date))::int as month,
          COALESCE(ph.client_division, 'CB') as client,
          SUM(COALESCE(ph.total_value, 0)) as shipped_value
        FROM po_headers ph
        WHERE (
          LOWER(ph.vendor) LIKE ${vendorCodeLower + '%'}
          OR LOWER(SPLIT_PART(ph.vendor, ' ', 1)) = ${vendorCodeLower}
          OR LOWER(SPLIT_PART(ph.vendor, ',', 1)) = ${vendorCodeLower}
        )
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_ship_date, ph.original_ship_date)) = ${yearNum}
          AND ph.shipment_status IN ('On-Time', 'Late')
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          AND ph.po_number NOT LIKE '089%'
        GROUP BY EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date)),
          COALESCE(ph.client_division, 'CB')
      `);

      // Transform to monthly array format with both confirmed and shipped by client
      const monthlyData: Array<{
        month: number;
        confirmed: number;
        shipped: number;
        CB: number;
        CB2: number;
        'C&K': number;
        cbShipped: number;
        cb2Shipped: number;
        ckShipped: number;
        total: number;
      }> = [];

      for (let m = 1; m <= 12; m++) {
        const confirmedRow = (confirmedResult.rows as any[]).find(r => r.month === m);
        const shippedRows = (shippedResult.rows as any[]).filter(r => r.month === m);

        const confirmedValue = Number(confirmedRow?.order_value || 0);

        const cbShipped = Number(shippedRows.find(r => r.client === 'CB')?.shipped_value || 0);
        const cb2Shipped = Number(shippedRows.find(r => r.client === 'CB2')?.shipped_value || 0);
        const ckShipped = Number(shippedRows.find(r => r.client === 'C&K')?.shipped_value || 0);
        const totalShipped = cbShipped + cb2Shipped + ckShipped;

        monthlyData.push({
          month: m,
          confirmed: confirmedValue,
          shipped: totalShipped,
          CB: cbShipped,
          CB2: cb2Shipped,
          'C&K': ckShipped,
          cbShipped: cbShipped,
          cb2Shipped: cb2Shipped,
          ckShipped: ckShipped,
          total: totalShipped
        });
      }

      res.json(monthlyData);
    } catch (error: any) {
      console.error("Error fetching OS340 shipped data:", error);
      res.status(500).json({ error: error.message || "Failed to fetch OS340 shipped data" });
    }
  });

  app.post("/api/vendor-capacity/import", upload.single("file"), async (req: Express.Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      const xlsx = await import("xlsx");
      const workbook = xlsx.read(req.file.buffer, { type: "buffer" });

      const importStats = {
        vendorsProcessed: 0,
        totalRecords: 0,
        summariesCreated: 0,
        errors: [] as string[],
        lockedYearsSkipped: [] as number[],
        yearsImported: [] as number[]
      };

      // STEP 1: Scan ALL sheets to detect ALL years present in the file
      const detectedYearsSet = new Set<number>();
      for (const sheetName of workbook.SheetNames) {
        if (['template', 'instructions', 'summary'].includes(sheetName.toLowerCase())) continue;

        const sheet = workbook.Sheets[sheetName];
        const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

        // Scan first 15 rows for year headers
        for (let rowIdx = 0; rowIdx < Math.min(15, jsonData.length); rowIdx++) {
          const row = jsonData[rowIdx];
          if (!row || !Array.isArray(row)) continue;

          for (const cell of row) {
            const cellStr = String(cell || '').trim();
            const yearMatch = cellStr.match(/\b(202[0-9]|2030)\b/);
            if (yearMatch) {
              detectedYearsSet.add(parseInt(yearMatch[1]));
            }
          }
        }
      }

      const detectedYears = Array.from(detectedYearsSet).sort((a, b) => a - b);
      console.log(`SS551 Import: Detected years in file: ${detectedYears.join(', ')}`);

      // STEP 2: Get locked years from database
      const lockedYears = await storage.getLockedCapacityYears();
      console.log(`SS551 Import: Locked years in database: ${lockedYears.join(', ') || 'none'}`);

      // STEP 3: Determine which years to import (unlocked only)
      const yearsToImport = detectedYears.filter(y => !lockedYears.includes(y));
      const yearsSkipped = detectedYears.filter(y => lockedYears.includes(y));

      importStats.lockedYearsSkipped = yearsSkipped;
      importStats.yearsImported = yearsToImport;

      if (yearsSkipped.length > 0) {
        console.log(`SS551 Import: Skipping locked years: ${yearsSkipped.join(', ')}`);
        importStats.errors.push(`Skipped locked years: ${yearsSkipped.join(', ')} (use unlock API to allow updates)`);
      }

      if (yearsToImport.length === 0) {
        res.json({
          success: false,
          message: `All years in file (${detectedYears.join(', ')}) are locked. No data imported.`,
          stats: importStats
        });
        return;
      }

      console.log(`SS551 Import: Will import years: ${yearsToImport.join(', ')}`);

      // STEP 4: Clear existing capacity data ONLY for unlocked years being imported
      const dataCleared = await storage.clearUnlockedVendorCapacityData(yearsToImport);
      const summaryCleared = await storage.clearUnlockedVendorCapacitySummary(yearsToImport);
      console.log(`SS551 Import: Cleared ${dataCleared} data rows and ${summaryCleared} summary rows for years: ${yearsToImport.join(', ')}`);

      // Use first detected year as default if needed
      const currentYear = yearsToImport[0] || new Date().getFullYear();
      console.log(`Using year ${currentYear} for capacity import`);

      const allCapacityData: any[] = [];
      const allSummaries: any[] = [];

      // Process each sheet as a vendor
      for (const sheetName of workbook.SheetNames) {
        if (sheetName.toLowerCase() === 'template' || sheetName.toLowerCase() === 'instructions' || sheetName.toLowerCase() === 'summary') {
          continue;
        }

        try {
          const sheet = workbook.Sheets[sheetName];
          const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

          if (jsonData.length < 2) continue;

          // Map vendor codes
          const vendorCode = sheetName.trim();

          // Support multi-year data in same sheet - track data per year
          const yearlyData: {
            [year: number]: {
              totalReservedCapacity: number;
              totalShipped: number;
              totalProjections: number;
              utilization: number;
              monthlyReserved: number[];
              monthlyProjections: number[];
              monthlyBrandData: { [key: string]: number[] };
            }
          } = {};

          // Initialize for detected years (will add dynamically when year headers found)
          const initYearData = (year: number) => {
            if (!yearlyData[year]) {
              yearlyData[year] = {
                totalReservedCapacity: 0,
                totalShipped: 0,
                totalProjections: 0,
                utilization: 0,
                monthlyReserved: new Array(12).fill(0),
                monthlyProjections: new Array(12).fill(0),
                monthlyBrandData: { 'CB': new Array(12).fill(0), 'CB2': new Array(12).fill(0), 'C&K': new Array(12).fill(0) }
              };
            }
          };

          // Build column->year/month mapping by scanning header rows
          // SS551 layout: columns B-Q = 2025 (Jan-Dec + totals), R-AE = 2026 (Jan-Dec + totals)
          const columnYearMonth: { [colIndex: number]: { year: number; month: number } } = {};
          const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

          // First pass: find all year headers and their column positions
          const yearColumns: { colIdx: number; year: number }[] = [];
          const monthColumns: { colIdx: number; month: number; rowIdx: number }[] = [];

          // Debug: log rows around where data starts (line 7 = index 6)
          console.log(`\n=== PARSING VENDOR ${vendorCode} ===`);
          for (let r = 0; r < Math.min(12, jsonData.length); r++) {
            const row = jsonData[r];
            if (row && Array.isArray(row)) {
              const preview = row.slice(0, 25).map((c, i) => `[${i}]=${String(c || '').substring(0, 12)}`).join(' | ');
              console.log(`Row ${r}: ${preview}`);
            }
          }

          // Scan rows 0-15 to find year and month headers (data starts at row 7, but headers may be above)
          for (let headerRowIdx = 0; headerRowIdx < Math.min(15, jsonData.length); headerRowIdx++) {
            const headerRow = jsonData[headerRowIdx];
            if (!headerRow || !Array.isArray(headerRow)) continue;

            for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
              const cellStr = String(headerRow[colIdx] || '').trim().toLowerCase();

              // Check if this cell contains a year (e.g., "2025", "FY 2025")
              const yearMatch = cellStr.match(/\b(202[0-9]|2030)\b/);
              if (yearMatch) {
                const year = parseInt(yearMatch[1]);
                // Only add if not already found at this column
                if (!yearColumns.find(yc => yc.colIdx === colIdx && yc.year === year)) {
                  yearColumns.push({ colIdx, year });
                  initYearData(year);
                  console.log(`Vendor ${vendorCode}: Found year ${year} at row ${headerRowIdx} column ${colIdx}`);
                }
              }

              // Check if this is a month column
              const monthIdx = monthNames.findIndex(m => cellStr === m || cellStr.startsWith(m + ' ') || cellStr.startsWith(m + '-'));
              if (monthIdx >= 0) {
                // Only add if not already found at this column
                if (!monthColumns.find(mc => mc.colIdx === colIdx)) {
                  monthColumns.push({ colIdx, month: monthIdx, rowIdx: headerRowIdx });
                  console.log(`Vendor ${vendorCode}: Found month ${monthNames[monthIdx]} at row ${headerRowIdx} column ${colIdx}`);
                }
              }
            }
          }

          console.log(`Vendor ${vendorCode}: Found ${yearColumns.length} year headers, ${monthColumns.length} month columns`);

          // Second pass: associate each month column with the correct year
          // A month column belongs to the year whose header is closest before it (or at the same position)
          yearColumns.sort((a, b) => a.colIdx - b.colIdx);

          for (const mc of monthColumns) {
            // Find the year header that is at or before this month column
            let assignedYear = currentYear;
            for (const yc of yearColumns) {
              if (yc.colIdx <= mc.colIdx) {
                assignedYear = yc.year;
              } else {
                break; // Year headers after this column don't apply
              }
            }
            columnYearMonth[mc.colIdx] = { year: assignedYear, month: mc.month };
            console.log(`Vendor ${vendorCode}: Column ${mc.colIdx} = ${assignedYear} ${monthNames[mc.month]}`);
          }

          // If no column mapping found OR all months map to same year, use SS551 standard layout
          // SS551 layout: columns 2-13 (C-N) = 2025 (prev year), 17-28 (R-AC) = 2026 (current year)
          const uniqueYears = new Set(Object.values(columnYearMonth).map(v => v.year));
          if (Object.keys(columnYearMonth).length === 0 || uniqueYears.size < 2) {
            console.log(`Vendor ${vendorCode}: Using SS551 standard layout (2025: cols 2-13, 2026: cols 17-28)`);

            // Clear any partial mapping
            Object.keys(columnYearMonth).forEach(k => delete columnYearMonth[parseInt(k)]);

            // 2025 months: columns 2-13 (C=2 through N=13) for Jan-Dec
            const prevYear = currentYear - 1; // 2025
            initYearData(prevYear);
            for (let m = 0; m < 12; m++) {
              columnYearMonth[m + 2] = { year: prevYear, month: m };
            }

            // 2026 months: columns 17-28 (R=17 through AC=28) for Jan-Dec
            initYearData(currentYear);
            for (let m = 0; m < 12; m++) {
              columnYearMonth[m + 17] = { year: currentYear, month: m };
            }

            console.log(`Vendor ${vendorCode}: Mapped 12 columns to ${prevYear}, 12 columns to ${currentYear}`);
          }

          // Start with base year (will be updated as year headers are found in rows)
          let activeYear = currentYear;
          initYearData(activeYear);

          // Track which section we're in
          let currentSection = '';

          // Helper to get annual total from row (last numeric column or sum of monthly)
          const getAnnualValue = (row: any[]): number => {
            // Try to find "Total" column value (usually last column with data)
            // Columns: Label | New/Re-buy | Jan | Feb | ... | Dec | Total
            // Index:   0     | 1          | 2   | 3   | ... | 13  | 14

            // First try the last column (index 14 for Total column)
            for (let i = row.length - 1; i >= 13; i--) {
              const val = parseFloat(String(row[i] || '0').replace(/[,$]/g, '').replace(/[^0-9.-]/g, '')) || 0;
              if (val > 0) return val;
            }

            // Sum monthly values (columns 2-13 for Jan-Dec, or 1-12 if no New/Re-buy column)
            let sum = 0;
            const startCol = row.length > 14 ? 2 : 1;
            for (let i = startCol; i < Math.min(startCol + 12, row.length); i++) {
              const val = parseFloat(String(row[i] || '0').replace(/[,$]/g, '').replace(/[^0-9.-]/g, '')) || 0;
              sum += val;
            }
            return sum;
          };

          // Process rows for this vendor
          for (let rowIndex = 0; rowIndex < jsonData.length; rowIndex++) {
            const row = jsonData[rowIndex];
            if (!row || !Array.isArray(row) || row.length < 2) continue;

            const firstCell = String(row[0] || '').trim();
            const firstCellLower = firstCell.toLowerCase();

            if (!firstCell) continue;

            // Check if this row contains a year header (e.g., "2025", "FY 2025", "Year 2025")
            const yearMatch = firstCell.match(/\b(202[0-9]|2030)\b/);
            if (yearMatch && firstCell.length < 20) { // Short cell with year = year header
              activeYear = parseInt(yearMatch[1]);
              initYearData(activeYear);
              console.log(`Vendor ${vendorCode}: Switched to year ${activeYear}`);
              continue;
            }

            // Detect section headers
            if (firstCellLower.includes('shipment') && (firstCellLower.includes('confirmed') || firstCellLower.includes('unconfirmed'))) {
              currentSection = 'shipment';
              continue;
            } else if (firstCellLower === 'projection' || (firstCellLower.includes('projection') && !firstCellLower.includes('history') && !firstCellLower.includes('vs'))) {
              currentSection = 'projection';
              continue;
            } else if (firstCellLower.includes('reserved capacity') || firstCellLower === 'reserved capacity' ||
              firstCellLower.includes('allocated capacity') || firstCellLower === 'allocated capacity') {
              currentSection = 'reserved';
              continue;
            }

            const annualValue = getAnnualValue(row);

            // Parse based on row label and current section (use yearlyData[activeYear])
            const yd = yearlyData[activeYear];
            if (firstCellLower === 'total shipment us$' || firstCellLower === 'total shipment') {
              yd.totalShipped = annualValue;
            } else if (firstCellLower === 'total reserved us$' || firstCellLower === 'total reserved' ||
              firstCellLower === 'total allocated us$' || firstCellLower === 'total allocated' ||
              firstCellLower.includes('allocated capacity') || firstCellLower.includes('reserved capacity')) {
              // Capture monthly reserved capacity using column mapping
              for (const [colIdxStr, mapping] of Object.entries(columnYearMonth)) {
                const colIdx = parseInt(colIdxStr);
                if (colIdx >= row.length) continue;
                const val = parseFloat(String(row[colIdx] || '0').replace(/[,$]/g, '').replace(/[^0-9.-]/g, '')) || 0;
                if (val > 0) {
                  initYearData(mapping.year);
                  yearlyData[mapping.year].monthlyReserved[mapping.month] = val;
                  yearlyData[mapping.year].totalReservedCapacity += val;
                }
              }
              // Log what was found
              for (const [yr, ydData] of Object.entries(yearlyData)) {
                if (ydData.totalReservedCapacity > 0) {
                  console.log(`Vendor ${vendorCode} year ${yr}: Reserved capacity = ${ydData.totalReservedCapacity}, monthly = ${ydData.monthlyReserved.filter(v => v > 0).length} months with data`);
                }
              }
            } else if (firstCellLower === 'total us$' && currentSection === 'projection') {
              // Capture monthly projection values using column mapping
              for (const [colIdxStr, mapping] of Object.entries(columnYearMonth)) {
                const colIdx = parseInt(colIdxStr);
                if (colIdx >= row.length) continue;
                const val = parseFloat(String(row[colIdx] || '0').replace(/[,$]/g, '').replace(/[^0-9.-]/g, '')) || 0;
                if (val > 0) {
                  initYearData(mapping.year);
                  yearlyData[mapping.year].monthlyProjections[mapping.month] = val;
                  yearlyData[mapping.year].totalProjections += val;
                }
              }
              // Log what was found
              for (const [yr, ydData] of Object.entries(yearlyData)) {
                if (ydData.totalProjections > 0) {
                  console.log(`Vendor ${vendorCode} year ${yr}: Projections = ${ydData.totalProjections}`);
                }
              }
            } else if (firstCellLower === 'utilized capacity' || firstCellLower === 'utilization') {
              // Get utilization percentage from first monthly column
              for (let i = 1; i < row.length; i++) {
                const val = parseFloat(String(row[i] || '0').replace(/[%,$]/g, '')) || 0;
                if (val > 0) {
                  yd.utilization = val > 1 ? val : val * 100; // Handle both 85.7 and 0.857 formats
                  break;
                }
              }
            } else if (currentSection === 'projection') {
              // Parse brand-specific projections (CB, CB2, C&K rows in projection section)
              let brandKey = '';
              if (firstCellLower === 'cb' || firstCellLower === 'crate & barrel' || firstCellLower === 'euromarket') {
                brandKey = 'CB';
              } else if (firstCellLower === 'cb2') {
                brandKey = 'CB2';
              } else if (firstCellLower === 'c&k' || firstCellLower === 'ck' || firstCellLower === 'crate & kids') {
                brandKey = 'C&K';
              }

              // If this is a brand row in projection section, capture monthly values into yearlyData
              if (brandKey && !firstCellLower.includes('total')) {
                for (const [colIdxStr, mapping] of Object.entries(columnYearMonth)) {
                  const colIdx = parseInt(colIdxStr);
                  if (colIdx >= row.length) continue;
                  // Skip locked years
                  if (!yearsToImport.includes(mapping.year)) continue;
                  const value = parseFloat(String(row[colIdx] || '0').replace(/[,$]/g, '').replace(/[^0-9.-]/g, '')) || 0;
                  if (value !== 0) {
                    initYearData(mapping.year);
                    // Store brand projections in a new structure
                    if (!yearlyData[mapping.year].monthlyBrandProjections) {
                      yearlyData[mapping.year].monthlyBrandProjections = { 'CB': Array(12).fill(0), 'CB2': Array(12).fill(0), 'C&K': Array(12).fill(0) };
                    }
                    yearlyData[mapping.year].monthlyBrandProjections[brandKey][mapping.month] += value;
                  }
                }
              }
            } else if (currentSection === 'shipment') {
              // Parse brand-specific shipments with monthly values using column mapping
              let brandKey = '';
              if (firstCellLower === 'cb' || firstCellLower === 'crate & barrel' || firstCellLower === 'euromarket') {
                brandKey = 'CB';
              } else if (firstCellLower === 'cb2') {
                brandKey = 'CB2';
              } else if (firstCellLower === 'c&k' || firstCellLower === 'ck' || firstCellLower === 'crate & kids') {
                brandKey = 'C&K';
              }

              // If this is a brand row, capture monthly values using column mapping (accumulate, don't push directly)
              if (brandKey && !firstCellLower.includes('total')) {
                for (const [colIdxStr, mapping] of Object.entries(columnYearMonth)) {
                  const colIdx = parseInt(colIdxStr);
                  if (colIdx >= row.length) continue;
                  // Skip locked years
                  if (!yearsToImport.includes(mapping.year)) continue;
                  const value = parseFloat(String(row[colIdx] || '0').replace(/[,$]/g, '').replace(/[^0-9.-]/g, '')) || 0;
                  if (value > 0) {
                    initYearData(mapping.year);
                    yearlyData[mapping.year].monthlyBrandData[brandKey][mapping.month] += value;
                  }
                }
              }
            }
          }

          // Process all years that have data for this vendor
          for (const [yearStr, yd] of Object.entries(yearlyData)) {
            const year = parseInt(yearStr);

            // Skip locked years - don't import data for them
            if (!yearsToImport.includes(year)) {
              console.log(`Vendor ${vendorCode}: Skipping locked year ${year}`);
              continue;
            }

            // Store monthly reserved capacity and projection data for the chart
            for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
              const reserved = yd.monthlyReserved[monthIndex] || 0;
              const projection = yd.monthlyProjections[monthIndex] || 0;

              if (reserved > 0 || projection > 0) {
                allCapacityData.push({
                  vendorCode,
                  vendorName: vendorCode,
                  year,
                  month: monthIndex + 1,
                  client: 'CAPACITY_DATA',
                  totalShipment: 0,
                  totalProjection: Math.round(projection),
                  reservedCapacity: Math.round(reserved)
                });
              }
            }

            // Store monthly brand data (combined shipments + projections) - one record per brand/month
            const brandProjections = (yd as any).monthlyBrandProjections || { 'CB': Array(12).fill(0), 'CB2': Array(12).fill(0), 'C&K': Array(12).fill(0) };
            for (const brand of ['CB', 'CB2', 'C&K'] as const) {
              for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
                const shipment = yd.monthlyBrandData[brand][monthIndex] || 0;
                const projection = brandProjections[brand][monthIndex] || 0;

                if (shipment > 0 || projection > 0) {
                  allCapacityData.push({
                    vendorCode,
                    vendorName: vendorCode,
                    year,
                    month: monthIndex + 1,
                    client: brand,
                    totalShipment: Math.round(shipment),
                    totalProjection: Math.round(projection),
                    reservedCapacity: 0
                  });
                }
              }
            }

            // Calculate annual totals from monthly brand data
            const cbShipped = yd.monthlyBrandData['CB'].reduce((sum, val) => sum + val, 0);
            const cb2Shipped = yd.monthlyBrandData['CB2'].reduce((sum, val) => sum + val, 0);
            const ckShipped = yd.monthlyBrandData['C&K'].reduce((sum, val) => sum + val, 0);

            // If we parsed brand-level data, use the sum as total shipped
            const calculatedTotalShipped = cbShipped + cb2Shipped + ckShipped;
            let totalShipped = yd.totalShipped;
            if (calculatedTotalShipped > 0) {
              totalShipped = calculatedTotalShipped;
            }

            // Calculate utilization if not found in data
            let utilization = yd.utilization;
            if (utilization === 0 && yd.totalReservedCapacity > 0) {
              utilization = Math.round((totalShipped / yd.totalReservedCapacity) * 100);
            } else if (utilization === 0 && totalShipped > 0) {
              utilization = 100;
            }

            // Create summary for this vendor/year (include all vendors with any data)
            if (totalShipped > 0 || yd.totalReservedCapacity > 0 || yd.totalProjections > 0) {
              allSummaries.push({
                vendorCode,
                vendorName: vendorCode,
                year,
                totalReservedCapacityAnnual: Math.round(yd.totalReservedCapacity),
                totalShipmentAnnual: Math.round(totalShipped),
                totalProjectionAnnual: Math.round(yd.totalProjections),
                cbShipmentAnnual: Math.round(cbShipped),
                cb2ShipmentAnnual: Math.round(cb2Shipped),
                ckShipmentAnnual: Math.round(ckShipped),
                avgUtilizationPct: Math.round(utilization)
              });
              console.log(`Added summary for ${vendorCode} year ${year}: reserved=${yd.totalReservedCapacity}, shipped=${totalShipped}`);
            }
          }
          importStats.vendorsProcessed++;
        } catch (sheetError: any) {
          importStats.errors.push(`Error processing sheet ${sheetName}: ${sheetError.message}`);
        }
      }

      // Bulk insert all capacity data
      if (allCapacityData.length > 0) {
        await storage.bulkCreateVendorCapacityData(allCapacityData);
        importStats.totalRecords = allCapacityData.length;
      }

      // Bulk insert all summaries
      if (allSummaries.length > 0) {
        await storage.bulkCreateVendorCapacitySummary(allSummaries);
        importStats.summariesCreated = allSummaries.length;
      }

      res.json({
        success: true,
        message: `Successfully imported capacity data for ${importStats.vendorsProcessed} vendors`,
        stats: importStats
      });
    } catch (error: any) {
      console.error("Error importing vendor capacity data:", error);
      res.status(500).json({ error: error.message || "Failed to import vendor capacity data" });
    }
  });

  app.delete("/api/vendor-capacity", async (req: Express.Request, res: Response) => {
    try {
      const { vendorCode, year } = req.query;

      const deletedCount = await storage.clearVendorCapacityData(
        vendorCode as string | undefined,
        year ? parseInt(year as string) : undefined
      );

      await storage.clearVendorCapacitySummary(
        vendorCode as string | undefined,
        year ? parseInt(year as string) : undefined
      );

      res.json({ success: true, deletedCount });
    } catch (error: any) {
      console.error("Error clearing vendor capacity data:", error);
      res.status(500).json({ error: error.message || "Failed to clear vendor capacity data" });
    }
  });

  // Get locked capacity years
  app.get("/api/vendor-capacity/locked-years", async (req: Express.Request, res: Response) => {
    try {
      const lockedYears = await storage.getLockedCapacityYears();
      res.json({ lockedYears });
    } catch (error: any) {
      console.error("Error getting locked years:", error);
      res.status(500).json({ error: error.message || "Failed to get locked years" });
    }
  });

  // Lock a capacity year (mark as historic, prevent deletion on import)
  app.post("/api/vendor-capacity/lock-year/:year", async (req: Express.Request, res: Response) => {
    try {
      const year = parseInt(req.params.year);
      if (isNaN(year) || year < 2020 || year > 2050) {
        res.status(400).json({ error: "Invalid year. Must be between 2020 and 2050." });
        return;
      }

      const result = await storage.lockCapacityYear(year);
      console.log(`Locked capacity year ${year}: ${result.dataRows} data rows, ${result.summaryRows} summary rows`);

      res.json({
        success: true,
        message: `Year ${year} locked as historic. This data will be preserved during future imports.`,
        dataRowsLocked: result.dataRows,
        summaryRowsLocked: result.summaryRows
      });
    } catch (error: any) {
      console.error("Error locking capacity year:", error);
      res.status(500).json({ error: error.message || "Failed to lock capacity year" });
    }
  });

  // Unlock a capacity year (allow updates on import)
  app.post("/api/vendor-capacity/unlock-year/:year", async (req: Express.Request, res: Response) => {
    try {
      const year = parseInt(req.params.year);
      if (isNaN(year) || year < 2020 || year > 2050) {
        res.status(400).json({ error: "Invalid year. Must be between 2020 and 2050." });
        return;
      }

      const result = await storage.unlockCapacityYear(year);
      console.log(`Unlocked capacity year ${year}: ${result.dataRows} data rows, ${result.summaryRows} summary rows`);

      res.json({
        success: true,
        message: `Year ${year} unlocked. This data can now be updated during imports.`,
        dataRowsUnlocked: result.dataRows,
        summaryRowsUnlocked: result.summaryRows
      });
    } catch (error: any) {
      console.error("Error unlocking capacity year:", error);
      res.status(500).json({ error: error.message || "Failed to unlock capacity year" });
    }
  });

  // Automatic year-end locking check - locks previous year if current date is in new year
  app.post("/api/vendor-capacity/auto-lock-previous-year", async (req: Express.Request, res: Response) => {
    try {
      const currentYear = new Date().getFullYear();
      const previousYear = currentYear - 1;

      // Check if previous year is already locked
      const lockedYears = await storage.getLockedCapacityYears();
      if (lockedYears.includes(previousYear)) {
        res.json({
          success: true,
          message: `Year ${previousYear} is already locked.`,
          alreadyLocked: true,
          lockedYears
        });
        return;
      }

      // Lock the previous year
      const result = await storage.lockCapacityYear(previousYear);
      console.log(`Auto-locked previous year ${previousYear}: ${result.dataRows} data rows, ${result.summaryRows} summary rows`);

      res.json({
        success: true,
        message: `Automatically locked year ${previousYear} as historic data.`,
        yearLocked: previousYear,
        dataRowsLocked: result.dataRows,
        summaryRowsLocked: result.summaryRows,
        lockedYears: [...lockedYears, previousYear].sort((a, b) => a - b)
      });
    } catch (error: any) {
      console.error("Error auto-locking previous year:", error);
      res.status(500).json({ error: error.message || "Failed to auto-lock previous year" });
    }
  });

  // Update reserved capacity for a vendor/year/month
  app.patch("/api/vendor-capacity/:vendorCode/:year/:month", async (req: Express.Request, res: Response) => {
    try {
      const { vendorCode, year, month } = req.params;
      const { reservedCapacity } = req.body;

      if (!reservedCapacity && reservedCapacity !== 0) {
        res.status(400).json({ error: "reservedCapacity is required" });
        return;
      }

      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      const capacityValue = Math.round(parseFloat(reservedCapacity) * 100); // Convert dollars to cents

      // Update all client rows for this vendor/year/month with the new total reserved capacity
      // Since we store by client, we'll update the first row and clear the others to avoid double-counting
      const existingRows = await db
        .select()
        .from(vendorCapacityData)
        .where(
          and(
            eq(vendorCapacityData.vendorCode, decodeURIComponent(vendorCode)),
            eq(vendorCapacityData.year, yearNum),
            eq(vendorCapacityData.month, monthNum)
          )
        );

      if (existingRows.length === 0) {
        // Create a new row if none exists
        await db.insert(vendorCapacityData).values({
          vendorCode: decodeURIComponent(vendorCode),
          vendorName: decodeURIComponent(vendorCode),
          client: 'ALL',
          year: yearNum,
          month: monthNum,
          reservedCapacity: capacityValue,
        });
      } else {
        // Update the first row with the total capacity, zero out others
        const [firstRow, ...otherRows] = existingRows;
        await db
          .update(vendorCapacityData)
          .set({ reservedCapacity: capacityValue })
          .where(eq(vendorCapacityData.id, firstRow.id));

        // Zero out reserved capacity in other rows to avoid double-counting
        for (const row of otherRows) {
          await db
            .update(vendorCapacityData)
            .set({ reservedCapacity: 0 })
            .where(eq(vendorCapacityData.id, row.id));
        }
      }

      res.json({ success: true, message: "Reserved capacity updated" });
    } catch (error: any) {
      console.error("Error updating reserved capacity:", error);
      res.status(500).json({ error: error.message || "Failed to update reserved capacity" });
    }
  });

  // Vendor-specific SKU Projections Import
  app.post("/api/vendor-capacity/sku-projections/:vendorId/import", upload.single("file"), async (req: Express.Request, res: Response) => {
    try {
      const vendorId = parseInt(req.params.vendorId);
      if (isNaN(vendorId)) {
        res.status(400).json({ error: "Invalid vendor ID" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      // Look up vendor to get vendor code
      const vendor = await storage.getVendorById(vendorId);
      if (!vendor) {
        res.status(404).json({ error: "Vendor not found" });
        return;
      }

      const xlsx = await import("xlsx");
      const workbook = xlsx.read(req.file.buffer, { type: "buffer" });

      const importStats = {
        vendorCode: vendor.vendorCode,
        vendorName: vendor.vendorName,
        projectionsImported: 0,
        projectionsArchived: 0,
        skusProcessed: 0,
        errors: [] as string[],
        brandBreakdown: { CB: 0, CB2: 0, "C&K": 0 } as Record<string, number>
      };

      // Brand mapping: CRATEKIDS→C&K, CRATE→CB, CB2→CB2
      // Returns null for unknown brands to allow rejection
      const mapBrand = (sourceBrand: string): string | null => {
        const normalized = String(sourceBrand || "").trim().toUpperCase();
        if (normalized === "CRATEKIDS" || normalized === "C&K" || normalized === "CK" || normalized === "CRATE & KIDS" || normalized === "CRATE AND KIDS") return "C&K";
        if (normalized === "CRATE" || normalized === "CB" || normalized === "CRATE & BARREL" || normalized === "CRATE AND BARREL") return "CB";
        if (normalized === "CB2") return "CB2";
        // Return null for unknown brands instead of silently converting
        return null;
      };

      const unknownBrands = new Set<string>();

      // Get first sheet (assume data is in first sheet)
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (jsonData.length < 2) {
        res.status(400).json({ error: "File appears to be empty or has no data rows" });
        return;
      }

      // Find header row (look for SKU, Brand, Year, Month columns)
      let headerRowIdx = -1;
      let columnMap: Record<string, number> = {};

      const requiredColumns = ["sku", "brand"];
      const optionalColumns = ["description", "year", "month", "value", "quantity", "fob", "coo", "lead_time"];
      const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

      for (let i = 0; i < Math.min(10, jsonData.length); i++) {
        const row = jsonData[i];
        if (!row || !Array.isArray(row)) continue;

        const headers = row.map(cell => String(cell || "").toLowerCase().trim().replace(/\s+/g, "_"));

        // Check if this row has SKU and Brand columns
        const hasRequired = headers.some(h => h.includes("sku") || h === "style") &&
          headers.some(h => h.includes("brand"));

        if (hasRequired) {
          headerRowIdx = i;
          headers.forEach((h, idx) => {
            if (h.includes("sku") || h === "style") columnMap["sku"] = idx;
            if (h.includes("brand") && !h.includes("source")) columnMap["brand"] = idx;
            if (h.includes("source") && h.includes("brand")) columnMap["source_brand"] = idx;
            if (h.includes("desc")) columnMap["description"] = idx;
            if (h === "year") columnMap["year"] = idx;
            if (h === "month") columnMap["month"] = idx;
            if (h.includes("value") || h.includes("usd") || h.includes("projection")) columnMap["value"] = idx;
            if (h.includes("qty") || h.includes("quantity") || h.includes("units")) columnMap["quantity"] = idx;
            if (h.includes("fob") || h.includes("price")) columnMap["fob"] = idx;
            if (h.includes("coo") || h.includes("country") || h.includes("origin")) columnMap["coo"] = idx;
            if (h.includes("lead") || h.includes("lt")) columnMap["lead_time"] = idx;

            // Check for month columns (Jan, Feb, etc.)
            monthNames.forEach((month, monthIdx) => {
              if (h === month || h.startsWith(month + "_") || h.includes(month)) {
                columnMap[`month_${monthIdx + 1}`] = idx;
              }
            });
          });
          break;
        }
      }

      if (headerRowIdx === -1) {
        res.status(400).json({
          error: "Could not find header row with required columns (SKU and Brand)",
          hint: "Make sure your file has columns for SKU/Style and Brand"
        });
        return;
      }

      console.log(`SKU Projections import for vendor ${vendor.vendorCode}: found header at row ${headerRowIdx + 1}, columns:`, columnMap);

      // Archive existing projections for this vendor before import
      const archivedCount = await storage.archiveVendorSkuProjections(vendorId);
      importStats.projectionsArchived = archivedCount;
      console.log(`Archived ${archivedCount} existing projections for vendor ${vendorId}`);

      // Determine if file has month columns (horizontal layout) or year/month rows (vertical layout)
      const hasMonthColumns = Object.keys(columnMap).some(k => k.startsWith("month_"));
      const hasYearColumn = columnMap["year"] !== undefined;
      const currentYear = new Date().getFullYear();

      const projectionsToInsert: any[] = [];

      if (hasMonthColumns) {
        // Horizontal layout: each row is a SKU with values in month columns
        for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || !Array.isArray(row)) continue;

          const sku = String(row[columnMap["sku"]] || "").trim();
          if (!sku) continue;

          const sourceBrand = String(row[columnMap["source_brand"] ?? columnMap["brand"]] || "").trim();
          const rawBrand = String(row[columnMap["brand"]] || sourceBrand).trim();
          const brand = mapBrand(rawBrand);

          // Track unknown brands and skip the row
          if (!brand) {
            if (rawBrand) unknownBrands.add(rawBrand);
            continue;
          }

          const description = columnMap["description"] !== undefined ? String(row[columnMap["description"]] || "") : "";
          const coo = columnMap["coo"] !== undefined ? String(row[columnMap["coo"]] || "") : "";
          const leadTime = columnMap["lead_time"] !== undefined ? parseInt(String(row[columnMap["lead_time"]] || "0")) || null : null;
          const fob = columnMap["fob"] !== undefined ? Math.round(parseFloat(String(row[columnMap["fob"]] || "0")) * 100) : 0;
          const year = hasYearColumn && columnMap["year"] !== undefined
            ? parseInt(String(row[columnMap["year"]] || currentYear))
            : currentYear;

          // Extract values from each month column
          for (let month = 1; month <= 12; month++) {
            const monthColKey = `month_${month}`;
            if (columnMap[monthColKey] !== undefined) {
              const value = parseFloat(String(row[columnMap[monthColKey]] || "0")) || 0;
              if (value > 0) {
                projectionsToInsert.push({
                  vendorId,
                  vendorCode: vendor.vendorCode,
                  sku,
                  skuDescription: description,
                  brand,
                  sourceBrand: sourceBrand || brand,
                  coo,
                  vendorLeadTime: leadTime,
                  fob,
                  year,
                  month,
                  projectionValue: Math.round(value * 100), // Convert to cents
                  quantity: 0,
                  importDate: new Date(),
                  importedBy: "system"
                });
                importStats.brandBreakdown[brand] = (importStats.brandBreakdown[brand] || 0) + 1;
              }
            }
          }
          importStats.skusProcessed++;
        }
      } else {
        // Vertical layout: each row has year, month, and value columns
        for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || !Array.isArray(row)) continue;

          const sku = String(row[columnMap["sku"]] || "").trim();
          if (!sku) continue;

          const sourceBrand = String(row[columnMap["source_brand"] ?? columnMap["brand"]] || "").trim();
          const rawBrand = String(row[columnMap["brand"]] || sourceBrand).trim();
          const brand = mapBrand(rawBrand);

          // Track unknown brands and skip the row
          if (!brand) {
            if (rawBrand) unknownBrands.add(rawBrand);
            continue;
          }

          const description = columnMap["description"] !== undefined ? String(row[columnMap["description"]] || "") : "";
          const coo = columnMap["coo"] !== undefined ? String(row[columnMap["coo"]] || "") : "";
          const leadTime = columnMap["lead_time"] !== undefined ? parseInt(String(row[columnMap["lead_time"]] || "0")) || null : null;
          const fob = columnMap["fob"] !== undefined ? Math.round(parseFloat(String(row[columnMap["fob"]] || "0")) * 100) : 0;
          const year = parseInt(String(row[columnMap["year"] ?? ""] || currentYear)) || currentYear;
          const month = parseInt(String(row[columnMap["month"] ?? ""] || "1")) || 1;
          const value = parseFloat(String(row[columnMap["value"] ?? ""] || "0")) || 0;
          const quantity = parseInt(String(row[columnMap["quantity"] ?? ""] || "0")) || 0;

          if (value > 0 || quantity > 0) {
            projectionsToInsert.push({
              vendorId,
              vendorCode: vendor.vendorCode,
              sku,
              skuDescription: description,
              brand,
              sourceBrand: sourceBrand || brand,
              coo,
              vendorLeadTime: leadTime,
              fob,
              year,
              month,
              projectionValue: Math.round(value * 100), // Convert to cents
              quantity,
              importDate: new Date(),
              importedBy: "system"
            });
            importStats.brandBreakdown[brand] = (importStats.brandBreakdown[brand] || 0) + 1;
          }
          importStats.skusProcessed++;
        }
      }

      // Check for unknown brands and report as error if no valid data found
      const unknownBrandsList = Array.from(unknownBrands);
      if (unknownBrandsList.length > 0) {
        importStats.errors.push(`Skipped rows with unknown brands: ${unknownBrandsList.join(', ')}. Valid brands are: CB, CB2, C&K, CRATE, CRATEKIDS.`);
      }

      // If we have no valid projections but had unknown brands, return error
      if (projectionsToInsert.length === 0 && unknownBrandsList.length > 0) {
        res.status(422).json({
          success: false,
          error: `No valid projections found. All rows had unrecognized brands: ${unknownBrandsList.join(', ')}`,
          validBrands: ["CB", "CB2", "C&K", "CRATE", "CRATEKIDS"],
          stats: importStats
        });
        return;
      }

      // Bulk insert projections
      if (projectionsToInsert.length > 0) {
        const insertedCount = await storage.bulkInsertVendorSkuProjections(projectionsToInsert);
        importStats.projectionsImported = insertedCount;
      }

      console.log(`SKU Projections import complete for ${vendor.vendorCode}:`, importStats);

      res.json({
        success: true,
        message: `Successfully imported ${importStats.projectionsImported} SKU projections for ${vendor.vendorName}${unknownBrandsList.length > 0 ? ` (${unknownBrandsList.length} unknown brand(s) skipped)` : ''}`,
        stats: {
          ...importStats,
          unknownBrands: unknownBrandsList
        }
      });

    } catch (error: any) {
      console.error("Error importing vendor SKU projections:", error);
      res.status(500).json({ error: error.message || "Failed to import SKU projections" });
    }
  });

  // Get vendor SKU projections
  app.get("/api/vendor-capacity/sku-projections/:vendorId", async (req: Express.Request, res: Response) => {
    try {
      const vendorId = parseInt(req.params.vendorId);
      const year = req.query.year ? parseInt(req.query.year as string) : undefined;
      const month = req.query.month ? parseInt(req.query.month as string) : undefined;

      if (isNaN(vendorId)) {
        res.status(400).json({ error: "Invalid vendor ID" });
        return;
      }

      const projections = await storage.getVendorSkuProjections(vendorId, year, month);
      res.json(projections);
    } catch (error: any) {
      console.error("Error fetching vendor SKU projections:", error);
      res.status(500).json({ error: error.message || "Failed to fetch SKU projections" });
    }
  });

  // Get vendor SKU projection history (for accuracy analysis)
  app.get("/api/vendor-capacity/sku-projections/:vendorId/history", async (req: Express.Request, res: Response) => {
    try {
      const vendorId = parseInt(req.params.vendorId);
      const sku = req.query.sku as string | undefined;
      const year = req.query.year ? parseInt(req.query.year as string) : undefined;

      if (isNaN(vendorId)) {
        res.status(400).json({ error: "Invalid vendor ID" });
        return;
      }

      const history = await storage.getVendorSkuProjectionHistory(vendorId, sku, year);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching vendor SKU projection history:", error);
      res.status(500).json({ error: error.message || "Failed to fetch SKU projection history" });
    }
  });

  // Get expired projections for a vendor (for capacity tracking verification)
  app.get("/api/vendor-capacity/expired-projections/:vendorCode/:year", async (req: Express.Request, res: Response) => {
    try {
      const { vendorCode, year } = req.params;
      const targetYear = parseInt(year) || new Date().getFullYear();
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;

      // Get vendor name for matching
      let vendorName = vendorCode;
      const vendorResult = await db.execute(sql`
        SELECT id, name FROM vendors 
        WHERE LOWER(name) LIKE ${vendorCode.toLowerCase() + '%'}
        OR LOWER(name) LIKE ${'%' + vendorCode.toLowerCase() + '%'}
        LIMIT 1
      `);
      let vendorId: number | null = null;
      if (vendorResult.rows.length > 0) {
        vendorId = vendorResult.rows[0].id as number;
        vendorName = vendorResult.rows[0].name as string;
      }

      // Get expired projections for this vendor from active_projections
      // NOTE: active_projections already represents latest state per vendor/SKU
      const clientFilter = clientId ? sql`AND ap.client_id = ${clientId}` : sql``;
      const expiredResult = await db.execute(sql`
        SELECT 
          ap.id,
          ap.sku,
          ap.sku_description as description,
          ap.brand,
          ap.year,
          ap.month,
          ap.quantity as projection_quantity,
          ap.projection_value,
          ap.order_type,
          ap.match_status,
          ap.updated_at as expired_at,
          ap.updated_at,
          v.name as vendor_name
        FROM active_projections ap
        JOIN vendors v ON ap.vendor_id = v.id
        WHERE ap.match_status = 'expired'
          AND ap.year = ${targetYear}
          ${clientFilter}
          AND (
            ap.vendor_id = ${vendorId}
            OR LOWER(v.name) LIKE ${vendorCode.toLowerCase() + '%'}
            OR LOWER(v.name) = ${vendorName.toLowerCase()}
          )
        ORDER BY ap.month, ap.brand, ap.sku
      `);

      res.json(expiredResult.rows);
    } catch (error: any) {
      console.error("Error fetching expired projections:", error);
      res.status(500).json({ error: error.message || "Failed to fetch expired projections" });
    }
  });

  // Projection Filter Options - Get unique vendors and brands from projections
  app.get("/api/projections/filter-options", async (req: Express.Request, res: Response) => {
    try {
      const filterOptions = await storage.getProjectionFilterOptions();
      res.json(filterOptions);
    } catch (error: any) {
      console.error("Error fetching projection filter options:", error);
      res.status(500).json({ error: error.message || "Failed to fetch filter options" });
    }
  });

  // Projection Validation Report - Get overdue, at-risk, and SPO projections with filtering
  app.get("/api/projections/validation-report", async (req: Express.Request, res: Response) => {
    try {
      const thresholdDays = req.query.threshold ? parseInt(req.query.threshold as string) : 90;
      const minVariancePct = req.query.minVariance ? parseInt(req.query.minVariance as string) : 10;

      // Extract filters
      const filters = {
        vendorId: req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined,
        brand: req.query.brand as string | undefined,
        year: req.query.year ? parseInt(req.query.year as string) : undefined,
        month: req.query.month ? parseInt(req.query.month as string) : undefined,
      };

      // Get overdue projections (within threshold or past due) - filtered
      const overdueProjections = await storage.getOverdueProjections(thresholdDays, filters);

      // Get projections with significant variances - filtered
      const varianceProjections = await storage.getProjectionsWithVariance(minVariancePct, filters);

      // Get SPO/MTO projections - filtered
      const spoProjections = await storage.getSpoProjections(filters);

      // Get overall summary - filtered
      const summary = await storage.getProjectionValidationSummary(undefined, filters);

      res.json({
        summary,
        overdue: overdueProjections,
        variances: varianceProjections,
        spo: spoProjections
      });
    } catch (error: any) {
      console.error("Error generating projection validation report:", error);
      res.status(500).json({ error: error.message || "Failed to generate validation report" });
    }
  });

  // Export projections to Excel
  app.get("/api/projections/export-excel", async (req: Express.Request, res: Response) => {
    try {
      const tab = req.query.tab as string || 'all';
      const filters = {
        vendorId: req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined,
        brand: req.query.brand as string | undefined,
        year: req.query.year ? parseInt(req.query.year as string) : undefined,
        month: req.query.month ? parseInt(req.query.month as string) : undefined,
      };

      // Get vendor name lookup for exports
      const vendorList = await storage.getVendors();
      const vendorMap = new Map(vendorList.map(v => [v.id, v.name]));

      // Get data based on active tab
      let data: any[] = [];
      let sheetName = 'Projections';

      if (tab === 'overdue' || tab === 'all') {
        const overdueProjections = await storage.getOverdueProjections(90, filters);
        data = overdueProjections.map(p => ({
          Vendor: vendorMap.get(p.vendorId) || 'Unknown',
          'Client Vendor ID': p.vendorCode,
          SKU: p.sku,
          Description: p.skuDescription || '',
          Brand: p.brand,
          Year: p.year,
          Month: p.month,
          Quantity: p.quantity,
          'Projected Value': (p.projectionValue || 0) / 100,
          Type: p.orderType === 'mto' ? 'MTO' : 'Regular',
          'Days Until Due': p.daysUntilDue,
          Status: p.isOverdue ? 'Overdue' : 'At Risk'
        }));
        sheetName = 'Overdue & At Risk';
      }

      if (tab === 'variances') {
        const varianceProjections = await storage.getProjectionsWithVariance(10, filters);
        data = varianceProjections.map(p => ({
          Vendor: vendorMap.get(p.vendorId) || 'Unknown',
          'Client Vendor ID': p.vendorCode,
          SKU: p.sku,
          Description: p.skuDescription || '',
          Brand: p.brand,
          Year: p.year,
          Month: p.month,
          'Matched PO': p.matchedPoNumber || '',
          'Projected Qty': p.quantity,
          'Actual Qty': p.actualQuantity || 0,
          'Qty Variance': p.quantityVariance || 0,
          'Variance %': p.variancePct || 0,
          'Projected Value': (p.projectionValue || 0) / 100,
          'Actual Value': (p.actualValue || 0) / 100
        }));
        sheetName = 'Volume Variances';
      }

      if (tab === 'spo') {
        const spoProjections = await storage.getSpoProjections(filters);
        data = spoProjections.map(p => ({
          Vendor: vendorMap.get(p.vendorId) || 'Unknown',
          'Client Vendor ID': p.vendorCode,
          Collection: p.collection || '',
          SKU: p.sku,
          Description: p.skuDescription || '',
          Brand: p.brand,
          Year: p.year,
          Month: p.month,
          'Projected Qty': p.quantity,
          'Projected Value': (p.projectionValue || 0) / 100,
          Status: p.matchStatus || 'unmatched',
          'Matched PO': p.matchedPoNumber || '',
          'Actual Qty': p.actualQuantity || 0,
          'Actual Value': (p.actualValue || 0) / 100,
          'Variance %': p.variancePct || 0
        }));
        sheetName = 'SPO MTO Projections';
      }

      // Create Excel workbook
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      // Generate buffer
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=projections_${tab}_${new Date().toISOString().split('T')[0]}.xlsx`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Error exporting projections to Excel:", error);
      res.status(500).json({ error: error.message || "Failed to export" });
    }
  });

  // Get projection validation summary for a specific vendor
  app.get("/api/projections/validation-summary/:vendorId", async (req: Express.Request, res: Response) => {
    try {
      const vendorId = parseInt(req.params.vendorId);
      if (isNaN(vendorId)) {
        res.status(400).json({ error: "Invalid vendor ID" });
        return;
      }

      const summary = await storage.getProjectionValidationSummary(vendorId);
      res.json(summary);
    } catch (error: any) {
      console.error("Error fetching vendor projection summary:", error);
      res.status(500).json({ error: error.message || "Failed to fetch summary" });
    }
  });

  // Mark projection as removed/expired
  app.post("/api/projections/:projectionId/remove", async (req: Express.Request, res: Response) => {
    try {
      const projectionId = parseInt(req.params.projectionId);
      const { reason } = req.body;

      if (isNaN(projectionId)) {
        res.status(400).json({ error: "Invalid projection ID" });
        return;
      }

      if (!reason || typeof reason !== 'string') {
        res.status(400).json({ error: "Removal reason is required" });
        return;
      }

      const result = await storage.markProjectionRemoved(projectionId, reason);
      if (!result) {
        res.status(404).json({ error: "Projection not found" });
        return;
      }

      res.json({ success: true, projection: result });
    } catch (error: any) {
      console.error("Error removing projection:", error);
      res.status(500).json({ error: error.message || "Failed to remove projection" });
    }
  });

  // Unmatch a projection (revert to unmatched state)
  app.post("/api/projections/:projectionId/unmatch", async (req: Express.Request, res: Response) => {
    try {
      const projectionId = parseInt(req.params.projectionId);

      if (isNaN(projectionId)) {
        res.status(400).json({ error: "Invalid projection ID" });
        return;
      }

      const result = await storage.unmatchProjection(projectionId);
      if (!result) {
        res.status(404).json({ error: "Projection not found" });
        return;
      }

      res.json({ success: true, projection: result });
    } catch (error: any) {
      console.error("Error unmatching projection:", error);
      res.status(500).json({ error: error.message || "Failed to unmatch projection" });
    }
  });

  // Manually match a projection to a PO
  app.post("/api/projections/:projectionId/match", async (req: Express.Request, res: Response) => {
    try {
      const projectionId = parseInt(req.params.projectionId);
      const { poNumber } = req.body;

      if (isNaN(projectionId)) {
        res.status(400).json({ error: "Invalid projection ID" });
        return;
      }

      if (!poNumber || typeof poNumber !== 'string') {
        res.status(400).json({ error: "PO number is required" });
        return;
      }

      const result = await storage.manualMatchProjection(projectionId, poNumber);
      res.json({ success: true, projection: result });
    } catch (error: any) {
      console.error("Error matching projection:", error);
      res.status(500).json({ error: error.message || "Failed to match projection" });
    }
  });

  // Update projection order type (regular/mto)
  app.patch("/api/projections/:projectionId/order-type", async (req: Express.Request, res: Response) => {
    try {
      const projectionId = parseInt(req.params.projectionId);
      const { orderType } = req.body;

      if (isNaN(projectionId)) {
        res.status(400).json({ error: "Invalid projection ID" });
        return;
      }

      if (!orderType || !['regular', 'mto'].includes(orderType)) {
        res.status(400).json({ error: "Order type must be 'regular' or 'mto'" });
        return;
      }

      const result = await storage.updateProjectionOrderType(projectionId, orderType);
      if (!result) {
        res.status(404).json({ error: "Projection not found" });
        return;
      }

      res.json({ success: true, projection: result });
    } catch (error: any) {
      console.error("Error updating projection order type:", error);
      res.status(500).json({ error: error.message || "Failed to update order type" });
    }
  });

  // Trigger projection matching manually (useful for re-running after corrections)
  // ===== EXPIRED PROJECTIONS MANAGEMENT =====
  // Check and expire projections that are past their order window
  // Regular POs: 90 days before end of target month
  // SPO/MTO: 30 days before end of target month
  app.post("/api/projections/check-expired", async (req: Express.Request, res: Response) => {
    try {
      const result = await storage.checkAndExpireProjections();
      res.json({
        success: true,
        message: `Expired ${result.expiredCount} projections`,
        regularExpired: result.regularExpired,
        spoExpired: result.spoExpired
      });
    } catch (error: any) {
      console.error("Error checking expired projections:", error);
      res.status(500).json({ error: error.message || "Failed to check expired projections" });
    }
  });

  // Get all expired projections for CBH verification
  app.get("/api/projections/expired", async (req: Express.Request, res: Response) => {
    try {
      const filters = {
        vendorId: req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined,
        brand: req.query.brand as string | undefined,
        year: req.query.year ? parseInt(req.query.year as string) : undefined,
        month: req.query.month ? parseInt(req.query.month as string) : undefined,
        status: req.query.status as string | undefined,
      };

      const expiredProjections = await storage.getExpiredProjections(filters);
      const summary = await storage.getExpiredProjectionsSummary();

      res.json({
        projections: expiredProjections,
        summary
      });
    } catch (error: any) {
      console.error("Error fetching expired projections:", error);
      res.status(500).json({ error: error.message || "Failed to fetch expired projections" });
    }
  });

  // Get summary of expired projections
  app.get("/api/projections/expired/summary", async (req: Express.Request, res: Response) => {
    try {
      const summary = await storage.getExpiredProjectionsSummary();
      res.json(summary);
    } catch (error: any) {
      console.error("Error fetching expired projections summary:", error);
      res.status(500).json({ error: error.message || "Failed to fetch summary" });
    }
  });

  // Restore an expired projection back to active state
  app.post("/api/projections/expired/:expiredId/restore", async (req: Express.Request, res: Response) => {
    try {
      const expiredId = parseInt(req.params.expiredId);
      const restoredBy = req.body.restoredBy || 'system';

      if (isNaN(expiredId)) {
        res.status(400).json({ error: "Invalid expired projection ID" });
        return;
      }

      const result = await storage.restoreExpiredProjection(expiredId, restoredBy);
      if (!result) {
        res.status(404).json({ error: "Expired projection not found" });
        return;
      }

      res.json({ success: true, message: "Projection restored successfully" });
    } catch (error: any) {
      console.error("Error restoring expired projection:", error);
      res.status(500).json({ error: error.message || "Failed to restore projection" });
    }
  });

  // Verify an expired projection (mark as verified or cancelled after CBH review)
  app.post("/api/projections/expired/:expiredId/verify", async (req: Express.Request, res: Response) => {
    try {
      const expiredId = parseInt(req.params.expiredId);
      const { status, verifiedBy, notes } = req.body;

      if (isNaN(expiredId)) {
        res.status(400).json({ error: "Invalid expired projection ID" });
        return;
      }

      if (!status || !['verified', 'cancelled'].includes(status)) {
        res.status(400).json({ error: "Status must be 'verified' or 'cancelled'" });
        return;
      }

      const result = await storage.verifyExpiredProjection(expiredId, status, verifiedBy || 'system', notes);
      if (!result) {
        res.status(404).json({ error: "Expired projection not found" });
        return;
      }

      res.json({ success: true, message: `Projection marked as ${status}` });
    } catch (error: any) {
      console.error("Error verifying expired projection:", error);
      res.status(500).json({ error: error.message || "Failed to verify projection" });
    }
  });

  // Admin: Mark expired projection as verified (keeps record for accuracy tracking)
  app.patch("/api/projections/:projectionId/verify", async (req: Express.Request, res: Response) => {
    try {
      const projectionId = parseInt(req.params.projectionId);
      const { verifiedBy, notes } = req.body;

      if (isNaN(projectionId)) {
        res.status(400).json({ error: "Invalid projection ID" });
        return;
      }

      // Mark projection as verified_unmatched - keeps record for accuracy reporting
      // Calculate variance as 100% (projected vs $0 actual since no order was placed)
      const projection = await db.select().from(activeProjections)
        .where(eq(activeProjections.id, projectionId))
        .limit(1);

      if (projection.length === 0) {
        res.status(404).json({ error: "Projection not found" });
        return;
      }

      const proj = projection[0];
      const projectedValue = proj.projectionValue || 0;

      await db.update(activeProjections)
        .set({
          matchStatus: 'verified_unmatched',
          matchedAt: new Date(),
          actualQuantity: 0,
          actualValue: 0,
          quantityVariance: -(proj.quantity || 0),
          valueVariance: -projectedValue,
          variancePct: -100, // 100% under-ordering (projected but never ordered)
          updatedAt: new Date()
        })
        .where(eq(activeProjections.id, projectionId));

      res.json({
        success: true,
        message: "Projection marked as verified (unmatched)",
        varianceData: {
          projectedValue: projectedValue / 100,
          actualValue: 0,
          variancePct: -100
        }
      });
    } catch (error: any) {
      console.error("Error verifying projection:", error);
      res.status(500).json({ error: error.message || "Failed to verify projection" });
    }
  });

  // Admin: Run projection matching for existing POs (retroactive matching)
  // Matches by SKU within vendor+month, consuming projections based on quantity
  app.post("/api/projections/run-matching", async (req: Express.Request, res: Response) => {
    try {
      const { year, vendorId } = req.body;
      const targetYear = year || new Date().getFullYear();

      const result = await runProjectionMatching(targetYear, vendorId);

      res.json({
        ...result,
        targetYear
      });
    } catch (error: any) {
      console.error("Error running SKU-level matching:", error);
      res.status(500).json({ error: error.message || "Failed to run matching" });
    }
  });

  // Projection Accuracy Report - Compares LOCKED projections vs ACTUAL orders from po_headers
  // Projected = last_forecast_value (frozen at 90 days for regular, 30 days for SPO/MTO before month end)
  // Actual = ALL orders from po_headers (same data source as Dashboard KPIs)
  app.get("/api/projections/accuracy-report", async (req: Express.Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;
      const horizon = req.query.horizon as string | undefined; // '90_day', '6_month', '90_day_from_today'
      const orderType = req.query.orderType as string | undefined; // 'regular', 'mto'
      const brand = req.query.brand as string | undefined; // 'CB', 'CB2', 'C&K'
      const monthsParam = req.query.months as string | undefined; // comma-separated list of months
      const months = monthsParam ? monthsParam.split(',').map(m => parseInt(m)).filter(m => !isNaN(m) && m >= 1 && m <= 12) : [];

      // Use projection_snapshots for backward-looking accuracy analysis
      // This compares actual POs against historical forecasts captured at import time
      // Default to 90_day horizon for lock reference
      // "90_day_from_today" uses 90 days from current date as snapshot reference
      let lockHorizon = horizon || '90_day';
      let importDateFilter = sql``;

      if (horizon === '90_day_from_today') {
        // For 90 days from today, we want snapshots imported around 90 days ago
        // These should now be firm orders for regular products
        lockHorizon = '90_day';
        const importCutoff = new Date();
        importCutoff.setDate(importCutoff.getDate() - 90);
        importDateFilter = sql`AND ps.import_date <= ${importCutoff.toISOString().split('T')[0]}`;
      }

      const projectionsResult = await db.execute(sql`
        SELECT 
          ps.vendor_id,
          v.name as vendor_name,
          COALESCE(ps.brand, 'CB') as brand,
          ps.month as month,
          COALESCE(ps.order_type, 'regular') as order_type,
          SUM(COALESCE(ps.projection_value, 0)) as projection_value,
          COUNT(*) as projection_count
        FROM projection_snapshots ps
        JOIN vendors v ON ps.vendor_id = v.id
        WHERE 
          ps.year = ${year}
          ${importDateFilter}
          ${vendorId ? sql`AND ps.vendor_id = ${vendorId}` : sql``}
          ${months.length > 0 ? sql`AND ps.month IN ${sql.raw(`(${months.join(',')})`)}` : sql``}
          ${orderType === 'mto'
          ? sql`AND LOWER(COALESCE(ps.order_type, 'regular')) IN ('mto', 'spo')`
          : orderType === 'regular'
            ? sql`AND LOWER(COALESCE(ps.order_type, 'regular')) NOT IN ('mto', 'spo')`
            : sql``}
          ${brand ? sql`AND COALESCE(ps.brand, 'CB') = ${brand}` : sql``}
        GROUP BY ps.vendor_id, v.name, COALESCE(ps.brand, 'CB'), ps.month, COALESCE(ps.order_type, 'regular')
        ORDER BY v.name, ps.month
      `);

      // Get ACTUAL orders - matching Dashboard KPI logic EXACTLY:
      // Actuals query: Match orders by SHIP DATE (when order is expected to ship) to projection month
      // Projections forecast what will ship in each month, so actuals should match by ship date
      // Uses total_value (Total USD) for the order value
      // Build brand filter for actuals query
      const brandFilter = brand
        ? sql`AND (
            CASE 
              WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
              WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
              ELSE 'CB'
            END
          ) = ${brand}`
        : sql``;

      // Build order type filter for actuals query
      // MTO/SPO orders are identified by program_description starting with MTO or SPO
      let orderTypeFilter = sql``;
      if (orderType === 'mto') {
        orderTypeFilter = sql`AND (ph.program_description ILIKE 'MTO%' OR ph.program_description ILIKE 'SPO%')`;
      } else if (orderType === 'regular') {
        orderTypeFilter = sql`AND (ph.program_description IS NULL OR (ph.program_description NOT ILIKE 'MTO%' AND ph.program_description NOT ILIKE 'SPO%'))`;
      }

      const actualsResult = await db.execute(sql`
        WITH orders_by_ship_date AS (
          -- Sum po_headers.total_value by SHIP DATE month (when order is expected to ship)
          -- This matches projections which predict shipment timing
          -- Excludes SMP%, 8X8% programs to match Dashboard exclusions
          SELECT 
            ph.vendor_id,
            v.name as vendor_name,
            CASE 
              WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
              WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
              ELSE 'CB'
            END as brand,
            EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date))::int as month,
            SUM(COALESCE(ph.total_value, 0)) as order_value,
            COUNT(DISTINCT ph.po_number) as order_count
          FROM po_headers ph
          JOIN vendors v ON ph.vendor_id = v.id
          WHERE 
            COALESCE(ph.revised_ship_date, ph.original_ship_date) IS NOT NULL
            AND EXTRACT(YEAR FROM COALESCE(ph.revised_ship_date, ph.original_ship_date)) = ${year}
            AND COALESCE(ph.total_value, 0) > 0
            AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
            AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
            ${vendorId ? sql`AND ph.vendor_id = ${vendorId}` : sql``}
            ${months.length > 0 ? sql`AND EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date))::int IN ${sql.raw(`(${months.join(',')})`)}` : sql``}
            ${brandFilter}
            ${orderTypeFilter}
          GROUP BY ph.vendor_id, v.name, 
            CASE 
              WHEN ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' THEN 'CB2'
              WHEN ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%' THEN 'C&K'
              ELSE 'CB'
            END,
            EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date))::int
        ),
        all_actuals AS (
          SELECT vendor_id, vendor_name, brand, month, order_value, order_count FROM orders_by_ship_date
        )
        SELECT 
          vendor_id,
          vendor_name,
          brand,
          month,
          SUM(order_value) as actual_order_value,
          SUM(order_count) as order_count
        FROM all_actuals
        WHERE month IS NOT NULL
        GROUP BY vendor_id, vendor_name, brand, month
        ORDER BY vendor_name
      `);

      const projections = projectionsResult.rows as any[];
      const actuals = actualsResult.rows as any[];

      // Get historical projections from projection_snapshots for variance calculation
      // These are frozen forecasts captured at import time
      // Used for measuring forecast accuracy (variance trend chart)
      const lockedProjectionsResult = await db.execute(sql`
        SELECT 
          month,
          SUM(projection_value) as locked_value
        FROM projection_snapshots
        WHERE year = ${year}
        ${vendorId ? sql`AND vendor_id = ${vendorId}` : sql``}
        GROUP BY month
        ORDER BY month
      `);
      const lockedProjections = lockedProjectionsResult.rows as any[];

      // Build lookup for locked projections by month (for variance calculation)
      const lockedByMonth: Record<number, number> = {};
      for (const lp of lockedProjections) {
        lockedByMonth[Number(lp.month)] = Number(lp.locked_value) || 0;
      }

      // Build lookup for actuals by vendor+brand+month
      const actualsByKey: Record<string, { value: number; orderCount: number }> = {};
      for (const row of actuals) {
        const key = `${row.vendor_id}_${row.brand}_${row.month}`;
        if (!actualsByKey[key]) {
          actualsByKey[key] = { value: 0, orderCount: 0 };
        }
        actualsByKey[key].value += Number(row.actual_order_value) || 0;
        actualsByKey[key].orderCount += Number(row.order_count) || 0;
      }

      // Aggregate by month for chart (across all vendors)
      // Separate MTO/SPO projections from Regular projections for different chart colors
      const monthlyData: Record<number, { projectedMto: number; projectedRegular: number; actual: number }> = {};
      for (let m = 1; m <= 12; m++) {
        monthlyData[m] = { projectedMto: 0, projectedRegular: 0, actual: 0 };
      }

      // Add projections to monthly data - split by MTO vs Regular
      for (const proj of projections) {
        const month = Number(proj.month);
        const projValue = Number(proj.projection_value) || 0;
        const orderType = (proj.order_type || 'regular').toLowerCase();
        if (monthlyData[month]) {
          if (orderType === 'mto' || orderType === 'spo') {
            monthlyData[month].projectedMto += projValue;
          } else {
            monthlyData[month].projectedRegular += projValue;
          }
        }
      }

      // Add actuals to monthly data
      for (const act of actuals) {
        const month = Number(act.month);
        const actValue = Number(act.actual_order_value) || 0;
        if (monthlyData[month]) {
          monthlyData[month].actual += actValue;
        }
      }

      // Calculate vendor-level stats
      const vendorStats: Record<string, {
        vendorId: number;
        vendorName: string;
        totalProjected: number;
        totalActual: number;
        byMonth: Record<number, { projected: number; actual: number }>;
        byBrand: Record<string, { projected: number; actual: number }>;
      }> = {};

      // Process projections
      for (const proj of projections) {
        const vendorName = proj.vendor_name;
        if (!vendorStats[vendorName]) {
          vendorStats[vendorName] = {
            vendorId: proj.vendor_id,
            vendorName,
            totalProjected: 0,
            totalActual: 0,
            byMonth: {},
            byBrand: {},
          };
        }

        const stats = vendorStats[vendorName];
        const projValue = Number(proj.projection_value) || 0;
        const month = Number(proj.month);
        const brand = proj.brand || 'Unknown';

        stats.totalProjected += projValue;

        if (!stats.byMonth[month]) {
          stats.byMonth[month] = { projected: 0, actual: 0 };
        }
        stats.byMonth[month].projected += projValue;

        if (!stats.byBrand[brand]) {
          stats.byBrand[brand] = { projected: 0, actual: 0 };
        }
        stats.byBrand[brand].projected += projValue;
      }

      // Process actuals
      for (const act of actuals) {
        const vendorName = act.vendor_name;
        if (!vendorStats[vendorName]) {
          vendorStats[vendorName] = {
            vendorId: act.vendor_id,
            vendorName,
            totalProjected: 0,
            totalActual: 0,
            byMonth: {},
            byBrand: {},
          };
        }

        const stats = vendorStats[vendorName];
        const actValue = Number(act.actual_order_value) || 0;
        const month = Number(act.month);
        const brand = act.brand || 'Unknown';

        stats.totalActual += actValue;

        if (!stats.byMonth[month]) {
          stats.byMonth[month] = { projected: 0, actual: 0 };
        }
        stats.byMonth[month].actual += actValue;

        if (!stats.byBrand[brand]) {
          stats.byBrand[brand] = { projected: 0, actual: 0 };
        }
        stats.byBrand[brand].actual += actValue;
      }

      // Calculate variance and accuracy for each vendor
      const vendorSummaries = Object.values(vendorStats).map(stats => {
        const overallVariancePct = stats.totalProjected > 0
          ? ((stats.totalActual - stats.totalProjected) / stats.totalProjected) * 100
          : (stats.totalActual > 0 ? 100 : 0);

        return {
          ...stats,
          overallVariancePct,
          variance: stats.totalActual - stats.totalProjected,
        };
      });

      // Calculate overall totals
      const totalProjected = vendorSummaries.reduce((sum, v) => sum + v.totalProjected, 0);
      const totalActual = vendorSummaries.reduce((sum, v) => sum + v.totalActual, 0);
      const overallVariancePct = totalProjected > 0
        ? ((totalActual - totalProjected) / totalProjected) * 100
        : (totalActual > 0 ? 100 : 0);

      // Build monthly trend array
      // Variance is calculated using LOCKED projections (frozen forecasts) for accuracy measurement
      // Bar chart uses ROLLING projections vs actuals for operational tracking
      const monthlyTrend = Object.entries(monthlyData).map(([m, data]) => {
        const month = Number(m);
        // Use locked projections for variance calculation (accuracy measurement)
        const lockedValue = lockedByMonth[month] || 0;
        const totalProjectedThisMonth = data.projectedMto + data.projectedRegular;
        const varianceVsLocked = data.actual - lockedValue;
        const variancePct = lockedValue > 0
          ? (varianceVsLocked / lockedValue) * 100
          : (data.actual > 0 ? 0 : 0); // If no locked projection, no variance to show
        return {
          month,
          projected: totalProjectedThisMonth, // Total projections for backwards compatibility
          projectedMto: data.projectedMto, // MTO/SPO projections (orange color)
          projectedRegular: data.projectedRegular, // Regular projections (blue color)
          actual: data.actual,
          locked: lockedValue, // Locked projections for reference
          variance: varianceVsLocked,
          variancePct,
        };
      }).sort((a, b) => a.month - b.month);

      // Get counts for unmatched projections (for the warning banner)
      // NOTE: Uses active_projections (latest state per vendor/SKU)
      const unmatchedCountResult = await db.execute(sql`
        SELECT 
          COUNT(*) FILTER (WHERE match_status = 'partial') as partial_count,
          COUNT(*) FILTER (WHERE match_status IS NULL OR match_status = 'unmatched') as unmatched_count,
          COALESCE(SUM(projection_value) FILTER (WHERE match_status = 'partial'), 0) as partial_value
        FROM active_projections
        WHERE year = ${year}
        ${vendorId ? sql`AND vendor_id = ${vendorId}` : sql``}
      `);
      const counts = unmatchedCountResult.rows[0] as any;

      res.json({
        year,
        overall: {
          totalProjected,
          totalActual,
          overallVariancePct,
          variance: totalActual - totalProjected,
          partialCount: Number(counts.partial_count) || 0,
          unmatchedCount: Number(counts.unmatched_count) || 0,
          partialValue: Number(counts.partial_value) || 0,
        },
        byVendor: vendorSummaries.sort((a, b) => b.totalProjected - a.totalProjected),
        monthlyTrend,
      });
    } catch (error: any) {
      console.error("Error generating accuracy report:", error);
      res.status(500).json({ error: error.message || "Failed to generate accuracy report" });
    }
  });

  // Monthly Trends Chart - uses ROLLING projections (active_projections) vs ACTUAL orders
  // This endpoint is separate from the accuracy report to show current operational status
  // Supports optional vendorId filter for filtering by specific vendor
  app.get("/api/projections/monthly-trends", async (req: Express.Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;

      // Build vendor filter for projections
      const vendorProjectionsFilter = vendorId
        ? sql`AND ap.vendor_id = ${vendorId}`
        : sql``;

      // Get ROLLING projections from active_projections (current forecasts, not locked)
      // NOTE: active_projections already represents latest state per vendor/SKU
      const projectionsResult = await db.execute(sql`
        SELECT 
          ap.month,
          ap.order_type,
          SUM(COALESCE(ap.projection_value, 0)) as projection_value
        FROM active_projections ap
        WHERE 
          ap.year = ${year}
          ${vendorProjectionsFilter}
        GROUP BY ap.month, ap.order_type
        ORDER BY ap.month
      `);

      // Build vendor filter for actuals - need to match by vendor name from vendors table
      let vendorActualsFilter = sql``;
      if (vendorId) {
        // Get vendor name first to match against po_headers
        const vendorResult = await db.execute(sql`SELECT name FROM vendors WHERE id = ${vendorId}`);
        if (vendorResult.rows.length > 0) {
          const vendorName = vendorResult.rows[0].name as string;
          vendorActualsFilter = sql`AND (
            LOWER(ph.vendor) LIKE ${vendorName.toLowerCase() + '%'}
            OR LOWER(ph.vendor) = ${vendorName.toLowerCase()}
            OR LOWER(SPLIT_PART(ph.vendor, ' ', 1)) = ${vendorName.split(' ')[0].toLowerCase()}
          )`;
        }
      }

      // Get ACTUAL orders from po_headers (same logic as Dashboard KPIs)
      const actualsResult = await db.execute(sql`
        SELECT 
          EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date))::int as month,
          SUM(COALESCE(ph.total_value, 0)) as actual_value
        FROM po_headers ph
        WHERE 
          COALESCE(ph.revised_ship_date, ph.original_ship_date) IS NOT NULL
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_ship_date, ph.original_ship_date)) = ${year}
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          ${vendorActualsFilter}
        GROUP BY EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date))::int
        ORDER BY month
      `);

      const projections = projectionsResult.rows as any[];
      const actuals = actualsResult.rows as any[];

      // Build monthly data
      const monthlyData: Record<number, { projectedMto: number; projectedRegular: number; actual: number }> = {};
      for (let m = 1; m <= 12; m++) {
        monthlyData[m] = { projectedMto: 0, projectedRegular: 0, actual: 0 };
      }

      // Add projections by order type
      for (const proj of projections) {
        const month = Number(proj.month);
        const projValue = Number(proj.projection_value) || 0;
        const orderType = (proj.order_type || 'regular').toLowerCase();
        if (monthlyData[month]) {
          if (orderType === 'mto' || orderType === 'spo') {
            monthlyData[month].projectedMto += projValue;
          } else {
            monthlyData[month].projectedRegular += projValue;
          }
        }
      }

      // Add actuals
      for (const act of actuals) {
        const month = Number(act.month);
        const actValue = Number(act.actual_value) || 0;
        if (monthlyData[month]) {
          monthlyData[month].actual += actValue;
        }
      }

      // Build monthly trend array
      const monthlyTrend = Object.entries(monthlyData).map(([m, data]) => {
        const month = Number(m);
        const totalProjected = data.projectedMto + data.projectedRegular;
        const variance = data.actual - totalProjected;
        const variancePct = totalProjected > 0
          ? (variance / totalProjected) * 100
          : (data.actual > 0 ? 100 : 0);
        return {
          month,
          projected: totalProjected,
          projectedMto: data.projectedMto,
          projectedRegular: data.projectedRegular,
          actual: data.actual,
          variance,
          variancePct,
        };
      }).sort((a, b) => a.month - b.month);

      res.json({
        year,
        monthlyTrend,
      });
    } catch (error: any) {
      console.error("Error generating monthly trends:", error);
      res.status(500).json({ error: error.message || "Failed to generate monthly trends" });
    }
  });

  // ============================================================================
  // PROJECTION CHARTS - Following GPT Spec for 3 Visuals
  // ============================================================================

  // SNAPSHOT SELECTION HELPER: Finds projections at cutoff_date for a target month
  // Uses projection_snapshots (immutable historical archive) for accuracy analysis
  async function getProjectionSnapshot(
    year: number,
    targetMonth: number,
    cutoffDate: Date,
    filters: {
      vendorId?: number;
      brand?: string;
      productClass?: string;
      orderType?: string; // 'regular' | 'spo' | 'all'
      clientId?: number;
    }
  ): Promise<{ uploadId: number | null; runDate: Date | null; projectedValue: number }> {
    // Query projection_snapshots (immutable historical archive) using import_date as the snapshot date
    // First try to find projections with import_date <= cutoff, then fallback with 14-day grace period
    const vendorFilter = filters.vendorId ? sql`AND ps.vendor_id = ${filters.vendorId}` : sql``;
    const brandFilter = filters.brand && filters.brand !== 'all' ? sql`AND ps.brand = ${filters.brand}` : sql``;
    const clientFilter = filters.clientId ? sql`AND ps.client_id = ${filters.clientId}` : sql``;
    // Map 'spo' to 'mto' since database stores 'mto' for SPO orders
    let orderTypeFilter = sql``;
    if (filters.orderType && filters.orderType !== 'all') {
      const dbOrderType = filters.orderType === 'spo' ? 'mto' : filters.orderType;
      orderTypeFilter = sql`AND ps.order_type = ${dbOrderType}`;
    }

    // First try: find projections with import_date in the cutoff month
    // For accuracy tracking, we want the EARLIEST import in the cutoff month (original forecast)
    const cutoffMonthStart = new Date(cutoffDate.getFullYear(), cutoffDate.getMonth(), 1);
    const cutoffMonthEnd = cutoffDate; // Already the last day of the cutoff month

    let result = await db.execute(sql`
      SELECT 
        DATE(ps.import_date) as run_date,
        SUM(COALESCE(ps.projection_value, 0)) as projected_value
      FROM projection_snapshots ps
      WHERE 
        DATE(ps.import_date) >= ${cutoffMonthStart.toISOString().split('T')[0]}
        AND DATE(ps.import_date) <= ${cutoffMonthEnd.toISOString().split('T')[0]}
        AND ps.year = ${year}
        AND ps.month = ${targetMonth}
        ${vendorFilter}
        ${brandFilter}
        ${orderTypeFilter}
        ${clientFilter}
      GROUP BY DATE(ps.import_date)
      ORDER BY DATE(ps.import_date) ASC
      LIMIT 1
    `);

    // Fallback: if no import in cutoff month, find the latest import before cutoff month
    if (result.rows.length === 0) {
      result = await db.execute(sql`
        SELECT 
          DATE(ps.import_date) as run_date,
          SUM(COALESCE(ps.projection_value, 0)) as projected_value
        FROM projection_snapshots ps
        WHERE 
          DATE(ps.import_date) < ${cutoffMonthStart.toISOString().split('T')[0]}
          AND ps.year = ${year}
          AND ps.month = ${targetMonth}
          ${vendorFilter}
          ${brandFilter}
          ${orderTypeFilter}
          ${clientFilter}
        GROUP BY DATE(ps.import_date)
        ORDER BY DATE(ps.import_date) DESC
        LIMIT 1
      `);
    }

    // If no snapshot found, try to find the earliest one within 14 days AFTER the cutoff (grace period)
    if (result.rows.length === 0) {
      const gracePeriodEnd = new Date(cutoffDate);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 14);

      result = await db.execute(sql`
        SELECT 
          DATE(ps.import_date) as run_date,
          SUM(COALESCE(ps.projection_value, 0)) as projected_value
        FROM projection_snapshots ps
        WHERE 
          DATE(ps.import_date) > ${cutoffDate.toISOString().split('T')[0]}
          AND DATE(ps.import_date) <= ${gracePeriodEnd.toISOString().split('T')[0]}
          AND ps.year = ${year}
          AND ps.month = ${targetMonth}
          ${vendorFilter}
          ${brandFilter}
          ${orderTypeFilter}
          ${clientFilter}
        GROUP BY DATE(ps.import_date)
        ORDER BY DATE(ps.import_date) ASC
        LIMIT 1
      `);
    }

    // Final fallback: if still no snapshot, use the earliest available projection for this target month
    // This handles cases where historical import data doesn't exist yet - will self-correct over time
    if (result.rows.length === 0) {
      result = await db.execute(sql`
        SELECT 
          DATE(ps.import_date) as run_date,
          SUM(COALESCE(ps.projection_value, 0)) as projected_value
        FROM projection_snapshots ps
        WHERE 
          ps.year = ${year}
          AND ps.month = ${targetMonth}
          ${vendorFilter}
          ${brandFilter}
          ${orderTypeFilter}
          ${clientFilter}
        GROUP BY DATE(ps.import_date)
        ORDER BY DATE(ps.import_date) ASC
        LIMIT 1
      `);
    }

    if (result.rows.length === 0) {
      return { uploadId: null, runDate: null, projectedValue: 0 };
    }

    const row = result.rows[0] as any;
    return {
      uploadId: null, // No longer using upload IDs
      runDate: new Date(row.run_date),
      projectedValue: Number(row.projected_value) || 0,
    };
  }

  // Get actual values for a target month (from po_headers using cancel date)
  async function getActualsForMonth(
    year: number,
    targetMonth: number,
    filters: {
      vendorId?: number;
      brand?: string;
      orderType?: string;
    }
  ): Promise<number> {
    let vendorFilter = sql``;
    if (filters.vendorId) {
      const vendorResult = await db.execute(sql`SELECT name FROM vendors WHERE id = ${filters.vendorId}`);
      if (vendorResult.rows.length > 0) {
        const vendorName = vendorResult.rows[0].name as string;
        vendorFilter = sql`AND (
          LOWER(ph.vendor) LIKE ${vendorName.toLowerCase() + '%'}
          OR LOWER(ph.vendor) = ${vendorName.toLowerCase()}
        )`;
      }
    }

    // Brand filter: derive brand from client_division (CB2, C&K, or default CB)
    let brandFilter = sql``;
    if (filters.brand && filters.brand !== 'all') {
      if (filters.brand === 'CB2') {
        brandFilter = sql`AND (ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%')`;
      } else if (filters.brand === 'C&K') {
        brandFilter = sql`AND (ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%')`;
      } else if (filters.brand === 'CB') {
        // CB = everything that's NOT CB2 and NOT C&K
        brandFilter = sql`AND NOT (
          ph.client_division ILIKE '%CB2%' OR ph.client ILIKE '%CB2%' OR
          ph.client_division ILIKE '%Kids%' OR ph.client ILIKE '%Kids%' OR ph.client_division ILIKE '%C&K%'
        )`;
      }
    }

    // SPO detection: program_description contains 'SPO' or 'MTO'
    let orderTypeFilter = sql``;
    if (filters.orderType === 'spo') {
      orderTypeFilter = sql`AND (
        LOWER(COALESCE(ph.program_description, '')) LIKE '%spo%' 
        OR LOWER(COALESCE(ph.program_description, '')) LIKE '%mto%'
      )`;
    } else if (filters.orderType === 'regular') {
      orderTypeFilter = sql`AND NOT (
        LOWER(COALESCE(ph.program_description, '')) LIKE '%spo%' 
        OR LOWER(COALESCE(ph.program_description, '')) LIKE '%mto%'
      )`;
    }

    // Use ORIGINAL_CANCEL_DATE for projection accuracy comparison
    // Projections are made against original planned ship dates, so we compare to original dates
    const result = await db.execute(sql`
      SELECT SUM(COALESCE(ph.total_value, 0)) as actual_value
      FROM po_headers ph
      WHERE 
        EXTRACT(YEAR FROM ph.original_cancel_date) = ${year}
        AND EXTRACT(MONTH FROM ph.original_cancel_date) = ${targetMonth}
        AND COALESCE(ph.total_value, 0) > 0
        AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
        AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
        ${vendorFilter}
        ${brandFilter}
        ${orderTypeFilter}
    `);

    return Number(result.rows[0]?.actual_value) || 0;
  }

  // VISUAL 1: Accuracy Bar Chart (90D vs 6MO horizon toggle)
  // Two bars per month: Projected (at horizon) vs Actual
  app.get("/api/projections/v2/accuracy-chart", async (req: Express.Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const horizon = (req.query.horizon as string) || '90D'; // '90D' or '6MO'
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;
      const brand = req.query.brand as string | undefined;
      const orderType = (req.query.orderType as string) || 'all'; // 'regular', 'spo', 'all'
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;

      const results: Array<{
        month: number;
        monthName: string;
        projected: number;
        actual: number;
        varianceDollar: number;
        variancePct: number | null;
        snapshotDate: string | null;
        hasSnapshot: boolean;
      }> = [];

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      for (let month = 1; month <= 12; month++) {
        // Calculate cutoff date based on horizon and order type
        // Use END of the cutoff month to ensure we capture imports made that month
        // For 90D horizon: Oct import → Jan ship (3 months lead time)
        // For 6MO horizon: Jul import → Jan ship (6 months lead time)
        const targetMonthStart = new Date(year, month - 1, 1);
        let cutoffDate: Date;

        if (horizon === '6MO') {
          // Use end of month 6 months before target
          cutoffDate = new Date(year, month - 1 - 6 + 1, 0); // Last day of month 6 months before
        } else { // 90D
          if (orderType === 'spo') {
            // SPO uses 1 month cutoff (end of previous month)
            cutoffDate = new Date(year, month - 1 - 1 + 1, 0); // Last day of previous month
          } else {
            // Regular uses 3 month cutoff (end of month 3 months before)
            // Oct (10) → Jan (1), Nov (11) → Feb (2), Dec (12) → Mar (3)
            cutoffDate = new Date(year, month - 1 - 3 + 1, 0); // Last day of month 3 months before
          }
        }

        // Get projection snapshot at cutoff
        const snapshot = await getProjectionSnapshot(year, month, cutoffDate, {
          vendorId,
          brand,
          orderType: orderType === 'all' ? undefined : orderType,
          clientId,
        });

        // Get actuals for this month
        const actual = await getActualsForMonth(year, month, {
          vendorId,
          brand,
          orderType: orderType === 'all' ? undefined : orderType,
        });

        const varianceDollar = actual - snapshot.projectedValue;
        const variancePct = snapshot.projectedValue > 0
          ? ((varianceDollar / snapshot.projectedValue) * 100)
          : (actual > 0 ? 100 : null);

        results.push({
          month,
          monthName: monthNames[month - 1],
          projected: snapshot.projectedValue,
          actual,
          varianceDollar,
          variancePct: variancePct !== null ? Math.round(variancePct * 10) / 10 : null,
          snapshotDate: snapshot.runDate ? snapshot.runDate.toISOString().split('T')[0] : null,
          hasSnapshot: snapshot.uploadId !== null,
        });
      }

      res.json({
        year,
        horizon,
        orderType,
        vendorId,
        brand,
        data: results,
      });
    } catch (error: any) {
      console.error("Error generating accuracy chart:", error);
      res.status(500).json({ error: error.message || "Failed to generate accuracy chart" });
    }
  });

  // VISUAL 2A: Forecast Error Trend (line chart showing error % over months)
  app.get("/api/projections/v2/error-trend", async (req: Express.Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const horizon = (req.query.horizon as string) || '90D';
      const metricType = (req.query.metricType as string) || 'signed'; // 'signed' or 'absolute'
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;
      const brand = req.query.brand as string | undefined;
      const orderType = (req.query.orderType as string) || 'all';
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;

      const results: Array<{
        month: number;
        monthName: string;
        errorPct: number | null;
        projected: number;
        actual: number;
        hasData: boolean;
      }> = [];

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      for (let month = 1; month <= 12; month++) {
        // Calculate cutoff date based on horizon and order type
        // Use END of the cutoff month to match accuracy-chart logic
        // For 90D horizon: Oct import → Jan ship (3 months lead time)
        // For 6MO horizon: Jul import → Jan ship (6 months lead time)
        const targetMonthStart = new Date(year, month - 1, 1);
        let cutoffDate: Date;

        if (horizon === '6MO') {
          // Use end of month 6 months before target
          cutoffDate = new Date(year, month - 1 - 6 + 1, 0); // Last day of month 6 months before
        } else { // 90D
          if (orderType === 'spo') {
            // SPO uses 1 month cutoff (end of previous month)
            cutoffDate = new Date(year, month - 1 - 1 + 1, 0); // Last day of previous month
          } else {
            // Regular uses 3 month cutoff (end of month 3 months before)
            cutoffDate = new Date(year, month - 1 - 3 + 1, 0); // Last day of month 3 months before
          }
        }

        const snapshot = await getProjectionSnapshot(year, month, cutoffDate, {
          vendorId,
          brand,
          orderType: orderType === 'all' ? undefined : orderType,
          clientId,
        });

        const actual = await getActualsForMonth(year, month, {
          vendorId,
          brand,
          orderType: orderType === 'all' ? undefined : orderType,
        });

        let errorPct: number | null = null;
        if (snapshot.projectedValue > 0) {
          const rawError = ((actual - snapshot.projectedValue) / snapshot.projectedValue) * 100;
          errorPct = metricType === 'absolute' ? Math.abs(rawError) : rawError;
          errorPct = Math.round(errorPct * 10) / 10;
        }

        results.push({
          month,
          monthName: monthNames[month - 1],
          errorPct,
          projected: snapshot.projectedValue,
          actual,
          hasData: snapshot.uploadId !== null,
        });
      }

      res.json({
        year,
        horizon,
        metricType,
        orderType,
        vendorId,
        brand,
        data: results,
      });
    } catch (error: any) {
      console.error("Error generating error trend:", error);
      res.status(500).json({ error: error.message || "Failed to generate error trend" });
    }
  });

  // VISUAL 2B: Forecast Churn (volatility) Trend
  // Measures how unstable projections are for the same target month across run dates
  app.get("/api/projections/v2/churn-trend", async (req: Express.Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;
      const brand = req.query.brand as string | undefined;
      const orderType = (req.query.orderType as string) || 'all';
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;

      const vendorFilter = vendorId ? sql`AND ps.vendor_id = ${vendorId}` : sql``;
      const brandFilter = brand && brand !== 'all' ? sql`AND ps.brand = ${brand}` : sql``;
      const orderTypeFilter = orderType !== 'all' ? sql`AND ps.order_type = ${orderType}` : sql``;
      const clientFilter = clientId ? sql`AND ps.client_id = ${clientId}` : sql``;

      // Get all projection snapshots for each target month, ordered by import_date (run_date)
      // Uses projection_snapshots (immutable historical archive) for churn analysis
      const result = await db.execute(sql`
        SELECT 
          ps.month as target_month,
          DATE(ps.import_date) as projection_run_date,
          SUM(COALESCE(ps.projection_value, 0)) as projected_value
        FROM projection_snapshots ps
        WHERE 
          ps.year = ${year}
          ${vendorFilter}
          ${brandFilter}
          ${orderTypeFilter}
          ${clientFilter}
        GROUP BY ps.month, DATE(ps.import_date)
        ORDER BY ps.month, DATE(ps.import_date)
      `);

      const rows = result.rows as any[];

      // Group by target month
      const byMonth: Record<number, Array<{ runDate: Date; projectedValue: number }>> = {};
      for (let m = 1; m <= 12; m++) {
        byMonth[m] = [];
      }

      for (const row of rows) {
        const month = Number(row.target_month);
        if (byMonth[month]) {
          byMonth[month].push({
            runDate: new Date(row.projection_run_date),
            projectedValue: Number(row.projected_value) || 0,
          });
        }
      }

      // Calculate churn for each month
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const results = Object.entries(byMonth).map(([m, series]) => {
        const month = Number(m);
        let churnScore = 0;
        let avgProjection = 0;

        if (series.length > 1) {
          // Calculate sum of absolute changes between consecutive projections
          let totalChange = 0;
          let totalProjection = 0;

          for (let i = 1; i < series.length; i++) {
            totalChange += Math.abs(series[i].projectedValue - series[i - 1].projectedValue);
          }

          for (const s of series) {
            totalProjection += s.projectedValue;
          }

          avgProjection = totalProjection / series.length;
          churnScore = avgProjection > 0 ? (totalChange / avgProjection) * 100 : 0;
        }

        return {
          month,
          monthName: monthNames[month - 1],
          churnScore: Math.round(churnScore * 10) / 10,
          snapshotCount: series.length,
          avgProjection: Math.round(avgProjection),
          series: series.map(s => ({
            runDate: s.runDate.toISOString().split('T')[0],
            projectedValue: s.projectedValue,
          })),
        };
      });

      res.json({
        year,
        orderType,
        vendorId,
        brand,
        data: results,
      });
    } catch (error: any) {
      console.error("Error generating churn trend:", error);
      res.status(500).json({ error: error.message || "Failed to generate churn trend" });
    }
  });

  // VISUAL 3: Current Cleanup View
  // Stacked bar: Matched, Unmatched Not Expired, Unmatched Expired
  app.get("/api/projections/v2/cleanup-status", async (req: Express.Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;
      const brand = req.query.brand as string | undefined;
      const orderType = (req.query.orderType as string) || 'all';
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;

      const today = new Date();
      const vendorFilter = vendorId ? sql`AND ap.vendor_id = ${vendorId}` : sql``;
      const brandFilter = brand && brand !== 'all' ? sql`AND ap.brand = ${brand}` : sql``;
      const orderTypeFilter = orderType !== 'all' ? sql`AND ap.order_type = ${orderType}` : sql``;
      const clientFilter = clientId ? sql`AND ap.client_id = ${clientId}` : sql``;

      // Get latest snapshot date from active_projections (working table for current status)
      const latestDateResult = await db.execute(sql`
        SELECT MAX(DATE(last_snapshot_date)) as latest_date
        FROM active_projections 
        WHERE year = ${year}
      `);

      const latestRunDate = latestDateResult.rows[0]?.latest_date
        ? new Date(latestDateResult.rows[0].latest_date as string)
        : today;

      // Get projections from active_projections grouped by month (current working data)
      const projectionsResult = await db.execute(sql`
        SELECT 
          ap.month as target_month,
          ap.order_type,
          SUM(COALESCE(ap.projection_value, 0)) as projected_value
        FROM active_projections ap
        WHERE 
          ap.year = ${year}
          ${vendorFilter}
          ${brandFilter}
          ${orderTypeFilter}
          ${clientFilter}
        GROUP BY ap.month, ap.order_type
        ORDER BY ap.month
      `);

      // Get actuals by month
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const results: Array<{
        month: number;
        monthName: string;
        projected: number;
        actual: number;
        matched: number;
        unmatchedNotExpired: number;
        unmatchedExpired: number;
        overReceived: number;
        expectedBy: string;
        isExpired: boolean;
        isPartial: boolean;
        isUnderForecasted: boolean;
      }> = [];

      // Build projection map
      const projectionMap: Record<number, { regular: number; spo: number }> = {};
      for (let m = 1; m <= 12; m++) {
        projectionMap[m] = { regular: 0, spo: 0 };
      }

      for (const row of projectionsResult.rows as any[]) {
        const month = Number(row.target_month);
        const value = Number(row.projected_value) || 0;
        const ot = (row.order_type || 'regular').toLowerCase();

        if (projectionMap[month]) {
          if (ot === 'spo' || ot === 'mto') {
            projectionMap[month].spo += value;
          } else {
            projectionMap[month].regular += value;
          }
        }
      }

      for (let month = 1; month <= 12; month++) {
        // Get actual for this month
        const actual = await getActualsForMonth(year, month, {
          vendorId,
          brand,
          orderType: orderType === 'all' ? undefined : orderType,
        });

        const projRegular = projectionMap[month].regular;
        const projSpo = projectionMap[month].spo;
        let projected = 0;
        let expectedBy: Date;

        if (orderType === 'spo') {
          projected = projSpo;
          // SPO: expected_by = latest_run_date + 40 days
          expectedBy = new Date(latestRunDate);
          expectedBy.setDate(expectedBy.getDate() + 40);
        } else if (orderType === 'regular') {
          projected = projRegular;
          // Regular: expected_by = end of (target_month - 3 months)
          const targetMonthStart = new Date(year, month - 1, 1);
          expectedBy = new Date(targetMonthStart);
          expectedBy.setMonth(expectedBy.getMonth() - 3);
          // Get end of that month
          expectedBy = new Date(expectedBy.getFullYear(), expectedBy.getMonth() + 1, 0);
        } else {
          projected = projRegular + projSpo;
          // Use regular lead time for "all"
          const targetMonthStart = new Date(year, month - 1, 1);
          expectedBy = new Date(targetMonthStart);
          expectedBy.setMonth(expectedBy.getMonth() - 3);
          expectedBy = new Date(expectedBy.getFullYear(), expectedBy.getMonth() + 1, 0);
        }

        const isExpired = today > expectedBy;
        const remaining = Math.max(projected - actual, 0);

        // Calculate segments
        // matched = portion of projections fulfilled by actual orders
        const matched = Math.min(actual, projected);
        // unmatchedExpired = projections not fulfilled and order window passed
        const unmatchedExpired = isExpired ? remaining : 0;
        // unmatchedNotExpired = projections not fulfilled but order window still open
        const unmatchedNotExpired = isExpired ? 0 : remaining;
        // overReceived = actual orders that exceeded projections (under-forecasting)
        const overReceived = Math.max(actual - projected, 0);
        const isPartial = actual > 0 && actual < projected;
        // isUnderForecasted = received more orders than projected
        const isUnderForecasted = actual > projected;

        results.push({
          month,
          monthName: monthNames[month - 1],
          projected,
          actual,
          matched,
          unmatchedNotExpired,
          unmatchedExpired,
          overReceived,
          expectedBy: expectedBy.toISOString().split('T')[0],
          isExpired,
          isPartial,
          isUnderForecasted,
        });
      }

      res.json({
        year,
        orderType,
        vendorId,
        brand,
        latestRunDate: latestRunDate.toISOString().split('T')[0],
        data: results,
      });
    } catch (error: any) {
      console.error("Error generating cleanup status:", error);
      res.status(500).json({ error: error.message || "Failed to generate cleanup status" });
    }
  });

  // Keep legacy endpoint for backward compatibility but mark as deprecated
  // Chart 1 (LEGACY): Current Projection Status - shows projections by match status for each month
  app.get("/api/projections/status-by-month", async (req: Express.Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;

      // Build vendor filter
      const vendorFilter = vendorId
        ? sql`AND ap.vendor_id = ${vendorId}`
        : sql``;

      // Get projections grouped by month and match_status from active_projections
      // NOTE: active_projections already represents latest state per vendor/SKU
      const statusResult = await db.execute(sql`
        SELECT 
          ap.month,
          ap.match_status,
          SUM(COALESCE(ap.projection_value, 0)) as total_value,
          COUNT(*) as count
        FROM active_projections ap
        WHERE 
          ap.year = ${year}
          ${vendorFilter}
        GROUP BY ap.month, ap.match_status
        ORDER BY ap.month
      `);

      const rows = statusResult.rows as any[];

      // Build monthly status data
      const monthlyStatus: Record<number, { matched: number; partial: number; unmatched: number; expired: number }> = {};
      for (let m = 1; m <= 12; m++) {
        monthlyStatus[m] = { matched: 0, partial: 0, unmatched: 0, expired: 0 };
      }

      for (const row of rows) {
        const month = Number(row.month);
        const value = Number(row.total_value) || 0;
        const status = (row.match_status || 'unmatched').toLowerCase();

        if (monthlyStatus[month]) {
          if (status === 'matched') {
            monthlyStatus[month].matched += value;
          } else if (status === 'partial') {
            monthlyStatus[month].partial += value;
          } else if (status === 'expired') {
            monthlyStatus[month].expired += value;
          } else {
            monthlyStatus[month].unmatched += value;
          }
        }
      }

      // Build response array
      const statusByMonth = Object.entries(monthlyStatus).map(([m, data]) => ({
        month: Number(m),
        matched: data.matched,
        partial: data.partial,
        unmatched: data.unmatched,
        expired: data.expired,
        total: data.matched + data.partial + data.unmatched + data.expired,
      })).sort((a, b) => a.month - b.month);

      res.json({
        year,
        statusByMonth,
      });
    } catch (error: any) {
      console.error("Error generating projection status by month:", error);
      res.status(500).json({ error: error.message || "Failed to generate projection status" });
    }
  });

  // Chart 2: Locked Projection Accuracy - compares locked projections to actual POs with lead time offset
  // Regular POs: 90-day lead time (January locked projections predict April actuals)
  // MTO/SPO: 30-day lead time (March locked projections predict April actuals)
  app.get("/api/projections/locked-accuracy-chart", async (req: Express.Request, res: Response) => {
    try {
      const year = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;

      // Build vendor filter for projections
      const vendorFilter = vendorId
        ? sql`AND pl.vendor_id = ${vendorId}`
        : sql``;

      // Get historical projections from projection_snapshots for accuracy analysis
      const lockedResult = await db.execute(sql`
        SELECT 
          ps.month as delivery_month,
          ps.order_type,
          SUM(COALESCE(ps.projection_value, 0)) as locked_value,
          '90_day' as lock_horizon
        FROM projection_snapshots ps
        WHERE 
          ps.year = ${year}
          ${vendorId ? sql`AND ps.vendor_id = ${vendorId}` : sql``}
        GROUP BY ps.month, ps.order_type
        ORDER BY ps.month
      `);

      // Get actual orders by month and order type (from po_headers)
      // For vendor matching, we need to look up vendor name
      let vendorActualsFilter = sql``;
      if (vendorId) {
        const vendorResult = await db.execute(sql`SELECT name FROM vendors WHERE id = ${vendorId}`);
        if (vendorResult.rows.length > 0) {
          const vendorName = vendorResult.rows[0].name as string;
          vendorActualsFilter = sql`AND (
            LOWER(ph.vendor) LIKE ${vendorName.toLowerCase() + '%'}
            OR LOWER(ph.vendor) = ${vendorName.toLowerCase()}
            OR LOWER(SPLIT_PART(ph.vendor, ' ', 1)) = ${vendorName.split(' ')[0].toLowerCase()}
          )`;
        }
      }

      const actualsResult = await db.execute(sql`
        SELECT 
          EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date))::int as month,
          CASE 
            WHEN LOWER(COALESCE(ph.program_description, '')) LIKE '%mto%' 
              OR LOWER(COALESCE(ph.program_description, '')) LIKE '%spo%'
            THEN 'mto'
            ELSE 'regular'
          END as order_type,
          SUM(COALESCE(ph.total_value, 0)) as actual_value
        FROM po_headers ph
        WHERE 
          COALESCE(ph.revised_ship_date, ph.original_ship_date) IS NOT NULL
          AND EXTRACT(YEAR FROM COALESCE(ph.revised_ship_date, ph.original_ship_date)) = ${year}
          AND COALESCE(ph.total_value, 0) > 0
          AND COALESCE(ph.program_description, '') NOT ILIKE 'SMP %'
          AND COALESCE(ph.program_description, '') NOT ILIKE '8X8 %'
          ${vendorActualsFilter}
        GROUP BY 
          EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date))::int,
          CASE 
            WHEN LOWER(COALESCE(ph.program_description, '')) LIKE '%mto%' 
              OR LOWER(COALESCE(ph.program_description, '')) LIKE '%spo%'
            THEN 'mto'
            ELSE 'regular'
          END
        ORDER BY month
      `);

      const lockedRows = lockedResult.rows as any[];
      const actualRows = actualsResult.rows as any[];

      // Build monthly data with lead time offsets
      // For each delivery month, we need locked projections from:
      // - Regular: 3 months prior (90-day lead time)
      // - MTO: 1 month prior (30-day lead time)
      const monthlyData: Record<number, {
        lockedRegular: number;
        lockedMto: number;
        actualRegular: number;
        actualMto: number;
        lockedRegularSource: number | null;
        lockedMtoSource: number | null;
      }> = {};

      for (let m = 1; m <= 12; m++) {
        monthlyData[m] = {
          lockedRegular: 0,
          lockedMto: 0,
          actualRegular: 0,
          actualMto: 0,
          lockedRegularSource: null,
          lockedMtoSource: null,
        };
      }

      // Process locked projections with lead time offset
      for (const row of lockedRows) {
        const deliveryMonth = Number(row.delivery_month);
        const lockedValue = Number(row.locked_value) || 0;
        const orderType = (row.order_type || 'regular').toLowerCase();
        const horizon = row.lock_horizon;

        // For 90-day locks, the delivery month is target_month (already offset in the lock)
        // For 30-day locks, same applies
        if (monthlyData[deliveryMonth]) {
          if (orderType === 'mto' || orderType === 'spo') {
            monthlyData[deliveryMonth].lockedMto += lockedValue;
          } else {
            monthlyData[deliveryMonth].lockedRegular += lockedValue;
          }
        }
      }

      // If no locked data, use active_projections with calculated offsets
      if (lockedRows.length === 0) {
        // Fallback: calculate from active_projections with lead time offset
        const apFilter = vendorId
          ? sql`AND ap.vendor_id = ${vendorId}`
          : sql``;

        const vspResult = await db.execute(sql`
          SELECT 
            ap.month as projection_month,
            ap.order_type,
            SUM(COALESCE(ap.projection_value, 0)) as projection_value
          FROM active_projections ap
          WHERE 
            ap.year = ${year}
            ${apFilter}
          GROUP BY ap.month, ap.order_type
          ORDER BY ap.month
        `);

        const vspRows = vspResult.rows as any[];

        for (const row of vspRows) {
          const projMonth = Number(row.projection_month);
          const projValue = Number(row.projection_value) || 0;
          const orderType = (row.order_type || 'regular').toLowerCase();

          // Calculate delivery month based on lead time
          // Regular: 90 days = 3 months forward
          // MTO: 30 days = 1 month forward
          if (orderType === 'mto' || orderType === 'spo') {
            const deliveryMonth = projMonth + 1; // 30-day lead time
            if (deliveryMonth >= 1 && deliveryMonth <= 12 && monthlyData[deliveryMonth]) {
              monthlyData[deliveryMonth].lockedMto += projValue;
              monthlyData[deliveryMonth].lockedMtoSource = projMonth;
            }
          } else {
            const deliveryMonth = projMonth + 3; // 90-day lead time
            if (deliveryMonth >= 1 && deliveryMonth <= 12 && monthlyData[deliveryMonth]) {
              monthlyData[deliveryMonth].lockedRegular += projValue;
              monthlyData[deliveryMonth].lockedRegularSource = projMonth;
            }
          }
        }
      }

      // Add actuals
      for (const row of actualRows) {
        const month = Number(row.month);
        const actualValue = Number(row.actual_value) || 0;
        const orderType = (row.order_type || 'regular').toLowerCase();

        if (monthlyData[month]) {
          if (orderType === 'mto' || orderType === 'spo') {
            monthlyData[month].actualMto += actualValue;
          } else {
            monthlyData[month].actualRegular += actualValue;
          }
        }
      }

      // Build response array with variance calculations
      const accuracyByMonth = Object.entries(monthlyData).map(([m, data]) => {
        const month = Number(m);
        const totalLocked = data.lockedRegular + data.lockedMto;
        const totalActual = data.actualRegular + data.actualMto;
        const variance = totalActual - totalLocked;
        const variancePct = totalLocked > 0
          ? ((variance / totalLocked) * 100)
          : (totalActual > 0 ? 100 : 0);

        return {
          month,
          lockedRegular: data.lockedRegular,
          lockedMto: data.lockedMto,
          actualRegular: data.actualRegular,
          actualMto: data.actualMto,
          totalLocked,
          totalActual,
          variance,
          variancePct: Math.round(variancePct * 10) / 10,
          regularSourceMonth: data.lockedRegularSource,
          mtoSourceMonth: data.lockedMtoSource,
        };
      }).sort((a, b) => a.month - b.month);

      res.json({
        year,
        accuracyByMonth,
        leadTimes: {
          regular: 90,
          mto: 30,
        },
      });
    } catch (error: any) {
      console.error("Error generating locked accuracy chart:", error);
      res.status(500).json({ error: error.message || "Failed to generate locked accuracy" });
    }
  });

  // GET All Projections with filtering - for Projections List page
  app.get("/api/projections/list", async (req: Express.Request, res: Response) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;
      const month = req.query.month ? parseInt(req.query.month as string) : undefined;
      const runMonth = req.query.runMonth ? parseInt(req.query.runMonth as string) : undefined;
      const matchStatus = req.query.matchStatus as string | undefined;
      const orderType = req.query.orderType as string | undefined;
      const brand = req.query.brand as string | undefined;
      const productClasses = req.query.productClasses ? (req.query.productClasses as string).split(',') : undefined;
      const showHistoric = req.query.showHistoric === 'true';
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      // Build the query using active_projections (already represents latest state per vendor/SKU)
      // showHistoric parameter is deprecated since active_projections is the current working state

      const conditions: any[] = [
        sql`ap.year = ${year}`,
      ];

      if (vendorId) {
        conditions.push(sql`ap.vendor_id = ${vendorId}`);
      }
      if (month) {
        conditions.push(sql`ap.month = ${month}`);
      }
      if (runMonth) {
        // Filter by the month from last_snapshot_date
        conditions.push(sql`EXTRACT(MONTH FROM ap.last_snapshot_date) = ${runMonth}`);
      }
      if (matchStatus) {
        if (matchStatus === 'unmatched') {
          conditions.push(sql`(ap.match_status IS NULL OR ap.match_status = 'unmatched')`);
        } else {
          conditions.push(sql`ap.match_status = ${matchStatus}`);
        }
      }
      if (orderType) {
        if (orderType === 'regular') {
          conditions.push(sql`(ap.order_type IS NULL OR LOWER(ap.order_type) = 'regular')`);
        } else {
          conditions.push(sql`LOWER(ap.order_type) = LOWER(${orderType})`);
        }
      }
      if (brand) {
        conditions.push(sql`ap.brand = ${brand}`);
      }
      if (productClasses && productClasses.length > 0) {
        conditions.push(sql`ap.product_class = ANY(ARRAY[${sql.join(productClasses.map(pc => sql`${pc}`), sql`, `)}]::text[])`);
      }

      const whereClause = sql.join(conditions, sql` AND `);

      const result = await db.execute(sql`
        SELECT 
          ap.id,
          ap.vendor_id,
          v.name as vendor_name,
          ap.sku,
          ap.sku_description,
          ap.collection,
          ap.brand,
          ap.year,
          ap.month,
          ap.order_type,
          ap.quantity,
          ap.projection_value,
          NULL as fob,
          ap.match_status,
          ap.matched_po_number,
          ap.matched_at,
          ap.actual_quantity,
          ap.actual_value,
          ap.quantity_variance,
          ap.value_variance,
          ap.variance_pct,
          ap.snapshot_id as import_batch_id,
          ap.created_at,
          DATE(ap.last_snapshot_date)::text as projection_run_date,
          ap.category_group as source_file
        FROM active_projections ap
        LEFT JOIN vendors v ON ap.vendor_id = v.id
        WHERE ${whereClause}
        ORDER BY ap.vendor_id, ap.month, ap.sku
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      // Get total count for pagination
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total
        FROM active_projections ap
        WHERE ${whereClause}
      `);

      const total = parseInt(countResult.rows[0]?.total as string) || 0;

      // Get summary stats by match status
      const statsResult = await db.execute(sql`
        SELECT 
          COALESCE(ap.match_status, 'unmatched') as status,
          COUNT(*) as count,
          SUM(ap.projection_value) as total_value
        FROM active_projections ap
        WHERE ${whereClause}
        GROUP BY COALESCE(ap.match_status, 'unmatched')
      `);

      const projections = result.rows.map((row: any) => ({
        id: row.id,
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        sku: row.sku,
        skuDescription: row.sku_description,
        collection: row.collection,
        brand: row.brand,
        year: row.year,
        month: row.month,
        orderType: row.order_type,
        quantity: row.quantity,
        projectionValue: row.projection_value,
        fob: row.fob,
        matchStatus: row.match_status || 'unmatched',
        matchedPoNumber: row.matched_po_number,
        matchedAt: row.matched_at,
        actualQuantity: row.actual_quantity,
        actualValue: row.actual_value,
        quantityVariance: row.quantity_variance,
        valueVariance: row.value_variance,
        variancePct: row.variance_pct,
        importBatchId: row.import_batch_id,
        createdAt: row.created_at,
        projectionRunDate: row.projection_run_date,
        sourceFile: row.source_file,
      }));

      const stats = statsResult.rows.reduce((acc: Record<string, { count: number; value: number }>, row: any) => {
        acc[row.status] = {
          count: parseInt(row.count) || 0,
          value: parseInt(row.total_value) || 0,
        };
        return acc;
      }, {});

      res.json({
        projections,
        total,
        stats,
        year,
        limit,
        offset,
      });
    } catch (error: any) {
      console.error("Error fetching projections list:", error);
      res.status(500).json({ error: error.message || "Failed to fetch projections" });
    }
  });

  // GET Unmatched/Partial Projections with filters
  app.get("/api/projections/unmatched", async (req: Express.Request, res: Response) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string) : undefined;
      const merchandiser = req.query.merchandiser as string | undefined;
      const manager = req.query.manager as string | undefined;
      const month = req.query.month ? parseInt(req.query.month as string) : undefined;
      const clientId = req.query.clientId ? parseInt(req.query.clientId as string) : undefined;

      // Build the query with filters using active_projections
      const conditions = [
        sql`ap.year = ${year}`,
        sql`(ap.match_status IS NULL OR ap.match_status IN ('unmatched', 'partial', 'expired'))`,
      ];

      if (vendorId) {
        conditions.push(sql`ap.vendor_id = ${vendorId}`);
      }
      if (month) {
        conditions.push(sql`ap.month = ${month}`);
      }
      if (clientId) {
        conditions.push(sql`ap.client_id = ${clientId}`);
      }

      // For merchandiser/manager filters, we need to join with po_headers
      let merchandiserFilter = sql``;
      let managerFilter = sql``;
      if (merchandiser && merchandiser !== 'all') {
        merchandiserFilter = sql`AND ph.merchandiser = ${merchandiser}`;
      }
      if (manager && manager !== 'all') {
        managerFilter = sql`AND ph.merchandising_manager = ${manager}`;
      }

      const whereClause = sql.join(conditions, sql` AND `);

      const unmatchedResult = await db.execute(sql`
        SELECT 
          ap.id,
          ap.vendor_id,
          v.name as vendor_name,
          ap.sku,
          ap.sku_description as description,
          ap.brand,
          ap.year,
          ap.month,
          ap.quantity as projection_quantity,
          ap.projection_value,
          ap.order_type,
          ap.match_status,
          ap.matched_po_number,
          ap.actual_value as matched_value,
          ap.actual_quantity,
          ap.comment,
          ap.created_at
        FROM active_projections ap
        LEFT JOIN vendors v ON v.id = ap.vendor_id
        WHERE ${whereClause}
        ${merchandiser && merchandiser !== 'all' ? sql`
          AND EXISTS (
            SELECT 1 FROM po_headers ph 
            WHERE ph.vendor_id = ap.vendor_id 
            AND EXTRACT(YEAR FROM COALESCE(ph.revised_ship_date, ph.original_ship_date)) = ap.year
            AND EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date)) = ap.month
            ${merchandiserFilter}
          )
        ` : sql``}
        ${manager && manager !== 'all' ? sql`
          AND EXISTS (
            SELECT 1 FROM po_headers ph 
            WHERE ph.vendor_id = ap.vendor_id 
            AND EXTRACT(YEAR FROM COALESCE(ph.revised_ship_date, ph.original_ship_date)) = ap.year
            AND EXTRACT(MONTH FROM COALESCE(ph.revised_ship_date, ph.original_ship_date)) = ap.month
            ${managerFilter}
          )
        ` : sql``}
        ORDER BY ap.month, ap.projection_value DESC
        LIMIT 500
      `);

      res.json(unmatchedResult.rows);
    } catch (error: any) {
      console.error("Error fetching unmatched projections:", error);
      res.status(500).json({ error: error.message || "Failed to fetch unmatched projections" });
    }
  });

  // Update projection comment
  app.patch("/api/projections/:id/comment", async (req: Express.Request, res: Response) => {
    try {
      const projectionId = parseInt(req.params.id);
      const { comment } = req.body;
      const userName = (req.user as any)?.name || 'Unknown';

      if (isNaN(projectionId)) {
        return res.status(400).json({ error: "Invalid projection ID" });
      }

      await db.execute(sql`
        UPDATE active_projections
        SET comment = ${comment || null},
            commented_at = NOW(),
            commented_by = ${userName},
            updated_at = NOW()
        WHERE id = ${projectionId}
      `);

      res.json({ success: true, message: "Comment updated successfully" });
    } catch (error: any) {
      console.error("Error updating projection comment:", error);
      res.status(500).json({ error: error.message || "Failed to update comment" });
    }
  });

  // Remove/verify projection (mark as removed)
  app.patch("/api/projections/:id/remove", async (req: Express.Request, res: Response) => {
    try {
      const projectionId = parseInt(req.params.id);
      const { reason } = req.body;
      const userName = (req.user as any)?.name || 'Unknown';

      if (isNaN(projectionId)) {
        return res.status(400).json({ error: "Invalid projection ID" });
      }

      await db.execute(sql`
        UPDATE active_projections
        SET match_status = 'removed',
            comment = COALESCE(${reason}, comment),
            commented_at = NOW(),
            commented_by = ${userName},
            updated_at = NOW()
        WHERE id = ${projectionId}
      `);

      res.json({ success: true, message: "Projection removed successfully" });
    } catch (error: any) {
      console.error("Error removing projection:", error);
      res.status(500).json({ error: error.message || "Failed to remove projection" });
    }
  });

  // Get unmatched projections grouped by merchandiser for To-Do list
  app.get("/api/projections/unmatched-by-merchandiser", async (req: Express.Request, res: Response) => {
    try {
      const year = parseInt(String(req.query.year)) || new Date().getFullYear();
      const clientCode = req.query.client ? String(req.query.client) : null;

      // Get unmatched/partial/expired projections grouped by merchandiser
      // Links vendors to their assigned merchandiser through the vendors table
      // NOTE: Uses active_projections (latest state per vendor/SKU)
      const result = await db.execute(sql`
        SELECT 
          v.merchandiser,
          COALESCE(COUNT(DISTINCT ap.id), 0)::int as projection_count,
          COALESCE(SUM(ap.projection_value), 0)::bigint as total_value,
          COALESCE(COUNT(DISTINCT ap.vendor_id), 0)::int as vendor_count
        FROM active_projections ap
        JOIN vendors v ON v.id = ap.vendor_id
        WHERE ap.year = ${year}
          AND ap.match_status IN ('unmatched', 'partial', 'expired')
          AND v.merchandiser IS NOT NULL
          AND v.merchandiser != ''
          ${clientCode ? sql`AND ap.client_id = (SELECT c.id FROM clients c WHERE c.code = ${clientCode})` : sql``}
        GROUP BY v.merchandiser
        ORDER BY COUNT(DISTINCT ap.id) DESC
      `);

      res.json(result.rows);
    } catch (error: any) {
      console.error("Error fetching unmatched projections by merchandiser:", error);
      res.status(500).json({ error: error.message || "Failed to fetch data" });
    }
  });

  // FURNITURE Projections Import - Monthly projections file with SKU-level and SPO data
  // Columns: Office, Category, Brand, Class, Collection, COO, Vendor Lead Time, Dept, Pattern, SKU, SKU Desc, CB Vendor Code, Vendor, FOB, Year, Month, Projection Value
  // Stores data in projection_snapshots (historical archive) and active_projections (working state) for accuracy tracking
  app.post("/api/import/furniture-projections", upload.single("file"), async (req: Express.Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      // Get projection run date (when the projection was issued by the client)
      // This is critical for the lock mechanism - projections are locked based on run_date + horizon
      // First try explicit parameter, then extract from filename (e.g., FURNITURE-20251006 → 2025-10-06)
      let projectionRunDateStr = req.body.projectionRunDate || req.query.projectionRunDate;

      if (!projectionRunDateStr && req.file.originalname) {
        // Try to extract date from filename like FURNITURE-20251006.xlsx
        const dateMatch = req.file.originalname.match(/(\d{8})/);
        if (dateMatch) {
          const dateStr = dateMatch[1]; // e.g., "20251006"
          const year = dateStr.substring(0, 4);
          const month = dateStr.substring(4, 6);
          const day = dateStr.substring(6, 8);
          projectionRunDateStr = `${year}-${month}-${day}`; // e.g., "2025-10-06"
        }
      }

      // Normalize to midnight UTC for consistent import_date (prevents duplicates from same-day imports)
      let projectionRunDate: Date;
      if (projectionRunDateStr) {
        // Parse date string and normalize to midnight UTC
        const [year, month, day] = projectionRunDateStr.split('-').map(Number);
        projectionRunDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      } else {
        // Default to today at midnight UTC
        const now = new Date();
        projectionRunDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      }

      // Determine category group from filename or request
      const categoryGroup = req.body.categoryGroup ||
        (req.file.originalname.toLowerCase().includes('furniture') ? 'FURNITURE' : 'HOME-GOODS');

      // Get client_id for client-specific projections
      const clientId = req.body.clientId ? parseInt(req.body.clientId) : null;
      console.log(`FURNITURE Import: Client ID from request: ${clientId || 'not specified'}`);

      const xlsx = await import("xlsx");
      const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet) as any[];

      if (rows.length === 0) {
        return res.status(400).json({ error: "File appears to be empty" });
      }

      // STEP 0: PRE-IMPORT RECORD COUNTS FOR VERIFICATION
      const preImportCounts = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*) FROM projection_snapshots) as snapshots_count,
          (SELECT COUNT(*) FROM active_projections) as active_count
      `);
      const preImportSnapshots = Number(preImportCounts.rows[0]?.snapshots_count || 0);
      const preImportActive = Number(preImportCounts.rows[0]?.active_count || 0);
      console.log(`FURNITURE Import: Pre-import counts - Snapshots: ${preImportSnapshots}, Active: ${preImportActive}`);

      // Projection data is now stored in projection_snapshots (historical) and active_projections (working state)
      const importDateStr = projectionRunDate.toISOString().split('T')[0];

      // Generate a unique import batch ID for tracking (timestamp-based since projection_uploads table was removed)
      const uploadId = Date.now();

      console.log(`FURNITURE Import: Preparing import for ${categoryGroup} with import_date ${importDateStr}`);

      // Brand mapping
      const mapBrand = (sourceBrand: string): string | null => {
        const normalized = String(sourceBrand || "").trim().toUpperCase();
        if (normalized === "CRATEKIDS" || normalized === "C&K" || normalized === "CK") return "C&K";
        if (normalized === "CRATE" || normalized === "CB") return "CB";
        if (normalized === "CB2") return "CB2";
        return null;
      };

      // Build vendor lookups - by CBH code (primary) and by name (fallback)
      const vendorsByCbhCode = new Map<string, any>();
      const vendorsByName = new Map<string, any>();
      const vendors = await storage.getVendors();

      for (const v of vendors) {
        // Primary lookup: CBH vendor code (if stored from previous imports)
        if (v.cbhVendorCode) {
          vendorsByCbhCode.set(v.cbhVendorCode.toLowerCase().trim(), v);
        }

        if (v.name) {
          // Store by normalized name for fuzzy matching
          const normalizedName = v.name.toLowerCase().trim()
            .replace(/[.,\-_&']/g, '')  // Remove punctuation
            .replace(/\s+/g, ' ');       // Normalize whitespace
          vendorsByName.set(normalizedName, v);

          // Also store exact lowercase match
          vendorsByName.set(v.name.toLowerCase().trim(), v);
        }
      }

      // Track CBH codes to update after import (store mapping when matched by name)
      const cbhCodeUpdates = new Map<number, string>(); // vendorId -> cbhCode

      // Helper to find vendor - tries CBH code first, then name matching
      const findVendor = (cbhCode: string, vendorName: string): any | null => {
        // 1. Try CBH vendor code first (most reliable)
        if (cbhCode) {
          const codeMatch = vendorsByCbhCode.get(cbhCode.toLowerCase().trim());
          if (codeMatch) return codeMatch;
        }

        if (!vendorName) return null;

        // 2. Try exact name match
        const exactMatch = vendorsByName.get(vendorName.toLowerCase().trim());
        if (exactMatch) {
          // Store CBH code for future imports if not already set
          if (cbhCode && !exactMatch.cbhVendorCode) {
            cbhCodeUpdates.set(exactMatch.id, cbhCode);
          }
          return exactMatch;
        }

        // 3. Try normalized match (remove punctuation)
        const normalized = vendorName.toLowerCase().trim()
          .replace(/[.,\-_&']/g, '')
          .replace(/\s+/g, ' ');
        const normalizedMatch = vendorsByName.get(normalized);
        if (normalizedMatch) {
          if (cbhCode && !normalizedMatch.cbhVendorCode) {
            cbhCodeUpdates.set(normalizedMatch.id, cbhCode);
          }
          return normalizedMatch;
        }

        // 4. Try partial match - check if any vendor name contains this name or vice versa
        for (const [key, vendor] of vendorsByName.entries()) {
          if (key.includes(normalized) || normalized.includes(key)) {
            if (cbhCode && !vendor.cbhVendorCode) {
              cbhCodeUpdates.set(vendor.id, cbhCode);
            }
            return vendor;
          }
        }

        return null;
      };

      const stats = {
        totalRows: rows.length,
        regularSkuRows: 0,
        spoRows: 0,
        projectionsImported: 0,
        vendorsProcessed: new Set<string>(),
        unknownVendors: new Set<string>(),
        unknownBrands: new Set<string>(),
        errors: [] as string[],
        yearMonthBreakdown: {} as Record<string, number>
      };

      // Group projections by vendor for batch archiving
      const projectionsByVendor = new Map<number, any[]>();

      // NEW: Track unknown vendors with their row data for review
      const unknownVendorData = new Map<string, {
        vendorCode: string;
        vendorName: string;
        rowCount: number;
        totalValue: number;
        rows: any[];
      }>();

      for (const row of rows) {
        try {
          const vendorCode = String(row["CB Vendor Code"] || "").trim();
          const vendorName = String(row["Vendor"] || "").trim();
          const sourceBrand = String(row["Brand"] || "").trim();
          const brand = mapBrand(sourceBrand);

          if (!brand) {
            if (sourceBrand) stats.unknownBrands.add(sourceBrand);
            continue;
          }

          // Look up vendor by CBH code first, then by name
          let vendor = findVendor(vendorCode, vendorName);
          if (!vendor) {
            // NEW: Collect unknown vendor rows instead of skipping
            const key = `${vendorCode}|${vendorName}`;
            const projectionValueRaw = parseFloat(String(row["Projection Value"] || "0")) || 0;

            if (!unknownVendorData.has(key)) {
              unknownVendorData.set(key, {
                vendorCode,
                vendorName,
                rowCount: 0,
                totalValue: 0,
                rows: []
              });
            }
            const uvd = unknownVendorData.get(key)!;
            uvd.rowCount++;
            uvd.totalValue += projectionValueRaw;
            uvd.rows.push(row);
            stats.unknownVendors.add(vendorName || vendorCode || "Unknown");
            continue;
          }

          const vendorLeadTimeRaw = String(row["Vendor Lead Time"] || "").trim();
          const isSPO = vendorLeadTimeRaw.toUpperCase() === "SPO";

          const sku = String(row["SKU"] || "").trim();
          const skuDescription = String(row["SKU Desc"] || "").trim();
          const productClass = String(row["Class"] || "").trim();
          const collection = String(row["Collection"] || "").trim();
          const pattern = String(row["Pattern"] || "").trim();
          const coo = String(row["COO"] || "").trim();
          const fobRaw = parseFloat(String(row["FOB"] || "0")) || 0;
          const fobCents = Math.round(fobRaw * 100);
          const year = parseInt(String(row["Year"] || new Date().getFullYear())) || new Date().getFullYear();
          const month = parseInt(String(row["Month"] || "1")) || 1;
          const projectionValueRaw = parseFloat(String(row["Projection Value"] || "0")) || 0;
          const projectionValueCents = Math.round(projectionValueRaw * 100);

          // Calculate quantity from value and FOB if available
          let quantity = 0;
          if (fobRaw > 0 && projectionValueRaw > 0) {
            quantity = Math.round(projectionValueRaw / fobRaw);
          }

          // Track stats
          if (isSPO) {
            stats.spoRows++;
          } else {
            stats.regularSkuRows++;
          }
          stats.vendorsProcessed.add(vendor.name);
          const ymKey = `${year}-${String(month).padStart(2, '0')}`;
          stats.yearMonthBreakdown[ymKey] = (stats.yearMonthBreakdown[ymKey] || 0) + 1;

          // For SPO items, use collection as the "SKU" identifier for uniqueness
          const effectiveSku = isSPO ? `SPO_${collection}` : sku;

          if (!effectiveSku || effectiveSku === "SPO_") {
            continue; // Skip rows without identifiable SKU
          }

          const projection = {
            vendorId: vendor.id,
            vendorCode: vendorCode || vendor.name,
            sku: effectiveSku,
            skuDescription: isSPO ? `SPO: ${collection}` : skuDescription,
            brand,
            sourceBrand,
            productClass,
            collection,
            pattern: isSPO ? "SPO" : pattern,
            coo,
            vendorLeadTime: isSPO ? null : (parseInt(vendorLeadTimeRaw) || null),
            fob: fobCents,
            year,
            month,
            projectionValue: projectionValueCents,
            quantity,
            orderType: isSPO ? "mto" : "regular",
            categoryGroup, // FURNITURE or HOME-GOODS - from filename detection
            matchStatus: "unmatched",
            importDate: projectionRunDate, // Use the date from filename or explicit parameter
            importedBy: req.user?.username || "system"
          };

          if (!projectionsByVendor.has(vendor.id)) {
            projectionsByVendor.set(vendor.id, []);
          }
          projectionsByVendor.get(vendor.id)!.push(projection);

        } catch (rowError: any) {
          stats.errors.push(`Row error: ${rowError.message}`);
        }
      }

      // NEW: Check if there are unknown vendors that need user review
      if (unknownVendorData.size > 0) {
        // Generate a unique pending import ID
        const pendingImportId = `pending_${uploadId}_${Date.now()}`;

        // Store the pending import data for later completion
        pendingImports.set(pendingImportId, {
          uploadId,
          categoryGroup,
          projectionRunDate,
          parsedRows: rows,
          unknownVendors: unknownVendorData,
          knownVendorProjections: projectionsByVendor,
          fileName: req.file.originalname, // Store filename for import history
          importedBy: req.user?.username,
          clientId, // Client ID for client-specific projections
          stats: {
            ...stats,
            unknownVendors: Array.from(stats.unknownVendors),
            unknownBrands: Array.from(stats.unknownBrands),
            vendorsProcessed: Array.from(stats.vendorsProcessed)
          },
          expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minute expiry
        });

        // Get all existing SKUs from po_line_items for validation
        const existingSkusResult = await db.execute(sql`SELECT DISTINCT sku FROM po_line_items WHERE sku IS NOT NULL`);
        const existingSkus = new Set((existingSkusResult.rows as any[]).map(r => r.sku));

        // Return the unknown vendors for user review with detailed row info
        const unknownVendorsList = Array.from(unknownVendorData.entries()).map(([key, data]) => {
          // Parse row details for display
          const rowDetails = data.rows.map((row: any) => {
            const sku = String(row["SKU"] || "").trim();
            const skuDescription = String(row["SKU Desc"] || "").trim();
            const brand = String(row["Brand"] || "").trim();
            const collection = String(row["Collection"] || "").trim();
            const year = parseInt(String(row["Year"] || "")) || null;
            const month = parseInt(String(row["Month"] || "")) || null;
            const projectionValue = parseFloat(String(row["Projection Value"] || "0")) || 0;
            const vendorLeadTime = String(row["Vendor Lead Time"] || "").trim();
            const isSPO = vendorLeadTime.toUpperCase() === "SPO";

            return {
              sku: isSPO ? `SPO_${collection}` : sku,
              skuDescription: isSPO ? `SPO: ${collection}` : skuDescription,
              brand,
              collection,
              year,
              month,
              projectionValue,
              orderType: isSPO ? "SPO/MTO" : "Regular",
              skuExists: isSPO || existingSkus.has(sku),
              vendorExists: false
            };
          });

          return {
            key,
            vendorCode: data.vendorCode,
            vendorName: data.vendorName,
            rowCount: data.rowCount,
            totalValue: data.totalValue,
            rowDetails
          };
        });

        // Also get list of existing vendors for mapping options
        const existingVendors = vendors.map(v => ({
          id: v.id,
          name: v.name,
          cbhVendorCode: v.cbhVendorCode
        }));

        return res.json({
          success: false,
          needsReview: true,
          pendingImportId,
          message: `Found ${unknownVendorData.size} unknown vendor(s) requiring review`,
          unknownVendors: unknownVendorsList,
          existingVendors,
          knownVendorStats: {
            vendorsProcessed: Array.from(stats.vendorsProcessed).length,
            rowsProcessed: Array.from(projectionsByVendor.values()).reduce((sum, arr) => sum + arr.length, 0)
          }
        });
      }

      // Archive existing projections and insert new ones for each vendor
      let archivedTotal = 0;
      let rawRowsProcessed = 0;
      let duplicatesAggregated = 0;
      let totalProjectionValue = 0;
      let regularCount = 0;
      let spoMtoCount = 0;

      // OPTIMIZED: Collect all data first, then batch insert for performance
      const allVendorSkuProjections: any[] = [];

      for (const [vendorId, projections] of projectionsByVendor.entries()) {
        try {
          // Aggregate duplicate SKUs (same vendor+sku+year+month) by summing values/quantities
          const aggregatedMap = new Map<string, any>();

          for (const proj of projections) {
            rawRowsProcessed++;
            totalProjectionValue += proj.projectionValue;
            if (proj.orderType === 'mto' || proj.orderType === 'spo') {
              spoMtoCount++;
            } else {
              regularCount++;
            }

            const key = `${proj.vendorId}_${proj.sku}_${proj.year}_${proj.month}`;
            if (aggregatedMap.has(key)) {
              const existing = aggregatedMap.get(key);
              existing.projectionValue += proj.projectionValue;
              existing.quantity += proj.quantity;
              duplicatesAggregated++;
            } else {
              aggregatedMap.set(key, { ...proj, importBatchId: uploadId });
            }
          }

          // Collect aggregated projections for batch insert
          for (const proj of aggregatedMap.values()) {
            allVendorSkuProjections.push(proj);
            stats.projectionsImported++;
          }
        } catch (vendorError: any) {
          stats.errors.push(`Vendor ${vendorId} error: ${vendorError.message}`);
        }
      }

      // ========== Write to projection_snapshots (immutable historical archive) ==========
      // These are NEVER modified after import - used for accuracy analysis
      console.log(`FURNITURE Import: Writing ${allVendorSkuProjections.length} projection snapshots...`);
      const snapshotRecords = allVendorSkuProjections.map(proj => ({
        clientId: clientId,
        vendorId: proj.vendorId,
        vendorCode: proj.vendorCode,
        sku: proj.sku,
        skuDescription: proj.skuDescription,
        brand: proj.brand,
        sourceBrand: proj.sourceBrand,
        productClass: proj.productClass,
        collection: proj.collection,
        pattern: proj.pattern,
        coo: proj.coo,
        vendorLeadTime: proj.vendorLeadTime,
        fob: proj.fob,
        year: proj.year,
        month: proj.month,
        projectionValue: proj.projectionValue,
        quantity: proj.quantity,
        orderType: proj.orderType,
        categoryGroup: proj.categoryGroup,
        importDate: projectionRunDate,
        importedBy: req.user?.username,
      }));

      // Clear existing snapshots for this import_date AND category_group (allows re-import to update)
      // Scoped delete ensures we don't affect other category groups' snapshots on same date
      await db.delete(projectionSnapshots)
        .where(and(
          sql`DATE(import_date) = DATE(${projectionRunDate})`,
          eq(projectionSnapshots.categoryGroup, categoryGroup)
        ));

      // Insert snapshots in batches
      const BATCH_SIZE = 500;
      for (let i = 0; i < snapshotRecords.length; i += BATCH_SIZE) {
        const batch = snapshotRecords.slice(i, i + BATCH_SIZE);
        await db.insert(projectionSnapshots).values(batch);
      }

      // ========== REPLACE ALL: Clear existing active_projections for imported vendors ==========
      // This ensures active_projections is ALWAYS the single source of truth
      // by completely replacing data for ONLY the exact vendor+year pairs being imported
      const uniqueVendorYearPairs = [...new Set(allVendorSkuProjections.map(p => `${p.vendorId}|${p.year}`))];

      let deletedCount = 0;
      let activeInsertCount = 0;

      // Use transaction to ensure atomic delete+insert (all or nothing)
      await db.execute(sql`BEGIN`);
      try {
        for (const pair of uniqueVendorYearPairs) {
          const [vendorIdStr, yearStr] = pair.split('|');
          const vendorId = parseInt(vendorIdStr);
          const year = parseInt(yearStr);
          const result = await db.execute(sql`
            DELETE FROM active_projections 
            WHERE vendor_id = ${vendorId} 
              AND category_group = ${categoryGroup}
              AND year = ${year}
          `);
          deletedCount += (result as any).rowCount || 0;
        }
        console.log(`FURNITURE Import: Cleared ${deletedCount} existing active projections for ${uniqueVendorYearPairs.length} vendor+year pairs`);

        // ========== INSERT fresh active_projections ==========
        console.log(`FURNITURE Import: Inserting ${allVendorSkuProjections.length} fresh active projections...`);

        for (const proj of allVendorSkuProjections) {
          await db.execute(sql`
            INSERT INTO active_projections (
              client_id, vendor_id, vendor_code, sku, sku_description, brand, product_class, collection,
              year, month, projection_value, quantity, order_type, category_group,
              last_snapshot_date, match_status, created_at, updated_at
            ) VALUES (
              ${clientId}, ${proj.vendorId}, ${proj.vendorCode}, ${proj.sku}, ${proj.skuDescription || null},
              ${proj.brand}, ${proj.productClass || null}, ${proj.collection || null},
              ${proj.year}, ${proj.month}, ${proj.projectionValue || 0}, ${proj.quantity || 0},
              ${proj.orderType || 'regular'}, ${proj.categoryGroup || categoryGroup},
              ${projectionRunDate}, 'unmatched', NOW(), NOW()
            )
            ON CONFLICT (vendor_code, sku, year, month) 
            DO UPDATE SET
              client_id = EXCLUDED.client_id,
              vendor_id = EXCLUDED.vendor_id,
              sku_description = EXCLUDED.sku_description,
              brand = EXCLUDED.brand,
              product_class = EXCLUDED.product_class,
              collection = EXCLUDED.collection,
              projection_value = EXCLUDED.projection_value,
              quantity = EXCLUDED.quantity,
              order_type = EXCLUDED.order_type,
              category_group = EXCLUDED.category_group,
              last_snapshot_date = EXCLUDED.last_snapshot_date,
              updated_at = NOW()
          `);
          activeInsertCount++;
        }

        await db.execute(sql`COMMIT`);
      } catch (error) {
        await db.execute(sql`ROLLBACK`);
        console.error('FURNITURE Import: Transaction rolled back due to error:', error);
        throw error;
      }

      console.log(`FURNITURE Import: Wrote ${snapshotRecords.length} snapshots and inserted ${activeInsertCount} fresh active projections (replaced ${deletedCount} old)`);

      if (duplicatesAggregated > 0) {
        console.log(`FURNITURE Import: Aggregated ${duplicatesAggregated} duplicate SKU rows into ${stats.projectionsImported} unique projections`);
      }

      // Update vendors with CBH codes learned from name matching
      let cbhCodesUpdated = 0;
      for (const [vendorId, cbhCode] of cbhCodeUpdates.entries()) {
        try {
          await storage.updateVendor(vendorId, { cbhVendorCode: cbhCode });
          cbhCodesUpdated++;
        } catch (err) {
          // Non-critical, just log it
          console.log(`Could not update CBH code for vendor ${vendorId}: ${err}`);
        }
      }

      // POST-IMPORT VERIFICATION: Count records after import
      const postImportCounts = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*) FROM projection_snapshots) as snapshots_count,
          (SELECT COUNT(*) FROM active_projections) as active_count
      `);
      const postImportSnapshots = Number(postImportCounts.rows[0]?.snapshots_count || 0);
      const postImportActive = Number(postImportCounts.rows[0]?.active_count || 0);
      console.log(`FURNITURE Import: Post-import counts - Snapshots: ${postImportSnapshots}, Active: ${postImportActive}`);

      const snapshotsChange = postImportSnapshots - preImportSnapshots;
      const activeChange = postImportActive - preImportActive;
      const verificationDetails = `Pre-import: ${preImportSnapshots} snapshots, ${preImportActive} active. ` +
        `Post-import: ${postImportSnapshots} snapshots, ${postImportActive} active. ` +
        `Net change: ${snapshotsChange >= 0 ? '+' : ''}${snapshotsChange} snapshots, ${activeChange >= 0 ? '+' : ''}${activeChange} active. ` +
        `Processed: ${stats.projectionsImported} projections from ${rows.length} rows.`;

      console.log(`FURNITURE Import: Verification - ${verificationDetails}`);

      // Log import history with verification data
      await storage.createImportHistory({
        fileName: req.file.originalname,
        fileType: "furniture_projections",
        recordsImported: stats.projectionsImported,
        status: stats.errors.length > 0 ? "partial" : "success",
        errorMessage: stats.errors.length > 0 ? stats.errors.slice(0, 5).join("; ") : null,
        importedBy: req.user?.username,
        preImportProjections: preImportSnapshots + preImportActive,
        fileRowCount: rows.length,
        postImportProjections: postImportSnapshots + postImportActive,
        verificationStatus: stats.errors.length > 0 ? 'warning' : 'passed',
        verificationDetails,
      });

      console.log(`FURNITURE Import: ${stats.projectionsImported} projections imported, ${archivedTotal} archived, import_date: ${projectionRunDate.toISOString().split('T')[0]}`);
      if (cbhCodesUpdated > 0) {
        console.log(`FURNITURE Import: Updated ${cbhCodesUpdated} vendors with CBH codes`);
      }
      console.log(`FURNITURE Import: ${stats.regularSkuRows} regular SKU rows, ${stats.spoRows} SPO rows`);
      console.log(`FURNITURE Import: Vendors processed: ${Array.from(stats.vendorsProcessed).join(', ')}`);

      // Auto-run projection-to-PO matching after import
      console.log('FURNITURE Import: Auto-running projection-to-PO matching...');
      const matchingResult = await runProjectionMatching();
      console.log(`FURNITURE Import: Matching complete - ${matchingResult.matched} matched, ${matchingResult.partialMatches} partial, ${matchingResult.unmatched} unmatched`);

      res.json({
        success: true,
        message: `Imported ${stats.projectionsImported} projections (${stats.regularSkuRows} regular, ${stats.spoRows} SPO/MTO). Matched ${matchingResult.matched} to POs.`,
        uploadId,
        projectionRunDate: projectionRunDate.toISOString().split('T')[0],
        stats: {
          totalRows: stats.totalRows,
          projectionsImported: stats.projectionsImported,
          projectionsArchived: archivedTotal,
          regularSkuRows: stats.regularSkuRows,
          spoRows: stats.spoRows,
          rawRowsStored: rawRowsProcessed,
          vendorsProcessed: Array.from(stats.vendorsProcessed).length,
          cbhCodesUpdated,
          yearMonthBreakdown: stats.yearMonthBreakdown,
          unknownVendors: stats.unknownVendors.size > 0 ? Array.from(stats.unknownVendors) : undefined,
          unknownBrands: stats.unknownBrands.size > 0 ? Array.from(stats.unknownBrands) : undefined,
          errors: stats.errors.length > 0 ? stats.errors.slice(0, 10) : undefined,
          matching: {
            matched: matchingResult.matched,
            partialMatches: matchingResult.partialMatches,
            unmatched: matchingResult.unmatched,
            totalProjections: matchingResult.totalProjections
          }
        },
        verification: {
          status: stats.errors.length > 0 ? 'warning' : 'passed',
          preImport: { snapshots: preImportSnapshots, active: preImportActive },
          postImport: { snapshots: postImportSnapshots, active: postImportActive },
          details: verificationDetails,
        },
      });
    } catch (error: any) {
      console.error("Error importing FURNITURE projections:", error);
      res.status(500).json({ error: error.message || "Import failed" });
    }
  });

  // Complete a pending import with user's vendor mapping decisions
  // Accepts decisions for each unknown vendor: createNew, mapToExisting (with vendorId), or skip
  app.post("/api/import/furniture-projections/complete", async (req: Request, res: Response) => {
    try {
      const { pendingImportId, vendorDecisions } = req.body;

      if (!pendingImportId || !vendorDecisions) {
        return res.status(400).json({ error: "pendingImportId and vendorDecisions are required" });
      }

      const pendingData = pendingImports.get(pendingImportId);
      if (!pendingData) {
        return res.status(404).json({ error: "Pending import not found or expired. Please re-upload the file." });
      }

      // Validate that mapToExisting decisions have a vendorId BEFORE any side effects
      for (const [key, decision] of Object.entries(vendorDecisions)) {
        if (decision && (decision as any).action === 'mapToExisting' && !(decision as any).vendorId) {
          return res.status(400).json({
            error: `Vendor "${pendingData.unknownVendors.get(key)?.vendorName || key}" is set to map to existing vendor but no vendor was selected.`
          });
        }
      }

      // Process vendor decisions
      // vendorDecisions: { [key: string]: { action: 'createNew' | 'mapToExisting' | 'skip', vendorId?: number } }
      const vendorMappings = new Map<string, number>(); // key -> vendorId
      const newVendorsCreated: any[] = [];
      const skippedVendors: string[] = [];

      for (const [key, data] of pendingData.unknownVendors.entries()) {
        const decision = vendorDecisions[key];

        if (!decision || decision.action === 'skip') {
          skippedVendors.push(data.vendorName || data.vendorCode);
          continue;
        }

        if (decision.action === 'createNew') {
          // Create new vendor
          const newVendor = await storage.createVendor({
            name: data.vendorName || data.vendorCode,
            cbhVendorCode: data.vendorCode || null,
            status: 'active',
            country: null,
            email: null,
            phone: null,
            notes: `Auto-created from projection import on ${new Date().toISOString().split('T')[0]}`
          });
          vendorMappings.set(key, newVendor.id);
          newVendorsCreated.push({ id: newVendor.id, name: newVendor.name });
        } else if (decision.action === 'mapToExisting' && decision.vendorId) {
          vendorMappings.set(key, decision.vendorId);
        }
      }

      // Now process ALL projections: known vendors + resolved unknown vendors
      const { categoryGroup, projectionRunDate, uploadId } = pendingData;
      const allProjectionsToInsert: any[] = [];

      // First, add all known vendor projections (these were already parsed)
      for (const [vendorId, projections] of pendingData.knownVendorProjections.entries()) {
        for (const proj of projections) {
          allProjectionsToInsert.push({
            ...proj,
            importBatchId: uploadId
          });
        }
      }

      // Brand mapping function (same as main import)
      const mapBrand = (sourceBrand: string): string | null => {
        const normalized = String(sourceBrand || "").trim().toUpperCase();
        if (normalized === "CRATEKIDS" || normalized === "C&K" || normalized === "CK") return "C&K";
        if (normalized === "CRATE" || normalized === "CB") return "CB";
        if (normalized === "CB2") return "CB2";
        return null;
      };

      // Then add resolved unknown vendor projections
      let unknownVendorRowsProcessed = 0;
      for (const [key, data] of pendingData.unknownVendors.entries()) {
        const vendorId = vendorMappings.get(key);
        if (!vendorId) continue; // Skipped vendor

        for (const row of data.rows) {
          const sourceBrand = String(row["Brand"] || "").trim();
          const brand = mapBrand(sourceBrand);
          if (!brand) continue;

          const vendorCode = String(row["CB Vendor Code"] || "").trim();
          const vendorLeadTimeRaw = String(row["Vendor Lead Time"] || "").trim();
          const isSPO = vendorLeadTimeRaw.toUpperCase() === "SPO";

          const sku = String(row["SKU"] || "").trim();
          const skuDescription = String(row["SKU Desc"] || "").trim();
          const productClass = String(row["Class"] || "").trim();
          const collection = String(row["Collection"] || "").trim();
          const pattern = String(row["Pattern"] || "").trim();
          const coo = String(row["COO"] || "").trim();
          const fobRaw = parseFloat(String(row["FOB"] || "0")) || 0;
          const fobCents = Math.round(fobRaw * 100);
          const year = parseInt(String(row["Year"] || new Date().getFullYear())) || new Date().getFullYear();
          const month = parseInt(String(row["Month"] || "1")) || 1;
          const projectionValueRaw = parseFloat(String(row["Projection Value"] || "0")) || 0;
          const projectionValueCents = Math.round(projectionValueRaw * 100);

          let quantity = 0;
          if (fobRaw > 0 && projectionValueRaw > 0) {
            quantity = Math.round(projectionValueRaw / fobRaw);
          }

          const effectiveSku = isSPO ? `SPO_${collection}` : sku;
          if (!effectiveSku || effectiveSku === "SPO_") continue;

          allProjectionsToInsert.push({
            vendorId,
            vendorCode: vendorCode || data.vendorName,
            sku: effectiveSku,
            skuDescription: isSPO ? `SPO: ${collection}` : skuDescription,
            brand,
            sourceBrand,
            productClass,
            collection,
            pattern: isSPO ? "SPO" : pattern,
            coo,
            vendorLeadTime: isSPO ? null : (parseInt(vendorLeadTimeRaw) || null),
            fob: fobCents,
            year,
            month,
            projectionValue: projectionValueCents,
            quantity,
            orderType: isSPO ? "mto" : "regular",
            categoryGroup,
            matchStatus: "unmatched",
            importDate: projectionRunDate,
            importedBy: req.user?.username || "system",
            importBatchId: uploadId
          });
          unknownVendorRowsProcessed++;
        }
      }

      // Projection data is now stored in projection_snapshots (historical) and active_projections (working state)
      const importDateStr = projectionRunDate.toISOString().split('T')[0];
      const BATCH_SIZE = 100;

      // Insert all projections to both projection_snapshots and active_projections
      let insertedCount = 0;
      if (allProjectionsToInsert.length > 0) {
        insertedCount = allProjectionsToInsert.length;

        // ========== Write to projection_snapshots (immutable historical archive) ==========
        console.log(`Completion Import: Writing ${allProjectionsToInsert.length} projection snapshots...`);
        const snapshotRecords = allProjectionsToInsert.map(proj => ({
          vendorId: proj.vendorId,
          vendorCode: proj.vendorCode,
          sku: proj.sku,
          skuDescription: proj.skuDescription,
          brand: proj.brand,
          sourceBrand: proj.sourceBrand,
          productClass: proj.productClass,
          collection: proj.collection,
          pattern: proj.pattern,
          coo: proj.coo,
          vendorLeadTime: proj.vendorLeadTime,
          fob: proj.fob,
          year: proj.year,
          month: proj.month,
          projectionValue: proj.projectionValue,
          quantity: proj.quantity,
          orderType: proj.orderType,
          categoryGroup: proj.categoryGroup,
          importDate: projectionRunDate,
          importedBy: req.user?.username,
        }));

        // Clear existing snapshots for this import_date AND category_group (allows re-import to update)
        await db.delete(projectionSnapshots)
          .where(and(
            sql`DATE(import_date) = DATE(${projectionRunDate})`,
            eq(projectionSnapshots.categoryGroup, categoryGroup)
          ));

        // Insert snapshots in batches
        for (let i = 0; i < snapshotRecords.length; i += BATCH_SIZE) {
          const batch = snapshotRecords.slice(i, i + BATCH_SIZE);
          await db.insert(projectionSnapshots).values(batch);
        }

        // ========== REPLACE ALL: Clear existing active_projections for imported vendors ==========
        // Only delete exact vendor+year pairs that are being imported
        const uniqueVendorYearPairs = [...new Set(allProjectionsToInsert.map(p => `${p.vendorId}|${p.year}`))];

        let deletedCount = 0;

        // Use transaction to ensure atomic delete+insert (all or nothing)
        await db.execute(sql`BEGIN`);
        try {
          for (const pair of uniqueVendorYearPairs) {
            const [vendorIdStr, yearStr] = pair.split('|');
            const vendorId = parseInt(vendorIdStr);
            const year = parseInt(yearStr);
            const result = await db.execute(sql`
              DELETE FROM active_projections 
              WHERE vendor_id = ${vendorId} 
                AND category_group = ${categoryGroup}
                AND year = ${year}
            `);
            deletedCount += (result as any).rowCount || 0;
          }
          console.log(`Completion Import: Cleared ${deletedCount} existing active projections for ${uniqueVendorYearPairs.length} vendor+year pairs`);

          // ========== INSERT fresh active_projections ==========
          const completionClientId = pendingData.clientId;
          console.log(`Completion Import: Inserting ${allProjectionsToInsert.length} fresh active projections with clientId=${completionClientId}...`);
          for (const proj of allProjectionsToInsert) {
            await db.execute(sql`
              INSERT INTO active_projections (
                client_id, vendor_id, vendor_code, sku, sku_description, brand, product_class, collection,
                year, month, projection_value, quantity, order_type, category_group,
                last_snapshot_date, match_status, created_at, updated_at
              ) VALUES (
                ${completionClientId}, ${proj.vendorId}, ${proj.vendorCode}, ${proj.sku}, ${proj.skuDescription || null},
                ${proj.brand}, ${proj.productClass || null}, ${proj.collection || null},
                ${proj.year}, ${proj.month}, ${proj.projectionValue || 0}, ${proj.quantity || 0},
                ${proj.orderType || 'regular'}, ${proj.categoryGroup || categoryGroup},
                ${projectionRunDate}, 'unmatched', NOW(), NOW()
              )
              ON CONFLICT (vendor_code, sku, year, month) 
              DO UPDATE SET
                client_id = EXCLUDED.client_id,
                vendor_id = EXCLUDED.vendor_id,
                sku_description = EXCLUDED.sku_description,
                brand = EXCLUDED.brand,
                product_class = EXCLUDED.product_class,
                collection = EXCLUDED.collection,
                projection_value = EXCLUDED.projection_value,
                quantity = EXCLUDED.quantity,
                order_type = EXCLUDED.order_type,
                category_group = EXCLUDED.category_group,
                last_snapshot_date = EXCLUDED.last_snapshot_date,
                updated_at = NOW()
            `);
          }

          await db.execute(sql`COMMIT`);
        } catch (error) {
          await db.execute(sql`ROLLBACK`);
          console.error('Completion Import: Transaction rolled back due to error:', error);
          throw error;
        }

        console.log(`Completion Import: Wrote ${snapshotRecords.length} snapshots and inserted ${allProjectionsToInsert.length} fresh active projections (replaced ${deletedCount} old)`);
      }

      const knownVendorCount = Array.from(pendingData.knownVendorProjections.values()).reduce((sum, arr) => sum + arr.length, 0);

      // Log import history with actual counts
      await storage.createImportHistory({
        fileName: pendingData.fileName || 'FURNITURE-import.xlsx',
        fileType: "furniture_projections",
        recordsImported: insertedCount,
        status: skippedVendors.length > 0 ? "partial" : "success",
        errorMessage: skippedVendors.length > 0 ? `Skipped vendors: ${skippedVendors.join(', ')}` : null,
        importedBy: pendingData.importedBy,
      });
      console.log(`Completion Import: Logged import history - ${insertedCount} records, status: ${skippedVendors.length > 0 ? 'partial' : 'success'}`);

      // Clean up pending import
      pendingImports.delete(pendingImportId);

      res.json({
        success: true,
        message: `Import completed. Created ${newVendorsCreated.length} new vendor(s), inserted ${insertedCount} projection(s) (${knownVendorCount} from known vendors, ${unknownVendorRowsProcessed} from resolved vendors).`,
        newVendorsCreated,
        skippedVendors,
        totalProjectionsInserted: insertedCount,
        knownVendorProjections: knownVendorCount,
        resolvedVendorProjections: unknownVendorRowsProcessed
      });

    } catch (error: any) {
      console.error("Error completing pending import:", error);
      res.status(500).json({ error: error.message || "Failed to complete import" });
    }
  });

  // Cancel a pending import
  app.delete("/api/import/furniture-projections/pending/:pendingImportId", async (req: Request, res: Response) => {
    try {
      const { pendingImportId } = req.params;

      if (pendingImports.has(pendingImportId)) {
        pendingImports.delete(pendingImportId);
        res.json({ success: true, message: "Pending import cancelled" });
      } else {
        res.status(404).json({ error: "Pending import not found or already expired" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to cancel import" });
    }
  });

  // ==========================================
  // ACTUAL AGGREGATION & MATCHING ENDPOINTS
  // ==========================================

  // Refresh actual_agg from po_headers for a specific year/month or all
  // This aggregates actual orders by vendor/SKU/collection for comparison against projections
  app.post("/api/projections/refresh-actuals", async (req: Request, res: Response) => {
    try {
      const { targetYear, targetMonth, vendorId } = req.body;
      const currentYear = new Date().getFullYear();
      const yearToProcess = targetYear || currentYear;

      console.log(`Refreshing actuals for year ${yearToProcess}${targetMonth ? `, month ${targetMonth}` : ''}${vendorId ? `, vendor ${vendorId}` : ''}`);

      // Build the query to get actuals from po_headers with line items
      // For regular orders: group by vendor + SKU + month of original_ship_date
      // For SPO: group by vendor + collection + month

      // First, get the actual orders data from po_headers
      // Note: All orders treated as 'regular' since po_type column doesn't exist
      const actualsQuery = await db.execute(sql`
        WITH po_data AS (
          SELECT 
            ph.vendor_id,
            ph.po_number,
            ph.brand,
            ph.total_value,
            ph.shipped_value,
            EXTRACT(YEAR FROM ph.original_ship_date)::int as target_year,
            EXTRACT(MONTH FROM ph.original_ship_date)::int as target_month,
            'regular' as order_type,
            ph.is_shipped
          FROM po_headers ph
          WHERE ph.vendor_id IS NOT NULL
            AND ph.original_ship_date IS NOT NULL
            AND EXTRACT(YEAR FROM ph.original_ship_date) = ${yearToProcess}
            ${targetMonth ? sql`AND EXTRACT(MONTH FROM ph.original_ship_date) = ${targetMonth}` : sql``}
            ${vendorId ? sql`AND ph.vendor_id = ${vendorId}` : sql``}
            AND (ph.po_number NOT LIKE 'SMP%' AND ph.po_number NOT LIKE '8X8%')
            AND ph.total_value > 0
        )
        SELECT 
          vendor_id,
          target_year,
          target_month,
          order_type,
          brand,
          COUNT(DISTINCT po_number) as po_count,
          SUM(total_value) as actual_value_sum,
          SUM(CASE WHEN is_shipped THEN total_value ELSE 0 END) as shipped_value_sum,
          SUM(CASE WHEN NOT is_shipped THEN total_value ELSE 0 END) as unshipped_value_sum
        FROM po_data
        GROUP BY vendor_id, target_year, target_month, order_type, brand
        ORDER BY vendor_id, target_year, target_month
      `);

      const results = actualsQuery.rows as any[];
      console.log(`Found ${results.length} vendor/month/orderType combinations from po_headers`);

      let inserted = 0;
      let updated = 0;

      for (const row of results) {
        // Check if an aggregate already exists
        const existing = await db.select().from(actualAgg).where(
          sql`vendor_id = ${row.vendor_id}
              AND target_year = ${row.target_year}
              AND target_month = ${row.target_month}
              AND order_type = ${row.order_type}
              AND sku IS NULL
              AND collection IS NULL`
        );

        if (existing.length > 0) {
          // Update existing
          await db.update(actualAgg)
            .set({
              actualValueSum: parseInt(row.actual_value_sum) || 0,
              shippedValueSum: parseInt(row.shipped_value_sum) || 0,
              unshippedValueSum: parseInt(row.unshipped_value_sum) || 0,
              poCount: parseInt(row.po_count) || 0,
              brand: row.brand,
              lastRefreshedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(sql`id = ${existing[0].id}`);
          updated++;
        } else {
          // Insert new
          await db.insert(actualAgg).values({
            vendorId: row.vendor_id,
            targetYear: row.target_year,
            targetMonth: row.target_month,
            orderType: row.order_type,
            brand: row.brand,
            actualValueSum: parseInt(row.actual_value_sum) || 0,
            shippedValueSum: parseInt(row.shipped_value_sum) || 0,
            unshippedValueSum: parseInt(row.unshipped_value_sum) || 0,
            poCount: parseInt(row.po_count) || 0,
            lastRefreshedAt: new Date(),
          });
          inserted++;
        }
      }

      res.json({
        success: true,
        yearProcessed: yearToProcess,
        monthProcessed: targetMonth || 'all',
        recordsFound: results.length,
        inserted,
        updated,
      });
    } catch (error: any) {
      console.error("Error refreshing actuals:", error);
      res.status(500).json({ error: error.message || "Failed to refresh actuals" });
    }
  });

  // Get actuals aggregates for comparison
  app.get("/api/projections/actuals", async (req: Request, res: Response) => {
    try {
      const { targetYear, targetMonth, vendorId } = req.query;

      const conditions = [];
      if (targetYear) conditions.push(sql`target_year = ${Number(targetYear)}`);
      if (targetMonth) conditions.push(sql`target_month = ${Number(targetMonth)}`);
      if (vendorId) conditions.push(sql`vendor_id = ${Number(vendorId)}`);

      let query = db.select().from(actualAgg);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const actuals = await query;

      res.json({
        count: actuals.length,
        actuals,
        totalValue: actuals.reduce((sum, a) => sum + (a.actualValueSum || 0), 0),
      });
    } catch (error: any) {
      console.error("Error getting actuals:", error);
      res.status(500).json({ error: error.message || "Failed to get actuals" });
    }
  });

  // ==========================================
  // ROLLING FORECAST DRIFT ENDPOINTS
  // ==========================================

  // Get forecast drift data - shows how projections changed across multiple uploads for same target month
  // This helps track how accurate projections become as they get closer to the target month
  app.get("/api/projections/drift", async (req: Request, res: Response) => {
    try {
      const { targetYear, targetMonth, vendorId } = req.query;

      if (!targetYear || !targetMonth) {
        return res.status(400).json({ error: "targetYear and targetMonth are required" });
      }

      // Get all projections for this target month grouped by import_date
      // Uses projection_snapshots as historical archive for drift analysis
      const driftQuery = await db.execute(sql`
        SELECT 
          DATE(ps.import_date) as projection_run_date,
          ps.category_group as source_file,
          ps.category_group as category_group,
          ps.vendor_id,
          v.name as vendor_name,
          ps.order_type,
          ps.brand,
          SUM(ps.projection_value) as total_projected_value,
          SUM(ps.quantity) as total_projected_quantity,
          COUNT(*) as agg_count
        FROM projection_snapshots ps
        LEFT JOIN vendors v ON ps.vendor_id = v.id
        WHERE ps.year = ${Number(targetYear)}
          AND ps.month = ${Number(targetMonth)}
          ${vendorId ? sql`AND ps.vendor_id = ${Number(vendorId)}` : sql``}
        GROUP BY DATE(ps.import_date), ps.category_group, 
                 ps.vendor_id, v.name, ps.order_type, ps.brand
        ORDER BY DATE(ps.import_date) ASC, ps.vendor_id
      `);

      const driftData = driftQuery.rows as any[];

      // Group by vendor to show drift over time for each vendor
      const vendorDrift = new Map<number, any[]>();
      for (const row of driftData) {
        if (!vendorDrift.has(row.vendor_id)) {
          vendorDrift.set(row.vendor_id, []);
        }
        vendorDrift.get(row.vendor_id)!.push({
          projectionRunDate: row.projection_run_date,
          sourceFile: row.source_file,
          categoryGroup: row.category_group,
          orderType: row.order_type,
          brand: row.brand,
          projectedValue: parseInt(row.total_projected_value) || 0,
          projectedQuantity: parseInt(row.total_projected_quantity) || 0,
        });
      }

      // Calculate drift metrics for each vendor
      const driftSummary = [];
      for (const [vId, snapshots] of vendorDrift.entries()) {
        if (snapshots.length < 2) continue;

        const firstValue = snapshots[0].projectedValue;
        const lastValue = snapshots[snapshots.length - 1].projectedValue;
        const driftDollar = lastValue - firstValue;
        const driftPct = firstValue > 0 ? Math.round((driftDollar / firstValue) * 100) : 0;

        driftSummary.push({
          vendorId: vId,
          vendorName: driftData.find(d => d.vendor_id === vId)?.vendor_name,
          snapshotCount: snapshots.length,
          firstProjectedValue: firstValue,
          lastProjectedValue: lastValue,
          driftDollar,
          driftPct,
          snapshots,
        });
      }

      // Count unique import dates as snapshots
      const uniqueSnapshotDates = new Set(driftData.map(d => d.projection_run_date?.toString())).size;

      res.json({
        targetYear: Number(targetYear),
        targetMonth: Number(targetMonth),
        totalSnapshots: uniqueSnapshotDates,
        vendorCount: vendorDrift.size,
        driftSummary: driftSummary.sort((a, b) => Math.abs(b.driftDollar) - Math.abs(a.driftDollar)),
      });
    } catch (error: any) {
      console.error("Error getting projection drift:", error);
      res.status(500).json({ error: error.message || "Failed to get projection drift" });
    }
  });

  // Health check
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // ==========================================
  // DATA BACKUP/RESTORE ENDPOINTS
  // Export and import manually-entered data that should persist across upgrades
  // ==========================================

  // Export all manually-entered data to JSON for backup
  app.get("/api/backup/export", isAuthenticated, async (req: Request, res: Response) => {
    try {
      // Tables that contain manually-entered data (not overwritten by OS imports)
      const [
        staffData,
        staffGoalsData,
        staffClientAssignmentsData,
        poTasksData,
        qualityTestsData,
        inspectionsData,
        colorPanelsData,
        colorPanelCommunicationsData,
        colorPanelIssuesData,
        colorPanelMessagesData,
        vendorCapacityAliasesData,
        vendorCapacityDataRows,
        vendorContactsData,
        usersData,
        clientsData,
        activityLogsData,
        todoDismissalsData,
        backlogCommentsData,
        communicationsData,
      ] = await Promise.all([
        db.execute(sql`SELECT * FROM staff`),
        db.execute(sql`SELECT * FROM staff_goals`),
        db.execute(sql`SELECT * FROM staff_client_assignments`),
        db.execute(sql`SELECT * FROM po_tasks`),
        db.execute(sql`SELECT * FROM quality_tests`),
        db.execute(sql`SELECT * FROM inspections`),
        db.execute(sql`SELECT * FROM color_panels`),
        db.execute(sql`SELECT * FROM color_panel_communications`),
        db.execute(sql`SELECT * FROM color_panel_issues`),
        db.execute(sql`SELECT * FROM color_panel_messages`),
        db.execute(sql`SELECT * FROM vendor_capacity_aliases`),
        db.execute(sql`SELECT * FROM vendor_capacity_data`),
        db.execute(sql`SELECT * FROM vendor_contacts`),
        db.execute(sql`SELECT * FROM users`),
        db.execute(sql`SELECT * FROM clients`),
        db.execute(sql`SELECT * FROM activity_logs`),
        db.execute(sql`SELECT * FROM todo_dismissals`),
        db.execute(sql`SELECT * FROM backlog_comments`),
        db.execute(sql`SELECT * FROM communications`),
      ]);

      const backup = {
        exportedAt: new Date().toISOString(),
        version: "1.0",
        tables: {
          staff: staffData.rows,
          staff_goals: staffGoalsData.rows,
          staff_client_assignments: staffClientAssignmentsData.rows,
          po_tasks: poTasksData.rows,
          quality_tests: qualityTestsData.rows,
          inspections: inspectionsData.rows,
          color_panels: colorPanelsData.rows,
          color_panel_communications: colorPanelCommunicationsData.rows,
          color_panel_issues: colorPanelIssuesData.rows,
          color_panel_messages: colorPanelMessagesData.rows,
          vendor_capacity_aliases: vendorCapacityAliasesData.rows,
          vendor_capacity_data: vendorCapacityDataRows.rows,
          vendor_contacts: vendorContactsData.rows,
          users: usersData.rows,
          clients: clientsData.rows,
          activity_logs: activityLogsData.rows,
          todo_dismissals: todoDismissalsData.rows,
          backlog_comments: backlogCommentsData.rows,
          communications: communicationsData.rows,
        },
        rowCounts: {
          staff: staffData.rows.length,
          staff_goals: staffGoalsData.rows.length,
          staff_client_assignments: staffClientAssignmentsData.rows.length,
          po_tasks: poTasksData.rows.length,
          quality_tests: qualityTestsData.rows.length,
          inspections: inspectionsData.rows.length,
          color_panels: colorPanelsData.rows.length,
          color_panel_communications: colorPanelCommunicationsData.rows.length,
          color_panel_issues: colorPanelIssuesData.rows.length,
          color_panel_messages: colorPanelMessagesData.rows.length,
          vendor_capacity_aliases: vendorCapacityAliasesData.rows.length,
          vendor_capacity_data: vendorCapacityDataRows.rows.length,
          vendor_contacts: vendorContactsData.rows.length,
          users: usersData.rows.length,
          clients: clientsData.rows.length,
          activity_logs: activityLogsData.rows.length,
          todo_dismissals: todoDismissalsData.rows.length,
          backlog_comments: backlogCommentsData.rows.length,
          communications: communicationsData.rows.length,
        },
      };

      // Set headers for file download
      const filename = `erp-backup-${new Date().toISOString().split('T')[0]}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(backup);
    } catch (error: any) {
      console.error("Error exporting backup:", error);
      res.status(500).json({ error: error.message || "Failed to export backup" });
    }
  });

  // Get backup summary (row counts only, no data download)
  app.get("/api/backup/summary", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const counts = await db.execute(sql`
        SELECT 
          (SELECT COUNT(*) FROM staff) as staff,
          (SELECT COUNT(*) FROM staff_goals) as staff_goals,
          (SELECT COUNT(*) FROM staff_client_assignments) as staff_client_assignments,
          (SELECT COUNT(*) FROM po_tasks) as po_tasks,
          (SELECT COUNT(*) FROM quality_tests) as quality_tests,
          (SELECT COUNT(*) FROM inspections) as inspections,
          (SELECT COUNT(*) FROM color_panels) as color_panels,
          (SELECT COUNT(*) FROM vendor_capacity_aliases) as vendor_capacity_aliases,
          (SELECT COUNT(*) FROM vendor_capacity_data) as vendor_capacity_data,
          (SELECT COUNT(*) FROM users) as users,
          (SELECT COUNT(*) FROM clients) as clients,
          (SELECT COUNT(*) FROM activity_logs) as activity_logs
      `);

      res.json({
        summary: counts.rows[0],
        totalRecords: Object.values(counts.rows[0] as Record<string, string>).reduce((sum, val) => sum + parseInt(val || '0'), 0),
      });
    } catch (error: any) {
      console.error("Error getting backup summary:", error);
      res.status(500).json({ error: error.message || "Failed to get backup summary" });
    }
  });

  // Import/restore data from backup JSON (requires admin/full access)
  app.post("/api/backup/import", isAuthenticated, requireFullAccess, upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No backup file uploaded" });
      }

      const backupData = JSON.parse(req.file.buffer.toString('utf-8'));

      if (!backupData.tables || !backupData.version) {
        return res.status(400).json({ error: "Invalid backup file format" });
      }

      const results: Record<string, { cleared: number; imported: number; errors: string[] }> = {};

      // Helper to safely restore a table with upsert logic
      const restoreTable = async (tableName: string, data: any[], clearSql: string, insertFn: (row: any) => Promise<void>) => {
        const tableResult = { cleared: 0, imported: 0, errors: [] as string[] };

        if (!data || data.length === 0) {
          results[tableName] = tableResult;
          return;
        }

        try {
          // Clear existing data
          await db.execute(sql.raw(clearSql));
          tableResult.cleared = data.length;

          // Insert new data in batches
          for (const row of data) {
            try {
              await insertFn(row);
              tableResult.imported++;
            } catch (err: any) {
              tableResult.errors.push(`Row ${row.id || 'unknown'}: ${err.message?.substring(0, 100)}`);
            }
          }
        } catch (err: any) {
          tableResult.errors.push(`Table error: ${err.message}`);
        }

        results[tableName] = tableResult;
      };

      // Restore clients first (other tables may reference)
      if (backupData.tables.clients) {
        await restoreTable('clients', backupData.tables.clients, 'DELETE FROM clients', async (row) => {
          await db.execute(sql`
            INSERT INTO clients (id, name, code, active, created_at)
            VALUES (${row.id}, ${row.name}, ${row.code}, ${row.active}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code, active = EXCLUDED.active
          `);
        });
      }

      // Restore users
      if (backupData.tables.users) {
        await restoreTable('users', backupData.tables.users, 'DELETE FROM users WHERE id > 0', async (row) => {
          await db.execute(sql`
            INSERT INTO users (id, name, email, role, replit_id, profile_image, created_at)
            VALUES (${row.id}, ${row.name}, ${row.email}, ${row.role}, ${row.replit_id}, ${row.profile_image}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role
          `);
        });
      }

      // Restore staff
      if (backupData.tables.staff) {
        await restoreTable('staff', backupData.tables.staff, 'DELETE FROM staff', async (row) => {
          await db.execute(sql`
            INSERT INTO staff (id, name, email, role, client_id, active, user_id, created_at)
            VALUES (${row.id}, ${row.name}, ${row.email}, ${row.role}, ${row.client_id}, ${row.active}, ${row.user_id}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role, 
              client_id = EXCLUDED.client_id, active = EXCLUDED.active, user_id = EXCLUDED.user_id
          `);
        });
      }

      // Restore staff_goals
      if (backupData.tables.staff_goals) {
        await restoreTable('staff_goals', backupData.tables.staff_goals, 'DELETE FROM staff_goals', async (row) => {
          await db.execute(sql`
            INSERT INTO staff_goals (id, staff_id, goal_type, target_value, current_value, start_date, end_date, notes, created_at)
            VALUES (${row.id}, ${row.staff_id}, ${row.goal_type}, ${row.target_value}, ${row.current_value}, ${row.start_date}, ${row.end_date}, ${row.notes}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET staff_id = EXCLUDED.staff_id, goal_type = EXCLUDED.goal_type, 
              target_value = EXCLUDED.target_value, current_value = EXCLUDED.current_value
          `);
        });
      }

      // Restore staff_client_assignments
      if (backupData.tables.staff_client_assignments) {
        await restoreTable('staff_client_assignments', backupData.tables.staff_client_assignments, 'DELETE FROM staff_client_assignments', async (row) => {
          await db.execute(sql`
            INSERT INTO staff_client_assignments (id, staff_id, client_id, assigned_at)
            VALUES (${row.id}, ${row.staff_id}, ${row.client_id}, ${row.assigned_at})
            ON CONFLICT (id) DO NOTHING
          `);
        });
      }

      // Restore po_tasks
      if (backupData.tables.po_tasks) {
        await restoreTable('po_tasks', backupData.tables.po_tasks, 'DELETE FROM po_tasks', async (row) => {
          await db.execute(sql`
            INSERT INTO po_tasks (id, po_number, task_type, title, description, due_date, priority, status, assigned_to, created_by, created_at, updated_at, completed_at)
            VALUES (${row.id}, ${row.po_number}, ${row.task_type}, ${row.title}, ${row.description}, ${row.due_date}, ${row.priority}, ${row.status}, ${row.assigned_to}, ${row.created_by}, ${row.created_at}, ${row.updated_at}, ${row.completed_at})
            ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at, title = EXCLUDED.title, description = EXCLUDED.description
          `);
        });
      }

      // Restore quality_tests
      if (backupData.tables.quality_tests) {
        await restoreTable('quality_tests', backupData.tables.quality_tests, 'DELETE FROM quality_tests', async (row) => {
          await db.execute(sql`
            INSERT INTO quality_tests (id, po_header_id, sku_id, test_type, test_date, result, notes, inspector, created_at)
            VALUES (${row.id}, ${row.po_header_id}, ${row.sku_id}, ${row.test_type}, ${row.test_date}, ${row.result}, ${row.notes}, ${row.inspector}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET result = EXCLUDED.result, notes = EXCLUDED.notes
          `);
        });
      }

      // Restore inspections
      if (backupData.tables.inspections) {
        await restoreTable('inspections', backupData.tables.inspections, 'DELETE FROM inspections', async (row) => {
          await db.execute(sql`
            INSERT INTO inspections (id, po_header_id, sku_id, inspection_type, inspection_date, status, result, notes, inspector, created_at)
            VALUES (${row.id}, ${row.po_header_id}, ${row.sku_id}, ${row.inspection_type}, ${row.inspection_date}, ${row.status}, ${row.result}, ${row.notes}, ${row.inspector}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result, notes = EXCLUDED.notes
          `);
        });
      }

      // Restore color_panels
      if (backupData.tables.color_panels) {
        await restoreTable('color_panels', backupData.tables.color_panels, 'DELETE FROM color_panels', async (row) => {
          await db.execute(sql`
            INSERT INTO color_panels (id, sku_id, vendor_id, color_name, color_code, status, approval_date, notes, created_at, updated_at)
            VALUES (${row.id}, ${row.sku_id}, ${row.vendor_id}, ${row.color_name}, ${row.color_code}, ${row.status}, ${row.approval_date}, ${row.notes}, ${row.created_at}, ${row.updated_at})
            ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, approval_date = EXCLUDED.approval_date
          `);
        });
      }

      // Restore vendor_capacity_aliases
      if (backupData.tables.vendor_capacity_aliases) {
        await restoreTable('vendor_capacity_aliases', backupData.tables.vendor_capacity_aliases, 'DELETE FROM vendor_capacity_aliases', async (row) => {
          await db.execute(sql`
            INSERT INTO vendor_capacity_aliases (id, vendor_id, alias_name, created_at)
            VALUES (${row.id}, ${row.vendor_id}, ${row.alias_name}, ${row.created_at})
            ON CONFLICT (id) DO NOTHING
          `);
        });
      }

      // Restore vendor_capacity_data
      if (backupData.tables.vendor_capacity_data) {
        await restoreTable('vendor_capacity_data', backupData.tables.vendor_capacity_data, 'DELETE FROM vendor_capacity_data', async (row) => {
          await db.execute(sql`
            INSERT INTO vendor_capacity_data (id, vendor_id, year, month, capacity_value, actual_value, notes, source, created_at, updated_at)
            VALUES (${row.id}, ${row.vendor_id}, ${row.year}, ${row.month}, ${row.capacity_value}, ${row.actual_value}, ${row.notes}, ${row.source}, ${row.created_at}, ${row.updated_at})
            ON CONFLICT (id) DO UPDATE SET capacity_value = EXCLUDED.capacity_value, actual_value = EXCLUDED.actual_value, notes = EXCLUDED.notes
          `);
        });
      }

      // Restore vendor_contacts
      if (backupData.tables.vendor_contacts) {
        await restoreTable('vendor_contacts', backupData.tables.vendor_contacts, 'DELETE FROM vendor_contacts', async (row) => {
          await db.execute(sql`
            INSERT INTO vendor_contacts (id, vendor_id, name, email, phone, role, is_primary, notes, created_at)
            VALUES (${row.id}, ${row.vendor_id}, ${row.name}, ${row.email}, ${row.phone}, ${row.role}, ${row.is_primary}, ${row.notes}, ${row.created_at})
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone
          `);
        });
      }

      // Restore activity_logs
      if (backupData.tables.activity_logs) {
        await restoreTable('activity_logs', backupData.tables.activity_logs, 'DELETE FROM activity_logs', async (row) => {
          await db.execute(sql`
            INSERT INTO activity_logs (id, user_id, action, entity_type, entity_id, details, created_at)
            VALUES (${row.id}, ${row.user_id}, ${row.action}, ${row.entity_type}, ${row.entity_id}, ${row.details}, ${row.created_at})
            ON CONFLICT (id) DO NOTHING
          `);
        });
      }

      // Restore todo_dismissals
      if (backupData.tables.todo_dismissals) {
        await restoreTable('todo_dismissals', backupData.tables.todo_dismissals, 'DELETE FROM todo_dismissals', async (row) => {
          await db.execute(sql`
            INSERT INTO todo_dismissals (id, user_id, todo_type, todo_id, dismissed_at)
            VALUES (${row.id}, ${row.user_id}, ${row.todo_type}, ${row.todo_id}, ${row.dismissed_at})
            ON CONFLICT (id) DO NOTHING
          `);
        });
      }

      // Restore backlog_comments
      if (backupData.tables.backlog_comments) {
        await restoreTable('backlog_comments', backupData.tables.backlog_comments, 'DELETE FROM backlog_comments', async (row) => {
          await db.execute(sql`
            INSERT INTO backlog_comments (id, po_number, user_id, comment, created_at)
            VALUES (${row.id}, ${row.po_number}, ${row.user_id}, ${row.comment}, ${row.created_at})
            ON CONFLICT (id) DO NOTHING
          `);
        });
      }

      // Restore communications
      if (backupData.tables.communications) {
        await restoreTable('communications', backupData.tables.communications, 'DELETE FROM communications', async (row) => {
          await db.execute(sql`
            INSERT INTO communications (id, po_number, vendor_id, subject, message, sent_at, sent_by, created_at)
            VALUES (${row.id}, ${row.po_number}, ${row.vendor_id}, ${row.subject}, ${row.message}, ${row.sent_at}, ${row.sent_by}, ${row.created_at})
            ON CONFLICT (id) DO NOTHING
          `);
        });
      }

      // Calculate totals
      const totalImported = Object.values(results).reduce((sum, r) => sum + r.imported, 0);
      const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors.length, 0);

      console.log(`Backup restore complete: ${totalImported} records imported, ${totalErrors} errors`);

      res.json({
        success: true,
        message: `Restored ${totalImported} records across ${Object.keys(results).filter(k => results[k].imported > 0).length} tables`,
        backupDate: backupData.exportedAt,
        results,
        totalImported,
        totalErrors,
      });
    } catch (error: any) {
      console.error("Error importing backup:", error);
      res.status(500).json({ error: error.message || "Failed to import backup" });
    }
  });
}
