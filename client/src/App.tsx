import { useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AIAssistantSidebar } from "@/components/AIAssistantSidebar";
import { ClientProvider } from "@/contexts/ClientContext";
import { ClientSelector } from "@/components/ClientSelector";
import { Button } from "@/components/ui/button";
import { Sparkles, LogOut, User } from "lucide-react";
import { useAuth, useLogout } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Dashboard from "@/pages/Dashboard";
import QualityDashboard from "@/pages/QualityDashboard";
import PurchaseOrders from "@/pages/PurchaseOrders";
import PurchaseOrderDetail from "@/pages/PurchaseOrderDetail";
import Performance from "@/pages/Performance";
import Import from "@/pages/Import";
import Vendors from "@/pages/Vendors";
import VendorDetail from "@/pages/VendorDetail";
import ColorPanels from "@/pages/ColorPanels";
import ColorPanelDetail from "@/pages/ColorPanelDetail";
import MCPManagement from "@/pages/MCPManagement";
import Staff from "@/pages/Staff";
import StaffDetail from "@/pages/StaffDetail";
import SkuDetail from "@/pages/SkuDetail";
import SkuHome from "@/pages/SkuHome";
import Budget from "@/pages/Budget";
import CapacityTracking from "@/pages/CapacityTracking";
import VendorCapacityDetail from "@/pages/VendorCapacityDetail";
import ProjectionsDashboard from "@/pages/ProjectionAccuracy";
import ProjectionsList from "@/pages/ProjectionsList";
import POLookup from "@/pages/POLookup";
import ToDoList from "@/pages/ToDoList";
import Shipments from "@/pages/Shipments";
import FranchiseShipments from "@/pages/FranchiseShipments";
import ShipmentDetail from "@/pages/ShipmentDetail";
import Clients from "@/pages/Clients";
import ClientDetail from "@/pages/ClientDetail";
import VendorCategoryTimelines from "@/pages/VendorCategoryTimelines";
import Login from "@/pages/Login";
import UserGuide from "@/pages/UserGuide";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/quality" component={QualityDashboard} />
      <Route path="/sku-summary" component={SkuHome} />
      <Route path="/sku-summary/:skuCode" component={SkuDetail} />
      <Route path="/quality/sku/:skuCode" component={SkuDetail} />
      <Route path="/purchase-orders/:id" component={PurchaseOrderDetail} />
      <Route path="/purchase-orders" component={PurchaseOrders} />
      <Route path="/po-details" component={POLookup} />
      <Route path="/vendors/:id" component={VendorDetail} />
      <Route path="/vendors" component={Vendors} />
      <Route path="/vendor-report-cards" component={Vendors} />
      <Route path="/vendor-timelines" component={VendorCategoryTimelines} />
      <Route path="/color-panels/:id" component={ColorPanelDetail} />
      <Route path="/color-panels" component={ColorPanels} />
      <Route path="/mcp-management" component={MCPManagement} />
      <Route path="/performance" component={Performance} />
      <Route path="/staff/:id" component={StaffDetail} />
      <Route path="/staff" component={Staff} />
      <Route path="/budget" component={Budget} />
      <Route path="/capacity-tracking" component={CapacityTracking} />
      <Route path="/capacity" component={CapacityTracking} />
      <Route path="/capacity/:vendorCode" component={VendorCapacityDetail} />
      <Route path="/projections" component={ProjectionsDashboard} />
      <Route path="/projections-list" component={ProjectionsList} />
      <Route path="/import" component={Import} />
      <Route path="/to-do" component={ToDoList} />
      <Route path="/todo" component={ToDoList} />
      <Route path="/shipments/:id" component={ShipmentDetail} />
      <Route path="/shipments" component={Shipments} />
      <Route path="/franchise-shipments" component={FranchiseShipments} />
      <Route path="/clients/:id" component={ClientDetail} />
      <Route path="/clients" component={Clients} />
      <Route path="/user-guide" component={UserGuide} />
      <Route component={NotFound} />
    </Switch>
  );
}

function UserMenu() {
  const { user } = useAuth();
  const logoutMutation = useLogout();

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    window.location.href = "/login";
  };

  if (!user) return null;

  const roleDisplay = user.role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" data-testid="button-user-menu">
          <User className="h-4 w-4" />
          <span className="hidden sm:inline max-w-32 truncate">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium" data-testid="text-user-name">{user.name}</p>
            <p className="text-xs text-muted-foreground" data-testid="text-user-role">{roleDisplay}</p>
            {user.email && (
              <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">{user.email}</p>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={handleLogout}
          disabled={logoutMutation.isPending}
          data-testid="button-logout"
        >
          <LogOut className="mr-2 h-4 w-4" />
          {logoutMutation.isPending ? "Logging out..." : "Log out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AuthenticatedApp() {
  const [isAIAssistantOpen, setIsAIAssistantOpen] = useState(false);
  const { hasFullAccess } = useAuth();
  
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <ClientProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex flex-col flex-1">
            <header className="app-header flex items-center justify-between p-4 border-b gap-4">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="flex items-center gap-2">
                {hasFullAccess && <ClientSelector />}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAIAssistantOpen(true)}
                  className="gap-2"
                  data-testid="button-open-ai-assistant"
                >
                  <Sparkles className="h-4 w-4" />
                  <span className="hidden sm:inline">AI Analyst</span>
                </Button>
                <UserMenu />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 overflow-auto p-6">
              <Router />
            </main>
          </div>
        </div>
        <AIAssistantSidebar
          isOpen={isAIAssistantOpen}
          onClose={() => setIsAIAssistantOpen(false)}
        />
      </SidebarProvider>
    </ClientProvider>
  );
}

function App() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route>
        {isAuthenticated ? <AuthenticatedApp /> : <Login />}
      </Route>
    </Switch>
  );
}

function AppWrapper() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default AppWrapper;
