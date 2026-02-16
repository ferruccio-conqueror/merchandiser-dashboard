import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, Search, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Column {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: any, row: any) => React.ReactNode;
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  searchPlaceholder?: string;
  onExport?: (filteredData: any[]) => void;
  onRowClick?: (row: any) => void;
  hideSearch?: boolean;
  hideExport?: boolean;
}

export function DataTable({ columns, data, searchPlaceholder = "Search...", onExport, onRowClick, hideSearch = false, hideExport = false }: DataTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const sortedData = [...data].sort((a, b) => {
    if (!sortConfig) return 0;
    let aValue = a[sortConfig.key];
    let bValue = b[sortConfig.key];
    
    // Handle null/undefined values - push them to the end
    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    
    // Handle Date objects
    if (aValue instanceof Date && bValue instanceof Date) {
      const diff = aValue.getTime() - bValue.getTime();
      return sortConfig.direction === "asc" ? diff : -diff;
    }
    
    // Handle date strings (ISO format like "2025-01-28" or "2025-01-28T00:00:00")
    const dateRegex = /^\d{4}-\d{2}-\d{2}/;
    if (typeof aValue === 'string' && typeof bValue === 'string' && 
        dateRegex.test(aValue) && dateRegex.test(bValue)) {
      const aDate = new Date(aValue).getTime();
      const bDate = new Date(bValue).getTime();
      if (!isNaN(aDate) && !isNaN(bDate)) {
        const diff = aDate - bDate;
        return sortConfig.direction === "asc" ? diff : -diff;
      }
    }
    
    // Handle numbers (including numbers stored as strings)
    const aNum = typeof aValue === 'number' ? aValue : parseFloat(String(aValue));
    const bNum = typeof bValue === 'number' ? bValue : parseFloat(String(bValue));
    if (!isNaN(aNum) && !isNaN(bNum)) {
      const diff = aNum - bNum;
      return sortConfig.direction === "asc" ? diff : -diff;
    }
    
    // Handle strings (case-insensitive)
    const aStr = String(aValue).toLowerCase();
    const bStr = String(bValue).toLowerCase();
    if (aStr < bStr) return sortConfig.direction === "asc" ? -1 : 1;
    if (aStr > bStr) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });

  const filteredData = sortedData.filter((row) =>
    Object.values(row).some((value) =>
      String(value).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  return (
    <div className="space-y-4">
      {(!hideSearch || (!hideExport && onExport)) && (
        <div className="flex items-center justify-between gap-4">
          {!hideSearch && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
          )}
          {!hideExport && onExport && (
            <Button variant="outline" onClick={() => onExport(filteredData)} data-testid="button-export">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          )}
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key}>
                  {column.sortable ? (
                    <Button
                      variant="ghost"
                      onClick={() => handleSort(column.key)}
                      className="h-auto p-0 hover:bg-transparent"
                      data-testid={`sort-${column.key}`}
                    >
                      {column.label}
                      <ArrowUpDown className="ml-2 h-3 w-3" />
                    </Button>
                  ) : (
                    column.label
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No results found.
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((row, index) => (
                <TableRow 
                  key={index} 
                  className={`hover-elevate ${onRowClick ? 'cursor-pointer' : ''}`}
                  data-testid={`row-${index}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <TableCell key={column.key}>
                      {column.render ? column.render(row[column.key], row) : row[column.key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          Showing {filteredData.length} of {data.length} results
        </div>
      </div>
    </div>
  );
}
