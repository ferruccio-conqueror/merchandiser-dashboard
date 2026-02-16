/**
 * AI Schema Documentation
 * Complete database schema documentation for the AI Data Analyst
 * Enables the AI to generate and execute SQL queries to answer any ad-hoc question
 */

export const AI_SCHEMA_DOCUMENTATION = `
## DATABASE SCHEMA DOCUMENTATION

This ERP system tracks merchandising operations including purchase orders, vendors, shipments, quality inspections, projections, and capacity planning. All monetary values are stored in CENTS (divide by 100 for dollars).

### CORE TABLES

#### po_headers (Main PO table - one row per purchase order)
Primary source: OS340 import
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| po_number | varchar(64) | Unique PO identifier (e.g., "123456789") |
| cop_number | varchar(64) | Customer Order Processing number (client reference) |
| client | varchar(255) | Client company name |
| client_division | varchar(255) | Division within client (e.g., "Crate and Barrel") |
| client_department | varchar(255) | Department (e.g., "Furniture", "Textiles") |
| buyer | varchar(255) | Buyer name at client |
| vendor | varchar(255) | Vendor/factory name |
| vendor_id | integer | FK to vendors.id (canonical vendor) |
| factory | varchar(255) | Factory name if different from vendor |
| product_group | varchar(255) | Product category group |
| product_category | varchar(255) | Specific product category |
| season | varchar(64) | Selling season (e.g., "SP25", "FA24") |
| order_classification | varchar(255) | Order type classification |
| program_description | text | Program details (8X8 programs are excluded from OTD) |
| program | varchar(20) | Program code |
| merchandise_program | varchar(255) | Merchandise program name |
| office | varchar(64) | Office location (e.g., "Vietnam", "China") |
| mr_section | varchar(255) | MR section |
| po_date | timestamp | Date PO was placed |
| month | varchar(20) | Target month |
| original_ship_date | timestamp | Original planned ship date |
| original_cancel_date | timestamp | Original cancel/deadline date |
| revised_ship_date | timestamp | Revised ship date (if changed) |
| revised_cancel_date | timestamp | Revised cancel date (if changed) |
| revised_by | varchar(255) | Who revised dates (CLIENT, FORWARDER, or vendor name) |
| revised_reason | text | Reason for date revision |
| total_quantity | integer | Total units ordered |
| balance_quantity | integer | Remaining units to ship |
| total_value | integer | Total PO value in CENTS |
| shipped_value | integer | Value shipped in CENTS (for YTD revenue) |
| schedule_ship_mode | varchar(64) | Planned shipping mode |
| schedule_poe | varchar(255) | Planned port of entry |
| status | varchar(64) | PO status (Booked-to-ship, Closed, Cancelled) |
| shipment_status | varchar(64) | Shipment status (Shipped, Partial, Not Shipped) |

#### po_line_items (SKU-level detail for each PO)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| po_header_id | integer | FK to po_headers.id |
| po_number | varchar(64) | PO number (denormalized) |
| line_sequence | integer | Line item sequence |
| sku | varchar(64) | SKU code |
| style | varchar(64) | Style code |
| seller_style | varchar(255) | Product description |
| new_sku | varchar(64) | New SKU indicator |
| new_style | varchar(1) | New style flag |
| big_bets | varchar(10) | Big bets indicator |
| cbx_item | varchar(10) | CBX item indicator |
| order_quantity | integer | Quantity on this line |
| balance_quantity | integer | Remaining quantity |
| unit_price | integer | FOB unit price in CENTS |
| line_total | integer | Line total in CENTS (qty * price) |

#### shipments (Shipment tracking - multiple per PO)
Primary source: OS340 (initial), OS650 (enrichment)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| po_header_id | integer | FK to po_headers.id |
| po_number | varchar(64) | PO number |
| line_item_id | varchar(64) | OS650 line item ID |
| style | varchar(64) | Style code |
| shipment_number | integer | Shipment sequence (1, 2, 3...) |
| delivery_to_consolidator | timestamp | Date delivered to consolidator (HOD) |
| qty_shipped | integer | Quantity shipped |
| shipped_value | integer | Value shipped in CENTS |
| actual_port_of_loading | varchar(255) | Actual POL |
| actual_sailing_date | timestamp | Actual ETD |
| eta | timestamp | Estimated arrival |
| actual_ship_mode | varchar(64) | Actual shipping mode (Ocean, Air) |
| poe | varchar(255) | Port of entry |
| vessel_flight | varchar(255) | Vessel or flight name |
| cargo_ready_date | timestamp | When cargo was ready |
| load_type | varchar(64) | FCL/LCL |
| pts_number | varchar(64) | Pre-Shipment number |
| logistic_status | varchar(64) | Logistics status |
| late_reason_code | varchar(255) | Reason for late delivery |
| reason | varchar(255) | Reason based on original HOD |
| hod_status | varchar(64) | HOD status |
| so_first_submission_date | timestamp | SO first submission |
| pts_status | varchar(64) | PTS status |
| cargo_receipt_status | varchar(64) | CFS cargo receipt status |

#### vendors (Canonical vendor list)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| name | varchar(255) | Unique vendor name |
| cbh_vendor_code | varchar(50) | CBH vendor code |
| contact_person | varchar(255) | Primary contact |
| email | varchar(320) | Contact email |
| phone | varchar(50) | Phone number |
| address | text | Address |
| country | varchar(100) | Country |
| region | varchar(100) | Region |
| merchandiser | varchar(255) | Assigned merchandiser name |
| merchandising_manager | varchar(255) | Assigned MM name |
| merchandiser_id | integer | FK to staff.id |
| merchandising_manager_id | integer | FK to staff.id |
| status | varchar(50) | active/inactive |

#### staff (Employees - merchandisers, managers)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| name | varchar(255) | Unique staff name |
| role | varchar(100) | Job role (merchandiser, merchandising_manager, etc.) |
| email | varchar(320) | Email |
| phone | varchar(50) | Phone |
| office | varchar(100) | Office location |
| status | varchar(50) | active/inactive |
| access_level | varchar(50) | full_access, level_1, level_2 |
| hire_date | timestamp | Hire date |
| department | varchar(100) | Department |
| title | varchar(150) | Job title |
| manager_id | integer | FK to staff.id (their manager) |

#### inspections (Quality inspections)
Primary source: OS630
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| po_header_id | integer | FK to po_headers.id |
| sku_id | integer | FK to skus.id |
| vendor_id | integer | FK to vendors.id |
| po_number | varchar(64) | PO number |
| style | varchar(64) | Style code |
| sku | varchar(64) | SKU code |
| vendor_name | varchar(255) | Vendor name |
| inspection_type | varchar(100) | Material, Initial, Inline, Final, Re-Final |
| inspection_date | timestamp | When inspection occurred |
| result | varchar(50) | Passed, Failed, Pending |
| inspector | varchar(255) | Inspector name |
| inspection_company | varchar(255) | Third-party company |
| notes | text | Notes |

#### quality_tests (Lab tests and certifications)
Primary source: OS630
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| po_header_id | integer | FK to po_headers.id |
| sku_id | integer | FK to skus.id |
| po_number | varchar(64) | PO number |
| style | varchar(64) | Style code |
| sku | varchar(64) | SKU code |
| test_type | varchar(100) | Mandatory, Performance, Transit, Retest |
| report_date | timestamp | Report date |
| report_number | varchar(100) | Report number |
| result | varchar(50) | Passed, Failed, Conditional |
| expiry_date | timestamp | Certificate expiry |
| status | varchar(50) | Valid, Expired, Expiring Soon |
| corrective_action_plan | text | CAP if failed |
| report_link | text | Link to report |

#### compliance_styles (Compliance status by style)
Primary source: OS630
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| style | varchar(64) | Style code |
| po_number | varchar(64) | Related PO |
| po_header_id | integer | FK to po_headers.id |
| vendor_id | integer | FK to vendors.id |
| source_status | varchar(64) | Status from source file |
| client_division | varchar(255) | Client division |
| vendor_name | varchar(255) | Vendor name |
| mandatory_status | varchar(50) | Valid, Expired, Outstanding |
| mandatory_expiry_date | timestamp | Mandatory test expiry |
| mandatory_report_number | varchar(100) | Report number |
| performance_status | varchar(50) | Performance test status |
| performance_expiry_date | timestamp | Performance test expiry |
| performance_report_number | varchar(100) | Report number |
| transit_status | varchar(50) | Transit test status |
| transit_expiry_date | timestamp | Transit test expiry |

### PROJECTION & CAPACITY TABLES

#### projection_snapshots (Immutable historical archive for accuracy analysis)
Primary source: FURNITURE import - NEVER modified after import
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| vendor_id | integer | FK to vendors.id |
| vendor_code | varchar(64) | Vendor short code |
| sku | varchar(64) | SKU or "SPO" for made-to-order |
| sku_description | text | SKU description |
| brand | varchar(64) | Normalized: CB, CB2, C&K |
| product_class | varchar(100) | Product class |
| collection | varchar(100) | Collection name |
| year | integer | Target year |
| month | integer | Target month (1-12) |
| projection_value | bigint | Projected value in CENTS |
| quantity | integer | Projected quantity |
| order_type | varchar(20) | regular (90-day) or spo (30-day) |
| category_group | varchar(20) | FURNITURE or HOME-GOODS |
| import_date | timestamp | Date extracted from filename (e.g., 2025-10-01 from Oct 2025) |
| created_at | timestamp | Record creation time |

#### active_projections (Working table for matching and management)
Populated from latest snapshot per SKU/month - can be modified
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| snapshot_id | integer | FK to projection_snapshots.id |
| vendor_id | integer | FK to vendors.id |
| vendor_code | varchar(64) | Vendor short code |
| sku | varchar(64) | SKU or "SPO" for made-to-order |
| sku_description | text | SKU description |
| brand | varchar(64) | Normalized: CB, CB2, C&K |
| product_class | varchar(100) | Product class |
| collection | varchar(100) | Collection name |
| year | integer | Target year |
| month | integer | Target month (1-12) |
| projection_value | bigint | Projected value in CENTS |
| quantity | integer | Projected quantity |
| order_type | varchar(20) | regular (90-day) or spo (30-day) |
| category_group | varchar(20) | FURNITURE or HOME-GOODS |
| match_status | varchar(20) | unmatched, matched, partial, expired |
| matched_po_number | varchar(64) | Matched PO if any |
| matched_at | timestamp | When matched |
| actual_quantity | integer | Actual from matched PO |
| actual_value | integer | Actual value from matched PO in CENTS |
| quantity_variance | integer | actual - projected |
| value_variance | integer | Value variance in CENTS |
| variance_pct | integer | Percentage variance |
| comment | text | User comment |
| last_snapshot_date | timestamp | Which import snapshot this came from |

#### vendor_capacity_data (Monthly capacity by vendor/client)
Primary source: SS551 import
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| vendor_id | integer | FK to vendors.id |
| vendor_code | varchar(64) | Vendor short code |
| vendor_name | varchar(255) | Full vendor name |
| office | varchar(100) | Office location |
| client | varchar(64) | CB, CB2, C&K |
| year | integer | Year |
| month | integer | Month (1-12) |
| shipment_confirmed | integer | Confirmed shipment value in CENTS |
| shipment_unconfirmed | integer | Unconfirmed shipment value |
| total_shipment | integer | Total shipment value |
| projection_rebuy | integer | Re-buy projections |
| projection_new | integer | New projections |
| total_projection | integer | Total projection |
| reserved_capacity | integer | Reserved capacity |
| balance | integer | Reserved - used |
| utilized_capacity_pct | integer | Utilization % (0-100) |
| factory_overall_capacity | integer | Factory total capacity |
| pushout_required | integer | Amount to push out |
| is_locked | boolean | Year is locked (preserved during import) |

### TASK & ACTIVITY TABLES

#### po_tasks (Tasks linked to POs)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| po_number | varchar(64) | Related PO |
| po_header_id | integer | FK to po_headers.id |
| task_source | varchar(50) | compliance, inspection, shipment, manual |
| task_type | varchar(100) | Task type |
| title | varchar(255) | Task title |
| description | text | Description |
| due_date | timestamp | Due date |
| priority | varchar(20) | low, normal, high, urgent |
| is_completed | boolean | Completion status |
| completed_at | timestamp | When completed |
| completed_by | varchar(255) | Who completed |

#### activity_logs (Notes and actions on POs/SKUs)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| entity_type | varchar(20) | 'po' or 'sku' |
| entity_id | varchar(64) | PO number or SKU code |
| log_type | varchar(20) | 'action' or 'update' |
| description | text | Log content |
| due_date | timestamp | Due date for actions |
| completion_date | timestamp | When completed |
| is_completed | boolean | Completion status |
| created_by | varchar(255) | Creator |
| created_at | timestamp | Creation time |

### COLOR PANEL TABLES

#### color_panels (Master color panel tracking)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| vendor_id | integer | FK to vendors.id |
| merchandiser_id | integer | FK to staff.id |
| brand | varchar(64) | Merchandiser brand code |
| vendor_name | varchar(255) | Vendor short name |
| collection | varchar(255) | Collection name |
| sku_description | text | Description |
| material | text | Material info |
| finish_name | varchar(255) | Finish name |
| sheen_level | varchar(50) | Sheen level |
| finish_system | varchar(50) | NC, WB, PU |
| paint_supplier | varchar(255) | Paint supplier |
| validity_months | integer | 6 or 12 months |
| current_mcp_number | varchar(64) | Current active MCP# |
| current_approval_date | timestamp | Approval date |
| current_expiration_date | timestamp | Expiration date |
| status | varchar(50) | active, expiring, expired |

### REFERENCE DATA

#### skus (SKU master)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| sku | varchar(64) | Unique SKU code |
| style | varchar(64) | Style code |
| description | text | Description |
| category | varchar(255) | Category |
| product_group | varchar(255) | Product group |
| season | varchar(64) | Season |
| is_new | boolean | New SKU flag |
| unit_price | integer | Price in CENTS |
| status | varchar(20) | active, discontinued |
| discontinued_at | timestamp | When discontinued |
| discontinued_reason | varchar(255) | Reason for discontinuation |

#### clients (Client companies)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| name | varchar(255) | Client name |
| code | varchar(50) | Short code (CB, CB2, etc.) |
| region | varchar(100) | Region |
| country | varchar(100) | Country |
| status | varchar(50) | active/inactive |

#### import_history (File import tracking)
| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key |
| file_name | varchar(255) | Uploaded filename |
| file_type | varchar(50) | OS340, OS630, OS650, FURNITURE, SS551 |
| records_imported | integer | Row count |
| imported_by | varchar(255) | User who imported |
| status | varchar(50) | success, error |
| error_message | text | Error details if failed |
| created_at | timestamp | Import timestamp |

### KEY BUSINESS RULES

1. **OTD (On-Time Delivery) Calculation:**
   - Uses delivery_to_consolidator from shipments
   - Excludes franchise POs (po_number LIKE '089%')
   - Excludes 8X8 programs (program_description LIKE '8X8 %')
   - Excludes zero-value orders
   - Excludes samples
   - CLIENT or FORWARDER revisions count as on-time

2. **Late PO Definition:**
   - Past revised_cancel_date (or original_cancel_date if no revision)
   - Not shipped (shipment_status != 'Shipped')

3. **At-Risk PO Indicators:**
   - Failed final inspection
   - Inline inspection not booked ≤14 days to HOD
   - Final inspection not booked ≤7 days to HOD
   - PTS not submitted ≤30 days to HOD
   - No delivery_to_consolidator or actual_sailing_date recorded

4. **YTD Revenue Recognition:**
   - Uses shipped_value from po_headers
   - Revenue recognized at MIN(actual_sailing_date) from shipments
   - Prevents double-counting split shipments

5. **Projection Matching:**
   - SKU-level match first, then collection-level for SPO
   - Regular orders: 90-day order window
   - SPO/MTO orders: 30-day order window

### COMMON QUERY PATTERNS

**Active POs (current year, not cancelled):**
\`\`\`sql
SELECT * FROM po_headers 
WHERE EXTRACT(YEAR FROM po_date) = EXTRACT(YEAR FROM CURRENT_DATE)
AND status != 'Cancelled'
AND po_number NOT LIKE '089%'
\`\`\`

**Vendor OTD Calculation:**
\`\`\`sql
SELECT 
  vendor,
  COUNT(*) as total_shipped,
  COUNT(CASE WHEN s.delivery_to_consolidator <= COALESCE(h.revised_cancel_date, h.original_cancel_date) THEN 1 END) as on_time,
  ROUND(COUNT(CASE WHEN s.delivery_to_consolidator <= COALESCE(h.revised_cancel_date, h.original_cancel_date) THEN 1 END)::numeric * 100 / NULLIF(COUNT(*), 0), 1) as otd_pct
FROM po_headers h
JOIN shipments s ON h.po_number = s.po_number
WHERE s.delivery_to_consolidator IS NOT NULL
AND h.total_value > 0
AND h.po_number NOT LIKE '089%'
GROUP BY vendor
\`\`\`

**Monthly Shipment Value:**
\`\`\`sql
SELECT 
  DATE_TRUNC('month', s.actual_sailing_date) as month,
  SUM(h.shipped_value) / 100 as shipped_usd
FROM po_headers h
JOIN shipments s ON h.po_number = s.po_number
WHERE s.actual_sailing_date IS NOT NULL
GROUP BY DATE_TRUNC('month', s.actual_sailing_date)
ORDER BY month
\`\`\`

### NOTES
- All monetary values in CENTS (divide by 100 for USD)
- Timestamps stored as UTC
- Use COALESCE for nullable date fields
- Always exclude franchise (089%) and samples in OTD queries
`;
