import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  BookOpen, 
  LayoutDashboard, 
  ListChecks, 
  Package, 
  Clock, 
  Building2, 
  Boxes, 
  Ship, 
  Palette, 
  ClipboardCheck, 
  Upload, 
  Bot, 
  Users, 
  Shield,
  Lightbulb,
  Copy,
  Download,
  FileText,
  TrendingUp,
  Factory
} from "lucide-react";

const GUIDE_TEXT = `MERCHANDISING ERP SYSTEM - USER GUIDE

========================================
GETTING STARTED
========================================

LOGGING IN:
1. Open the application in your web browser
2. Enter your email address (assigned by your administrator)
3. If this is your first time, click "Set up your password"
4. Create a secure password (minimum 6 characters)
5. Use your email and password to log in

NAVIGATION:
The sidebar menu on the left contains all sections:
- Dashboard - Key performance metrics and charts
- Projections - Forecast accuracy and planning
- Capacity Tracker - Vendor capacity planning
- To-Do List - Your pending tasks
- Quality & Compliance - Inspection reports
- Purchase Orders - All PO records
- Vendors - Vendor information
- Shipments - Shipping tracking
- Data Import - Upload Excel files

========================================
DASHBOARD & KPIs - HOW THE NUMBERS WORK
========================================

THE KEY PERFORMANCE INDICATORS:

YTD TOTAL SALES:
How it's calculated: We add up the dollar value of all orders that have actually shipped this year. An order counts as "shipped" when goods leave the factory on a vessel. We use the first sailing date if an order ships in multiple parts.
What it means: This is your actual revenue recognized - money you can count on.

TOTAL POs:
How it's calculated: We count every purchase order placed this year, regardless of status.
What it means: Your total order volume for the year.

REVISED OTD % (On-Time Delivery):
How it's calculated: We take all orders that shipped and check if they shipped before their deadline. If the deadline was extended, we use the extended date - this gives vendors credit for meeting revised timelines.
The formula in plain terms: Orders that shipped on time ÷ Total orders that shipped
What counts as "on time": The goods left the factory on or before the cancel date.
What we exclude: Sample orders, zero-value orders, and franchise orders don't count.
Special case: If a delay was caused by the client or forwarder (not the vendor), we count it as on-time since it wasn't the vendor's fault.

ORIGINAL OTD %:
How it's calculated: Same as above, but we only look at the original deadline - no credit for extensions.
What it means: This shows how often vendors meet their first commitment.

LATE POs:
How it's calculated: We count orders that haven't shipped yet AND are past their cancel date.
What it means: These orders are overdue and need immediate attention.

AT-RISK POs:
How it's calculated: We look for orders that might become late. An order is "at risk" if any of these are true:
- Final inspection failed
- No inline inspection booked and ship date is within 14 days
- No final inspection booked and ship date is within 7 days  
- PTS not submitted and ship date is within 30 days (regular) or 21 days (MTO orders)
- No ship confirmation recorded yet
What it means: These orders need proactive follow-up to prevent delays.

CHARTS:

Monthly Shipments Chart:
- Shows shipped orders by month (green bars)
- For the current year, also shows pending orders (yellow) and projections (blue)
- Prior year only shows what actually shipped

Rolling Forecast View:
- Combines shipped orders + pending orders + future projections
- Helps you see the full picture of expected business

========================================
PROJECTIONS DASHBOARD - HOW ACCURACY IS MEASURED
========================================

WHAT ARE PROJECTIONS?
Projections are forecasts from vendors about what they expect to produce. We import these from the FURNITURE and HOME-GOODS planning files each month.

HOW PROJECTIONS GET "MATCHED":
When actual purchase orders come in, we match them to projections to see how accurate the forecast was.
- Matched: A PO came in that matches this projection
- Partially Matched: Some orders came in, but not the full projected amount
- Unmatched: No orders have come in yet for this projection
- Expired: The order window passed with no orders - the projection didn't happen

WHEN PROJECTIONS EXPIRE:
Regular orders: Expire at the end of their projected month
Special/MTO orders: Have a longer window (typically 90 days)
Why this matters: Expired projections highlight forecast misses we should discuss with vendors.

ACCURACY CHARTS:

Accuracy Bar Chart (90-Day or 6-Month View):
How it works: We compare what was projected vs. what actually happened.
- We look at what the vendor predicted 90 days (or 6 months) before the order window
- Then we compare to actual orders that came in
- Shows whether vendors over-predicted or under-predicted

Forecast Error Trend:
- Shows how projection accuracy changes over time
- Positive error = vendor predicted more than what happened (over-projected)
- Negative error = vendor predicted less than what happened (under-projected)
- Goal: Get this as close to zero as possible

Forecast Churn (Volatility):
How it works: We look at how much projections changed between updates.
- If a vendor keeps changing their numbers, that's "churn"
- High churn = unstable forecasts that are hard to plan around
- Low churn = consistent, reliable forecasting

Cleanup Status:
Shows the current state of all projections:
- Matched (green) = Orders received
- Unmatched (yellow) = Still waiting for orders
- Expired (red) = Order window passed, no orders came

FILTERING:
- Brand: Filter by CB, CB2, or C&K
- Horizon: Look at 90-day or 6-month forecasts
- Order Type: All orders, Regular only, or Special orders only

========================================
VENDOR CAPACITY TRACKER - HOW THE NUMBERS WORK
========================================

WHAT IS THE CAPACITY TRACKER?
It shows how much work each vendor has, combining actual orders with projections and comparing to their reserved capacity.

THE THREE SOURCES OF DATA:

1. ORDERS ON HAND:
What it is: Purchase orders that are booked but haven't shipped yet.
Where it comes from: The OS340 purchase order file.
How we determine the month: We use whichever cancel date is later - the original or revised one. This gives vendors credit for any deadline extensions.
What's included: Only orders with value > $0, excludes samples (SMP) and franchise orders (8X8).

2. PROJECTIONS:
What it is: Forecasted orders that haven't been placed yet.
Where it comes from: FURNITURE and HOME-GOODS planning files.
What's included: Only projections that haven't been matched to actual orders yet - this prevents counting the same business twice.
How brand is determined: Based on the client division in the projection file.

3. RESERVED CAPACITY:
What it is: The capacity the vendor has set aside for us.
Where it comes from: The SS551 capacity planning spreadsheet.
What it means: This is the vendor's commitment to handle our business.

THE CAPACITY CALCULATION:

Total Commitment = Orders on Hand + Unmatched Projections
Balance = Reserved Capacity - Total Commitment

If Balance is negative (red): The vendor is over-committed - more work than capacity.
If Balance is positive (green): The vendor has room for more orders.

CHART BREAKDOWN:
Each bar shows the monthly breakdown:
- Gray portion: Orders on Hand (confirmed business)
- Blue portion: Projections (expected future business)
- Line marker: Reserved Capacity limit

========================================
QUALITY & COMPLIANCE - HOW METRICS WORK
========================================

INSPECTION TIMING RULES:

Final Inspection:
When it should happen: At least 5 days before the goods need to ship.
Why: Leaves time to fix any issues found.
Late if: Final inspection happens less than 5 days before ship date, or hasn't happened yet.

Inline Inspection:
When it should happen: At least 8 days before the goods need to ship.
Why: Catches problems during production when they're easier to fix.
Late if: Inline inspection happens less than 8 days before ship date, or hasn't happened yet.

FIRST-TIME PASS RATE:
How it's calculated: We count how many inspections passed on the first try, divided by total inspections.
What it means: Higher is better - shows quality is right the first time without rework.

INSPECTION STATUSES:
- Passed: Product met all requirements
- Failed: Issues found that need to be fixed
- Pending: Inspection not yet completed
- Late: Past the deadline when it should have been done

========================================
PURCHASE ORDERS - STATUS DEFINITIONS
========================================

HOW WE DETERMINE STATUS:

On-Time: The order shipped on or before the cancel date.
Late: The order shipped after the cancel date.
At-Risk: Not shipped yet and showing warning signs (see Dashboard section above).
Pending: Order is active, not yet shipped, no issues flagged.

THE CANCEL DATE RULE:
When checking if an order is late, we use whichever cancel date is later - the original or revised one. This gives vendors the benefit of any extensions that were granted.

WHAT COUNTS AS "SHIPPED":
An order is considered shipped when we have a confirmed sailing date - meaning goods are on a vessel leaving the origin port.

========================================
DATA IMPORT - FILE TYPES
========================================

OS340 (Purchase Orders):
What it updates: All PO information - orders, line items, dates, values
This is the main data source for orders

OS630 (Quality & Compliance):
What it updates: Inspection results, quality test data
Use for: Tracking inspection status and pass rates

OS650 (Shipments):
What it updates: Shipping details - vessels, dates, quantities
Use for: Tracking logistics and delivery status

FURNITURE / HOME-GOODS (Projections):
What it updates: Vendor forecasts for future months
Use for: Capacity planning and accuracy tracking
Note: Each import creates a snapshot that's preserved for accuracy analysis

SS551 (Capacity Data):
What it updates: Vendor reserved capacity limits
Use for: Capacity tracker calculations

IMPORTANT: When you import new data, any notes or tasks you've added are preserved - they won't be overwritten.

========================================
TO-DO LIST
========================================

Your To-Do List shows tasks that need attention, automatically generated based on PO status:

TASK TYPES:
- Orders needing follow-up (past deadline, no shipping update)
- Inspection reminders (upcoming inspections not booked)
- Quality issues requiring resolution
- Custom tasks you've created

PRIORITY LEVELS:
- High: Urgent items that need immediate attention
- Medium: Important but not urgent
- Low: Can be addressed when time allows

TIPS:
- Complete tasks as you work through them to stay organized
- Add your own notes to tasks for context
- Tasks are automatically removed when the underlying issue is resolved

========================================
VENDORS - MANAGEMENT
========================================

VENDOR OVERVIEW:
The Vendors page shows all your suppliers with key metrics at a glance.

WHAT YOU'LL SEE:
- Total orders by vendor
- On-time delivery rate
- Quality scores (if inspections are tracked)
- Current order volume

VENDOR DETAILS:
Click any vendor to see:
- Order history
- Performance trends over time
- Current active orders
- Capacity information

NOTE: New vendors are only created when they appear in OS340 data - this keeps your vendor list clean and accurate.

========================================
SHIPMENTS - TRACKING
========================================

HOW SHIPMENT DATA WORKS:
Shipment information comes from two sources:
- OS340: Initial shipment dates from purchase orders
- OS650: Detailed logistics data (vessel names, ports, actual sailing dates)

SHIPMENT STATUS:
- Scheduled: Has a planned ship date but hasn't left yet
- In Transit: Goods are on a vessel
- Delivered: Arrived at destination
- Split Shipment: Part of the order shipped separately

KEY DATES:
- Delivery to Consolidator: When goods reach the shipping facility
- Actual Sailing Date: When the vessel departs
- These dates are used for OTD calculations

FINDING SHIPMENTS:
- Search by PO number
- Filter by vendor
- Filter by date range

========================================
AI DATA ANALYST
========================================

The AI assistant helps you analyze your data and answer questions about your operations.

WHAT IT CAN DO:
- Answer questions about your KPIs
- Explain trends in your data
- Help identify problem areas
- Provide insights on vendor performance

EXAMPLE QUESTIONS:
- "Which vendors have the best OTD this year?"
- "Why are late orders increasing?"
- "What's our projection accuracy trend?"
- "Which orders are most at risk?"

TIPS FOR BEST RESULTS:
- Ask specific questions with time frames
- Reference specific vendors or order types when relevant
- The AI has access to historical data for comparisons

========================================
ROLES & ACCESS
========================================

USER ROLES:

Merchandiser:
- View and manage assigned POs
- Update notes and tasks
- View reports and dashboards

Merchandising Manager:
- Everything a Merchandiser can do
- View team members' orders
- Access vendor management features
- View capacity planning tools

General Merchandising Manager (GMM):
- Full system access
- Import data files
- Manage user accounts
- Access all vendors and orders

Admin:
- Full system access
- User management
- System configuration

ACCESS LEVELS:
- Most users see only their assigned orders
- Managers can see their team's orders
- GMMs and Admins see all orders

========================================
TIPS & BEST PRACTICES
========================================

DAILY WORKFLOW:
1. Start with the Dashboard - check KPIs
2. Review your To-Do List
3. Check At-Risk orders
4. Update notes on active POs

WEEKLY TASKS:
- Review vendor performance trends
- Import latest data files (OS340, OS650, OS630)
- Check Capacity Tracker for over-committed vendors
- Review Projections Dashboard for forecast accuracy

MONTHLY TASKS:
- Import new projection files (FURNITURE, HOME-GOODS)
- Review expired projections with vendors
- Update capacity reservations if needed
`;

export default function UserGuide() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("getting-started");
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    if (section) {
      setActiveTab(section);
    }
  }, []);

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(GUIDE_TEXT);
      toast({
        title: "Copied!",
        description: "User guide text copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Please select and copy the text manually",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    const blob = new Blob([GUIDE_TEXT], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Merchandising_ERP_User_Guide.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: "Downloaded!",
      description: "User guide saved as text file",
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-4">
            <BookOpen className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">User Guide</h1>
              <p className="text-muted-foreground text-sm">Learn how to use the Merchandising ERP System</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyText} data-testid="button-copy-guide">
              <Copy className="h-4 w-4 mr-2" />
              Copy Text
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload} data-testid="button-download-guide">
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-view-text">
                  <FileText className="h-4 w-4 mr-2" />
                  View Text
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[80vh]">
                <DialogHeader>
                  <DialogTitle>User Guide - Text Version</DialogTitle>
                  <DialogDescription>
                    Copy this text to use in other applications
                  </DialogDescription>
                </DialogHeader>
                <Textarea
                  value={GUIDE_TEXT}
                  readOnly
                  className="h-[60vh] font-mono text-xs"
                  data-testid="textarea-guide-text"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={handleCopyText} data-testid="button-dialog-copy">
                    <Copy className="h-4 w-4 mr-2" />
                    Copy All
                  </Button>
                  <Button onClick={handleDownload} data-testid="button-dialog-download">
                    <Download className="h-4 w-4 mr-2" />
                    Download .txt
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 mb-4" data-testid="tabs-guide-sections">
            <TabsTrigger value="getting-started" data-testid="tab-getting-started">Getting Started</TabsTrigger>
            <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="projections" data-testid="tab-projections">Projections</TabsTrigger>
            <TabsTrigger value="capacity" data-testid="tab-capacity">Capacity Tracker</TabsTrigger>
            <TabsTrigger value="todo" data-testid="tab-todo">To-Do List</TabsTrigger>
            <TabsTrigger value="purchase-orders" data-testid="tab-purchase-orders">Purchase Orders</TabsTrigger>
            <TabsTrigger value="vendors" data-testid="tab-vendors">Vendors</TabsTrigger>
            <TabsTrigger value="shipments" data-testid="tab-shipments">Shipments</TabsTrigger>
            <TabsTrigger value="quality" data-testid="tab-quality">Quality</TabsTrigger>
            <TabsTrigger value="import" data-testid="tab-import">Data Import</TabsTrigger>
            <TabsTrigger value="ai" data-testid="tab-ai">AI Analyst</TabsTrigger>
            <TabsTrigger value="roles" data-testid="tab-roles">Roles & Access</TabsTrigger>
          </TabsList>

          <TabsContent value="getting-started">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Getting Started
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">Logging In</h3>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Open the application in your web browser</li>
                    <li>Enter your email address (assigned by your administrator)</li>
                    <li>If this is your first time, click <strong>"Set up your password"</strong></li>
                    <li>Create a secure password (minimum 6 characters)</li>
                    <li>Use your email and password to log in</li>
                  </ol>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Navigation</h3>
                  <p className="text-muted-foreground mb-2">The sidebar menu on the left contains all sections:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>Dashboard</strong> - Key performance metrics and charts</li>
                    <li><strong>Projections</strong> - Forecast accuracy and planning</li>
                    <li><strong>Capacity Tracker</strong> - Vendor capacity planning</li>
                    <li><strong>To-Do List</strong> - Your pending tasks</li>
                    <li><strong>Quality & Compliance</strong> - Inspection reports</li>
                    <li><strong>Purchase Orders</strong> - All PO records</li>
                    <li><strong>Vendors</strong> - Vendor information</li>
                    <li><strong>Shipments</strong> - Shipping tracking</li>
                    <li><strong>Data Import</strong> - Upload Excel files</li>
                  </ul>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Light/Dark Mode</h3>
                  <p className="text-muted-foreground">
                    Click the sun/moon icon in the top right corner to switch between light and dark display modes.
                  </p>
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LayoutDashboard className="h-5 w-5" />
                  Dashboard & KPIs - How the Numbers Work
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-3">Key Performance Indicators</h3>
                  <div className="grid gap-3">
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">YTD Total Sales</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How it's calculated:</strong> We add up the dollar value of all orders that have actually shipped this year. 
                        An order counts as "shipped" when goods leave the factory on a vessel. We use the first sailing date if an order ships in multiple parts.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it means:</strong> This is your actual revenue recognized - money you can count on.
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">Revised OTD % (On-Time Delivery)</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How it's calculated:</strong> We take all orders that shipped and check if they shipped before their deadline. 
                        If the deadline was extended, we use the extended date - this gives vendors credit for meeting revised timelines.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>In simple terms:</strong> Orders shipped on time ÷ Total orders shipped
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What we exclude:</strong> Sample orders, zero-value orders, and franchise orders don't count.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Special case:</strong> If a delay was caused by the client or forwarder (not the vendor), we count it as on-time since it wasn't the vendor's fault.
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">Original OTD %</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How it's calculated:</strong> Same as Revised OTD, but we only look at the original deadline - no credit for extensions.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it means:</strong> Shows how often vendors meet their first commitment without needing deadline changes.
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">Late POs</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How it's calculated:</strong> Orders that haven't shipped yet AND are past their cancel date.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it means:</strong> These orders are overdue and need immediate attention.
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">At-Risk POs</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How it's calculated:</strong> Orders that might become late. An order is "at risk" if any of these are true:
                      </p>
                      <ul className="text-muted-foreground text-sm mt-1 list-disc list-inside ml-2">
                        <li>Final inspection failed</li>
                        <li>No inline inspection booked and ship date is within 14 days</li>
                        <li>No final inspection booked and ship date is within 7 days</li>
                        <li>PTS not submitted and ship date is within 30 days (regular) or 21 days (MTO orders)</li>
                        <li>No ship confirmation recorded yet</li>
                      </ul>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">First-Time Pass Rate</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How it's calculated:</strong> Inspections that passed on the first try ÷ Total inspections completed
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it means:</strong> Higher is better - shows quality is right the first time without rework.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Dashboard Charts</h3>
                  <div className="space-y-3 text-muted-foreground">
                    <div>
                      <strong>Monthly Shipments Chart:</strong> Shows shipped orders by month. For the current year, 
                      you'll also see pending orders and projections. Prior year only shows what actually shipped.
                    </div>
                    <div>
                      <strong>Rolling Forecast View:</strong> Combines shipped orders + pending orders + future projections 
                      to show the full picture of expected business.
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Color Coding</h3>
                  <ul className="space-y-1 text-muted-foreground">
                    <li><span className="text-green-600 font-medium">Green</span> - Meeting or exceeding targets</li>
                    <li><span className="text-yellow-600 font-medium">Yellow/Orange</span> - Approaching concern levels</li>
                    <li><span className="text-red-600 font-medium">Red</span> - Needs immediate attention</li>
                  </ul>
                </section>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="projections">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Projections Dashboard - How Accuracy is Measured
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">What Are Projections?</h3>
                  <p className="text-muted-foreground">
                    Projections are forecasts from vendors about what they expect to produce. We import these from the 
                    FURNITURE and HOME-GOODS planning files each month. They help us plan capacity and anticipate future business.
                  </p>
                </section>
                
                <section>
                  <h3 className="text-lg font-semibold mb-2">How Projections Get "Matched"</h3>
                  <p className="text-muted-foreground mb-2">
                    When actual purchase orders come in, we match them to projections to see how accurate the forecast was:
                  </p>
                  <div className="grid gap-2">
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Matched</strong> - A PO came in that matches this projection. The forecast was accurate.
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Partially Matched</strong> - Some orders came in, but not the full projected amount.
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Unmatched</strong> - No orders have come in yet for this projection. Still waiting.
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Expired</strong> - The order window passed with no orders. The projection didn't happen.
                    </div>
                  </div>
                </section>
                
                <section>
                  <h3 className="text-lg font-semibold mb-2">When Projections Expire</h3>
                  <div className="space-y-2 text-muted-foreground">
                    <p><strong>Regular orders:</strong> Expire at the end of their projected month.</p>
                    <p><strong>Special/MTO orders:</strong> Have a longer window (typically 90 days).</p>
                    <p><strong>Why this matters:</strong> Expired projections highlight forecast misses we should discuss with vendors.</p>
                  </div>
                </section>
                
                <section>
                  <h3 className="text-lg font-semibold mb-3">Understanding the Charts</h3>
                  <div className="grid gap-3">
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">Accuracy Bar Chart (90-Day or 6-Month View)</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How it works:</strong> We compare what was projected vs. what actually happened. 
                        We look at what the vendor predicted 90 days (or 6 months) before the order window, 
                        then compare to actual orders that came in.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it shows:</strong> Whether vendors over-predicted or under-predicted their business.
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">Forecast Error Trend</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How it works:</strong> Shows how projection accuracy changes over time.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Reading the chart:</strong> Positive error = vendor predicted more than what happened (over-projected). 
                        Negative error = vendor predicted less than what happened (under-projected).
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Goal:</strong> Get this as close to zero as possible.
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">Forecast Churn (Volatility)</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How it works:</strong> We look at how much projections changed between updates. 
                        If a vendor keeps changing their numbers, that's "churn."
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it means:</strong> High churn = unstable forecasts that are hard to plan around. 
                        Low churn = consistent, reliable forecasting.
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">Cleanup Status</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it shows:</strong> The current state of all projections.
                      </p>
                      <ul className="text-muted-foreground text-sm mt-1 list-disc list-inside ml-2">
                        <li><span className="text-green-600">Matched (green)</span> = Orders received</li>
                        <li><span className="text-yellow-600">Unmatched (yellow)</span> = Still waiting for orders</li>
                        <li><span className="text-red-600">Expired (red)</span> = Order window passed, no orders came</li>
                      </ul>
                    </div>
                  </div>
                </section>
                
                <section>
                  <h3 className="text-lg font-semibold mb-2">Filters Available</h3>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>Brand:</strong> Filter by CB, CB2, or C&K</li>
                    <li><strong>Horizon:</strong> Look at 90-day or 6-month forecasts</li>
                    <li><strong>Order Type:</strong> All orders, Regular only, or Special orders only</li>
                  </ul>
                </section>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="capacity">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Factory className="h-5 w-5" />
                  Vendor Capacity Tracker - How the Numbers Work
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">What Is the Capacity Tracker?</h3>
                  <p className="text-muted-foreground">
                    It shows how much work each vendor has, combining actual orders with projections and comparing 
                    to their reserved capacity. This helps you see if vendors are over-committed or have room for more.
                  </p>
                </section>
                
                <section>
                  <h3 className="text-lg font-semibold mb-3">The Three Sources of Data</h3>
                  <div className="grid gap-3">
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">1. Orders on Hand</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it is:</strong> Purchase orders that are booked but haven't shipped yet.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Where it comes from:</strong> The OS340 purchase order file.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>How we determine the month:</strong> We use whichever cancel date is later - the original 
                        or revised one. This gives vendors credit for any deadline extensions they received.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What's included:</strong> Only orders with value greater than $0. Excludes samples (SMP) and franchise orders (8X8).
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">2. Projections</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it is:</strong> Forecasted orders that haven't been placed yet.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Where it comes from:</strong> FURNITURE and HOME-GOODS planning files.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Important:</strong> Only projections that haven't been matched to actual orders yet - 
                        this prevents counting the same business twice.
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">3. Reserved Capacity</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it is:</strong> The capacity the vendor has set aside for us.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Where it comes from:</strong> The SS551 capacity planning spreadsheet.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it means:</strong> This is the vendor's commitment to handle our business.
                      </p>
                    </div>
                  </div>
                </section>
                
                <section>
                  <h3 className="text-lg font-semibold mb-2">The Capacity Calculation</h3>
                  <div className="p-4 rounded-lg bg-muted">
                    <p className="text-muted-foreground mb-2">
                      <strong>Total Commitment</strong> = Orders on Hand + Unmatched Projections
                    </p>
                    <p className="text-muted-foreground mb-2">
                      <strong>Balance</strong> = Reserved Capacity − Total Commitment
                    </p>
                    <div className="mt-3 space-y-1">
                      <p className="text-red-600 text-sm">
                        <strong>If Balance is negative (red):</strong> The vendor is over-committed - more work than capacity.
                      </p>
                      <p className="text-green-600 text-sm">
                        <strong>If Balance is positive (green):</strong> The vendor has room for more orders.
                      </p>
                    </div>
                  </div>
                </section>
                
                <section>
                  <h3 className="text-lg font-semibold mb-2">Reading the Chart</h3>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>Gray bars:</strong> Orders on Hand (confirmed business)</li>
                    <li><strong>Blue bars:</strong> Projections (expected future business)</li>
                    <li><strong>Line marker:</strong> Reserved Capacity limit</li>
                  </ul>
                  <p className="text-muted-foreground mt-2">
                    When the bars go above the line, the vendor is over-committed for that month.
                  </p>
                </section>
                
                <section>
                  <h3 className="text-lg font-semibold mb-2">Filtering Options</h3>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>Year:</strong> View data for different years</li>
                    <li><strong>Brand:</strong> Filter by CB, CB2, or C&K</li>
                    <li><strong>Print/Export:</strong> Download as PDF for meetings</li>
                  </ul>
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="todo">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5" />
                  To-Do List
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">Types of Tasks</h3>
                  <div className="space-y-3 text-muted-foreground">
                    <div>
                      <strong>Auto-Generated Tasks:</strong> System creates tasks for upcoming inspection deadlines, 
                      expiring certifications, and POs approaching cancel dates.
                    </div>
                    <div>
                      <strong>Manual Tasks:</strong> Tasks you or your team create on specific POs.
                    </div>
                    <div>
                      <strong>Action Items:</strong> Notes marked as "action required" from PO activity logs.
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Task Priority Colors</h3>
                  <ul className="space-y-1 text-muted-foreground">
                    <li><span className="text-red-600 font-medium">Red (High)</span> - Urgent, requires immediate attention</li>
                    <li><span className="text-orange-600 font-medium">Orange (Medium)</span> - Important, address soon</li>
                    <li><span className="text-blue-600 font-medium">Blue/Gray (Normal)</span> - Standard priority</li>
                  </ul>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Managing Tasks</h3>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Click on a task to view details</li>
                    <li>Take the required action</li>
                    <li>Click the checkbox or "Complete" button</li>
                    <li>The task moves to completed status</li>
                  </ol>
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="purchase-orders">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Purchase Orders
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">PO Status Meanings</h3>
                  <div className="grid gap-2">
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Open</strong> - Order is active and in progress
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>On-Time</strong> - Shipped on or before the cancel date
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Late</strong> - Shipped after the cancel date
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>At-Risk</strong> - Approaching cancel date
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Pending</strong> - Awaiting shipment
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">PO Detail Page</h3>
                  <p className="text-muted-foreground mb-2">Click any PO to see:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>Header Information</strong> - PO number, vendor, dates, values</li>
                    <li><strong>Line Items</strong> - All SKUs with quantities and prices</li>
                    <li><strong>Shipments</strong> - Shipping records and logistics</li>
                    <li><strong>Timeline</strong> - Production milestones</li>
                    <li><strong>Tasks</strong> - Action items for this PO</li>
                    <li><strong>Notes & Activity</strong> - Comments and history</li>
                  </ul>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Key Dates</h3>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>PO Date</strong> - When the order was placed</li>
                    <li><strong>Original Cancel Date</strong> - Must-ship-by date (original commitment)</li>
                    <li><strong>Revised Cancel Date</strong> - Updated cancel date (if extended)</li>
                  </ul>
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="vendors">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Vendors
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">Vendor Detail Page</h3>
                  <p className="text-muted-foreground mb-2">Click any vendor to see:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>Contact Information</strong> - Address, phone, contacts</li>
                    <li><strong>Performance Metrics</strong> - OTD rates, quality scores</li>
                    <li><strong>Active POs</strong> - Current open orders</li>
                    <li><strong>Historical Performance</strong> - Trends over time</li>
                    <li><strong>Staff Assignment</strong> - Merchandisers working with this vendor</li>
                  </ul>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Performance Indicators</h3>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>Revised OTD %</strong> - On-time delivery rate</li>
                    <li><strong>Quality Score</strong> - Based on inspection pass rates</li>
                    <li><strong>Average Late Days</strong> - How late when orders miss deadlines</li>
                  </ul>
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="shipments">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ship className="h-5 w-5" />
                  Shipments
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">Shipment Status Colors</h3>
                  <ul className="space-y-1 text-muted-foreground">
                    <li><span className="text-blue-600 font-medium">Blue</span> - In Transit / On Water</li>
                    <li><span className="text-green-600 font-medium">Green</span> - Delivered / On-Time</li>
                    <li><span className="text-red-600 font-medium">Red</span> - Late / Delayed</li>
                    <li><span className="text-gray-600 font-medium">Gray</span> - Pending / Not Yet Shipped</li>
                  </ul>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Shipment Details</h3>
                  <p className="text-muted-foreground mb-2">Each shipment shows:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li><strong>PO Number</strong> - Which order it belongs to</li>
                    <li><strong>Style/SKU</strong> - Products included</li>
                    <li><strong>Quantity Shipped</strong> - Number of units</li>
                    <li><strong>Cargo Ready Date</strong> - When goods were ready</li>
                    <li><strong>Vessel Information</strong> - Ship name and voyage</li>
                    <li><strong>PTS</strong> - Port to Store tracking</li>
                  </ul>
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quality">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5" />
                  Quality & Compliance - How Metrics Work
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">Two Main Reports</h3>
                  <div className="space-y-3 text-muted-foreground">
                    <div>
                      <strong>Inspection Status Report:</strong> Tracks physical product inspections at the factory.
                    </div>
                    <div>
                      <strong>Quality Test Status Report:</strong> Tracks lab tests and certifications for materials and safety.
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-3">Inspection Timing Rules</h3>
                  <div className="grid gap-3">
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">Final Inspection</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>When it should happen:</strong> At least 5 days before the goods need to ship.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Why:</strong> Leaves time to fix any issues found before the shipping deadline.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Counted as "late" if:</strong> Final inspection happens less than 5 days before ship date, or hasn't happened yet when the ship date is within 5 days.
                      </p>
                    </div>
                    
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">Inline Inspection</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>When it should happen:</strong> At least 8 days before the goods need to ship.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Why:</strong> Catches problems during production when they're easier and cheaper to fix.
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Counted as "late" if:</strong> Inline inspection happens less than 8 days before ship date, or hasn't been booked yet when the ship date is within 14 days.
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">First-Time Pass Rate</h3>
                  <div className="p-4 rounded-lg bg-muted">
                    <p className="text-muted-foreground text-sm">
                      <strong>How it's calculated:</strong> We count how many inspections passed on the first try, 
                      then divide by the total number of inspections completed.
                    </p>
                    <p className="text-muted-foreground text-sm mt-2">
                      <strong>In simple terms:</strong> Inspections that passed first time ÷ Total inspections
                    </p>
                    <p className="text-muted-foreground text-sm mt-2">
                      <strong>What it means:</strong> Higher is better - shows the vendor's quality is right 
                      the first time without needing rework or re-inspection.
                    </p>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Status Indicators</h3>
                  <div className="grid gap-2">
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Passed</strong> - Product met all quality requirements
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Failed</strong> - Issues found that need to be fixed before shipping
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Pending</strong> - Inspection is scheduled but not yet completed
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Late</strong> - Past the deadline when it should have been done
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Expiring</strong> - A required certification expires within 30 days
                    </div>
                  </div>
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="import">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Data Import - File Types & What They Update
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-3">Supported File Types</h3>
                  <div className="grid gap-3">
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">OS340 (Purchase Orders)</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it updates:</strong> All PO information - orders, line items, dates, values, vendor assignments
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>This is the main data source</strong> for orders and the basis for most metrics.
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">OS630 (Quality & Compliance)</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it updates:</strong> Inspection results, quality test data, certification status
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Use for:</strong> Tracking inspection status and calculating pass rates
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">OS650 (Shipments)</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it updates:</strong> Shipping details - vessels, sailing dates, quantities shipped
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Use for:</strong> Tracking logistics and confirming delivery status
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">FURNITURE / HOME-GOODS (Projections)</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it updates:</strong> Vendor forecasts for future months
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Use for:</strong> Capacity planning and forecast accuracy tracking
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Note:</strong> Each import creates a snapshot that's preserved for accuracy analysis
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted">
                      <strong className="text-base">SS551 (Capacity Data)</strong>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>What it updates:</strong> Vendor reserved capacity limits by month
                      </p>
                      <p className="text-muted-foreground text-sm mt-1">
                        <strong>Use for:</strong> Capacity tracker calculations and balance analysis
                      </p>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">How to Import</h3>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Click <strong>Import Data</strong> in the sidebar</li>
                    <li>Click <strong>Upload File</strong> or drag and drop your Excel file</li>
                    <li>System auto-detects the file type based on the filename and contents</li>
                    <li>Review the preview to make sure it looks correct</li>
                    <li>Click <strong>Import</strong> to process the data</li>
                  </ol>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Important Notes</h3>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>Always use the most recent export from your data source</li>
                    <li>User-added notes and tasks are preserved during imports - they won't be overwritten</li>
                    <li>Data is kept for 3 years (current year + last 2 years)</li>
                    <li>Import projection files monthly for accurate forecast tracking</li>
                  </ul>
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ai">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  AI Data Analyst
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">How to Use</h3>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Click <strong>AI Analyst</strong> in the sidebar</li>
                    <li>Type your question in everyday language</li>
                    <li>Press Enter or click Send</li>
                    <li>The AI will analyze your data and respond</li>
                  </ol>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Example Questions</h3>
                  <div className="space-y-2 text-muted-foreground">
                    <p>"Which vendors have the worst on-time delivery this year?"</p>
                    <p>"What's our OTD trend over the last 6 months?"</p>
                    <p>"Show me all late POs for Vendor ABC"</p>
                    <p>"What's our first-time pass rate by vendor?"</p>
                    <p>"Compare Q1 vs Q2 performance"</p>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">Tips</h3>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>Be specific about what you want to know</li>
                    <li>Include time frames ("this month", "YTD", "last quarter")</li>
                    <li>Ask follow-up questions to dig deeper</li>
                  </ul>
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="roles">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  User Roles & Access
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="text-lg font-semibold mb-2">Role Types</h3>
                  <div className="grid gap-2">
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Admin</strong> - Full access to all data, can manage staff and import data
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>General Merchandising Manager</strong> - Full access to all orders and performance data
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Merchandising Manager</strong> - Can see orders for their team members
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <strong>Merchandiser</strong> - Can see their own assigned orders
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-lg font-semibold mb-2">What Each Role Can Do</h3>
                  <div className="space-y-3 text-muted-foreground">
                    <div>
                      <strong>Admins:</strong> View all data, add/edit staff, import data files, access all reports
                    </div>
                    <div>
                      <strong>Managers:</strong> View team POs, see performance for direct reports, run reports
                    </div>
                    <div>
                      <strong>Merchandisers:</strong> View assigned POs, update notes and tasks, access quality data
                    </div>
                  </div>
                </section>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5" />
              Tips & Best Practices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">Daily Workflow</h3>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Start with the Dashboard - check KPIs</li>
                  <li>Review your To-Do List</li>
                  <li>Check Quality Alerts</li>
                  <li>Update notes on active POs</li>
                </ol>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Weekly Tasks</h3>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Review vendor performance trends</li>
                  <li>Import latest data files</li>
                  <li>Check upcoming shipment deadlines</li>
                  <li>Follow up on at-risk orders</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </ScrollArea>
    </div>
  );
}
