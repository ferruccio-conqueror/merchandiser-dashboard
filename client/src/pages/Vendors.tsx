import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Building2, Users, ExternalLink } from "lucide-react";
import { HelpButton } from "@/components/HelpButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClientContext } from "@/contexts/ClientContext";

export default function Vendors() {
  const { toast } = useToast();
  const { selectedClient } = useClientContext();

  // Build API URL with client filter - for vendors we use vendor_client_assignments
  const vendorsQueryKey = selectedClient?.shortName 
    ? `/api/vendors?client=${encodeURIComponent(selectedClient.shortName)}`
    : "/api/vendors";

  const { data: vendors, isLoading: vendorsLoading } = useQuery<any[]>({
    queryKey: [vendorsQueryKey],
  });

  const { data: staff, isLoading: staffLoading } = useQuery<any[]>({
    queryKey: ["/api/staff"],
  });

  const updateVendorStaffMutation = useMutation({
    mutationFn: async ({ vendorId, updates }: { vendorId: number; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/vendors/${vendorId}`, updates);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Assignment Updated",
        description: "Staff assignment updated successfully",
      });
      // Invalidate both client-scoped and base vendor queries for cache consistency
      queryClient.invalidateQueries({ queryKey: [vendorsQueryKey] });
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleMerchandiserChange = (vendorId: number, staffId: string) => {
    const selectedStaff = staff?.find((s) => s.id === parseInt(staffId));
    if (!selectedStaff) return;

    updateVendorStaffMutation.mutate({
      vendorId,
      updates: {
        merchandiserId: selectedStaff.id,
        merchandiser: selectedStaff.name,
      },
    });
  };

  const handleManagerChange = (vendorId: number, staffId: string) => {
    const selectedStaff = staff?.find((s) => s.id === parseInt(staffId));
    if (!selectedStaff) return;

    updateVendorStaffMutation.mutate({
      vendorId,
      updates: {
        merchandisingManagerId: selectedStaff.id,
        merchandisingManager: selectedStaff.name,
      },
    });
  };

  const merchandisers = staff?.filter((s) => s.role === "merchandiser" && s.status === "active") || [];
  const merchandisingManagers = staff?.filter((s) => s.role === "merchandising_manager" && s.status === "active") || [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="heading-vendors">Vendors</h1>
          <p className="text-muted-foreground">
            Manage vendor information and staff assignments
          </p>
        </div>
        <HelpButton section="vendors" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Vendor Directory ({vendors?.length || 0})
          </CardTitle>
          <CardDescription>
            Assign merchandisers and merchandising managers to vendors
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vendorsLoading || staffLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : vendors && vendors.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor Name</TableHead>
                  <TableHead>Merchandiser</TableHead>
                  <TableHead>Merchandising Manager</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((vendor: any) => (
                  <TableRow key={vendor.id} data-testid={`vendor-row-${vendor.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/vendors/${vendor.id}`}>
                        <span className="text-primary hover:underline cursor-pointer flex items-center gap-1" data-testid={`link-vendor-${vendor.id}`}>
                          {vendor.name}
                          <ExternalLink className="h-3 w-3" />
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={vendor.merchandiserId?.toString() || ""}
                        onValueChange={(value) => handleMerchandiserChange(vendor.id, value)}
                        disabled={updateVendorStaffMutation.isPending}
                      >
                        <SelectTrigger className="w-[200px]" data-testid={`select-merchandiser-${vendor.id}`}>
                          <SelectValue placeholder="Select merchandiser" />
                        </SelectTrigger>
                        <SelectContent>
                          {merchandisers.map((m) => (
                            <SelectItem key={m.id} value={m.id.toString()}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={vendor.merchandisingManagerId?.toString() || ""}
                        onValueChange={(value) => handleManagerChange(vendor.id, value)}
                        disabled={updateVendorStaffMutation.isPending}
                      >
                        <SelectTrigger className="w-[200px]" data-testid={`select-manager-${vendor.id}`}>
                          <SelectValue placeholder="Select manager" />
                        </SelectTrigger>
                        <SelectContent>
                          {merchandisingManagers.map((m) => (
                            <SelectItem key={m.id} value={m.id.toString()}>
                              {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={vendor.status === "active" ? "default" : "secondary"}>
                        {vendor.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm">No vendors found</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
