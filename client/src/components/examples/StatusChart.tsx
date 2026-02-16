import { StatusChart } from "../StatusChart";

export default function StatusChartExample() {
  const mockData = [
    { name: "On Time", value: 1876 },
    { name: "At Risk", value: 234 },
    { name: "Late", value: 890 },
  ];

  return (
    <div className="p-8">
      <StatusChart title="PO Count by OTD Status" data={mockData} />
    </div>
  );
}
