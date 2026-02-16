import { FileUploadZone } from "../FileUploadZone";

export default function FileUploadZoneExample() {
  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-xl font-semibold mb-4">Upload Purchase Order Data</h2>
      <FileUploadZone
        onFileSelect={(file) => console.log("File selected:", file.name)}
        acceptedFormats={[".csv", ".xlsx", ".xls"]}
      />
    </div>
  );
}
