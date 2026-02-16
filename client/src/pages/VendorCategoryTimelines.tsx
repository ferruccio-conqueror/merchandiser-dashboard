import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Calendar, RefreshCw, Clock, Package, CheckCircle, Truck } from "lucide-react";

interface CategoryTimelineAverage {
  id: number;
  productCategory: string;
  avgDaysToRawMaterials: number;
  avgDaysToInitialInspection: number;
  avgDaysToInlineInspection: number;
  avgDaysToFinalInspection: number;
  avgDaysToShipDate: number;
  sampleCount: number;
  lastCalculatedAt: string;
}

export default function VendorCategoryTimelines() {
  const { toast } = useToast();

  const { data: averages, isLoading } = useQuery<CategoryTimelineAverage[]>({
    queryKey: ["/api/category-timeline-averages"],
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/category-timeline-averages/recalculate");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Averages Recalculated",
        description: "Category timeline averages have been updated from historical data",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/category-timeline-averages"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Recalculation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const sortedAverages = averages?.sort((a, b) => a.productCategory.localeCompare(b.productCategory)) || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="h-6 w-6" />
            Vendor Category Timelines
          </h1>
          <p className="text-muted-foreground">
            Average milestone durations by product category, calculated from historical inspection data
          </p>
        </div>
        <Button
          onClick={() => recalculateMutation.mutate()}
          disabled={recalculateMutation.isPending}
          data-testid="button-recalculate"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${recalculateMutation.isPending ? 'animate-spin' : ''}`} />
          Recalculate Averages
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Timeline Averages by Category
          </CardTitle>
          <CardDescription>
            Days from PO date to each milestone, based on historical inspection records. Used for bulk timeline generation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : sortedAverages.length > 0 ? (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Category</TableHead>
                    <TableHead className="text-center font-semibold">
                      <div className="flex flex-col items-center gap-1">
                        <Package className="h-4 w-4" />
                        <span>Raw Materials</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center font-semibold">
                      <div className="flex flex-col items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        <span>Initial Insp.</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center font-semibold">
                      <div className="flex flex-col items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        <span>Inline Insp.</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center font-semibold">
                      <div className="flex flex-col items-center gap-1">
                        <CheckCircle className="h-4 w-4" />
                        <span>Final Insp.</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-center font-semibold">
                      <div className="flex flex-col items-center gap-1">
                        <Truck className="h-4 w-4" />
                        <span>Ship Date</span>
                      </div>
                    </TableHead>
                    <TableHead className="text-right font-semibold">Sample Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAverages.map((avg) => (
                    <TableRow key={avg.id} data-testid={`row-category-${avg.id}`}>
                      <TableCell className="font-medium">{avg.productCategory}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" data-testid={`text-raw-materials-${avg.id}`}>
                          {avg.avgDaysToRawMaterials} days
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" data-testid={`text-initial-${avg.id}`}>
                          {avg.avgDaysToInitialInspection} days
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" data-testid={`text-inline-${avg.id}`}>
                          {avg.avgDaysToInlineInspection} days
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" data-testid={`text-final-${avg.id}`}>
                          {avg.avgDaysToFinalInspection} days
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" data-testid={`text-ship-${avg.id}`}>
                          {avg.avgDaysToShipDate} days
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-muted-foreground">{avg.sampleCount.toLocaleString()} POs</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No category timeline data available. Click "Recalculate Averages" to generate from historical data.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How This Data Is Used</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            These averages are calculated from historical inspection data and represent the typical number of days 
            from PO date to each production milestone for each product category.
          </p>
          <p>
            When bulk generating timelines for purchase orders, these averages are used to automatically populate 
            planned dates for Raw Materials, Initial Inspection, Inline Inspection, Final Inspection, and Ship Date.
          </p>
          <p>
            Categories without historical data use default values (45/60/75/90/105 days respectively).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
