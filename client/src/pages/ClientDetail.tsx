import { useParams, Link } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Building2, Users, ClipboardList, Mail, Phone, FileText, MessageSquare, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import type { Client, Vendor, PurchaseOrder } from "@shared/schema";

interface ClientKPIs {
  totalPOs: number;
  totalValue: number;
  openPOs: number;
  shippedPOs: number;
  otdPercentage: number;
  atRiskPOs: number;
  vendorCount: number;
}

interface StaffAssignment {
  staffId: number;
  staffName: string;
  role: string;
  isPrimary: boolean;
}

export default function ClientDetail() {
  const { id } = useParams();
  const goBack = useBackNavigation("/clients");

  const { data: client, isLoading: clientLoading } = useQuery<Client>({
    queryKey: ["/api/clients", id],
  });

  const { data: kpis, isLoading: kpisLoading } = useQuery<ClientKPIs>({
    queryKey: ["/api/clients", id, "kpis"],
  });

  const { data: staffAssignments = [], isLoading: staffLoading } = useQuery<StaffAssignment[]>({
    queryKey: ["/api/clients", id, "staff-assignments"],
  });

  const { data: purchaseOrders = [], isLoading: posLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders", { client: client?.name }],
    enabled: !!client?.name,
  });

  const { data: vendors = [], isLoading: vendorsLoading } = useQuery<Vendor[]>({
    queryKey: ["/api/vendors", { client: client?.name }],
    enabled: !!client?.name,
  });

  if (clientLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Client not found</p>
        <Button variant="outline" className="mt-4" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value / 100);
  };

  const recentPOs = purchaseOrders?.slice(0, 10) || [];
  const primaryStaff = staffAssignments.filter(s => s.isPrimary);
  const otherStaff = staffAssignments.filter(s => !s.isPrimary);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" data-testid="button-back" onClick={goBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {client.name}
              </CardTitle>
              <CardDescription className="mt-1">
                {client.code && <Badge variant="outline" className="mr-2">{client.code}</Badge>}
                {client.status && (
                  <Badge variant={client.status === "active" ? "default" : "secondary"}>
                    {client.status}
                  </Badge>
                )}
              </CardDescription>
            </div>
            <div className="text-right">
              {client.email && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 justify-end">
                  <Mail className="h-3 w-3" />
                  {client.email}
                </p>
              )}
              {client.phone && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 justify-end">
                  <Phone className="h-3 w-3" />
                  {client.phone}
                </p>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Total POs</span>
              {kpisLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-bold">{kpis?.totalPOs?.toLocaleString() || 0}</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Total Value</span>
              {kpisLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrency(kpis?.totalValue || 0)}</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Open POs</span>
              {kpisLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-bold">{kpis?.openPOs?.toLocaleString() || 0}</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Shipped POs</span>
              {kpisLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-bold">{kpis?.shippedPOs?.toLocaleString() || 0}</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">OTD Rate</span>
              {kpisLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-bold">{`${(kpis?.otdPercentage || 0).toFixed(1)}%`}</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">At Risk</span>
              {kpisLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-bold text-orange-600 dark:text-orange-400">{kpis?.atRiskPOs?.toLocaleString() || 0}</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Vendors</span>
              {kpisLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-bold">{kpis?.vendorCount?.toLocaleString() || 0}</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="staff" data-testid="tab-staff">Staff</TabsTrigger>
          <TabsTrigger value="vendors" data-testid="tab-vendors">Vendors</TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-orders">Recent Orders</TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">Activity Log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Assigned Staff
                </CardTitle>
                <CardDescription>
                  Staff members managing this client
                </CardDescription>
              </CardHeader>
              <CardContent>
                {staffLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : staffAssignments.length > 0 ? (
                  <div className="space-y-3">
                    {primaryStaff.map((assignment) => (
                      <div key={assignment.staffId} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-xs">Primary</Badge>
                          <span className="font-medium">{assignment.staffName}</span>
                        </div>
                        <Badge variant="outline">{assignment.role}</Badge>
                      </div>
                    ))}
                    {otherStaff.map((assignment) => (
                      <div key={assignment.staffId} className="flex items-center justify-between p-2 rounded-md">
                        <span>{assignment.staffName}</span>
                        <Badge variant="outline">{assignment.role}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">No staff assigned</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Client Overview
                </CardTitle>
                <CardDescription>
                  Quick summary of client information
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {client.contactPerson && (
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Contact: {client.contactPerson}</span>
                    </div>
                  )}
                  {client.address && (
                    <div className="flex items-start gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <span className="text-sm">{client.address}</span>
                    </div>
                  )}
                  {client.region && (
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Region: {client.region}</span>
                    </div>
                  )}
                  {client.country && (
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Country: {client.country}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Since: {format(new Date(client.createdAt), "MMM dd, yyyy")}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="staff" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Staff Assignments</CardTitle>
              <CardDescription>
                All staff members assigned to this client
              </CardDescription>
            </CardHeader>
            <CardContent>
              {staffLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : staffAssignments.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staffAssignments.map((assignment) => (
                      <TableRow key={assignment.staffId}>
                        <TableCell className="font-medium">{assignment.staffName}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{assignment.role}</Badge>
                        </TableCell>
                        <TableCell>
                          {assignment.isPrimary && <Badge variant="default">Primary</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-8">No staff assigned to this client</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vendors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Client Vendors</CardTitle>
              <CardDescription>
                Vendors working with this client
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vendorsLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : vendors.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Country</TableHead>
                      <TableHead>Merchandiser</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendors.slice(0, 20).map((vendor) => (
                      <TableRow key={vendor.id}>
                        <TableCell>
                          <Link 
                            href={`/vendors/${vendor.id}`}
                            className="text-primary hover:underline font-medium"
                          >
                            {vendor.name}
                          </Link>
                        </TableCell>
                        <TableCell>—</TableCell>
                        <TableCell>{vendor.country || "-"}</TableCell>
                        <TableCell>{vendor.merchandiser || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-8">No vendors associated with this client</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Purchase Orders</CardTitle>
              <CardDescription>
                Latest 10 purchase orders for this client
              </CardDescription>
            </CardHeader>
            <CardContent>
              {posLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : recentPOs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO Number</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Ship Date</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentPOs.map((po) => (
                      <TableRow key={po.id}>
                        <TableCell>
                          <Link 
                            href={`/purchase-orders/${po.poNumber}`}
                            className="text-primary hover:underline font-medium"
                          >
                            {po.poNumber}
                          </Link>
                        </TableCell>
                        <TableCell>{po.vendor || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{po.status || "Unknown"}</Badge>
                        </TableCell>
                        <TableCell>
                          {po.revisedCancelDate 
                            ? format(new Date(po.revisedCancelDate), "MM/dd/yyyy") 
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(po.totalValue || 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-8">No purchase orders found</p>
              )}
              {purchaseOrders.length > 10 && (
                <div className="mt-4 text-center">
                  <Link href={`/purchase-orders?client=${encodeURIComponent(client.name)}`}>
                    <Button variant="outline">
                      View All {purchaseOrders.length} Orders
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                Activity Log
              </CardTitle>
              <CardDescription>
                Notes and action items for this client
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-center py-8">
                Client activity logging coming soon. View individual purchase orders or vendors for activity notes.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
