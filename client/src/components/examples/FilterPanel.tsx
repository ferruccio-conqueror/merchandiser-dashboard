import { FilterPanel } from "../FilterPanel";

export default function FilterPanelExample() {
  const mockVendors = ["Vendor A", "Vendor B", "Vendor C"];
  const mockRegions = ["Asia", "Europe", "North America"];
  const mockMerchandisers = ["John Doe", "Jane Smith", "Bob Wilson"];
  const mockCategories = ["Furniture", "Home Decor", "Lighting"];

  return (
    <div className="p-8 max-w-sm">
      <FilterPanel
        vendors={mockVendors}
        regions={mockRegions}
        merchandisers={mockMerchandisers}
        categories={mockCategories}
        onFilterChange={(filters) => console.log("Filters changed:", filters)}
      />
    </div>
  );
}
