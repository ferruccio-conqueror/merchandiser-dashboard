# Merchandising ERP System

## Overview
This ERP system is a full-stack web application designed to streamline merchandising operations by efficiently managing purchase orders, vendor relationships, and shipment timelines. It aims to maximize efficiency, clarity, and consistency in tracking on-time delivery (OTD) metrics, vendor performance, and operational KPIs for over 5,000 annual purchase orders. The system provides dashboard analytics, comprehensive PO management, performance tracking, and multi-format data import, offering data-driven insights to enhance supply chain performance and improve vendor accountability. The business vision is to improve vendor accountability, optimize supply chain efficiency, and leverage data for strategic decision-making in merchandising.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
The system is a full-stack web application. The frontend uses React 18, TypeScript, and Vite, styled with `shadcn/ui` based on Radix UI and Tailwind CSS, adhering to Carbon Design System principles with IBM Plex Sans/Mono typography, supporting light/dark modes. The UI/UX emphasizes a "data-first" approach for high information density, consistent patterns, and minimal clicks.

Key frontend features include:
- **Dashboard & Reporting:** Displays 16-KPI header, Late & At-Risk POs, Quality & Compliance Dashboard, Staff Performance KPIs, To-Do List, and PO Timeline Tracking.
- **Management Modules:** Vendor Management, Master Color Panel Management, and PO Tasks.
- **Data & AI:** Multi-Format Data Import (OS 340, 630, 650, FURNITURE Excel files), AI Data Analyst with historical context, and advanced AI Analytics Endpoints.
- **Shipment Tracking:** Detailed shipment cards and a dedicated Shipments Page.
- **Workload Balancing:** Role-specific workload assessments.
- **Projections Dashboard:** Tracks forecast accuracy and trends with V2 charts.
- **Dashboard Filters:** Comprehensive filtering by Merchandiser, Merchandising Manager, Vendor, Brand, and Client.

The backend is built with Node.js, Express.js, and TypeScript, exposing RESTful API endpoints. It features parallelized KPI queries, robust Excel import handling with a full-replace strategy for data consistency, and Express middleware. A data layer uses a storage abstraction pattern for CRUD operations.

The database uses PostgreSQL (Neon serverless) with Drizzle ORM and Drizzle Kit for migrations. The schema includes tables for users, purchase orders, vendors, SKUs, shipments, staff, inspections, quality tests, color panels, activity logs, and import history, validated with Zod schemas.

**Key Data Structures and Logic:**
- **PO Data:** Structured across `po_headers`, `po_line_items`, and `shipments`.
- **Data Import Strategy:**
    - `OS340`: Full-replace for `po_headers`, `po_line_items`; upsert for `shipments`; creates `vendors`.
    - `OS650`: Enrichment-only for existing `shipments` (logistics data).
    - `OS630`: Upsert for `inspections` and `quality_tests`.
    - `FURNITURE`: Two-phase insert for `active_projections` and `projection_snapshots`.
- **Import Verification:** All import endpoints include pre/post verification with detailed tracking in `import_history`.
- **Vendor Capacity:** Historic data is protected; Capacity Tracker uses a hybrid approach from Orders on Hand, Projections, and Reserved Capacity.
- **Projection Expiration:** Projections that miss their order window are automatically marked as expired.
- **V2 Data Architecture:** `projection_snapshots` (immutable archive) and `active_projections` (working table). All monetary values are stored in cents.
- **Shipment Date Fields:** `actual_sailing_date` (OS340 BM), `estimated_vessel_etd` (OS650 AD), and `delivery_to_consolidator` (OS340 BH) are used for various KPIs and charts.
- **OTD Metrics:** Both Revised and Original OTD % are calculated based on shipped POs, excluding Client/Forwarder delays and specific PO types (franchise, sample, 8X8, zero-value), using `delivery_to_consolidator` for on-time determination and grouped by ship year.
- **"Late" and "At Risk" Logic:** Consistent definitions applied system-wide, with "At Risk" based on failed inspections, unbooked inspections, or unpassed QA tests within specific timeframes.
- **Point-in-Time YoY Comparisons:** All year-over-year comparisons use point-in-time logic for fair comparison.
- **Exclusions:** Sample POs, 8X8 POs, zero-value POs, and zero-value line items are generally excluded from KPI calculations.
- **Vendor Name Resolution:** Uses a canonical `vendors` table and `vendor_capacity_aliases` for variant names.

## External Dependencies

### Core Infrastructure
- **Neon Database:** Serverless PostgreSQL database.
- **Replit:** Development and hosting platform.

### Frontend Libraries
- **@tanstack/react-query:** Server state management.
- **wouter:** Client-side routing.
- **recharts:** Chart visualization.
- **date-fns:** Date manipulation.
- **papaparse:** CSV parsing.
- **lucide-react:** Icon system.
- **@radix-ui/:** Primitive UI components.

### Backend Libraries
- **drizzle-orm:** Type-safe ORM.
- **express:** Web framework.
- **multer:** File upload handling.
- **ws:** WebSocket library.
- **zod:** Schema validation.
- **nanoid:** Unique ID generation.

### Build Tools
- **Vite:** Frontend build tool.
- **esbuild:** Backend bundling.
- **TypeScript:** Type checking.
- **Tailwind CSS:** CSS framework.

### Development Tools
- **tsx:** TypeScript execution.
- **drizzle-kit:** Database migration.
- **@replit/vite-plugin-***: Replit-specific development plugins.