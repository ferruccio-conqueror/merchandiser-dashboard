import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, bigint, timestamp, boolean, unique, jsonb, index, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Role-based access control constants
export const FULL_ACCESS_ROLES = ['admin', 'general_merchandising_manager'] as const;
export const LIMITED_ACCESS_ROLES = ['merchandising_manager', 'senior_merchandiser', 'merchandiser'] as const;
export const ALL_ROLES = [...FULL_ACCESS_ROLES, ...LIMITED_ACCESS_ROLES] as const;

// Modules accessible by limited roles (filtered by their name)
export const LIMITED_ACCESS_MODULES = [
  'to-do-list',
  'dashboard', 
  'quality-compliance',
  'purchase-orders',
  'skus',
  'color-panels',
  'vendors',
  'import'
] as const;

// Sessions table for authentication (connect-pg-simple compatible)
export const sessions = pgTable("sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
}, (table) => [index("IDX_session_expire").on(table.expire)]);

// Users table for authentication (legacy - keeping for compatibility)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSignedIn: timestamp("last_signed_in").notNull().defaultNow(),
});

// DEPRECATED: Purchase Orders - Legacy flat table
// All new data now goes to po_headers + po_line_items (normalized structure)
// This table is kept for historical FK references only - DO NOT WRITE NEW DATA HERE
export const purchaseOrders = pgTable("purchase_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poNumber: varchar("po_number", { length: 64 }).notNull(),
  copNumber: varchar("cop_number", { length: 64 }),
  client: varchar("client", { length: 255 }),
  clientDivision: varchar("client_division", { length: 255 }),
  clientDepartment: varchar("client_department", { length: 255 }),
  buyer: varchar("buyer", { length: 255 }),
  vendor: varchar("vendor", { length: 255 }),
  factory: varchar("factory", { length: 255 }),
  productGroup: varchar("product_group", { length: 255 }),
  productCategory: varchar("product_category", { length: 255 }),
  season: varchar("season", { length: 64 }),
  sku: varchar("sku", { length: 64 }),
  style: varchar("style", { length: 64 }),
  sellerStyle: varchar("seller_style", { length: 255 }),
  newSku: varchar("new_sku", { length: 64 }),
  newStyle: varchar("new_style", { length: 1 }),
  bigBets: varchar("big_bets", { length: 10 }),
  cbxItem: varchar("cbx_item", { length: 10 }),
  orderClassification: varchar("order_classification", { length: 255 }),
  programDescription: text("program_description"),
  program: varchar("program", { length: 20 }),
  merchandiseProgram: varchar("merchandise_program", { length: 255 }),
  office: varchar("office", { length: 64 }),
  mrSection: varchar("mr_section", { length: 255 }),
  poDate: timestamp("po_date"),
  month: varchar("month", { length: 20 }),
  originalShipDate: timestamp("original_ship_date"),
  originalCancelDate: timestamp("original_cancel_date"),
  revisedShipDate: timestamp("revised_ship_date"),
  revisedCancelDate: timestamp("revised_cancel_date"),
  revisedBy: varchar("revised_by", { length: 255 }),
  revisedReason: text("revised_reason"),
  orderQuantity: integer("order_quantity").notNull().default(0),
  balanceQuantity: integer("balance_quantity").default(0),
  unitPrice: integer("unit_price").default(0),
  totalValue: integer("total_value").default(0),
  scheduleShipMode: varchar("schedule_ship_mode", { length: 64 }),
  schedulePoe: varchar("schedule_poe", { length: 255 }),
  status: varchar("status", { length: 64 }).notNull().default("Booked-to-ship"),
  shipmentStatus: varchar("shipment_status", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdBy: varchar("created_by"),
  updatedBy: varchar("updated_by"),
});

// PO Headers - One row per PO with header-level information (from OS340)
// SKU-level details are in po_line_items table (one-to-many relationship)
export const poHeaders = pgTable("po_headers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poNumber: varchar("po_number", { length: 64 }).notNull().unique(),
  copNumber: varchar("cop_number", { length: 64 }),
  client: varchar("client", { length: 255 }),
  clientDivision: varchar("client_division", { length: 255 }),
  clientDepartment: varchar("client_department", { length: 255 }),
  buyer: varchar("buyer", { length: 255 }),
  vendor: varchar("vendor", { length: 255 }),
  vendorId: integer("vendor_id").references(() => vendors.id), // FK to canonical vendor (nullable for migration)
  factory: varchar("factory", { length: 255 }),
  productGroup: varchar("product_group", { length: 255 }),
  productCategory: varchar("product_category", { length: 255 }),
  season: varchar("season", { length: 64 }),
  orderClassification: varchar("order_classification", { length: 255 }),
  programDescription: text("program_description"),
  program: varchar("program", { length: 20 }),
  merchandiseProgram: varchar("merchandise_program", { length: 255 }),
  office: varchar("office", { length: 64 }),
  mrSection: varchar("mr_section", { length: 255 }),
  poDate: timestamp("po_date"),
  month: varchar("month", { length: 20 }),
  originalShipDate: timestamp("original_ship_date"),
  originalCancelDate: timestamp("original_cancel_date"),
  revisedShipDate: timestamp("revised_ship_date"),
  revisedCancelDate: timestamp("revised_cancel_date"),
  revisedBy: varchar("revised_by", { length: 255 }),
  revisedReason: text("revised_reason"),
  // Aggregated values from all line items
  totalQuantity: integer("total_quantity").notNull().default(0),
  balanceQuantity: integer("balance_quantity").default(0),
  totalValue: integer("total_value").default(0), // Sum of all line totals in cents
  shippedValue: integer("shipped_value").default(0), // "Shipped (USD)" from OS340 in cents - actual shipped value for YTD calculations
  scheduleShipMode: varchar("schedule_ship_mode", { length: 64 }),
  schedulePoe: varchar("schedule_poe", { length: 255 }),
  status: varchar("status", { length: 64 }).notNull().default("Booked-to-ship"),
  shipmentStatus: varchar("shipment_status", { length: 64 }),
  contentHash: varchar("content_hash", { length: 64 }), // MD5 hash of key fields for delta import detection
  confirmationDate: timestamp("confirmation_date"), // Date when status changed from EDI/Initial to Booked-to-ship
  // PTS (Pre-Shipment) data from OS650 - stored at PO level for easy access
  ptsNumber: varchar("pts_number", { length: 64 }), // Pre-Shipment Tracking Number
  ptsDate: timestamp("pts_date"), // SO First Submission Date
  ptsStatus: varchar("pts_status", { length: 255 }), // PTS Status by Freight Forwarder
  logisticStatus: varchar("logistic_status", { length: 255 }), // Logistic Status from OS650
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// PO Line Items - SKU-level detail for each PO (from OS340)
export const poLineItems = pgTable("po_line_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poHeaderId: integer("po_header_id").notNull().references(() => poHeaders.id, { onDelete: "cascade" }),
  poNumber: varchar("po_number", { length: 64 }).notNull(), // Denormalized for easy querying
  lineSequence: integer("line_sequence").notNull().default(1),
  sku: varchar("sku", { length: 64 }),
  style: varchar("style", { length: 64 }),
  sellerStyle: varchar("seller_style", { length: 255 }), // Product description from OS340
  newSku: varchar("new_sku", { length: 64 }),
  newStyle: varchar("new_style", { length: 1 }),
  bigBets: varchar("big_bets", { length: 10 }),
  cbxItem: varchar("cbx_item", { length: 10 }),
  orderQuantity: integer("order_quantity").notNull().default(0),
  balanceQuantity: integer("balance_quantity").default(0),
  unitPrice: integer("unit_price").default(0), // FOB unit price in cents
  lineTotal: integer("line_total").default(0), // qty * unit_price in cents
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Access level constants for role-based access control
export const ACCESS_LEVELS = ['full_access', 'level_1', 'level_2'] as const;
export type AccessLevel = typeof ACCESS_LEVELS[number];

// Staff table for merchandisers and merchandising managers (also used for authentication)
export const staff = pgTable("staff", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  role: varchar("role", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  office: varchar("office", { length: 100 }),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  // Access level: full_access (all areas), level_1 (team records), level_2 (own records only)
  accessLevel: varchar("access_level", { length: 50 }).notNull().default("level_2"),
  // Authentication fields
  passwordHash: varchar("password_hash", { length: 255 }),
  passwordSetAt: timestamp("password_set_at"),
  lastLoginAt: timestamp("last_login_at"),
  resetToken: varchar("reset_token", { length: 255 }),
  resetTokenExpires: timestamp("reset_token_expires"),
  // HR fields
  hireDate: timestamp("hire_date"),
  department: varchar("department", { length: 100 }),
  title: varchar("title", { length: 150 }),
  employmentType: varchar("employment_type", { length: 50 }),
  managerId: integer("manager_id"),
  // Metadata
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Clients table - Companies we do business with (Euromarket Designs Inc., Jonathan Adler, etc.)
export const clients = pgTable("clients", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  code: varchar("code", { length: 50 }), // Short code like "CB", "JA", "MAF"
  region: varchar("region", { length: 100 }),
  country: varchar("country", { length: 100 }),
  contactPerson: varchar("contact_person", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Staff-to-Client assignments - Merchandisers assigned to specific clients
export const staffClientAssignments = pgTable("staff_client_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  staffId: integer("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 100 }), // "merchandiser", "manager", "backup"
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueAssignment: unique().on(table.staffId, table.clientId),
}));

// Vendor-to-Client assignments - Vendors working with specific clients
export const vendorClientAssignments = pgTable("vendor_client_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueAssignment: unique().on(table.vendorId, table.clientId),
}));

// Vendors table
export const vendors = pgTable("vendors", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  cbhVendorCode: varchar("cbh_vendor_code", { length: 50 }),  // CBH vendor code for matching imports
  contactPerson: varchar("contact_person", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  country: varchar("country", { length: 100 }),
  region: varchar("region", { length: 100 }),
  merchandiser: varchar("merchandiser", { length: 255 }),
  merchandisingManager: varchar("merchandising_manager", { length: 255 }),
  merchandiserId: integer("merchandiser_id").references(() => staff.id),
  merchandisingManagerId: integer("merchandising_manager_id").references(() => staff.id),
  status: varchar("status", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// SKUs/Products table
export const skus = pgTable("skus", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sku: varchar("sku", { length: 64 }).notNull().unique(),
  style: varchar("style", { length: 64 }),
  description: text("description"),
  category: varchar("category", { length: 255 }),
  productGroup: varchar("product_group", { length: 255 }),
  season: varchar("season", { length: 64 }),
  isNew: boolean("is_new").default(false),
  unitPrice: integer("unit_price").default(0),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  discontinuedAt: timestamp("discontinued_at"),
  discontinuedReason: varchar("discontinued_reason", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Timeline/Milestones table
export const timelines = pgTable("timelines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poId: integer("po_id").notNull().references(() => purchaseOrders.id), // DEPRECATED: Use poHeaderId
  poHeaderId: integer("po_header_id").references(() => poHeaders.id), // FK to normalized po_headers
  poNumber: varchar("po_number", { length: 64 }).notNull(),
  milestone: varchar("milestone", { length: 100 }).notNull(), // e.g., "Lab Dips", "Strikes", "Pre-Production"
  plannedDate: timestamp("planned_date"),
  actualDate: timestamp("actual_date"),
  status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, on-track, delayed, completed
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Shipments table for tracking deliveries
export const shipments = pgTable("shipments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poId: integer("po_id"), // DEPRECATED: Now linking via po_number instead of FK to purchaseOrders
  poHeaderId: integer("po_header_id").references(() => poHeaders.id), // FK to normalized po_headers
  poNumber: varchar("po_number", { length: 64 }).notNull(),
  lineItemId: varchar("line_item_id", { length: 64 }), // OS 650: Line Item Id - SKU-level tracking
  style: varchar("style", { length: 64 }), // OS 650: Style
  shipmentNumber: integer("shipment_number").notNull().default(1),
  deliveryToConsolidator: timestamp("delivery_to_consolidator"),
  qtyShipped: integer("qty_shipped").default(0),
  shippedValue: integer("shipped_value").default(0),
  actualPortOfLoading: varchar("actual_port_of_loading", { length: 255 }),
  actualSailingDate: timestamp("actual_sailing_date"),
  eta: timestamp("eta"),
  actualShipMode: varchar("actual_ship_mode", { length: 64 }),
  poe: varchar("poe", { length: 255 }),
  vesselFlight: varchar("vessel_flight", { length: 255 }),
  // OS 650 specific fields
  cargoReadyDate: timestamp("cargo_ready_date"), // OS 650: Cargo Ready Date
  loadType: varchar("load_type", { length: 64 }), // OS 650: Load Type (CY FCL, CFS LCL)
  ptsNumber: varchar("pts_number", { length: 64 }), // OS 650: PTS Number
  logisticStatus: varchar("logistic_status", { length: 64 }), // OS 650: Logistic Status
  lateReasonCode: varchar("late_reason_code", { length: 255 }), // OS 650: GTN Late Reason Code
  reason: varchar("reason", { length: 255 }), // OS 650: Reason (based on Original HOD)
  hodStatus: varchar("hod_status", { length: 64 }), // OS 650: HOD Status (based on Latest HOD)
  soFirstSubmissionDate: timestamp("so_first_submission_date"), // OS 650: SO First Submission Date
  ptsStatus: varchar("pts_status", { length: 64 }), // OS 650: PTS Status by Freight Forwarder
  cargoReceiptStatus: varchar("cargo_receipt_status", { length: 64 }), // OS 650: Cargo Receipt Status (CFS only)
  estimatedVesselEtd: timestamp("estimated_vessel_etd"), // OS 650: Estimated Vessel ETD (column AD) - separate from actual_sailing_date
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Quality Inspections - SKU level inspection tracking
export const inspections = pgTable("inspections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poId: integer("po_id").references(() => purchaseOrders.id), // DEPRECATED: Use poHeaderId
  poHeaderId: integer("po_header_id").references(() => poHeaders.id), // FK to normalized po_headers
  skuId: integer("sku_id").references(() => skus.id),
  vendorId: integer("vendor_id").references(() => vendors.id), // For vendor-level analytics
  poNumber: varchar("po_number", { length: 64 }).notNull(),
  style: varchar("style", { length: 64 }),
  sku: varchar("sku", { length: 64 }),
  vendorName: varchar("vendor_name", { length: 255 }), // Denormalized for quick filtering
  inspectionType: varchar("inspection_type", { length: 100 }).notNull(), // Material, Initial, Inline, Final, Re-Final
  inspectionDate: timestamp("inspection_date"),
  result: varchar("result", { length: 50 }), // Passed, Failed, Pending, etc.
  inspector: varchar("inspector", { length: 255 }), // Inspector name for filtering
  inspectionCompany: varchar("inspection_company", { length: 255 }), // Third-party inspection company
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Compliance Styles - OS630 source data stored separately for accurate reporting
// Links to PO data via po_number but keeps original source status
export const complianceStyles = pgTable("compliance_styles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  style: varchar("style", { length: 64 }).notNull(),
  poNumber: varchar("po_number", { length: 64 }), // Links to po_headers/purchase_orders
  poHeaderId: integer("po_header_id").references(() => poHeaders.id), // FK to normalized po_headers
  vendorId: integer("vendor_id").references(() => vendors.id), // FK to canonical vendor
  sourceStatus: varchar("source_status", { length: 64 }), // Original status from Excel (Booked-to-ship, Closed, etc.)
  clientDivision: varchar("client_division", { length: 255 }),
  clientDepartment: varchar("client_department", { length: 255 }),
  vendorName: varchar("vendor_name", { length: 255 }),
  mandatoryStatus: varchar("mandatory_status", { length: 50 }), // Valid, Expired, Outstanding, etc.
  mandatoryExpiryDate: timestamp("mandatory_expiry_date"),
  mandatoryReportNumber: varchar("mandatory_report_number", { length: 100 }),
  performanceStatus: varchar("performance_status", { length: 50 }), // Valid, Expired, Outstanding, etc.
  performanceExpiryDate: timestamp("performance_expiry_date"),
  performanceReportNumber: varchar("performance_report_number", { length: 100 }),
  transitStatus: varchar("transit_status", { length: 50 }),
  transitExpiryDate: timestamp("transit_expiry_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Quality Tests - SKU level lab test and certification tracking
export const qualityTests = pgTable("quality_tests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poId: integer("po_id").references(() => purchaseOrders.id), // DEPRECATED: Use poHeaderId
  poHeaderId: integer("po_header_id").references(() => poHeaders.id), // FK to normalized po_headers
  skuId: integer("sku_id").references(() => skus.id),
  poNumber: varchar("po_number", { length: 64 }).notNull(),
  style: varchar("style", { length: 64 }),
  sku: varchar("sku", { length: 64 }),
  testType: varchar("test_type", { length: 100 }).notNull(), // Mandatory, Performance, Transit, Retest
  reportDate: timestamp("report_date"),
  reportNumber: varchar("report_number", { length: 100 }),
  result: varchar("result", { length: 50 }), // Passed, Failed, Conditional
  expiryDate: timestamp("expiry_date"),
  status: varchar("status", { length: 50 }), // Valid, Expired, Expiring Soon
  correctiveActionPlan: text("corrective_action_plan"),
  reportLink: text("report_link"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Brand Assignments - Map brand codes to merchandisers and managers
export const brandAssignments = pgTable("brand_assignments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  brandCode: varchar("brand_code", { length: 64 }).notNull().unique(),
  brandName: varchar("brand_name", { length: 255 }),
  merchandiserId: integer("merchandiser_id").references(() => staff.id),
  merchandisingManagerId: integer("merchandising_manager_id").references(() => staff.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Vendor Contacts - Multiple contact persons per vendor
export const vendorContacts = pgTable("vendor_contacts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 320 }),
  role: varchar("role", { length: 100 }), // e.g., "Production Manager", "QA Contact"
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Master Color Panels - Track approved color/finish standards
export const colorPanels = pgTable("color_panels", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").references(() => vendors.id),
  merchandiserId: integer("merchandiser_id").references(() => staff.id),
  brand: varchar("brand", { length: 64 }), // JOLIE, HARLEY, MILEY, etc. (merchandiser code)
  vendorName: varchar("vendor_name", { length: 255 }), // Vendor short name from PDF
  collection: varchar("collection", { length: 255 }),
  skuDescription: text("sku_description"),
  material: text("material"),
  finishName: varchar("finish_name", { length: 255 }),
  sheenLevel: varchar("sheen_level", { length: 50 }),
  finishSystem: varchar("finish_system", { length: 50 }), // NC, WB, PU
  paintSupplier: varchar("paint_supplier", { length: 255 }),
  validityMonths: integer("validity_months").default(12), // 6 or 12 months
  currentMcpNumber: varchar("current_mcp_number", { length: 64 }), // Current active MCP#
  currentApprovalDate: timestamp("current_approval_date"),
  currentExpirationDate: timestamp("current_expiration_date"),
  status: varchar("status", { length: 50 }).notNull().default("active"), // active, expiring, expired
  notes: text("notes"),
  lastReminderSent: timestamp("last_reminder_sent"),
  reminderCount: integer("reminder_count").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Color Panel History - Track all versions/renewals over time
export const colorPanelHistory = pgTable("color_panel_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  colorPanelId: integer("color_panel_id").notNull().references(() => colorPanels.id),
  mcpNumber: varchar("mcp_number", { length: 64 }).notNull(),
  approvalDate: timestamp("approval_date"),
  expirationDate: timestamp("expiration_date"),
  versionNumber: integer("version_number").notNull(), // 1, 2, 3, 4, 5
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// SKU-Color Panel Junction Table - Many-to-many relationship
export const skuColorPanels = pgTable("sku_color_panels", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  skuId: integer("sku_id").notNull().references(() => skus.id),
  colorPanelId: integer("color_panel_id").notNull().references(() => colorPanels.id),
  linkedDate: timestamp("linked_date").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true), // Track current vs historical
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Color Panel Renewal Workflows - Track renewal state and automation status
export const colorPanelWorkflows = pgTable("color_panel_workflows", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  colorPanelId: integer("color_panel_id").notNull().references(() => colorPanels.id).unique(),
  status: varchar("status", { length: 50 }).notNull().default("idle"), // idle, reminder_pending, reminder_sent, awaiting_response, follow_up_required, escalated, renewed, closed
  responsibleUserId: varchar("responsible_user_id").references(() => users.id),
  responsibleUserName: varchar("responsible_user_name", { length: 255 }),
  nextActionDue: timestamp("next_action_due"),
  lastActionDate: timestamp("last_action_date"),
  aiStatus: varchar("ai_status", { length: 50 }), // drafting, sent, waiting, escalated
  remindersSent: integer("reminders_sent").notNull().default(0),
  lastReminderDate: timestamp("last_reminder_date"),
  supplierContactEmail: varchar("supplier_contact_email", { length: 320 }),
  escalationReason: text("escalation_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Color Panel Communications - Email thread headers with suppliers
export const colorPanelCommunications = pgTable("color_panel_communications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  colorPanelId: integer("color_panel_id").notNull().references(() => colorPanels.id),
  workflowId: integer("workflow_id").references(() => colorPanelWorkflows.id),
  threadSubject: varchar("thread_subject", { length: 500 }).notNull(),
  supplierEmail: varchar("supplier_email", { length: 320 }),
  supplierName: varchar("supplier_name", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("open"), // open, awaiting_reply, responded, closed
  messageCount: integer("message_count").notNull().default(0),
  lastMessageDate: timestamp("last_message_date"),
  lastMessageDirection: varchar("last_message_direction", { length: 20 }), // outbound, inbound
  aiSummary: text("ai_summary"), // AI-generated summary of the thread
  requiresHumanAction: boolean("requires_human_action").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Color Panel Messages - Individual email messages in a thread
export const colorPanelMessages = pgTable("color_panel_messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  communicationId: integer("communication_id").notNull().references(() => colorPanelCommunications.id),
  colorPanelId: integer("color_panel_id").notNull().references(() => colorPanels.id),
  direction: varchar("direction", { length: 20 }).notNull(), // outbound, inbound
  senderEmail: varchar("sender_email", { length: 320 }),
  senderName: varchar("sender_name", { length: 255 }),
  recipientEmail: varchar("recipient_email", { length: 320 }),
  subject: varchar("subject", { length: 500 }),
  body: text("body"),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  aiConfidence: integer("ai_confidence"), // 0-100 confidence score
  requiresHumanReview: boolean("requires_human_review").notNull().default(false),
  humanApproved: boolean("human_approved"),
  humanApprovedBy: varchar("human_approved_by", { length: 255 }),
  humanApprovedAt: timestamp("human_approved_at"),
  sentAt: timestamp("sent_at"),
  receivedAt: timestamp("received_at"),
  mcpReference: varchar("mcp_reference", { length: 64 }), // MCP# included in email
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Color Panel AI Events - Track all AI actions and decisions
export const colorPanelAiEvents = pgTable("color_panel_ai_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  colorPanelId: integer("color_panel_id").notNull().references(() => colorPanels.id),
  workflowId: integer("workflow_id").references(() => colorPanelWorkflows.id),
  eventType: varchar("event_type", { length: 50 }).notNull(), // scan, draft_email, send_email, analyze_response, escalate, summarize
  eventDescription: text("event_description"),
  inputContext: text("input_context"), // JSON context provided to AI
  aiOutput: text("ai_output"), // JSON AI response
  confidence: integer("confidence"), // 0-100
  actionTaken: varchar("action_taken", { length: 100 }),
  requiresFollowUp: boolean("requires_follow_up").notNull().default(false),
  followUpDate: timestamp("follow_up_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Color Panel Issues - Track problems and risks for panels
export const colorPanelIssues = pgTable("color_panel_issues", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  colorPanelId: integer("color_panel_id").notNull().references(() => colorPanels.id),
  issueType: varchar("issue_type", { length: 50 }).notNull(), // no_response, expired, renewal_delayed, supplier_issue, quality_concern
  severity: varchar("severity", { length: 20 }).notNull().default("medium"), // low, medium, high, critical
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 50 }).notNull().default("open"), // open, in_progress, resolved, closed
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  assignedToUserName: varchar("assigned_to_user_name", { length: 255 }),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by", { length: 255 }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// MCP Workflow status constants
export const MCP_WORKFLOW_STATUSES = [
  'idle',
  'reminder_pending', 
  'reminder_sent',
  'awaiting_response',
  'follow_up_required',
  'escalated',
  'renewed',
  'closed'
] as const;
export type McpWorkflowStatus = typeof MCP_WORKFLOW_STATUSES[number];

// MCP Issue types
export const MCP_ISSUE_TYPES = [
  'no_response',
  'expired',
  'renewal_delayed',
  'supplier_issue',
  'quality_concern'
] as const;
export type McpIssueType = typeof MCP_ISSUE_TYPES[number];

// Import history for tracking uploaded files
export const importHistory = pgTable("import_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 50 }).notNull(),
  recordsImported: integer("records_imported").default(0),
  importedBy: varchar("imported_by"),
  status: varchar("status", { length: 50 }).notNull().default("success"),
  errorMessage: text("error_message"),
  // Pre-import validation counts
  preImportPoHeaders: integer("pre_import_po_headers"),
  preImportPoLineItems: integer("pre_import_po_line_items"),
  preImportShipments: integer("pre_import_shipments"),
  preImportInspections: integer("pre_import_inspections"),
  preImportProjections: integer("pre_import_projections"),
  // Expected counts from file
  fileRowCount: integer("file_row_count"),
  expectedPoHeaders: integer("expected_po_headers"),
  expectedPoLineItems: integer("expected_po_line_items"),
  expectedShipments: integer("expected_shipments"),
  // Post-import verification counts
  postImportPoHeaders: integer("post_import_po_headers"),
  postImportPoLineItems: integer("post_import_po_line_items"),
  postImportShipments: integer("post_import_shipments"),
  postImportInspections: integer("post_import_inspections"),
  postImportProjections: integer("post_import_projections"),
  // Verification status
  verificationStatus: varchar("verification_status", { length: 20 }), // 'passed', 'failed', 'warning'
  verificationDetails: text("verification_details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Activity Logs - For merchandiser notes and actions on POs and SKUs
export const activityLogs = pgTable("activity_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  entityType: varchar("entity_type", { length: 20 }).notNull(), // 'po' or 'sku'
  entityId: varchar("entity_id", { length: 64 }).notNull(), // PO number or SKU code
  logType: varchar("log_type", { length: 20 }).notNull(), // 'action' or 'update'
  description: text("description").notNull(),
  dueDate: timestamp("due_date"), // Only for actions
  completionDate: timestamp("completion_date"), // When action was completed
  isCompleted: boolean("is_completed").notNull().default(false),
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// To-Do Dismissals - Track items dismissed from To-Do list by users
// userId can be a staff ID or session ID for anonymous users (no FK constraint to support session IDs)
export const todoDismissals = pgTable("todo_dismissals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  itemType: varchar("item_type", { length: 50 }).notNull(), // 'deadline', 'milestone', 'cert', 'mcp', 'projection', 'action', 'missing-cop'
  itemId: varchar("item_id", { length: 255 }).notNull(), // Unique identifier for the item (PO number, cert id, mcp id, etc.)
  dismissedAt: timestamp("dismissed_at").notNull().defaultNow(),
});

// PO Tasks - Comprehensive task tracking for PO-specific follow-ups
export const poTasks = pgTable("po_tasks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poNumber: varchar("po_number", { length: 64 }).notNull(),
  poId: integer("po_id"), // DEPRECATED: Now linking via poHeaderId instead
  poHeaderId: integer("po_header_id").references(() => poHeaders.id), // New: references normalized po_headers
  taskSource: varchar("task_source", { length: 50 }).notNull(), // 'compliance', 'inspection', 'shipment', 'manual'
  taskType: varchar("task_type", { length: 100 }).notNull(), // e.g., 'book_inspection', 'follow_up_compliance', 'book_shipment', 'custom'
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  priority: varchar("priority", { length: 20 }).default("normal"), // 'low', 'normal', 'high', 'urgent'
  // Related entity references for auto-generated tasks
  relatedEntityType: varchar("related_entity_type", { length: 50 }), // 'inspection', 'shipment', 'quality_test', 'activity_log'
  relatedEntityId: integer("related_entity_id"),
  // Completion tracking
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by", { length: 255 }),
  // Metadata
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Task source constants
export const TASK_SOURCES = ['compliance', 'inspection', 'shipment', 'manual'] as const;
export type TaskSource = typeof TASK_SOURCES[number];

// Task type constants
export const TASK_TYPES = {
  compliance: ['follow_up_test_report', 'renew_certificate', 'submit_documentation'],
  inspection: ['book_inline', 'book_final', 'follow_up_failed', 'reschedule'],
  shipment: ['book_shipment', 'confirm_booking', 'follow_up_pts', 'track_vessel'],
  manual: ['custom'],
} as const;

// Vendor Timeline Templates - Default timeline configurations by vendor and product category
export const vendorTimelineTemplates = pgTable("vendor_timeline_templates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  name: varchar("name", { length: 255 }).notNull(), // e.g., "Standard Furniture", "Rush Order"
  productCategory: varchar("product_category", { length: 255 }), // e.g., "Furniture", "Textiles"
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false), // Default template for this vendor
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Vendor Template Milestones - Default durations for each milestone in a template
export const vendorTemplateMilestones = pgTable("vendor_template_milestones", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  templateId: integer("template_id").notNull().references(() => vendorTimelineTemplates.id),
  milestone: varchar("milestone", { length: 50 }).notNull(), // po_confirmation, raw_materials_ordered, etc.
  daysFromPoDate: integer("days_from_po_date").notNull().default(0), // Days from PO date for planned date
  dependsOnMilestone: varchar("depends_on_milestone", { length: 50 }), // Optional: milestone this depends on
  daysFromDependency: integer("days_from_dependency"), // Days after dependency milestone
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Category Timeline Averages - Calculated average days for each milestone by product category
export const categoryTimelineAverages = pgTable("category_timeline_averages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  productCategory: varchar("product_category", { length: 255 }).notNull().unique(),
  avgDaysToRawMaterials: integer("avg_days_to_raw_materials"),
  avgDaysToInitialInspection: integer("avg_days_to_initial_inspection"),
  avgDaysToInlineInspection: integer("avg_days_to_inline_inspection"),
  avgDaysToFinalInspection: integer("avg_days_to_final_inspection"),
  avgDaysToShipDate: integer("avg_days_to_ship_date"),
  sampleCount: integer("sample_count").default(0),
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// PO Timelines - Header table linking a PO to its timeline
export const poTimelines = pgTable("po_timelines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  poId: integer("po_id").references(() => purchaseOrders.id, { onDelete: "cascade" }), // DEPRECATED: Use poHeaderId instead
  poHeaderId: integer("po_header_id").references(() => poHeaders.id, { onDelete: "cascade" }), // New: references normalized po_headers
  poNumber: varchar("po_number", { length: 64 }), // Direct lookup without needing FK join
  templateId: integer("template_id").references(() => vendorTimelineTemplates.id), // Source template (if any)
  isLocked: boolean("is_locked").notNull().default(false), // Once locked, planned dates can't change
  lockedAt: timestamp("locked_at"),
  lockedBy: varchar("locked_by", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// PO Timeline Milestones - Individual milestone records with planned/revised/actual dates
export const poTimelineMilestones = pgTable("po_timeline_milestones", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  timelineId: integer("timeline_id").notNull().references(() => poTimelines.id, { onDelete: "cascade" }),
  milestone: varchar("milestone", { length: 50 }).notNull(), // po_confirmation, raw_materials_ordered, etc.
  plannedDate: timestamp("planned_date"), // Original planned date (locked after initial setup)
  revisedDate: timestamp("revised_date"), // Updated target date
  actualDate: timestamp("actual_date"), // When it actually happened
  actualSource: varchar("actual_source", { length: 50 }), // 'manual', 'shipment', 'inspection'
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Vendor Capacity Data - Monthly capacity tracking by vendor/client/year
// Vendor Capacity Aliases - Maps import names to canonical vendor IDs
export const vendorCapacityAliases = pgTable("vendor_capacity_aliases", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  alias: varchar("alias", { length: 255 }).notNull().unique(), // Import name like "Riches", "YC", "GHP"
  vendorId: integer("vendor_id").notNull().references(() => vendors.id), // Canonical vendor
  notes: text("notes"), // Optional notes about this alias
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const vendorCapacityData = pgTable("vendor_capacity_data", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").references(() => vendors.id), // Link to canonical vendor (nullable for migration)
  vendorCode: varchar("vendor_code", { length: 64 }).notNull(), // Tab name like "Riches", "YC", "GHP"
  vendorName: varchar("vendor_name", { length: 255 }).notNull(), // Full vendor name from Row 0 (kept for reference)
  office: varchar("office", { length: 100 }), // e.g. "Vietnam"
  client: varchar("client", { length: 64 }).notNull(), // "CB", "CB2", "C&K"
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 1-12
  // Monthly values in USD
  shipmentConfirmed: integer("shipment_confirmed").default(0), // Confirmed shipment value
  shipmentUnconfirmed: integer("shipment_unconfirmed").default(0), // Unconfirmed shipment value  
  totalShipment: integer("total_shipment").default(0), // Total shipment (confirmed + unconfirmed)
  projectionRebuy: integer("projection_rebuy").default(0), // Re-buy projections
  projectionNew: integer("projection_new").default(0), // New projections
  totalProjection: integer("total_projection").default(0), // Total projection
  totalShipmentPlusProjection: integer("total_shipment_plus_projection").default(0), // Combined total
  reservedCapacity: integer("reserved_capacity").default(0), // Reserved capacity for this client
  balance: integer("balance").default(0), // Reserved - (Shipment + Projection)
  utilizedCapacityPct: integer("utilized_capacity_pct").default(0), // Percentage utilized (stored as whole number 0-100)
  factoryOverallCapacity: integer("factory_overall_capacity").default(0), // Factory's total capacity
  pushoutRequired: integer("pushout_required").default(0), // Amount that needs to be pushed out
  rolloverCumulative: integer("rollover_cumulative").default(0), // Cumulative rollover from previous months
  projectionHistoryCB: integer("projection_history_cb").default(0), // Historical projection for CB
  projectionHistoryCB2: integer("projection_history_cb2").default(0), // Historical projection for CB2
  projectionHistoryCK: integer("projection_history_ck").default(0), // Historical projection for C&K
  remarks: text("remarks"),
  // Year locking - prevents deletion during import
  isLocked: boolean("is_locked").notNull().default(false), // Locked years are preserved during import
  // Metadata
  importDate: timestamp("import_date").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  vendorYearMonthClient: unique().on(table.vendorCode, table.year, table.month, table.client),
}));

// ========== PROJECTION SNAPSHOTS - READ-ONLY HISTORICAL ARCHIVE ==========
// Pure historical record of imported projections. NEVER modified after import.
// Used for accuracy analysis: comparing what was projected vs what actually shipped.
// Each import creates a new snapshot identified by import_date (from filename).
export const projectionSnapshots = pgTable("projection_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  clientId: integer("client_id").references(() => clients.id), // Which client this projection belongs to
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  vendorCode: varchar("vendor_code", { length: 64 }).notNull(),
  sku: varchar("sku", { length: 64 }).notNull(),
  skuDescription: text("sku_description"),
  brand: varchar("brand", { length: 64 }).notNull(), // CB, CB2, C&K
  sourceBrand: varchar("source_brand", { length: 64 }),
  productClass: varchar("product_class", { length: 100 }),
  collection: varchar("collection", { length: 100 }),
  pattern: varchar("pattern", { length: 100 }),
  coo: varchar("coo", { length: 100 }),
  vendorLeadTime: integer("vendor_lead_time"),
  fob: integer("fob").default(0), // FOB unit price in cents
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 1-12
  projectionValue: bigint("projection_value", { mode: "number" }).default(0), // USD value in cents
  quantity: integer("quantity").default(0),
  orderType: varchar("order_type", { length: 20 }).default("regular"), // regular, mto, spo
  categoryGroup: varchar("category_group", { length: 20 }).default("FURNITURE"), // FURNITURE or HOME-GOODS
  // Import metadata - these are the only fields that identify the snapshot
  importDate: timestamp("import_date").notNull(), // From filename (e.g., HOME-GOODS-20251105 → Nov 5, 2025)
  importedBy: varchar("imported_by", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Unique constraint: one record per vendor/SKU/year/month per import snapshot
  uniqueSnapshot: unique("projection_snapshots_unique_idx").on(
    table.vendorCode, table.sku, table.year, table.month, table.importDate
  ),
}));
// This table is IMMUTABLE after import. For management and matching, use active_projections.

// ========== ACTIVE PROJECTIONS - WORKING TABLE FOR MATCHING ==========
// Dynamic table for managing projections and matching to POs.
// Populated from latest snapshot per SKU/month. Can be modified for matching.
export const activeProjections = pgTable("active_projections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  snapshotId: integer("snapshot_id").references(() => projectionSnapshots.id), // Links to source snapshot
  clientId: integer("client_id").references(() => clients.id), // Which client this projection belongs to
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  vendorCode: varchar("vendor_code", { length: 64 }).notNull(),
  sku: varchar("sku", { length: 64 }).notNull(),
  skuDescription: text("sku_description"),
  brand: varchar("brand", { length: 64 }).notNull(),
  productClass: varchar("product_class", { length: 100 }),
  collection: varchar("collection", { length: 100 }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  projectionValue: bigint("projection_value", { mode: "number" }).default(0),
  quantity: integer("quantity").default(0),
  orderType: varchar("order_type", { length: 20 }).default("regular"),
  categoryGroup: varchar("category_group", { length: 20 }).default("FURNITURE"),
  // Matching fields - only used in this working table
  matchStatus: varchar("match_status", { length: 20 }).default("unmatched"), // unmatched, matched, partial, expired
  matchedPoNumber: varchar("matched_po_number", { length: 64 }),
  matchedAt: timestamp("matched_at"),
  actualQuantity: integer("actual_quantity"),
  actualValue: integer("actual_value"),
  quantityVariance: integer("quantity_variance"),
  valueVariance: integer("value_variance"),
  variancePct: integer("variance_pct"),
  // User notes for client communication
  comment: text("comment"),
  commentedAt: timestamp("commented_at"),
  commentedBy: varchar("commented_by", { length: 255 }),
  // Tracking
  lastSnapshotDate: timestamp("last_snapshot_date"), // Which import snapshot this came from
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // One active projection per vendor/SKU/year/month (latest snapshot wins)
  uniqueActive: unique("active_projections_unique_idx").on(
    table.vendorCode, table.sku, table.year, table.month
  ),
}));
// This table is the working copy - can be modified, matched, commented, etc.

// Vendor SKU Projection History - Archives old projections before each import for accuracy analysis
export const vendorSkuProjectionHistory = pgTable("vendor_sku_projection_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  vendorCode: varchar("vendor_code", { length: 64 }).notNull(),
  sku: varchar("sku", { length: 64 }).notNull(),
  skuDescription: text("sku_description"),
  brand: varchar("brand", { length: 64 }).notNull(), // CB, CB2, C&K
  sourceBrand: varchar("source_brand", { length: 64 }),
  productClass: varchar("product_class", { length: 100 }),
  collection: varchar("collection", { length: 100 }),
  pattern: varchar("pattern", { length: 100 }),
  coo: varchar("coo", { length: 100 }),
  vendorLeadTime: integer("vendor_lead_time"),
  fob: integer("fob").default(0),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  projectionValue: bigint("projection_value", { mode: "number" }).default(0),
  quantity: integer("quantity").default(0),
  orderType: varchar("order_type", { length: 20 }),
  // PO matching state at time of archival
  matchStatus: varchar("match_status", { length: 20 }),
  matchedPoNumber: varchar("matched_po_number", { length: 64 }),
  matchedAt: timestamp("matched_at"),
  actualQuantity: integer("actual_quantity"),
  actualValue: integer("actual_value"),
  quantityVariance: integer("quantity_variance"),
  valueVariance: integer("value_variance"),
  variancePct: integer("variance_pct"),
  removedAt: timestamp("removed_at"),
  removalReason: text("removal_reason"),
  // When this projection was originally imported
  originalImportDate: timestamp("original_import_date").notNull(),
  originalImportedBy: varchar("original_imported_by", { length: 255 }),
  // When this projection was archived (replaced by newer import)
  archivedAt: timestamp("archived_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Expired Projections - Storage for projections past their order window
// Regular POs: 90 days before target month end
// SPO/MTO: 30 days before target month end
export const expiredProjections = pgTable("expired_projections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Original projection data
  originalProjectionId: integer("original_projection_id").notNull(), // ID from active_projections
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  vendorCode: varchar("vendor_code", { length: 64 }).notNull(),
  sku: varchar("sku", { length: 64 }).notNull(),
  skuDescription: text("sku_description"),
  brand: varchar("brand", { length: 64 }).notNull(),
  sourceBrand: varchar("source_brand", { length: 64 }),
  productClass: varchar("product_class", { length: 100 }),
  collection: varchar("collection", { length: 100 }),
  pattern: varchar("pattern", { length: 100 }),
  coo: varchar("coo", { length: 100 }),
  vendorLeadTime: integer("vendor_lead_time"),
  fob: integer("fob").default(0),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  projectionValue: bigint("projection_value", { mode: "number" }).default(0),
  quantity: integer("quantity").default(0),
  orderType: varchar("order_type", { length: 20 }), // 'regular' or 'mto'
  // Expiration metadata
  expiredAt: timestamp("expired_at").notNull().defaultNow(),
  expirationReason: text("expiration_reason").notNull(), // 'past_90_day_window' or 'past_30_day_window'
  thresholdDays: integer("threshold_days").notNull(), // 90 for regular, 30 for SPO
  targetMonthEnd: timestamp("target_month_end").notNull(), // End of the target month
  daysOverdue: integer("days_overdue").notNull(), // How many days past the order window
  // Verification tracking
  verificationStatus: varchar("verification_status", { length: 20 }).default("pending"), // pending, verified, cancelled, restored
  verifiedAt: timestamp("verified_at"),
  verifiedBy: varchar("verified_by", { length: 255 }),
  verificationNotes: text("verification_notes"),
  // If restored back to active projections
  restoredAt: timestamp("restored_at"),
  restoredBy: varchar("restored_by", { length: 255 }),
  // Original import metadata
  originalImportDate: timestamp("original_import_date").notNull(),
  originalImportedBy: varchar("original_imported_by", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Backlog Comments - Editable comments for "yet to be ordered" items
// Allows merchandisers to annotate projections that haven't converted to orders
export const backlogComments = pgTable("backlog_comments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  targetYear: integer("target_year").notNull(),
  targetMonth: integer("target_month").notNull(),
  // For regular: SKU-level, for SPO: Collection-level
  sku: varchar("sku", { length: 64 }), // SKU for regular orders
  collection: varchar("collection", { length: 100 }), // Collection for SPO orders
  orderType: varchar("order_type", { length: 20 }).notNull(), // 'regular' or 'spo'
  // Comment content
  comment: text("comment"),
  status: varchar("status", { length: 50 }).default("pending"), // pending, acknowledged, escalated, resolved
  // Metadata
  createdBy: varchar("created_by", { length: 255 }),
  updatedBy: varchar("updated_by", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Actual Aggregates - Aggregated actual order data from locked actual logic
// Stores outputs from the Dashboard KPI calculations for comparison
export const actualAgg = pgTable("actual_agg", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  targetYear: integer("target_year").notNull(),
  targetMonth: integer("target_month").notNull(), // 1-12
  // Aggregation key (SKU for regular, Collection for SPO)
  sku: varchar("sku", { length: 64 }), // For regular orders
  collection: varchar("collection", { length: 100 }), // For SPO orders
  orderType: varchar("order_type", { length: 20 }).notNull(), // 'regular' or 'spo'
  brand: varchar("brand", { length: 64 }), // CB, CB2, C&K
  // Aggregated actual values (from shipped + unshipped)
  actualValueSum: integer("actual_value_sum").default(0), // Total actual order value in cents
  actualQuantitySum: integer("actual_quantity_sum").default(0),
  shippedValueSum: integer("shipped_value_sum").default(0), // Shipped portion
  unshippedValueSum: integer("unshipped_value_sum").default(0), // Unshipped portion
  poCount: integer("po_count").default(0), // Number of POs
  // Refresh tracking
  lastRefreshedAt: timestamp("last_refreshed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  vendorMonthKey: unique().on(table.vendorId, table.targetYear, table.targetMonth, table.sku, table.collection, table.orderType),
}));

// Vendor Capacity Summary - Aggregated vendor-level data per year
export const vendorCapacitySummary = pgTable("vendor_capacity_summary", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  vendorId: integer("vendor_id").references(() => vendors.id), // Link to canonical vendor (nullable for migration)
  vendorCode: varchar("vendor_code", { length: 64 }).notNull(),
  vendorName: varchar("vendor_name", { length: 255 }).notNull(), // Kept for reference
  office: varchar("office", { length: 100 }),
  year: integer("year").notNull(),
  // Annual totals in USD
  totalShipmentAnnual: integer("total_shipment_annual").default(0),
  totalProjectionAnnual: integer("total_projection_annual").default(0),
  totalReservedCapacityAnnual: integer("total_reserved_capacity_annual").default(0),
  avgUtilizationPct: integer("avg_utilization_pct").default(0),
  // Client breakdown totals
  cbShipmentAnnual: integer("cb_shipment_annual").default(0),
  cb2ShipmentAnnual: integer("cb2_shipment_annual").default(0),
  ckShipmentAnnual: integer("ck_shipment_annual").default(0),
  // Year locking - prevents deletion during import
  isLocked: boolean("is_locked").notNull().default(false), // Locked years are preserved during import
  // Metadata
  importDate: timestamp("import_date").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  vendorYear: unique().on(table.vendorCode, table.year),
}));

// Communications table - emails, notes, and messages tagged to entities (POs, MCPs, SKUs, etc.)
export const communications = pgTable("communications", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Entity linkage - polymorphic association
  entityType: varchar("entity_type", { length: 50 }).notNull(), // 'po', 'mcp', 'sku', 'vendor', 'shipment'
  entityId: integer("entity_id").notNull(), // ID of the linked entity
  poNumber: varchar("po_number", { length: 64 }), // Optional PO number for searching
  // Communication type and content
  communicationType: varchar("communication_type", { length: 50 }).notNull(), // 'email', 'note', 'system'
  subject: varchar("subject", { length: 500 }),
  content: text("content").notNull(),
  sender: varchar("sender", { length: 255 }),
  recipients: text("recipients"), // Comma-separated list
  // Email-specific fields
  emailMessageId: varchar("email_message_id", { length: 255 }), // External email ID for deduplication
  emailThreadId: varchar("email_thread_id", { length: 255 }), // For grouping email threads
  direction: varchar("direction", { length: 20 }), // 'inbound', 'outbound'
  // Metadata
  communicationDate: timestamp("communication_date").notNull().defaultNow(),
  isRead: boolean("is_read").default(false),
  priority: varchar("priority", { length: 20 }).default("normal"), // 'low', 'normal', 'high', 'urgent'
  tags: text("tags"), // Comma-separated tags for categorization
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// AI Summaries table - cached AI-generated summaries for entities
export const aiSummaries = pgTable("ai_summaries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Entity linkage
  entityType: varchar("entity_type", { length: 50 }).notNull(), // 'po', 'mcp', 'sku', 'vendor', 'shipment'
  entityId: integer("entity_id").notNull(),
  poNumber: varchar("po_number", { length: 64 }), // Optional PO number for reference
  // Summary content
  summaryType: varchar("summary_type", { length: 50 }).notNull(), // 'email_history', 'timeline', 'compliance', 'notes'
  summary: text("summary").notNull(), // The AI-generated summary
  keyEvents: text("key_events"), // JSON array of key events/timeline items
  recommendations: text("recommendations"), // AI recommendations if any
  // Generation metadata
  modelUsed: varchar("model_used", { length: 100 }),
  promptVersion: varchar("prompt_version", { length: 50 }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  // Cache management
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"), // Optional expiry for cache invalidation
  isStale: boolean("is_stale").default(false), // Mark as stale when new data arrives
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  entitySummary: unique().on(table.entityType, table.entityId, table.summaryType),
}));

// Staff Performance Goals - Up to 5 annual review goals per staff member
export const staffGoals = pgTable("staff_goals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  staffId: integer("staff_id").notNull().references(() => staff.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  targetMetric: varchar("target_metric", { length: 255 }), // e.g., "3 new vendors", "2% cost reduction"
  category: varchar("category", { length: 100 }), // e.g., "sourcing", "cost_reduction", "efficiency"
  status: varchar("status", { length: 50 }).notNull().default("in_progress"), // 'in_progress', 'on_track', 'at_risk', 'completed', 'not_met'
  priority: integer("priority").notNull().default(1), // 1-5 for ordering goals
  reviewYear: integer("review_year").notNull(), // e.g., 2025
  managerNotes: text("manager_notes"), // Overall manager notes on the goal
  createdBy: integer("created_by"), // Manager who created the goal
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Goal Progress Entries - Line items showing progress on each goal
export const goalProgressEntries = pgTable("goal_progress_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  goalId: integer("goal_id").notNull().references(() => staffGoals.id),
  entryDate: timestamp("entry_date").notNull().defaultNow(),
  action: text("action").notNull(), // What was done
  result: text("result"), // Measurable outcome
  addedBy: integer("added_by"), // Manager who added the entry
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Milestone type constants for reference
export const TIMELINE_MILESTONES = [
  'po_confirmation',
  'raw_materials_ordered',
  'raw_materials_delivered',
  'production_start',
  'shipment_booking',
  'inline_inspection',
  'production_finish',
  'final_inspection',
  'hod',
  'etd',
] as const;

export type TimelineMilestone = typeof TIMELINE_MILESTONES[number];

export const MILESTONE_LABELS: Record<TimelineMilestone, string> = {
  po_confirmation: 'PO Confirmation',
  raw_materials_ordered: 'Raw Materials Ordered',
  raw_materials_delivered: 'Raw Materials Delivered',
  production_start: 'Production Start',
  shipment_booking: 'Shipment Booking',
  inline_inspection: 'Inline Inspection',
  production_finish: 'Production Finish',
  final_inspection: 'Final Inspection',
  hod: 'HOD',
  etd: 'ETD',
};

// Insert schemas - using pick to select only the fields we want to insert
const userFullSchema = createInsertSchema(users, {
  email: z.string().email(),
});
export const insertUserSchema = userFullSchema.pick({
  username: true,
  email: true,
  role: true,
});

const purchaseOrderFullSchema = createInsertSchema(purchaseOrders);
export const insertPurchaseOrderSchema = purchaseOrderFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// PO Headers schema
const poHeaderFullSchema = createInsertSchema(poHeaders);
export const insertPoHeaderSchema = poHeaderFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// PO Line Items schema
const poLineItemFullSchema = createInsertSchema(poLineItems);
export const insertPoLineItemSchema = poLineItemFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const staffFullSchema = createInsertSchema(staff, {
  email: z.string().email().optional(),
  hireDate: z.string().transform(val => val ? new Date(val) : null).optional(),
});
export const insertStaffSchema = staffFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const clientFullSchema = createInsertSchema(clients, {
  email: z.string().email().optional(),
});
export const insertClientSchema = clientFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const staffClientAssignmentFullSchema = createInsertSchema(staffClientAssignments);
export const insertStaffClientAssignmentSchema = staffClientAssignmentFullSchema.omit({
  id: true,
  createdAt: true,
});

const vendorClientAssignmentFullSchema = createInsertSchema(vendorClientAssignments);
export const insertVendorClientAssignmentSchema = vendorClientAssignmentFullSchema.omit({
  id: true,
  createdAt: true,
});

const vendorFullSchema = createInsertSchema(vendors, {
  email: z.string().email().optional(),
});
export const insertVendorSchema = vendorFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const skuFullSchema = createInsertSchema(skus);
export const insertSkuSchema = skuFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const timelineFullSchema = createInsertSchema(timelines);
export const insertTimelineSchema = timelineFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const shipmentFullSchema = createInsertSchema(shipments);
export const insertShipmentSchema = shipmentFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const inspectionFullSchema = createInsertSchema(inspections);
export const insertInspectionSchema = inspectionFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const complianceStyleFullSchema = createInsertSchema(complianceStyles);
export const insertComplianceStyleSchema = complianceStyleFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const qualityTestFullSchema = createInsertSchema(qualityTests);
export const insertQualityTestSchema = qualityTestFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const importHistoryFullSchema = createInsertSchema(importHistory);
export const insertImportHistorySchema = importHistoryFullSchema.omit({
  id: true,
  createdAt: true,
});

const brandAssignmentFullSchema = createInsertSchema(brandAssignments);
export const insertBrandAssignmentSchema = brandAssignmentFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const vendorContactFullSchema = createInsertSchema(vendorContacts, {
  email: z.string().email().optional(),
});
export const insertVendorContactSchema = vendorContactFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const colorPanelFullSchema = createInsertSchema(colorPanels);
export const insertColorPanelSchema = colorPanelFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const colorPanelHistoryFullSchema = createInsertSchema(colorPanelHistory);
export const insertColorPanelHistorySchema = colorPanelHistoryFullSchema.omit({
  id: true,
  createdAt: true,
});

const skuColorPanelFullSchema = createInsertSchema(skuColorPanels);
export const insertSkuColorPanelSchema = skuColorPanelFullSchema.omit({
  id: true,
  createdAt: true,
  linkedDate: true,
});

// MCP Workflow schemas
const colorPanelWorkflowFullSchema = createInsertSchema(colorPanelWorkflows, {
  nextActionDue: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
  lastActionDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
  lastReminderDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertColorPanelWorkflowSchema = colorPanelWorkflowFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const colorPanelCommunicationFullSchema = createInsertSchema(colorPanelCommunications, {
  lastMessageDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertColorPanelCommunicationSchema = colorPanelCommunicationFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const colorPanelMessageFullSchema = createInsertSchema(colorPanelMessages, {
  sentAt: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
  receivedAt: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
  humanApprovedAt: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertColorPanelMessageSchema = colorPanelMessageFullSchema.omit({
  id: true,
  createdAt: true,
});

const colorPanelAiEventFullSchema = createInsertSchema(colorPanelAiEvents, {
  followUpDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertColorPanelAiEventSchema = colorPanelAiEventFullSchema.omit({
  id: true,
  createdAt: true,
});

const colorPanelIssueFullSchema = createInsertSchema(colorPanelIssues, {
  resolvedAt: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertColorPanelIssueSchema = colorPanelIssueFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const activityLogFullSchema = createInsertSchema(activityLogs, {
  dueDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
  completionDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertActivityLogSchema = activityLogFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// PO Tasks schema
const poTaskFullSchema = createInsertSchema(poTasks, {
  dueDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
  completedAt: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertPoTaskSchema = poTaskFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Todo Dismissals schemas
const todoDismissalFullSchema = createInsertSchema(todoDismissals);
export const insertTodoDismissalSchema = todoDismissalFullSchema.omit({
  id: true,
  dismissedAt: true,
});

// Vendor Timeline Template schemas
const vendorTimelineTemplateFullSchema = createInsertSchema(vendorTimelineTemplates);
export const insertVendorTimelineTemplateSchema = vendorTimelineTemplateFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const vendorTemplateMilestoneFullSchema = createInsertSchema(vendorTemplateMilestones);
export const insertVendorTemplateMilestoneSchema = vendorTemplateMilestoneFullSchema.omit({
  id: true,
  createdAt: true,
});

// PO Timeline schemas
const poTimelineFullSchema = createInsertSchema(poTimelines, {
  lockedAt: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertPoTimelineSchema = poTimelineFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const poTimelineMilestoneFullSchema = createInsertSchema(poTimelineMilestones, {
  plannedDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
  revisedDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
  actualDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertPoTimelineMilestoneSchema = poTimelineMilestoneFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Projection Snapshots schemas (read-only historical archive)
const projectionSnapshotsFullSchema = createInsertSchema(projectionSnapshots);
export const insertProjectionSnapshotSchema = projectionSnapshotsFullSchema.omit({
  id: true,
  createdAt: true,
});

// Active Projections schemas (working table for matching)
const activeProjectionsFullSchema = createInsertSchema(activeProjections);
export const insertActiveProjectionSchema = activeProjectionsFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

const vendorSkuProjectionHistoryFullSchema = createInsertSchema(vendorSkuProjectionHistory);
export const insertVendorSkuProjectionHistorySchema = vendorSkuProjectionHistoryFullSchema.omit({
  id: true,
  createdAt: true,
  archivedAt: true,
});

// Expired Projections schemas
const expiredProjectionsFullSchema = createInsertSchema(expiredProjections);
export const insertExpiredProjectionSchema = expiredProjectionsFullSchema.omit({
  id: true,
  createdAt: true,
  expiredAt: true,
});

// Backlog Comments schemas
const backlogCommentsFullSchema = createInsertSchema(backlogComments);
export const insertBacklogCommentSchema = backlogCommentsFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Actual Agg schemas
const actualAggFullSchema = createInsertSchema(actualAgg);
export const insertActualAggSchema = actualAggFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Vendor Capacity schemas
const vendorCapacityAliasesFullSchema = createInsertSchema(vendorCapacityAliases);
export const insertVendorCapacityAliasSchema = vendorCapacityAliasesFullSchema.omit({
  id: true,
  createdAt: true,
});

const vendorCapacityDataFullSchema = createInsertSchema(vendorCapacityData);
export const insertVendorCapacityDataSchema = vendorCapacityDataFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  importDate: true,
});

const vendorCapacitySummaryFullSchema = createInsertSchema(vendorCapacitySummary);
export const insertVendorCapacitySummarySchema = vendorCapacitySummaryFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  importDate: true,
});

// Communications schema
const communicationFullSchema = createInsertSchema(communications, {
  communicationDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertCommunicationSchema = communicationFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// AI Summaries schema
const aiSummaryFullSchema = createInsertSchema(aiSummaries, {
  lastUpdated: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
  expiresAt: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertAiSummarySchema = aiSummaryFullSchema.omit({
  id: true,
  createdAt: true,
});

// Staff Goals schema
const staffGoalFullSchema = createInsertSchema(staffGoals);
export const insertStaffGoalSchema = staffGoalFullSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Goal Progress Entries schema
const goalProgressEntryFullSchema = createInsertSchema(goalProgressEntries, {
  entryDate: z.preprocess(
    (val) => val === null || val === undefined || val === '' ? null : typeof val === 'string' ? new Date(val) : val,
    z.date().nullable().optional()
  ),
});
export const insertGoalProgressEntrySchema = goalProgressEntryFullSchema.omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

// Extended PO type for list responses that includes computed fields from the getPurchaseOrders query
export type PurchaseOrderWithComputedFields = PurchaseOrder & {
  hasActualShipDate?: boolean;  // Computed: true if any shipment has delivery_to_consolidator or actual_sailing_date
  lineItemCount?: number;       // Computed: count of po_line_items for this PO
};

export type InsertPoHeader = z.infer<typeof insertPoHeaderSchema>;
export type PoHeader = typeof poHeaders.$inferSelect;

export type InsertPoLineItem = z.infer<typeof insertPoLineItemSchema>;
export type PoLineItem = typeof poLineItems.$inferSelect;

export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staff.$inferSelect;

export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

export type InsertStaffClientAssignment = z.infer<typeof insertStaffClientAssignmentSchema>;
export type StaffClientAssignment = typeof staffClientAssignments.$inferSelect;

export type InsertVendorClientAssignment = z.infer<typeof insertVendorClientAssignmentSchema>;
export type VendorClientAssignment = typeof vendorClientAssignments.$inferSelect;

export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

export type InsertSku = z.infer<typeof insertSkuSchema>;
export type Sku = typeof skus.$inferSelect;

export type InsertTimeline = z.infer<typeof insertTimelineSchema>;
export type Timeline = typeof timelines.$inferSelect;

export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type Shipment = typeof shipments.$inferSelect;

export type InsertInspection = z.infer<typeof insertInspectionSchema>;
export type Inspection = typeof inspections.$inferSelect;

export type InsertComplianceStyle = z.infer<typeof insertComplianceStyleSchema>;
export type ComplianceStyle = typeof complianceStyles.$inferSelect;

export type InsertQualityTest = z.infer<typeof insertQualityTestSchema>;
export type QualityTest = typeof qualityTests.$inferSelect;

export type InsertImportHistory = z.infer<typeof insertImportHistorySchema>;
export type ImportHistory = typeof importHistory.$inferSelect;

export type InsertBrandAssignment = z.infer<typeof insertBrandAssignmentSchema>;
export type BrandAssignment = typeof brandAssignments.$inferSelect;

export type InsertVendorContact = z.infer<typeof insertVendorContactSchema>;
export type VendorContact = typeof vendorContacts.$inferSelect;

export type InsertColorPanel = z.infer<typeof insertColorPanelSchema>;
export type ColorPanel = typeof colorPanels.$inferSelect;

export type InsertColorPanelHistory = z.infer<typeof insertColorPanelHistorySchema>;
export type ColorPanelHistory = typeof colorPanelHistory.$inferSelect;

export type InsertSkuColorPanel = z.infer<typeof insertSkuColorPanelSchema>;
export type SkuColorPanel = typeof skuColorPanels.$inferSelect;

export type InsertColorPanelWorkflow = z.infer<typeof insertColorPanelWorkflowSchema>;
export type ColorPanelWorkflow = typeof colorPanelWorkflows.$inferSelect;

export type InsertColorPanelCommunication = z.infer<typeof insertColorPanelCommunicationSchema>;
export type ColorPanelCommunication = typeof colorPanelCommunications.$inferSelect;

export type InsertColorPanelMessage = z.infer<typeof insertColorPanelMessageSchema>;
export type ColorPanelMessage = typeof colorPanelMessages.$inferSelect;

export type InsertColorPanelAiEvent = z.infer<typeof insertColorPanelAiEventSchema>;
export type ColorPanelAiEvent = typeof colorPanelAiEvents.$inferSelect;

export type InsertColorPanelIssue = z.infer<typeof insertColorPanelIssueSchema>;
export type ColorPanelIssue = typeof colorPanelIssues.$inferSelect;

export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

export type InsertVendorTimelineTemplate = z.infer<typeof insertVendorTimelineTemplateSchema>;
export type VendorTimelineTemplate = typeof vendorTimelineTemplates.$inferSelect;

export type InsertVendorTemplateMilestone = z.infer<typeof insertVendorTemplateMilestoneSchema>;
export type VendorTemplateMilestone = typeof vendorTemplateMilestones.$inferSelect;

export type InsertPoTimeline = z.infer<typeof insertPoTimelineSchema>;
export type PoTimeline = typeof poTimelines.$inferSelect;

export type InsertPoTimelineMilestone = z.infer<typeof insertPoTimelineMilestoneSchema>;
export type PoTimelineMilestone = typeof poTimelineMilestones.$inferSelect;

export type CategoryTimelineAverage = typeof categoryTimelineAverages.$inferSelect;

export type InsertPoTask = z.infer<typeof insertPoTaskSchema>;
export type PoTask = typeof poTasks.$inferSelect;

export type InsertVendorCapacityAlias = z.infer<typeof insertVendorCapacityAliasSchema>;
export type VendorCapacityAlias = typeof vendorCapacityAliases.$inferSelect;

export type InsertVendorCapacityData = z.infer<typeof insertVendorCapacityDataSchema>;
export type VendorCapacityData = typeof vendorCapacityData.$inferSelect;

export type InsertVendorCapacitySummary = z.infer<typeof insertVendorCapacitySummarySchema>;
export type VendorCapacitySummary = typeof vendorCapacitySummary.$inferSelect;

export type InsertProjectionSnapshot = z.infer<typeof insertProjectionSnapshotSchema>;
export type ProjectionSnapshot = typeof projectionSnapshots.$inferSelect;

export type InsertActiveProjection = z.infer<typeof insertActiveProjectionSchema>;
export type ActiveProjection = typeof activeProjections.$inferSelect;

export type InsertVendorSkuProjectionHistory = z.infer<typeof insertVendorSkuProjectionHistorySchema>;
export type VendorSkuProjectionHistory = typeof vendorSkuProjectionHistory.$inferSelect;

export type InsertExpiredProjection = z.infer<typeof insertExpiredProjectionSchema>;
export type ExpiredProjection = typeof expiredProjections.$inferSelect;

export type InsertBacklogComment = z.infer<typeof insertBacklogCommentSchema>;
export type BacklogComment = typeof backlogComments.$inferSelect;

export type InsertActualAgg = z.infer<typeof insertActualAggSchema>;
export type ActualAgg = typeof actualAgg.$inferSelect;

export type InsertCommunication = z.infer<typeof insertCommunicationSchema>;
export type Communication = typeof communications.$inferSelect;

export type InsertAiSummary = z.infer<typeof insertAiSummarySchema>;
export type AiSummary = typeof aiSummaries.$inferSelect;

export type InsertStaffGoal = z.infer<typeof insertStaffGoalSchema>;
export type StaffGoal = typeof staffGoals.$inferSelect;

export type InsertGoalProgressEntry = z.infer<typeof insertGoalProgressEntrySchema>;
export type GoalProgressEntry = typeof goalProgressEntries.$inferSelect;

export type InsertTodoDismissal = z.infer<typeof insertTodoDismissalSchema>;
export type TodoDismissal = typeof todoDismissals.$inferSelect;
