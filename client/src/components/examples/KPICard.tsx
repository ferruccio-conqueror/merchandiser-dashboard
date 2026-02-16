import { KPICard } from "../KPICard";

export default function KPICardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 p-8">
      <KPICard
        title="OTD %"
        value="94.9%"
        subtitle="To consolidate"
        trend="up"
        trendValue="+2.3%"
      />
      <KPICard
        title="Original OTD"
        value="49.1%"
        subtitle="1053 orders"
        trend="down"
        trendValue="-5.1%"
      />
      <KPICard
        title="Avg Late"
        value="5 days"
        subtitle="Delayed"
        trend="down"
        trendValue="-1 day"
      />
      <KPICard
        title="No Regular"
        value="118d"
        subtitle="47 orders"
        trend="neutral"
      />
    </div>
  );
}
