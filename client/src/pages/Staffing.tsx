import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Upload, FileText, Users, UserCircle, Plus, Pencil, TrendingUp, Briefcase, Calendar, Package } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const staffFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  role: z.enum(["merchandiser", "merchandising_manager"]),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  office: z.string().optional(),
  status: z.string().default("active"),
  // HR fields
  title: z.string().optional(),
  department: z.string().optional(),
  employmentType: z.string().optional(),
  hireDate: z.string().optional(),
});

export default function Staffing() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isStaffDialogOpen, setIsStaffDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<any | null>(null);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof staffFormSchema>>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      name: "",
      role: "merchandiser",
      email: "",
      phone: "",
      office: "",
      status: "active",
      title: "",
      department: "",
      employmentType: "",
      hireDate: "",
    },
  });

  const { data: vendors, isLoading: vendorsLoading } = useQuery<any[]>({
    queryKey: ["/api/vendors"],
  });

  const { data: staff, isLoading: staffLoading } = useQuery<any[]>({
    queryKey: ["/api/staff"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/import/vendor-staff-mapping", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Import Successful",
        description: `Updated ${data.vendorsUpdated} vendors, created ${data.staffCreated} staff members`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      setSelectedFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveStaffMutation = useMutation({
    mutationFn: async (data: z.infer<typeof staffFormSchema>) => {
      if (editingStaff) {
        const res = await apiRequest("PATCH", `/api/staff/${editingStaff.id}`, data);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/staff", data);
        return res.json();
      }
    },
    onSuccess: () => {
      toast({
        title: editingStaff ? "Staff Updated" : "Staff Created",
        description: `Successfully ${editingStaff ? "updated" : "created"} staff member`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      setIsStaffDialogOpen(false);
      setEditingStaff(null);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const handleAddStaff = () => {
    setEditingStaff(null);
    form.reset({
      name: "",
      role: "merchandiser",
      email: "",
      phone: "",
      office: "",
      status: "active",
      title: "",
      department: "",
      employmentType: "",
      hireDate: "",
    });
    setIsStaffDialogOpen(true);
  };

  const handleEditStaff = (staffMember: any) => {
    setEditingStaff(staffMember);
    const hireDate = staffMember.hireDate 
      ? new Date(staffMember.hireDate).toISOString().split('T')[0]
      : "";
    
    form.reset({
      name: staffMember.name,
      role: staffMember.role,
      email: staffMember.email || "",
      phone: staffMember.phone || "",
      office: staffMember.office || "",
      status: staffMember.status,
      title: staffMember.title || "",
      department: staffMember.department || "",
      employmentType: staffMember.employmentType || "",
      hireDate,
    });
    setIsStaffDialogOpen(true);
  };

  const handleSubmitStaff = (data: z.infer<typeof staffFormSchema>) => {
    saveStaffMutation.mutate(data);
  };

  const merchandisers = staff?.filter((s) => s.role === "merchandiser") || [];
  const merchandisingManagers = staff?.filter((s) => s.role === "merchandising_manager") || [];

  // Component for displaying staff KPI metrics
  const StaffMetrics = ({ staffId }: { staffId: number }) => {
    const { data: metrics, isLoading } = useQuery<any>({
      queryKey: ['/api/staff', String(staffId), 'metrics'],
      enabled: !!staffId,
    });

    if (isLoading) {
      return <div className="text-xs text-muted-foreground">Loading metrics...</div>;
    }

    if (!metrics) {
      return null;
    }

    return (
      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t">
        <div className="text-xs">
          <div className="text-muted-foreground">Active POs</div>
          <div className="font-medium">{metrics.activePOs}</div>
        </div>
        <div className="text-xs">
          <div className="text-muted-foreground">Vendors</div>
          <div className="font-medium">{metrics.assignedVendors}</div>
        </div>
        <div className="text-xs">
          <div className="text-muted-foreground">OTD %</div>
          <div className="font-medium">{metrics.otdPercentage?.toFixed(1)}%</div>
        </div>
        <div className="text-xs">
          <div className="text-muted-foreground">At Risk</div>
          <div className="font-medium">{metrics.atRiskPOs}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="heading-staffing">Vendor Staffing Allocation Tool</h1>
        <p className="text-muted-foreground">
          Assign merchandisers and merchandising managers to vendors
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Vendor-to-Staff Mapping
          </CardTitle>
          <CardDescription>
            Upload a CSV file with columns: Vendor, Merchandiser, MM (Merchandising Manager)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                data-testid="input-file"
              />
            </div>
            {selectedFile && (
              <div className="flex items-center gap-2" data-testid="file-selected">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{selectedFile.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedFile(null)}
                  data-testid="button-clear-file"
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploadMutation.isPending}
            data-testid="button-upload"
          >
            {uploadMutation.isPending ? "Uploading..." : "Upload & Import"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <UserCircle className="h-5 w-5" />
                Merchandisers ({merchandisers.length})
              </CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  handleAddStaff();
                  form.setValue("role", "merchandiser");
                }}
                data-testid="button-add-merchandiser"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {staffLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : merchandisers.length > 0 ? (
              <div className="space-y-2">
                {merchandisers.map((s: any) => (
                  <div key={s.id} className="flex flex-col p-3 rounded border hover-elevate" data-testid={`staff-merchandiser-${s.id}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.name}</span>
                          {s.status && <Badge variant="secondary">{s.status}</Badge>}
                        </div>
                        {s.title && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Briefcase className="h-3 w-3" />
                            <span>{s.title}</span>
                          </div>
                        )}
                        {s.department && (
                          <div className="text-xs text-muted-foreground">
                            {s.department}
                          </div>
                        )}
                        {s.email && (
                          <div className="text-xs text-muted-foreground">{s.email}</div>
                        )}
                        {s.hireDate && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <span>Hired: {new Date(s.hireDate).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleEditStaff(s)}
                          data-testid={`button-edit-staff-${s.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <StaffMetrics staffId={s.id} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No merchandisers assigned</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Merchandising Managers ({merchandisingManagers.length})
              </CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  handleAddStaff();
                  form.setValue("role", "merchandising_manager");
                }}
                data-testid="button-add-manager"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {staffLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : merchandisingManagers.length > 0 ? (
              <div className="space-y-2">
                {merchandisingManagers.map((s: any) => (
                  <div key={s.id} className="flex flex-col p-3 rounded border hover-elevate" data-testid={`staff-manager-${s.id}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.name}</span>
                          {s.status && <Badge variant="secondary">{s.status}</Badge>}
                        </div>
                        {s.title && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Briefcase className="h-3 w-3" />
                            <span>{s.title}</span>
                          </div>
                        )}
                        {s.department && (
                          <div className="text-xs text-muted-foreground">
                            {s.department}
                          </div>
                        )}
                        {s.email && (
                          <div className="text-xs text-muted-foreground">{s.email}</div>
                        )}
                        {s.hireDate && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <span>Hired: {new Date(s.hireDate).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleEditStaff(s)}
                          data-testid={`button-edit-staff-${s.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <StaffMetrics staffId={s.id} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No merchandising managers assigned</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Vendor Assignments
          </CardTitle>
          <CardDescription>
            View and manage staff assignments for each vendor
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vendorsLoading ? (
            <p className="text-muted-foreground">Loading vendors...</p>
          ) : vendors && vendors.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Merchandiser</TableHead>
                  <TableHead>Merchandising Manager</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((vendor: any) => (
                  <TableRow key={vendor.id} data-testid={`vendor-row-${vendor.id}`}>
                    <TableCell className="font-medium">{vendor.name}</TableCell>
                    <TableCell>
                      {vendor.merchandiser ? (
                        <span className="text-sm">{vendor.merchandiser}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not assigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {vendor.merchandisingManager ? (
                        <span className="text-sm">{vendor.merchandisingManager}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not assigned</span>
                      )}
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

      <Dialog open={isStaffDialogOpen} onOpenChange={setIsStaffDialogOpen}>
        <DialogContent data-testid="dialog-staff-form">
          <DialogHeader>
            <DialogTitle>{editingStaff ? "Edit Staff Member" : "Add Staff Member"}</DialogTitle>
            <DialogDescription>
              {editingStaff ? "Update staff member details" : "Create a new staff member"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmitStaff)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter name" {...field} data-testid="input-staff-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-staff-role">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="merchandiser">Merchandiser</SelectItem>
                        <SelectItem value="merchandising_manager">Merchandising Manager</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (Optional)</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="Enter email" {...field} data-testid="input-staff-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter phone" {...field} data-testid="input-staff-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="office"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Office (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter office location" {...field} data-testid="input-staff-office" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="border-t pt-4 mt-4">
                <h4 className="text-sm font-medium mb-3">HR Information</h4>
                <div className="grid gap-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Job Title (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Senior Merchandiser" {...field} data-testid="input-staff-title" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Department (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Operations" {...field} data-testid="input-staff-department" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="employmentType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employment Type (Optional)</FormLabel>
                        <FormControl>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-employment-type">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="full_time">Full-time</SelectItem>
                              <SelectItem value="part_time">Part-time</SelectItem>
                              <SelectItem value="contract">Contract</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="hireDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Hire Date (Optional)</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-staff-hire-date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
              
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsStaffDialogOpen(false)}
                  data-testid="button-cancel-staff"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saveStaffMutation.isPending}
                  data-testid="button-save-staff"
                >
                  {saveStaffMutation.isPending ? "Saving..." : editingStaff ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
