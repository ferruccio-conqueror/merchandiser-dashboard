import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Mail, Phone, MapPin } from "lucide-react";
import type { Client } from "@shared/schema";

interface ClientKPIs {
  totalPOs: number;
  totalValue: number;
  openPOs: number;
  shippedPOs: number;
  otdPercentage: number;
  atRiskPOs: number;
  vendorCount: number;
}

export default function Clients() {
  const { data: clients, isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value / 100);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="heading-clients">Clients</h1>
        <p className="text-muted-foreground">
          Manage client relationships and view performance metrics
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            All Clients ({clients?.length || 0})
          </CardTitle>
          <CardDescription>
            Click on a client to view details and performance metrics
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4" data-testid="skeleton-loading">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : clients && clients.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow 
                    key={client.id} 
                    className="cursor-pointer hover-elevate"
                    data-testid={`client-row-${client.id}`}
                  >
                    <TableCell>
                      <Link 
                        href={`/clients/${client.id}`}
                        className="text-primary hover:underline font-medium"
                        data-testid={`link-client-${client.id}`}
                      >
                        {client.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {client.code ? (
                        <Badge variant="outline">{client.code}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {client.contactPerson && (
                          <p className="text-sm font-medium">{client.contactPerson}</p>
                        )}
                        {client.email && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {client.email}
                          </p>
                        )}
                        {client.phone && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {client.phone}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {client.region || client.country ? (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">
                            {[client.region, client.country].filter(Boolean).join(", ")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={client.status === "active" ? "default" : "secondary"}>
                        {client.status || "active"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8" data-testid="text-empty">
              No clients found
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
