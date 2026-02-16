import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export interface DashboardFilters {
  merchandiser?: string;
  merchandisingManager?: string;
  vendor?: string;
  brand?: string;
  startDate?: Date;
  endDate?: Date;
}

interface DashboardFiltersProps {
  filters: DashboardFilters;
  onFiltersChange: (filters: DashboardFilters) => void;
  merchandisers: string[];
  managers: string[];
  vendors: string[];
  brands?: string[];
}

export function DashboardFiltersPanel({
  filters,
  onFiltersChange,
  merchandisers,
  managers,
  vendors,
  brands = [],
}: DashboardFiltersProps) {
  const hasActiveFilters = Object.values(filters).some(v => v !== undefined);

  const handleClearAll = () => {
    onFiltersChange({});
  };

  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Filters</h3>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-1" />
              Clear All
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          {/* Merchandiser Filter */}
          <div className="space-y-2 min-w-[160px] flex-1">
            <label className="text-sm font-medium">Merchandiser</label>
            <Select
              value={filters.merchandiser || "all"}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  merchandiser: value === "all" ? undefined : value,
                })
              }
            >
              <SelectTrigger data-testid="select-merchandiser">
                <SelectValue placeholder="All Merchandisers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Merchandisers</SelectItem>
                {merchandisers.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Merchandising Manager Filter */}
          <div className="space-y-2 min-w-[160px] flex-1">
            <label className="text-sm font-medium">Manager</label>
            <Select
              value={filters.merchandisingManager || "all"}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  merchandisingManager: value === "all" ? undefined : value,
                })
              }
            >
              <SelectTrigger data-testid="select-manager">
                <SelectValue placeholder="All Managers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Managers</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vendor Filter */}
          <div className="space-y-2 min-w-[160px] flex-1">
            <label className="text-sm font-medium">Vendor</label>
            <Select
              value={filters.vendor || "all"}
              onValueChange={(value) =>
                onFiltersChange({
                  ...filters,
                  vendor: value === "all" ? undefined : value,
                })
              }
            >
              <SelectTrigger data-testid="select-vendor">
                <SelectValue placeholder="All Vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vendors</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Brand Filter */}
          {brands.length > 0 && (
            <div className="space-y-2 min-w-[140px] flex-1">
              <label className="text-sm font-medium">Brand</label>
              <Select
                value={filters.brand || "all"}
                onValueChange={(value) =>
                  onFiltersChange({
                    ...filters,
                    brand: value === "all" ? undefined : value,
                  })
                }
              >
                <SelectTrigger data-testid="select-brand">
                  <SelectValue placeholder="All Brands" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Start Date Calendar Picker */}
          <div className="space-y-2 min-w-[160px]">
            <label className="text-sm font-medium">Start Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !filters.startDate && "text-muted-foreground"
                  )}
                  data-testid="button-start-date"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.startDate ? format(filters.startDate, "MMM d, yyyy") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.startDate}
                  onSelect={(date) =>
                    onFiltersChange({
                      ...filters,
                      startDate: date || undefined,
                    })
                  }
                  initialFocus
                  defaultMonth={filters.startDate || new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* End Date Calendar Picker */}
          <div className="space-y-2 min-w-[160px]">
            <label className="text-sm font-medium">End Date</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !filters.endDate && "text-muted-foreground"
                  )}
                  data-testid="button-end-date"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filters.endDate ? format(filters.endDate, "MMM d, yyyy") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={filters.endDate}
                  onSelect={(date) =>
                    onFiltersChange({
                      ...filters,
                      endDate: date || undefined,
                    })
                  }
                  initialFocus
                  defaultMonth={filters.endDate || new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
