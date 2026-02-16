import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X, Calendar as CalendarIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";

interface FilterPanelProps {
  vendors?: string[];
  regions?: string[];
  merchandisers?: string[];
  categories?: string[];
  onFilterChange?: (filters: any) => void;
}

export function FilterPanel({ vendors = [], regions = [], merchandisers = [], categories = [], onFilterChange }: FilterPanelProps) {
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<string>("");
  const [selectedMerchandiser, setSelectedMerchandiser] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});

  const activeFilters = [
    selectedVendor && { type: "vendor", value: selectedVendor },
    selectedRegion && { type: "region", value: selectedRegion },
    selectedMerchandiser && { type: "merchandiser", value: selectedMerchandiser },
    selectedCategory && { type: "category", value: selectedCategory },
  ].filter(Boolean);

  const clearAllFilters = () => {
    setSelectedVendor("");
    setSelectedRegion("");
    setSelectedMerchandiser("");
    setSelectedCategory("");
    setDateRange({});
    onFilterChange?.({});
  };

  const removeFilter = (type: string) => {
    switch (type) {
      case "vendor":
        setSelectedVendor("");
        break;
      case "region":
        setSelectedRegion("");
        break;
      case "merchandiser":
        setSelectedMerchandiser("");
        break;
      case "category":
        setSelectedCategory("");
        break;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Filters</h3>
        {activeFilters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} data-testid="button-clear-filters">
            Clear All
          </Button>
        )}
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilters.map((filter: any) => (
            <Badge key={filter.type} variant="secondary" className="gap-1" data-testid={`filter-chip-${filter.type}`}>
              {filter.value}
              <button onClick={() => removeFilter(filter.type)} data-testid={`button-remove-${filter.type}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <Label htmlFor="vendor" className="text-sm">Vendor</Label>
          <Select value={selectedVendor} onValueChange={setSelectedVendor}>
            <SelectTrigger id="vendor" data-testid="select-vendor">
              <SelectValue placeholder="All Vendors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vendors</SelectItem>
              {vendors.map((vendor) => (
                <SelectItem key={vendor} value={vendor}>{vendor}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="region" className="text-sm">Region</Label>
          <Select value={selectedRegion} onValueChange={setSelectedRegion}>
            <SelectTrigger id="region" data-testid="select-region">
              <SelectValue placeholder="All Regions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Regions</SelectItem>
              {regions.map((region) => (
                <SelectItem key={region} value={region}>{region}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="merchandiser" className="text-sm">Merchandiser</Label>
          <Select value={selectedMerchandiser} onValueChange={setSelectedMerchandiser}>
            <SelectTrigger id="merchandiser" data-testid="select-merchandiser">
              <SelectValue placeholder="All Merchandisers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Merchandisers</SelectItem>
              {merchandisers.map((merchandiser) => (
                <SelectItem key={merchandiser} value={merchandiser}>{merchandiser}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="category" className="text-sm">Category</Label>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger id="category" data-testid="select-category">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>{category}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-sm">Date Range</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left font-normal" data-testid="button-date-range">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}
                    </>
                  ) : (
                    format(dateRange.from, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange.from}
                selected={{ from: dateRange.from, to: dateRange.to }}
                onSelect={(range) => setDateRange(range || {})}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
