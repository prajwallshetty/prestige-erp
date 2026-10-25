"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, FileText, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { uploadCatalogueAction } from "./actions";

export function UploadCatalogueModal() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [progressMsg, setProgressMsg] = useState("");
  const router = useRouter();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && dropped.type === "application/pdf") {
      setFile(dropped);
    } else {
      toast.error("Please drop a valid PDF brochure or catalogue");
    }
  };

  const handleUpload = () => {
    if (!file) return;

    startTransition(async () => {
      setProgressMsg("Uploading brochure and initiating multi-stage AI extraction...");
      const formData = new FormData();
      formData.append("file", file);

      const res = await uploadCatalogueAction(formData);
      if (!res.ok) {
        toast.error(res.error || "Failed to upload catalogue");
        setProgressMsg("");
        return;
      }

      toast.success("Catalogue uploaded and processed!");
      setOpen(false);
      setFile(null);
      setProgressMsg("");
      router.push(`/products/catalogue-import/${res.data.jobId}`);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UploadCloud className="mr-2 h-4 w-4" />
          Upload Catalogue PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import Supplier Catalogue / Brochure</DialogTitle>
          <DialogDescription>
            Upload a manufacturer brochure or product catalogue in PDF format. The AI pipeline will extract tile specifications, crop product swatches, and match images for your review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : file
                ? "border-success/50 bg-success/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            {file ? (
              <div className="space-y-2">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
                  <FileText className="h-6 w-6" />
                </div>
                <div className="font-medium text-foreground">{file.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB · PDF Document
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setFile(null)}
                  disabled={isPending}
                  className="text-xs text-destructive hover:text-destructive"
                >
                  Choose different file
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <UploadCloud className="h-6 w-6" />
                </div>
                <div>
                  <label
                    htmlFor="catalogue-file"
                    className="cursor-pointer font-medium text-primary hover:underline"
                  >
                    Click to browse
                  </label>{" "}
                  <span className="text-muted-foreground">or drag and drop your PDF here</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Supports multi-page digital PDFs, scanned brochures, and composite tile grids up to 50 MB
                </p>
                <input
                  id="catalogue-file"
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const selected = e.target.files?.[0];
                    if (selected) setFile(selected);
                  }}
                  disabled={isPending}
                />
              </div>
            )}
          </div>

          {isPending ? (
            <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="font-medium">Processing Document</p>
                <p className="text-xs text-muted-foreground">{progressMsg || "Extracting text and images..."}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <AlertCircle className="h-3.5 w-3.5 text-primary" />
                Pipeline Highlights:
              </div>
              <p>• Extract embedded images with exact aspect ratios and detect tile sample grids.</p>
              <p>• Identifies size, surface finish, pieces/box, coverage/box, MRP, and product codes.</p>
              <p>• Compares against ERP Product Master to identify duplicates before publishing.</p>
              <p className="font-medium text-foreground/80">• Inventory safeguard: Product catalogue import will never increase stock.</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setFile(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!file || isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                "Start Extraction"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
