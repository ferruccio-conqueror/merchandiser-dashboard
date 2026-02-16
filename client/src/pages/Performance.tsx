import { KPICard } from "@/components/KPICard";
import { StatusChart } from "@/components/StatusChart";
import { DataTable } from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";

export default function Performance() {
  const lateShipmentsData = [
    { name: "Week 1", value: 12 },
    { name: "Week 2", value: 8 },
    { name: "Week 3", value: 15 },
    { name: "Week 4", value: 10 },
  ];

  const vendorColumns = [
    { key: "vendor", label: "Vendor", sortable: true },
    { key: "totalPOs", label: "Total POs", sortable: true },
    { key: "onTime", label: "On Time %", sortable: true },
    { 
      key: "performance", 
      label: "Performance", 
      render: (value: string) => {
        const variant = value === "Excellent" ? "default" : value === "Good" ? "secondary" : "destructive";
        return <Badge variant={variant}>{value}</Badge>;
      }
    },
    { key: "avgDelay", label: "Avg Delay (days)", sortable: true },
  ];

  const vendorData = [
    { vendor: "Shanghai Furniture Co.", totalPOs: 145, onTime: "96.5%", performance: "Excellent", avgDelay: "0.5" },
    { vendor: "Vietnam Home Decor", totalPOs: 98, onTime: "89.2%", performance: "Good", avgDelay: "2.3" },
    { vendor: "Malaysian Crafts Ltd", totalPOs: 67, onTime: "78.5%", performance: "Poor", avgDelay: "5.1" },
    { vendor: "Thai Artisans Inc", totalPOs: 123, onTime: "94.1%", performance: "Excellent", avgDelay: "1.2" },
    { vendor: "Indonesia Exports", totalPOs: 88, onTime: "91.8%", performance: "Good", avgDelay: "1.8" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Performance Analysis</h1>
        <p className="text-muted-foreground">Analyze late shipments and vendor performance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KPICard
          title="Quality"
          value="98.6%"
          subtitle="Pass rate"
          trend="up"
          trendValue="+1.2%"
        />
        <KPICard
          title="1st MTD"
          value="53d"
          subtitle="67 orders"
        />
        <KPICard
          title="Repeat MTD"
          value="51d"
          subtitle="568 orders"
        />
        <KPICard
          title="Repeat Req"
          value="130d"
          subtitle="581 orders"
        />
      </div>

      <StatusChart title="Late Shipments Trend" data={lateShipmentsData} />

      <div>
        <h2 className="text-xl font-semibold mb-4">Vendor Performance</h2>
        <DataTable
          columns={vendorColumns}
          data={vendorData}
          searchPlaceholder="Search vendors..."
          onExport={() => console.log("Exporting vendor performance...")}
        />
      </div>
    </div>
  );
}
