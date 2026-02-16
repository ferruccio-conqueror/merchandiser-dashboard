import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, FileText, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import type { PurchaseOrder } from "@shared/schema";

export default function POLookup() {
  const [, setLocation] = useLocation();
  const [searchValue, setSearchValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: searchResults = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders/search", searchQuery],
    enabled: searchQuery.length >= 3,
  });

  const handleSearch = () => {
    if (searchValue.trim().length >= 3) {
      setSearchQuery(searchValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const navigateToPO = (poNumber: string) => {
    setLocation(`/purchase-orders/${poNumber}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-po-lookup-title">
          <FileText className="h-6 w-6" />
          PO Details Lookup
        </h1>
        <p className="text-muted-foreground">Search for a purchase order by PO number</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Search Purchase Order</CardTitle>
          <CardDescription>Enter a PO number to view its details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Enter PO number (e.g., 444-6683716)"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-10"
                data-testid="input-po-search"
              />
            </div>
            <Button onClick={handleSearch} data-testid="button-search-po">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {searchQuery && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Search Results</CardTitle>
            <CardDescription>
              {isLoading ? "Searching..." : `Found ${searchResults.length} result(s) for "${searchQuery}"`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-2">
                {searchResults.slice(0, 20).map((po) => (
                  <div
                    key={po.id}
                    className="flex items-center justify-between p-4 rounded-lg border hover-elevate cursor-pointer"
                    onClick={() => navigateToPO(po.poNumber)}
                    data-testid={`result-po-${po.poNumber}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-primary">{po.poNumber}</span>
                        {po.copNumber && (
                          <span className="text-sm text-muted-foreground">/ {po.copNumber}</span>
                        )}
                        <Badge variant="outline">{po.status}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span>{po.vendor}</span>
                        {po.revisedShipDate && (
                          <span> • Ship Date: {format(new Date(po.revisedShipDate), "MM/dd/yyyy")}</span>
                        )}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon">
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No purchase orders found matching "{searchQuery}"</p>
                <p className="text-sm text-muted-foreground mt-1">Try a different PO number</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!searchQuery && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Enter a PO Number</h3>
              <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                Search for a purchase order to view its complete details including line items, 
                shipments, inspections, and quality tests.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
