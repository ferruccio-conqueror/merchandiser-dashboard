# Operations Dashboard - Calculation Reference

This document lists every metric and calculation on the Operations Dashboard for verification purposes.

---

## HEADER KPIs (Top Banner - 4 Cards)

### 1. YTD SKUs Ordered
| Property | Details |
|----------|---------|
| **Widget** | Header KPI Card - Position 1 |
| **Formula** | `COUNT(DISTINCT sku)` where ordered YTD |
| **Data Source** | `purchase_orders.sku` |
| **Filters Applied** | Vendor, Merchandiser, Merchandising Manager |
| **Date Range** | Current: Jan 1 → Today; Previous: Jan 1 (prev year) → Same date (prev year) |
| **Exclusions** | - Zero-value orders (`total_value = 0`) |
| | - Samples (`program_description LIKE 'SMP %'`) |
| | - Swatches (`program_description LIKE '8X8 %'`) |
| **YoY Comparison** | Compares current YTD SKU count vs same period last year |
| **Notes** | Counts unique SKU codes ordered YTD (any status, not just shipped) |

---

### 2. New SKUs YTD
| Property | Details |
|----------|---------|
| **Widget** | Header KPI Card - Position 2 |
| **Formula** | `COUNT(DISTINCT sku)` where first ordered in current year |
| **Data Source** | `purchase_orders.sku` |
| **Filters Applied** | Vendor, Merchandiser, Merchandising Manager |
| **Date Range** | Current: Jan 1 → Today |
| **New SKU Definition** | SKUs that have NO orders dated before Jan 1 of current year |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |
| **YoY Comparison** | Compares new SKUs introduced in current year vs previous year |
| **Notes** | Tracks SKU introduction rate - useful for product development metrics |

---

### 3. YTD Total Sales
| Property | Details |
|----------|---------|
| **Widget** | Header KPI Card - Position 3 |
| **Formula** | `SUM(total_value)` where shipped |
| **Data Source** | `purchase_orders.total_value` |
| **Filters Applied** | Vendor, Merchandiser, Merchandising Manager |
| **Date Range** | Current: Jan 1 → Today; Previous: Jan 1 (prev year) → Same date (prev year) |
| **Shipped Status** | `shipment_status IN ('On-Time', 'Late')` (from OS 340) |
| **Client Filter** | `client = 'Euromarket Designs, Inc.'` (Crate & Barrel only) |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |
| **Currency** | USD (whole dollars, no conversion) |
| **Notes** | Only counts value from orders that have actually shipped |

---

### 4. YTD Shipped Orders
| Property | Details |
|----------|---------|
| **Widget** | Header KPI Card - Position 4 |
| **Formula** | `COUNT(DISTINCT po_number)` where shipped |
| **Data Source** | `purchase_orders.po_number` |
| **Filters Applied** | Vendor, Merchandiser, Merchandising Manager |
| **Date Range** | Current: Jan 1 → Today; Previous: Jan 1 (prev year) → Same date (prev year) |
| **Shipped Status** | `shipment_status IN ('On-Time', 'Late')` (from OS 340) |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |
| **Notes** | Counts unique PO numbers that have shipped (not rows, since each PO can have multiple SKUs) |

---

## GRID KPIs (8-Card Performance Grid)

### 5. True OTD (On-Time Delivery)
| Property | Details |
|----------|---------|
| **Widget** | KPI Grid - Card 1 |
| **Formula** | `On-Time Shipped ÷ (Total Shipped + Overdue Unshipped) × 100` |
| **On-Time Shipped** | Orders where `shipment_status = 'On-Time'` (from OS 340) |
| **Total Shipped** | Orders where `shipment_status IN ('On-Time', 'Late')` |
| **Overdue Unshipped** | Orders where: |
| | - `revised_cancel_date < TODAY` |
| | - No 'On-Time' or 'Late' shipment_status |
| | - Status NOT IN ('CLOSED', 'CANCELLED') |
| **Date Scope** | YTD (Jan 1 current year → Today) |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |
| **Display** | Percentage with 1 decimal (e.g., 85.3%) |

---

### 5. OTD Original
| Property | Details |
|----------|---------|
| **Widget** | KPI Grid - Card 2 |
| **Formula** | `On-Time to Original ÷ Total with Original Date × 100` |
| **On-Time Condition** | `shipment_status = 'On-Time'` OR `original_ship_date >= original_cancel_date` |
| **Data Source** | `purchase_orders.original_cancel_date`, `original_ship_date` |
| **Date Scope** | YTD (Jan 1 current year → Today) |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |
| **Notes** | Measures against ORIGINAL dates, not revised dates |

---

### 6. Quality (First-Time Pass Rate)
| Property | Details |
|----------|---------|
| **Widget** | KPI Grid - Card 3 |
| **Formula** | `Passed Inspections ÷ Total Inspections × 100` |
| **Passed Condition** | `result LIKE '%pass%'` (case-insensitive) |
| **Data Source** | `inspections` table |
| **Scope** | All inspections (no date filter currently) |
| **Display** | Percentage with 1 decimal |

---

### 7. Avg Late Days
| Property | Details |
|----------|---------|
| **Widget** | KPI Grid - Card 4 |
| **Formula** | `AVG(CURRENT_DATE - revised_cancel_date)` for late orders |
| **Late Order Definition** | Orders where: |
| | - `revised_cancel_date < TODAY` |
| | - NOT delivered on-time via shipments table |
| | - Status NOT IN ('CLOSED', 'SHIPPED') |
| **On-Time Delivery Check** | Excluded if: |
| | - `hod_status = 'SHIPPED'` OR |
| | - `delivery_to_consolidator <= revised_cancel_date` |
| **Date Scope** | YTD (po_date >= Jan 1 current year) |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |
| **Display** | Integer days (e.g., "12d") |

---

### 8. 1st MTO (First-Time Made-To-Order Lead Time)
| Property | Details |
|----------|---------|
| **Widget** | KPI Grid - Card 5 |
| **Formula** | `AVG(original_ship_date - po_date)` |
| **Order Classification** | `seller_style ILIKE '%MTO%'` = Made-To-Order |
| **First-Time Condition** | `new_style = 'Y'` |
| **Data Source** | `purchase_orders.po_date`, `original_ship_date`, `new_style`, `seller_style` |
| **Date Scope** | YTD (po_date >= Jan 1 current year) |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |
| | - Orders where `original_ship_date <= po_date` |
| **Display** | Integer days (e.g., "45d") with order count in parentheses |

---

### 9. 1st Regular (First-Time Regular Order Lead Time)
| Property | Details |
|----------|---------|
| **Widget** | KPI Grid - Card 6 |
| **Formula** | `AVG(original_ship_date - po_date)` |
| **Order Classification** | `seller_style NOT ILIKE '%MTO%'` = Regular |
| **First-Time Condition** | `new_style = 'Y'` |
| **Display** | Integer days with order count |

---

### 10. Repeat MTO (Repeat Made-To-Order Lead Time)
| Property | Details |
|----------|---------|
| **Widget** | KPI Grid - Card 7 |
| **Formula** | `AVG(original_ship_date - po_date)` |
| **Order Classification** | `seller_style ILIKE '%MTO%'` |
| **Repeat Condition** | `new_style != 'Y'` (or NULL) |
| **Display** | Integer days with order count |

---

### 11. Repeat Regular (Repeat Regular Order Lead Time)
| Property | Details |
|----------|---------|
| **Widget** | KPI Grid - Card 8 |
| **Formula** | `AVG(original_ship_date - po_date)` |
| **Order Classification** | `seller_style NOT ILIKE '%MTO%'` |
| **Repeat Condition** | `new_style != 'Y'` (or NULL) |
| **Display** | Integer days with order count |

---

## CHARTS

### 12. True OTD Performance (Line Chart - Monthly YoY)
| Property | Details |
|----------|---------|
| **Widget** | Line chart with 2 lines (current year, previous year) |
| **Y-Axis** | True OTD Percentage (0-100%) |
| **X-Axis** | Months (Jan-Dec) |
| **Formula Per Month** | `Shipped On-Time ÷ (Total Shipped + Overdue Unshipped) × 100` |
| **Grouping** | By `revised_cancel_date` month (when orders were DUE) |
| **Shipped Status** | From OS 340 `shipment_status` field |
| **On-Time** | `shipment_status = 'On-Time'` |
| **Late** | `shipment_status = 'Late'` |
| **Overdue Unshipped** | Past cancel date, no shipment status, not CLOSED/CANCELLED |
| **Years Displayed** | Current year + Previous year |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |
| **Legend** | Shows YTD average for each year + YoY % change |

---

### 13. PO Count by OTD Status (Bar Chart)
| Property | Details |
|----------|---------|
| **Widget** | Stacked/grouped bar chart |
| **Categories** | On Time, At Risk, Late |
| **On Time Count** | Active POs where `revised_cancel_date >= TODAY` |
| **Late Count** | Active POs where `revised_cancel_date < TODAY` |
| **At Risk Count** | Active POs meeting ANY of these criteria: |
| | 1. Failed Final Inspection (`result IN ('Failed', 'Failed - Critical Failure')`) |
| | 2. Final Inspection outside HOD/CRD window |
| | 3. Quality test pending >45 days (`result IS NULL AND report_date < TODAY - 45`) |
| **"Active" Definition** | Not CLOSED, not SHIPPED, no on-time delivery record |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |

---

### 14. Vendor Late & At-Risk Shipments (Horizontal Bar Chart)
| Property | Details |
|----------|---------|
| **Widget** | Horizontal bar chart (top 8 vendors) |
| **Bars** | Late count (red), At Risk count (orange) per vendor |
| **Late Definition** | Same as Late Count above |
| **At Risk Definition** | Same 4 criteria as At Risk Count above |
| **Sorting** | By total (Late + At Risk) descending |
| **Limit** | Top 8 vendors |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |

---

### 15. Currently Late Orders by Severity (Pie Chart + Table)
| Property | Details |
|----------|---------|
| **Widget** | Donut/pie chart + detail table |
| **Buckets** | 1-7 days late, 8-14 days late, 15-30 days late, 30+ days late |
| **Formula** | `CURRENT_DATE - revised_cancel_date` for each late order |
| **Late Order Definition** | - `revised_cancel_date < TODAY` |
| | - Status NOT IN ('CLOSED', 'SHIPPED', 'CANCELLED') |
| **Table Columns** | Severity, Count, Percentage, Avg Days Late |
| **Percentage** | Count in bucket ÷ Total late orders × 100 |
| **Avg Days Late** | Average of `days_late` within each bucket |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |

---

### 16. Currently Late Orders by Status (Pie Chart + Table)
| Property | Details |
|----------|---------|
| **Widget** | Donut/pie chart + detail table |
| **Grouping** | By `purchase_orders.status` field |
| **Late Order Definition** | Same as Severity chart above |
| **Table Columns** | Status, Count, Percentage, Avg Days Late |
| **Percentage** | Count per status ÷ Total late orders × 100 |
| **Sorting** | By count descending |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |

---

## DATA TABLE

### 17. Late & At-Risk Purchase Orders (Filterable Table)
| Property | Details |
|----------|---------|
| **Widget** | Full-width data table with search and export |
| **Columns** | PO Number, SKU, Vendor, Status, Risk Status, Days Late, Revised Cancel Date, etc. |
| **Row Criteria** | Orders that are LATE or AT RISK (per definitions above) |
| **Risk Status Values** | "Late", "At Risk", "Late & At Risk" |
| **Days Late Calculation** | `CURRENT_DATE - revised_cancel_date` |
| **Color Coding** | - Red: 30+ days late |
| | - Orange: 15-30 days late |
| | - Yellow: 8-14 days late |
| | - Default: 1-7 days late |
| **Search** | Filters by PO number, SKU, vendor name |
| **Export** | CSV download of filtered results |
| **Exclusions** | - Zero-value orders |
| | - Samples (SMP prefix) |
| | - Swatches (8X8 prefix) |

---

## GLOBAL EXCLUSION RULES

These exclusions apply to ALL calculations unless otherwise noted:

| Exclusion | Rule | Reason |
|-----------|------|--------|
| Zero-value orders | `total_value = 0` or `NULL` | Not real commercial orders |
| Samples | `program_description LIKE 'SMP %'` | Sample/prototype orders |
| Swatches | `program_description LIKE '8X8 %'` | Swatch/fabric sample orders |

---

## FILTER BEHAVIOR

When filters are applied (Merchandiser, Vendor, Date Range):

| KPI/Chart | Responds to Filters? |
|-----------|---------------------|
| Total SKUs | Yes |
| YTD Total Sales | Yes |
| YTD Total Orders | Yes |
| True OTD | Yes |
| OTD Original | Yes |
| Avg Late Days | Yes |
| Lead Time (1st MTO, etc.) | Yes |
| Quality Pass Rate | No (inspections table not filtered) |
| All Charts | Yes |
| Data Table | Yes |

---

## DATA SOURCE MAPPING

| Field | Source | Import File |
|-------|--------|-------------|
| `shipment_status` | OS 340 | Purchase Orders Excel |
| `total_value` | OS 340 | Purchase Orders Excel |
| `po_date`, `revised_cancel_date` | OS 340 | Purchase Orders Excel |
| `delivery_to_consolidator` | OS 650 | Shipment Logistics Excel |
| `hod_status` | OS 650 | Shipment Logistics Excel |
| `inspection_date`, `result` | OS 630 | Quality Inspections Excel |

---

*Last Updated: November 30, 2025*
