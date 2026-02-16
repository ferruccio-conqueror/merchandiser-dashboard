# Merchandising ERP Design Guidelines

## Design Approach
**Selected Approach:** Design System - Carbon Design System
**Justification:** This is a data-intensive enterprise application requiring maximum efficiency, clarity, and consistency for 12 operations team members managing 5,000+ annual POs. Carbon Design System excels at information-dense interfaces with strong data visualization and productivity-focused patterns.

**Core Principles:**
- Data First: Information accessibility and clarity above all else
- Efficiency: Minimize clicks and cognitive load for daily repetitive tasks
- Consistency: Predictable patterns aid muscle memory for frequent users
- Density: Maximize information display without overwhelming users

---

## Typography

**Font Family:** IBM Plex Sans (via Google Fonts CDN)
- Primary: 'IBM Plex Sans', system-ui, sans-serif
- Monospace (for data/SKUs): 'IBM Plex Mono', monospace

**Type Scale:**
- Page Headers: text-2xl (24px), font-semibold
- Section Headers: text-xl (20px), font-semibold  
- Card/Panel Titles: text-lg (18px), font-medium
- Body Text: text-base (16px), font-normal
- Data Labels: text-sm (14px), font-medium
- Metadata/Captions: text-xs (12px), font-normal
- Table Headers: text-sm (14px), font-semibold, uppercase tracking-wide

**Hierarchy Rules:**
- Dashboard KPIs: Large numerics (text-3xl/4xl) with small labels (text-xs)
- Data tables: Consistent text-sm throughout for scannability
- Forms: text-sm labels, text-base inputs

---

## Layout System

**Spacing Primitives:** Tailwind units of 1, 2, 3, 4, 6, 8, 12, 16
- Tight spacing: p-2, gap-2 (8px) - within components
- Standard spacing: p-4, gap-4 (16px) - between related elements
- Section spacing: p-6, gap-6 (24px) - between major sections
- Page spacing: p-8 (32px) - page containers

**Grid System:**
- Dashboard: grid-cols-1 md:grid-cols-2 xl:grid-cols-4 for KPI cards
- Data Tables: Full-width with horizontal scroll on mobile
- Filters Panel: Sticky left sidebar (w-64) on desktop, collapsible drawer on mobile
- Content Area: max-w-full with responsive padding (px-4 md:px-6 lg:px-8)

**Layout Structure:**
```
Top Navigation Bar (h-16)
└─ Logo, Navigation, User Menu

Main Content (min-h-screen)
├─ Sidebar Navigation (w-64, hidden on mobile)
│  └─ Dashboard, POs, Vendors, Timeline, Staff, Reports
└─ Content Area (flex-1)
   ├─ Page Header (mb-6)
   ├─ Filters/Actions Bar (mb-4)
   └─ Content Sections (space-y-6)
```

---

## Component Library

### Navigation
**Top Bar:**
- Fixed header with company logo left, main nav center, user profile right
- Height: h-16, horizontal padding: px-6
- Navigation items: hover underline, active state with subtle highlight

**Sidebar:**
- Sticky position, full viewport height
- Icon + label pattern for each nav item
- Active state: left border accent with background tint
- Collapsible sections for grouped features

### Dashboard Components

**KPI Cards:**
- Grid layout: 4 columns on xl, 2 on md, 1 on mobile
- Card structure: Large metric (text-4xl), small label (text-xs), trend indicator (↑↓ with percentage)
- Padding: p-6, rounded-lg border
- Height: min-h-32 for consistency

**Data Tables:**
- Sticky headers with column sorting indicators
- Row hover states for clarity
- Alternating row backgrounds (subtle) for scannability
- Compact row height: py-3
- Action buttons: icon-only on row hover (Edit, View Details, Delete)
- Pagination controls at bottom-right
- Search/filter bar above table
- Column visibility toggle for customization

**Filter Panels:**
- Multi-select dropdowns for: Vendor, Region, Merchandiser, Category, Season
- Date range picker for shipment dates
- "Clear All Filters" button
- Active filter chips displayed above data with X to remove

### Forms & Inputs

**Form Layout:**
- Two-column grid on desktop (grid-cols-2 gap-4), single column mobile
- Full-width for text areas and complex inputs
- Label above input pattern
- Required field indicators (*)
- Inline validation messages

**Input Components:**
- Text inputs: Standard height h-10, px-3, rounded border
- Dropdowns: Searchable multi-select for vendor/category lists
- Date pickers: Calendar popup with quick ranges (This Week, This Month, Q1, etc.)
- File upload: Drag-and-drop zone for Excel/CSV imports with file type validation
- Checkboxes/Radio: Larger touch targets (h-5 w-5)

### Data Visualization

**Charts (using Chart.js or Recharts):**
- OTD% trend: Line chart showing on-time delivery percentage over time
- Vendor performance: Horizontal bar chart comparing vendors
- Late shipments: Stacked bar chart by reason/category
- PO status distribution: Donut chart with status breakdown
- Consistent height: h-64 or h-80 for charts

### Buttons & Actions

**Primary Actions:** Solid button, height h-10, px-6, rounded, font-medium
**Secondary Actions:** Outline button, same dimensions
**Tertiary Actions:** Ghost button (no border, hover background)
**Danger Actions:** Distinct treatment for delete/cancel operations

**Icon Buttons:** 
- Square ratio (h-10 w-10), rounded
- Use Heroicons exclusively via CDN
- Tooltips on hover for clarity

### Modal & Overlays

**Modals:**
- Centered overlay with backdrop blur
- Max width: max-w-2xl for forms, max-w-4xl for detailed views
- Header with title and close button
- Footer with action buttons (right-aligned)
- Padding: p-6

**Toast Notifications:**
- Top-right positioning
- Success, error, warning, info variants
- Auto-dismiss after 5 seconds
- Action button for undo operations where applicable

---

## Page-Specific Layouts

### Dashboard Page
- 4 KPI cards at top (OTD%, Late Shipments, Open POs, Quality Issues)
- 2-column grid below: Late Shipments Chart (left) + Status Distribution (right)
- Recent Activity table at bottom (last 10 POs with status changes)

### PO Management Page
- Search bar + filter panel at top
- Bulk action buttons (Export, Archive, Assign)
- Comprehensive data table with inline edit capabilities
- Detail drawer slides from right on row click

### Vendor Performance Page
- Vendor selector dropdown (searchable)
- Vendor details card (contact, capacity, delivery metrics)
- Performance charts: OTD trend, quality scores, capacity utilization
- Associated POs table below

### Timeline/Milestone Tracking
- Horizontal timeline view with milestone markers
- Progress bars showing completion percentage per stage
- Filter by PO, vendor, or date range
- Color-coded status indicators (On Track, At Risk, Delayed)

### Import/Upload Page
- Large file drop zone centered
- File format instructions and template download link
- Preview table showing parsed data before import
- Column mapping interface for Excel columns to database fields
- Validation results with error highlighting

---

## Responsive Behavior

**Breakpoints:**
- Mobile: < 768px - Single column, stacked layout, hamburger nav
- Tablet: 768px - 1024px - Two-column grids, sidebar toggles to drawer
- Desktop: 1024px+ - Full sidebar, multi-column grids, optimal data density

**Mobile Optimizations:**
- Tables: Horizontal scroll or card-based view toggle
- Filters: Bottom sheet drawer instead of sidebar
- Charts: Simplified or stacked vertically
- Navigation: Bottom tab bar for key sections

---

## Accessibility

- Keyboard navigation: Tab order follows logical reading flow
- Focus indicators: Visible outline on all interactive elements
- ARIA labels: Comprehensive labeling for screen readers
- Color contrast: WCAG AA minimum for all text
- Form validation: Both visual and text-based error messages
- Skip navigation: "Skip to main content" link

---

## Data Import & Visualization

**Excel/CSV Import Flow:**
1. Upload interface with drag-drop
2. Preview table showing first 20 rows
3. Column mapping step (match Excel headers to system fields)
4. Validation report (highlighting errors/warnings)
5. Confirm import with summary
6. Success notification with count of imported records

**Export Options:**
- All tables exportable to Excel/CSV
- Export button in table toolbar
- Options: Current view, All data, Selected rows

---

## Performance Considerations

- Virtual scrolling for tables with 1000+ rows
- Lazy load charts and heavy components
- Debounced search inputs (300ms delay)
- Skeleton loaders during data fetches
- Optimistic UI updates for common actions

This design creates a professional, efficient, data-dense ERP interface optimized for daily operational use by merchandising teams managing high-volume purchase order workflows.