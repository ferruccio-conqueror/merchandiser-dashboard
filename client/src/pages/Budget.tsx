import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Target, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Budget() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-budget-title">
          <DollarSign className="h-6 w-6" />
          Budget Overview
        </h1>
        <p className="text-muted-foreground">Track and manage merchandising budget allocations</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Budget (YTD)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-500" />
              <span className="text-3xl font-bold" data-testid="text-total-budget">
                $0
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Allocated for this year</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Spent (YTD)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-orange-500" />
              <span className="text-3xl font-bold" data-testid="text-spent-budget">
                $0
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">0% of budget used</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Remaining</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <span className="text-3xl font-bold text-green-600" data-testid="text-remaining-budget">
                $0
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Available to spend</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Forecast Variance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <span className="text-3xl font-bold" data-testid="text-variance">
                $0
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Projected difference</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Budget by Category</CardTitle>
          <CardDescription>Breakdown of budget allocation across categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Budget Module Coming Soon</h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              This feature will allow you to track budget allocations, compare actuals vs planned spending, 
              and generate budget reports for merchandising operations.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
