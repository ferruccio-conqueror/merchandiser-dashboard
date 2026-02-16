import { DataTable } from "../DataTable";
import { Badge } from "@/components/ui/badge";

export default function DataTableExample() {
  const columns = [
    { key: "poNumber", label: "PO Number", sortable: true },
    { key: "vendor", label: "Vendor", sortable: true },
    { key: "status", label: "Status", render: (value: string) => {
      const variant = value === "On Time" ? "default" : value === "At Risk" ? "secondary" : "destructive";
      return <Badge variant={variant}>{value}</Badge>;
    }},
    { key: "shipDate", label: "Ship Date", sortable: true },
    { key: "quantity", label: "Quantity", sortable: true },
  ];

  const mockData = [
    { poNumber: "PO-2024-001", vendor: "Vendor A", status: "On Time", shipDate: "2024-01-15", quantity: 500 },
    { poNumber: "PO-2024-002", vendor: "Vendor B", status: "Late", shipDate: "2024-01-20", quantity: 750 },
    { poNumber: "PO-2024-003", vendor: "Vendor C", status: "At Risk", shipDate: "2024-01-25", quantity: 300 },
    { poNumber: "PO-2024-004", vendor: "Vendor A", status: "On Time", shipDate: "2024-02-01", quantity: 450 },
    { poNumber: "PO-2024-005", vendor: "Vendor D", status: "On Time", shipDate: "2024-02-10", quantity: 600 },
  ];

  return (
    <div className="p-8">
      <DataTable
        columns={columns}
        data={mockData}
        searchPlaceholder="Search purchase orders..."
        onExport={() => console.log("Exporting data...")}
      />
    </div>
  );
}
