# Merchandising ERP System - User Guide

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard](#dashboard)
3. [To-Do List](#to-do-list)
4. [Purchase Orders](#purchase-orders)
5. [PO Details & Timeline](#po-details--timeline)
6. [Vendors](#vendors)
7. [SKUs (Products)](#skus-products)
8. [Shipments](#shipments)
9. [Color Panels](#color-panels)
10. [Quality & Compliance](#quality--compliance)
11. [Data Import](#data-import)
12. [AI Data Analyst](#ai-data-analyst)`
13. [Staff Management](#staff-management)
14. [User Roles & Access](#user-roles--access)
15. [Tips & Best Practices](#tips--best-practices)

---

## Getting Started

### Logging In

1. Open the application in your web browser
2. Enter your email address (the one assigned by your administrator)
3. If this is your first time logging in, click **"Set up your password"**
4. Create a secure password (minimum 6 characters)
5. Once set up, use your email and password to log in

### Navigation

The application has a sidebar menu on the left side with the following sections:

- **Dashboard** - Overview of key performance metrics
- **To-Do List** - Your pending tasks and action items
- **Quality & Compliance** - Inspection and quality test reports
- **Purchase Orders** - All PO records
- **SKUs** - Product catalog
- **Shipments** - Shipping and logistics tracking
- **Vendors** - Vendor information and performance
- **Color Panels** - Wood finish specifications
- **Data Import** - Upload Excel files
- **Staff** - Team member directory (admin only)
- **AI Analyst** - Chat with AI for data insights

### Switching Between Light and Dark Mode

Click the sun/moon icon in the top right corner to switch between light and dark display modes.

---

## Dashboard

The Dashboard is your home page and shows real-time performance metrics for the current year.

### The 8 Key Performance Indicators (KPIs)

The dashboard displays 8 important metrics in a grid:

| KPI | What It Measures | Target |
|-----|------------------|--------|
| **YTD Total Sales** | Total dollar value of shipped orders this year | For reference |
| **Total POs** | Number of purchase orders placed this year | For reference |
| **Revised OTD %** | On-time delivery rate (considers revised dates) | 95%+ is green |
| **Original OTD %** | On-time delivery rate (based on original dates) | 90%+ is green |
| **Late POs** | Number of overdue purchase orders | Lower is better |
| **At-Risk POs** | POs that may become late soon | Lower is better |
| **Avg Late Days** | Average number of days late for delayed orders | Lower is better |
| **First-Time Pass Rate** | Quality inspection pass rate on first attempt | 95%+ is green |

### Understanding OTD (On-Time Delivery)

- **Revised OTD %** = On-Time Shipped ÷ (Total Shipped + Overdue Unshipped)
  - This is the most accurate measure because it accounts for date changes
  - Uses the revised cancel date if one exists, otherwise the original date
  
- **Original OTD %** = On-Time Shipped ÷ Total Shipped
  - Compares against original dates only
  - Useful for measuring vendor adherence to initial commitments

### Color Coding

- **Green**: Meeting or exceeding targets
- **Yellow/Orange**: Approaching concern levels
- **Red**: Needs immediate attention

### Late & At-Risk Purchase Orders Table

Below the KPIs, you'll see a table showing:

- **Late POs**: Orders past their cancel date that haven't shipped
- **At-Risk POs**: Orders shipping within the next 14 days

Use the search bar to find specific POs, and click any row to view full details.

---

## To-Do List

### Overview

The To-Do List is your central hub for tracking tasks and action items across all your purchase orders. It aggregates tasks from multiple sources so you never miss important deadlines.

### Types of Tasks

Tasks come from three sources:

1. **Auto-Generated Tasks**: System creates tasks based on:
   - Upcoming inspection deadlines
   - Expiring quality certifications
   - POs approaching cancel dates
   - Required compliance actions

2. **Manual Tasks**: Tasks you or your team create on specific POs

3. **Action Items**: Notes marked as "action required" from PO activity logs

### Task Priority Colors

| Color | Priority | Meaning |
|-------|----------|---------|
| **Red** | High | Urgent - requires immediate attention |
| **Orange** | Medium | Important - address soon |
| **Blue/Gray** | Normal | Standard priority |

### Managing Tasks

**Viewing Tasks:**

1. Click **To-Do List** in the sidebar
2. See all your pending tasks organized by priority
3. Use filters to show specific task types

**Completing Tasks:**

1. Click on a task to view details
2. Take the required action
3. Click the checkbox or "Complete" button
4. The task moves to completed status

**Creating Manual Tasks:**

1. Go to a specific PO's detail page
2. Navigate to the Tasks section
3. Click "Add Task"
4. Enter description, due date, and priority
5. Save the task

### Tips

- Check your To-Do List first thing each morning
- Complete high-priority (red) tasks before starting other work
- Link tasks to specific POs for better tracking

---

## Purchase Orders

### Viewing Purchase Orders

1. Click **Purchase Orders** in the sidebar
2. Browse the list of all POs
3. Use filters to narrow down:
   - Search by PO number, vendor, or SKU
   - Filter by status, client, or date range
   - Sort by any column

### PO Status Meanings

| Status | Description |
|--------|-------------|
| **Open** | Order is active and in progress |
| **On-Time** | Order shipped on or before the cancel date |
| **Late** | Order shipped after the cancel date |
| **At-Risk** | Order is approaching its cancel date |
| **Pending** | Order is awaiting shipment |

### PO Detail Page

Click any PO to see:

- **Header Information**: PO number, vendor, dates, values
- **Line Items**: All SKUs included in this PO with quantities and prices
- **Shipments**: Shipping records and logistics data
- **Timeline**: Production milestones and progress
- **Tasks**: Action items related to this PO
- **Notes & Activity**: Comments and historical notes

### Key Dates to Watch

- **PO Date**: When the order was placed
- **Original Ship Date**: Initial expected ship date from vendor
- **Original Cancel Date**: Must-ship-by date (original commitment)
- **Revised Ship Date**: Updated ship date (if changed)
- **Revised Cancel Date**: Updated cancel date (if extended)

---

## PO Details & Timeline

### Production Timeline

Each PO has a timeline showing production milestones. This helps track progress from order placement to shipment.

**Standard Milestones:**

| Milestone | Description |
|-----------|-------------|
| **PO Confirmed** | Vendor acknowledges the order |
| **Materials Ordered** | Raw materials purchased |
| **Production Start** | Manufacturing begins |
| **Inline Inspection** | Mid-production quality check |
| **Production Complete** | Manufacturing finished |
| **Final Inspection** | Pre-shipment quality check |
| **Cargo Ready** | Goods ready for pickup |
| **Shipped** | Left the factory |
| **On Water** | In transit by sea |
| **Delivered** | Arrived at destination |

**Date Types for Each Milestone:**

- **Planned Date**: Original target date
- **Revised Date**: Updated date (if timeline changed)
- **Actual Date**: When milestone was actually completed

### Activity Log & Notes

The Activity Log tracks all notes and communications related to a PO.

**Adding Notes:**

1. Go to the PO detail page
2. Scroll to the Activity section
3. Type your note in the text box
4. Click "Add Note"

**Action Items:**

- Check "Mark as Action Item" when adding a note that requires follow-up
- Action items appear in your To-Do List
- Mark as complete when done

**AI Email Summary:**

- Click the "Summarize" button to get an AI-generated summary
- The AI reviews all notes and provides key points
- Useful for quickly catching up on PO history

### Tasks Panel

PO-specific tasks appear in a dedicated panel:

- View all tasks related to this PO
- Add new tasks directly
- Mark tasks complete
- See auto-generated tasks from compliance/inspection requirements

---

## Vendors

### Vendor List

1. Click **Vendors** in the sidebar
2. See all vendors with summary statistics
3. Search by vendor name or filter by performance

### Vendor Detail Page

Click any vendor to see:

- **Contact Information**: Address, phone, primary contacts
- **Performance Metrics**: OTD rates, quality scores, average late days
- **Active POs**: Current open orders with this vendor
- **Historical Performance**: Trends over time
- **Staff Assignment**: Which merchandisers work with this vendor

### Vendor Performance Indicators

- **Revised OTD %**: Percentage of orders delivered on time (using revised dates)
- **Quality Score**: Based on inspection pass rates
- **Average Late Days**: How many days late when orders miss deadlines

---

## SKUs (Products)

### Browsing Products

1. Click **SKUs** in the sidebar
2. View the product catalog
3. Search by SKU number, style, or description

### SKU Detail Page

Each SKU shows:

- **Product Details**: SKU number, style, description, category
- **Current Orders**: Active POs containing this SKU
- **Shipment History**: Past shipments of this product
- **Quality Records**: Inspection and test results
- **Color Panel**: Associated wood finish specifications (if applicable)

---

## Shipments

### Shipment List

1. Click **Shipments** in the sidebar
2. View all shipment records
3. Filter by:
   - Status (In Transit, Delivered, etc.)
   - Cargo Ready Date
   - Vessel name
   - PO number

### Shipment Status Colors

| Color | Status |
|-------|--------|
| **Blue** | In Transit / On Water |
| **Green** | Delivered / On-Time |
| **Red** | Late / Delayed |
| **Gray** | Pending / Not Yet Shipped |

### Shipment Details

Each shipment card shows:

- **PO Number**: Which order this shipment belongs to
- **Style/SKU**: What products are included
- **Quantity Shipped**: How many units
- **Cargo Ready Date**: When goods were ready at origin
- **Vessel Information**: Ship name and voyage details
- **PTS (Port to Store)**: Tracking status from port to final destination

---

## Color Panels

### What Are Color Panels?

Color Panels track wood finish specifications and color standards for furniture products. Each panel documents the approved finish that must be matched during production.

### Viewing Color Panels

1. Click **Color Panels** in the sidebar
2. Browse the list of all color specifications
3. Search by panel name, color code, or associated SKUs

### Color Panel Information

Each panel includes:

- **Panel Name/Code**: Unique identifier for the finish
- **Color Description**: What the finish looks like
- **Wood Type**: What type of wood this finish applies to
- **Associated SKUs**: Products that use this finish
- **Approval Status**: Whether the panel is approved for production
- **Last Updated**: When specifications were last revised

### Importing Color Panels

Color panel specifications can be imported from PDF documents:

1. Go to Color Panels
2. Click "Import PDF"
3. Select your specification document
4. Review the extracted information
5. Confirm to add to the system

### Linking SKUs to Color Panels

When viewing a SKU, you can see which color panel it's associated with. This ensures the correct finish is applied during production.

---

## Quality & Compliance

### Overview

The Quality & Compliance section has two main reports:

1. **Inspection Status Report**: Tracks physical product inspections
2. **Quality Test Status Report**: Tracks lab tests and certifications

### Inspection Status Report

Shows inspections that need attention:

- **Pending Inspections**: Not yet completed
- **Late Inspections**: Past the deadline
  - Final inspections: Late if more than 5 days before ship date
  - Inline inspections: Late if more than 8 days before ship date

### Quality Test Status Report

Tracks lab testing and compliance:

- **Pending Tests**: Awaiting results
- **Expiring Certifications**: Tests that will expire soon
- **Failed Tests**: Products that didn't pass testing

### Status Indicators

| Status | Meaning |
|--------|---------|
| **Passed** | Inspection/test completed successfully |
| **Failed** | Did not meet requirements |
| **Pending** | Waiting for completion |
| **Late** | Past the required deadline |
| **Expiring** | Certification expires within 30 days |

---

## Data Import

### Supported File Types

The system accepts three types of Excel files from your data sources:

| File Type | Contains | Updates |
|-----------|----------|---------|
| **OS340** | Purchase Orders & SKUs | PO headers, line items, order details |
| **OS630** | Quality & Compliance | Inspections, quality tests, compliance data |
| **OS650** | Shipments | Shipping records, logistics, vessel info |

### How to Import Data

1. Click **Data Import** in the sidebar
2. Click **Upload File** or drag and drop your Excel file
3. The system automatically detects the file type
4. Review the preview to confirm the data looks correct
5. Click **Import** to process the file
6. Wait for the confirmation message

### Import Tips

- Always use the most recent export from your data source
- The system will update existing records and add new ones
- User-added notes and tasks are preserved during imports
- Data is kept for 3 years (current year + last 2 years)

### What Happens During Import

**OS340 Import:**

- Creates/updates PO header records
- Creates/updates individual line items (SKUs within each PO)
- Preserves any notes or tasks you've added

**OS630 Import:**

- Updates inspection records
- Updates quality test records
- Updates compliance status data

**OS650 Import:**

- Updates shipment records
- Links shipments to existing POs by PO number
- Updates logistics status and vessel information

---

## AI Data Analyst

### What It Does

The AI Data Analyst can answer questions about your data in plain English. It has access to all your POs, shipments, vendors, and quality data.

### How to Use It

1. Click **AI Analyst** in the sidebar (or use the chat panel)
2. Type your question in everyday language
3. Press Enter or click Send
4. The AI will analyze your data and respond

### Example Questions

**Performance Questions:**

- "Which vendors have the worst on-time delivery this year?"
- "What's our OTD trend over the last 6 months?"
- "How many POs are currently at risk?"

**Order Questions:**

- "Show me all late POs for Vendor ABC"
- "What's the total value of open orders?"
- "Which POs are due to ship next week?"

**Quality Questions:**

- "What's our first-time pass rate by vendor?"
- "Which products have failed inspections recently?"
- "Are there any expiring certifications I should know about?"

**Trend Analysis:**

- "Compare Q1 vs Q2 performance"
- "What's causing our late deliveries?"
- "Which categories have quality issues?"

### Tips for Best Results

- Be specific about what you want to know
- Include time frames when relevant ("this month", "YTD", "last quarter")
- Ask follow-up questions to dig deeper
- The AI can create summaries and recommendations

---

## Staff Management

*Note: This section is for administrators only.*

### Viewing Staff Members

1. Click **Staff** in the sidebar
2. See a list of all team members
3. View their role, email, and status

### Staff Information

Each staff profile shows:

- **Name**: Full name
- **Email**: Login email address
- **Role**: Their access level (Admin, Manager, Merchandiser)
- **Title**: Job title
- **Department**: Team or department
- **Status**: Active or inactive

### Staff Performance (Managers & Admins)

Administrators and managers can view individual performance metrics:

- **Active POs**: Number of open orders assigned
- **At-Risk POs**: Orders approaching deadlines
- **Revised OTD %**: Personal on-time delivery rate
- **Goals**: Personal performance targets

### Adding New Staff

1. Click "Add Staff" button
2. Enter the person's details:
   - Name
   - Email address
   - Role (determines access level)
   - Title
3. Save the new staff member
4. They will set up their password on first login

### Editing Staff

1. Click on a staff member's name
2. Update their information
3. Save changes

### Resetting Passwords

Administrators can reset staff passwords if someone forgets theirs or needs a fresh start:

1. Go to Staff page
2. Select the staff member
3. Click "Reset Password"
4. The staff member will set a new password on next login

---

## User Roles & Access

### Role Types

| Role | Access Level | Description |
|------|--------------|-------------|
| **Admin** | Full | Can access all data, manage staff, import data |
| **General Merchandising Manager** | Full | Can view all orders and performance data |
| **Merchandising Manager** | Team | Can see orders for their team members |
| **Merchandiser** | Personal | Can see their own assigned orders |

### What Each Role Can Do

**Admins:**

- View all data across the organization
- Add/edit staff members
- Import data files
- Access all reports and analytics

**General Merchandising Manager:**

- View all POs, vendors, and performance metrics
- Access all team members' data
- Run reports across the organization

**Merchandising Managers:**

- View POs assigned to their team
- See performance for their direct reports
- Access quality and shipment data for their orders

**Merchandisers:**

- View their own assigned POs
- Update notes and tasks on their orders
- Access quality data for their products

---

## Tips & Best Practices

### Daily Workflow

1. **Start with the Dashboard** - Check KPIs and any new late/at-risk POs
2. **Review your To-Do List** - Address pending tasks
3. **Check Quality Alerts** - Look for failed inspections or expiring tests
4. **Update Notes** - Document any important communications or decisions

### Weekly Tasks

- Review vendor performance trends
- Import latest data files (OS340, OS630, OS650)
- Check upcoming shipment deadlines
- Follow up on at-risk orders

### Best Practices

**For Accurate Data:**

- Import data regularly (at least weekly)
- Keep notes updated with latest information
- Report any data discrepancies to admin

**For Performance Tracking:**

- Focus on Revised OTD % as the primary metric
- Investigate vendors with consistently low scores
- Address at-risk POs before they become late

**For Quality Management:**

- Schedule inspections early (8+ days before ship for inline)
- Track first-time pass rates by vendor
- Monitor expiring certifications proactively

---

## Glossary

| Term | Definition |
|------|------------|
| **PO** | Purchase Order - A formal order placed with a vendor |
| **SKU** | Stock Keeping Unit - A unique product identifier |
| **OTD** | On-Time Delivery - Percentage of orders shipped on time |
| **Cancel Date** | The deadline by which an order must ship |
| **Cargo Ready Date** | When goods are ready for pickup at origin |
| **PTS** | Port to Store - Tracking from arrival port to final destination |
| **Inline Inspection** | Quality check during production |
| **Final Inspection** | Quality check before shipping |
| **First-Time Pass** | Passing inspection on the first attempt |
| **YTD** | Year to Date - From January 1 to today |

---

## Getting Help

If you encounter issues or have questions:

1. Check this user guide first
2. Ask the AI Data Analyst for help with data questions
3. Contact your administrator for access or technical issues

---

*Last Updated: January 2026*
