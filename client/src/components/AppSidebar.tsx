import { 
  LayoutDashboard, 
  Package, 
  Users, 
  FileBarChart, 
  Upload, 
  Users2, 
  ChevronRight, 
  BarChart3, 
  ClipboardCheck, 
  Palette,
  ListChecks,
  Calendar,
  TrendingUp,
  Home,
  FolderOpen,
  Contact,
  Target,
  DollarSign,
  Gauge,
  PieChart,
  Calculator,
  Ship,
  Building2,
  BookOpen,
  List
} from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import logoUrl from "@assets/Connor_Gray_Logo_2_1764661503704.png";
import { useAuth } from "@/hooks/useAuth";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, hasFullAccess, hasLimitedAccess } = useAuth();
  
  const isDashboardPath = location === "/" || location === "/quality";
  const isPurchaseOrderPath = location.startsWith("/purchase-orders") || location.startsWith("/po-") || location.startsWith("/timeline");
  const isShipmentsPath = location.startsWith("/shipments");
  const isClientsPath = location.startsWith("/clients");
  const isSkuPath = location.startsWith("/sku") || location === "/sku-summary";
  const isMcpPath = location.startsWith("/color-panels") || location.startsWith("/mcp");
  const isVendorPath = location === "/vendors" || location === "/staff" || location.startsWith("/vendors/") || location.startsWith("/capacity");
  const isBudgetPath = location.startsWith("/budget");

  return (
    <Sidebar>
      <SidebarHeader className="bg-[#c81030] p-4">
        <div className="flex items-center gap-2">
          <img 
            src={logoUrl} 
            alt="Connor Grey" 
            className="h-12 w-12 object-contain mix-blend-screen brightness-150"
          />
          <div>
            <h2 className="text-sm font-semibold text-white">Merchandising</h2>
            <p className="text-xs text-white/80">Operations Center</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="bg-[#c8102f]">
        <SidebarGroup>
          <SidebarGroupLabel className="text-white/80">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              
              {/* To-Do List - Available to all roles */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/to-do"} data-testid="nav-to-do">
                  <Link href="/to-do">
                    <ListChecks className="h-4 w-4" />
                    <span>To-Do List</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Dashboards Section - Available to all roles */}
              <Collapsible defaultOpen={isDashboardPath} className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton data-testid="nav-dashboards">
                      <LayoutDashboard className="h-4 w-4" />
                      <span>Dashboard</span>
                      <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={location === "/"} data-testid="nav-operations-dashboard">
                          <Link href="/">
                            <BarChart3 className="h-4 w-4" />
                            <span>Operations</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={location === "/quality"} data-testid="nav-quality-dashboard">
                          <Link href="/quality">
                            <ClipboardCheck className="h-4 w-4" />
                            <span>Quality and Compliance</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {/* Vendors Section - Available to all roles */}
              <Collapsible defaultOpen={isVendorPath} className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton data-testid="nav-vendors">
                      <Users className="h-4 w-4" />
                      <span>Vendors</span>
                      <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={location === "/vendors"} data-testid="nav-vendor-home">
                          <Link href="/vendors">
                            <Home className="h-4 w-4" />
                            <span>Vendor Home</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      {hasFullAccess && (
                        <>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={location === "/vendor-timelines"} data-testid="nav-vendor-timelines">
                              <Link href="/vendor-timelines">
                                <Calendar className="h-4 w-4" />
                                <span>Vendor Category Timelines</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={location === "/vendor-contacts"} data-testid="nav-vendor-contacts">
                              <Link href="/vendor-contacts">
                                <Contact className="h-4 w-4" />
                                <span>Vendor Contacts</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={location === "/capacity-tracking"} data-testid="nav-capacity-tracking">
                              <Link href="/capacity-tracking">
                                <Gauge className="h-4 w-4" />
                                <span>Capacity Tracking</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={location === "/projections"} data-testid="nav-projections-dashboard">
                              <Link href="/projections">
                                <Target className="h-4 w-4" />
                                <span>Projections Dashboard</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={location === "/projections-list"} data-testid="nav-projections-list">
                              <Link href="/projections-list">
                                <List className="h-4 w-4" />
                                <span>Projections List</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        </>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {/* Purchase Orders - Available to all roles */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isPurchaseOrderPath} data-testid="nav-purchase-orders">
                  <Link href="/purchase-orders">
                    <Package className="h-4 w-4" />
                    <span>Purchase Orders</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Shipments - Full access only */}
              {hasFullAccess && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isShipmentsPath} data-testid="nav-shipments">
                    <Link href="/shipments">
                      <Ship className="h-4 w-4" />
                      <span>Shipments</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}


              {/* Master Color Panels Section - Available to all roles */}
              <Collapsible defaultOpen={isMcpPath} className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton data-testid="nav-master-color-panels">
                      <Palette className="h-4 w-4" />
                      <span>MCP</span>
                      <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={location === "/mcp-management"} data-testid="nav-mcp-management">
                          <Link href="/mcp-management">
                            <Target className="h-4 w-4" />
                            <span>MCP Management Center</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={location === "/color-panels"} data-testid="nav-mcp-home">
                          <Link href="/color-panels">
                            <Home className="h-4 w-4" />
                            <span>MCP Home</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {/* SKUs - Available to all roles */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isSkuPath} data-testid="nav-skus">
                  <Link href="/sku-summary">
                    <FolderOpen className="h-4 w-4" />
                    <span>SKUs</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Staff - Full access only */}
              {hasFullAccess && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/staff"} data-testid="nav-staff-directory">
                    <Link href="/staff">
                      <Users2 className="h-4 w-4" />
                      <span>Staff</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Clients - Full access only */}
              {hasFullAccess && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isClientsPath} data-testid="nav-clients">
                    <Link href="/clients">
                      <Building2 className="h-4 w-4" />
                      <span>Clients</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Budget Section - Full access only */}
              {hasFullAccess && (
                <Collapsible defaultOpen={isBudgetPath} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton data-testid="nav-budget">
                        <DollarSign className="h-4 w-4" />
                        <span>Budgets</span>
                        <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={location === "/budget"} data-testid="nav-budget-home">
                            <Link href="/budget">
                              <Home className="h-4 w-4" />
                              <span>Budget Home</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={location === "/budget-planning"} data-testid="nav-budget-planning">
                            <Link href="/budget-planning">
                              <Calculator className="h-4 w-4" />
                              <span>Budget Planning</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={location === "/budget-vs-actual"} data-testid="nav-budget-vs-actual">
                            <Link href="/budget-vs-actual">
                              <PieChart className="h-4 w-4" />
                              <span>Budget vs Actual</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={location === "/budget-reports"} data-testid="nav-budget-reports">
                            <Link href="/budget-reports">
                              <FileBarChart className="h-4 w-4" />
                              <span>Budget Reports</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )}

              {/* Import Data - Available to full access and limited access roles */}
              {(hasFullAccess || hasLimitedAccess) && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/import"} data-testid="nav-import">
                    <Link href="/import">
                      <Upload className="h-4 w-4" />
                      <span>Import Data</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* User Guide - Available to all roles */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/user-guide"} data-testid="nav-user-guide">
                  <Link href="/user-guide">
                    <BookOpen className="h-4 w-4" />
                    <span>User Guide</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
