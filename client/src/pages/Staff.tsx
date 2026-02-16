import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Users, Mail, Phone, Building2, Edit2, X, Star, Shield, ChevronRight, Briefcase, Calendar, Plus, Pencil } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import type { Staff, Client } from "@shared/schema";

interface ClientAssignment {
  clientId: number;
  clientName: string;
  role: string;
  isPrimary: boolean;
}

const staffFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  role: z.enum(["merchandiser", "merchandising_manager"]),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  office: z.string().optional(),
  status: z.string().default("active"),
  title: z.string().optional(),
  department: z.string().optional(),
  employmentType: z.string().optional(),
  hireDate: z.string().optional(),
});

export default function StaffPage() {
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isStaffFormOpen, setIsStaffFormOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const { hasFullAccess } = useAuth();

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

  const { data: staff, isLoading } = useQuery<Staff[]>({
    queryKey: ["/api/staff"],
  });

  const updateAccessLevelMutation = useMutation({
    mutationFn: async ({ staffId, accessLevel }: { staffId: number; accessLevel: string }) => {
      const res = await apiRequest("PATCH", `/api/staff/${staffId}/access-level`, { accessLevel });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Access Level Updated",
        description: "Staff member's access level has been updated",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
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
      setIsStaffFormOpen(false);
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

  const getAccessLevelLabel = (level: string | null | undefined) => {
    switch (level) {
      case "full_access":
        return "Full Access";
      case "level_1":
        return "Level 1";
      case "level_2":
        return "Level 2";
      default:
        return "Level 2";
    }
  };

  const getAccessLevelVariant = (level: string | null | undefined): "default" | "secondary" | "outline" | "destructive" => {
    switch (level) {
      case "full_access":
        return "default";
      case "level_1":
        return "secondary";
      default:
        return "outline";
    }
  };

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: staffClientAssignments, refetch: refetchAssignments } = useQuery<ClientAssignment[]>({
    queryKey: ["/api/staff", selectedStaffId, "client-assignments"],
    queryFn: async () => {
      if (!selectedStaffId) return [];
      const res = await fetch(`/api/staff/${selectedStaffId}/client-assignments`);
      if (!res.ok) throw new Error("Failed to fetch client assignments");
      return res.json();
    },
    enabled: !!selectedStaffId,
  });

  const assignClientMutation = useMutation({
    mutationFn: async ({ staffId, clientId, role, isPrimary }: { staffId: number; clientId: number; role: string; isPrimary: boolean }) => {
      const res = await apiRequest("POST", `/api/staff/${staffId}/client-assignments`, { clientId, role, isPrimary });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Client Assigned",
        description: "Staff member has been assigned to the client",
      });
      refetchAssignments();
    },
    onError: (error: Error) => {
      toast({
        title: "Assignment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeClientMutation = useMutation({
    mutationFn: async ({ staffId, clientId }: { staffId: number; clientId: number }) => {
      const res = await apiRequest("DELETE", `/api/staff/${staffId}/client-assignments/${clientId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Client Removed",
        description: "Staff member has been unassigned from the client",
      });
      refetchAssignments();
    },
    onError: (error: Error) => {
      toast({
        title: "Removal Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const filteredStaff = staff?.filter((member) => {
    const matchesRole = roleFilter === "all" || member.role === roleFilter;
    const matchesSearch = !searchTerm || 
      member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (member.email && member.email.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesRole && matchesSearch;
  }) || [];

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "merchandiser":
        return "default";
      case "merchandising_manager":
        return "secondary";
      default:
        return "outline";
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "merchandiser":
        return "Merchandiser";
      case "merchandising_manager":
        return "Manager";
      default:
        return role;
    }
  };

  const handleEditClients = (staffId: number) => {
    setSelectedStaffId(staffId);
    setIsEditDialogOpen(true);
  };

  const handleToggleClient = (clientId: number, isAssigned: boolean) => {
    if (!selectedStaffId) return;
    
    if (isAssigned) {
      removeClientMutation.mutate({ staffId: selectedStaffId, clientId });
    } else {
      assignClientMutation.mutate({ 
        staffId: selectedStaffId, 
        clientId, 
        role: staff?.find(s => s.id === selectedStaffId)?.role || "merchandiser",
        isPrimary: false 
      });
    }
  };

  const handleTogglePrimary = (clientId: number, currentlyPrimary: boolean) => {
    if (!selectedStaffId) return;
    const staffMember = staff?.find(s => s.id === selectedStaffId);
    assignClientMutation.mutate({
      staffId: selectedStaffId,
      clientId,
      role: staffMember?.role || "merchandiser",
      isPrimary: !currentlyPrimary,
    });
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
    setIsStaffFormOpen(true);
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
    setIsStaffFormOpen(true);
  };

  const handleSubmitStaff = (data: z.infer<typeof staffFormSchema>) => {
    saveStaffMutation.mutate(data);
  };

  const selectedStaffMember = staff?.find(s => s.id === selectedStaffId);

  const hasActiveFilters = roleFilter !== "all" || searchTerm !== "";

  const clearAllFilters = () => {
    setRoleFilter("all");
    setSearchTerm("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="heading-staff">Staff</h1>
          <p className="text-muted-foreground">
            View and manage merchandisers, managers, and their assignments
          </p>
        </div>
        <Button onClick={handleAddStaff} data-testid="button-add-staff">
          <Plus className="h-4 w-4 mr-2" />
          Add Staff
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px] max-w-[300px]">
            <Label htmlFor="search-staff" className="text-xs text-muted-foreground mb-1.5 block">Search</Label>
            <Input
              id="search-staff"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9"
              data-testid="input-search-staff"
            />
          </div>
          <div className="flex-1 min-w-[180px] max-w-[250px]">
            <Label htmlFor="role-filter" className="text-xs text-muted-foreground mb-1.5 block">Role</Label>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger id="role-filter" className="h-9" data-testid="select-role-filter">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="role-option-all">All Roles</SelectItem>
                <SelectItem value="merchandiser" data-testid="role-option-merchandiser">Merchandisers</SelectItem>
                <SelectItem value="merchandising_manager" data-testid="role-option-manager">Managers</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearAllFilters} 
              className="h-9"
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </Card>

      {hasActiveFilters && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg">
          <span className="text-sm text-muted-foreground">Filtered by:</span>
          {roleFilter !== "all" && (
            <Badge variant="secondary" data-testid="badge-filter-role">
              Role: {getRoleLabel(roleFilter)}
            </Badge>
          )}
          {searchTerm && (
            <Badge variant="secondary" data-testid="badge-filter-search">
              Search: "{searchTerm}"
            </Badge>
          )}
          <span className="text-sm text-muted-foreground ml-2">
            ({filteredStaff.length} of {staff?.length || 0} staff)
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Staff Members ({filteredStaff.length})
          </CardTitle>
          <CardDescription>
            Click on a staff member to view their profile and performance goals
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4" data-testid="skeleton-loading">
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No staff members found
            </div>
          ) : (
            <div className="space-y-2">
              {filteredStaff.map((member) => (
                <div key={member.id} className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between p-4 hover-elevate">
                    <Link href={`/staff/${member.id}`} className="flex items-center gap-4 flex-1 cursor-pointer">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium" data-testid={`staff-name-${member.id}`}>
                            {member.name}
                          </span>
                          <Badge 
                            variant={getRoleBadgeVariant(member.role)}
                            data-testid={`staff-role-${member.id}`}
                          >
                            {getRoleLabel(member.role)}
                          </Badge>
                          {member.status && member.status !== "active" && (
                            <Badge variant="outline">{member.status}</Badge>
                          )}
                        </div>
                        {member.title && (
                          <p className="text-sm text-muted-foreground">{member.title}</p>
                        )}
                        {member.email && (
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        )}
                      </div>
                    </Link>
                    <div className="flex items-center gap-3">
                      {hasFullAccess ? (
                        <Select
                          value={member.accessLevel || "level_2"}
                          onValueChange={(newLevel) => {
                            updateAccessLevelMutation.mutate({ staffId: member.id, accessLevel: newLevel });
                          }}
                          disabled={updateAccessLevelMutation.isPending}
                        >
                          <SelectTrigger 
                            className="w-[130px] h-8"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`select-access-level-${member.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="full_access">
                              <div className="flex items-center gap-2">
                                <Shield className="h-3 w-3 text-primary" />
                                Full Access
                              </div>
                            </SelectItem>
                            <SelectItem value="level_1">
                              <div className="flex items-center gap-2">
                                <Shield className="h-3 w-3 text-muted-foreground" />
                                Level 1
                              </div>
                            </SelectItem>
                            <SelectItem value="level_2">
                              <div className="flex items-center gap-2">
                                <Shield className="h-3 w-3 text-muted-foreground/50" />
                                Level 2
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge 
                          variant={getAccessLevelVariant(member.accessLevel)}
                          data-testid={`badge-access-level-${member.id}`}
                        >
                          <Shield className="h-3 w-3 mr-1" />
                          {getAccessLevelLabel(member.accessLevel)}
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          handleEditClients(member.id);
                        }}
                        data-testid={`button-edit-clients-${member.id}`}
                      >
                        <Building2 className="h-4 w-4 mr-1" />
                        Clients
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          handleEditStaff(member);
                        }}
                        data-testid={`button-edit-staff-${member.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Assign Clients to {selectedStaffMember?.name}
            </DialogTitle>
            <DialogDescription>
              Select which clients this staff member should be assigned to. Primary clients are marked with a star.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {clients?.map((client) => {
              const assignment = staffClientAssignments?.find(a => a.clientId === client.id);
              const isAssigned = !!assignment;
              
              return (
                <div 
                  key={client.id} 
                  className="flex items-center justify-between p-3 border rounded-md"
                  data-testid={`client-assignment-row-${client.id}`}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={`client-${client.id}`}
                      checked={isAssigned}
                      onCheckedChange={() => handleToggleClient(client.id, isAssigned)}
                      disabled={assignClientMutation.isPending || removeClientMutation.isPending}
                      data-testid={`checkbox-client-${client.id}`}
                    />
                    <label 
                      htmlFor={`client-${client.id}`}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {client.name}
                      {client.code && <span className="text-muted-foreground ml-1">({client.code})</span>}
                    </label>
                  </div>
                  
                  {isAssigned && (
                    <Button
                      size="icon"
                      variant={assignment?.isPrimary ? "default" : "ghost"}
                      onClick={() => handleTogglePrimary(client.id, assignment?.isPrimary || false)}
                      disabled={assignClientMutation.isPending}
                      title={assignment?.isPrimary ? "Primary client" : "Set as primary"}
                      data-testid={`button-primary-${client.id}`}
                    >
                      <Star className={`h-4 w-4 ${assignment?.isPrimary ? "fill-current" : ""}`} />
                    </Button>
                  )}
                </div>
              );
            })}
            
            {(!clients || clients.length === 0) && (
              <p className="text-muted-foreground text-center py-4">
                No clients available
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isStaffFormOpen} onOpenChange={setIsStaffFormOpen}>
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
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Email" {...field} data-testid="input-staff-email" />
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
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="Phone" {...field} data-testid="input-staff-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="office"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Office</FormLabel>
                      <FormControl>
                        <Input placeholder="Office location" {...field} data-testid="input-staff-office" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Job title" {...field} data-testid="input-staff-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department</FormLabel>
                      <FormControl>
                        <Input placeholder="Department" {...field} data-testid="input-staff-department" />
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
                      <FormLabel>Hire Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-staff-hire-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsStaffFormOpen(false)}
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
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
