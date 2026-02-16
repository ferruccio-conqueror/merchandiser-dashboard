import { useState, useCallback } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface FileUploadZoneProps {
  onFileSelect?: (file: File) => void;
  acceptedFormats?: string[];
}

export function FileUploadZone({ onFileSelect, acceptedFormats = [".csv", ".xlsx", ".xls"] }: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      setSelectedFile(files[0]);
      onFileSelect?.(files[0]);
    }
  }, [onFileSelect]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      onFileSelect?.(e.target.files[0]);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
  };

  return (
    <Card
      className={`p-8 transition-colors ${isDragging ? "border-primary bg-primary/5" : ""}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      {!selectedFile ? (
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <div className="rounded-full bg-muted p-4">
            <Upload className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="text-base font-medium">Drop your file here or click to browse</p>
            <p className="text-sm text-muted-foreground mt-1">
              Supported formats: {acceptedFormats.join(", ")}
            </p>
          </div>
          <input
            type="file"
            accept={acceptedFormats.join(",")}
            onChange={handleFileInput}
            className="hidden"
            id="file-upload"
            data-testid="input-file-upload"
          />
          <label htmlFor="file-upload">
            <Button variant="outline" asChild data-testid="button-browse-files">
              <span>Browse Files</span>
            </Button>
          </label>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-8 w-8 text-primary" />
            <div>
              <p className="font-medium" data-testid="text-filename">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(2)} KB
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={clearFile} data-testid="button-clear-file">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </Card>
  );
}
