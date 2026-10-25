import Link from "next/link";
import { ArrowLeft, Clock, CheckCircle2, AlertTriangle, FileScan, Sparkles, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { formatDate } from "@/lib/dates";
import { UploadCatalogueModal } from "./upload-modal";

export const metadata = { title: "Catalogue OCR Import — Technic Technologies" };

const STATUS_CONFIG: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  UPLOADED: { label: "Uploaded", tone: "neutral" },
  PROCESSING: { label: "Processing", tone: "info" },
  REVIEW_REQUIRED: { label: "Review Required", tone: "warning" },
  APPROVED: { label: "Approved", tone: "info" },
  IMPORTED: { label: "Imported", tone: "success" },
  PARTIALLY_IMPORTED: { label: "Partially Imported", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export default async function CatalogueImportJobsPage() {
  const user = await requirePermissionInFirm("products.view");
  const firmId = user.activeFirmId;

  const [totalJobs, jobs, stats] = await Promise.all([
    prisma.catalogueImportJob.count({ where: { firmId } }),
    prisma.catalogueImportJob.findMany({
      where: { firmId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        _count: {
          select: { items: true },
        },
      },
    }),
    prisma.catalogueImportJob.groupBy({
      by: ["status"],
      where: { firmId },
      _count: { id: true },
    }),
  ]);

  const counts = {
    reviewRequired: stats.find((s) => s.status === "REVIEW_REQUIRED")?._count.id ?? 0,
    imported: stats.find((s) => s.status === "IMPORTED" || s.status === "PARTIALLY_IMPORTED")?._count.id ?? 0,
    processing: stats.find((s) => s.status === "PROCESSING" || s.status === "UPLOADED")?._count.id ?? 0,
  };

  interface JobRow {
    id: string;
    name: string;
    sourceFilename: string;
    fileSize: number;
    pageCount: number | null;
    status: string;
    totalProducts: number;
    approvedProducts: number;
    importedProducts: number;
    lastError: string | null;
    createdAt: Date;
  }

  const rows: JobRow[] = jobs.map((job) => ({
    id: job.id,
    name: job.name,
    sourceFilename: job.sourceFilename,
    fileSize: job.fileSize,
    pageCount: job.pageCount,
    status: job.status,
    totalProducts: job.totalProducts,
    approvedProducts: job.approvedProducts,
    importedProducts: job.importedProducts,
    lastError: job.lastError,
    createdAt: job.createdAt,
  }));

  const columns: Column<JobRow>[] = [
    {
      key: "name",
      header: "Catalogue Brochure",
      cell: (row) => (
        <div>
          <Link
            href={`/products/catalogue-import/${row.id}`}
            className="font-medium hover:text-primary hover:underline"
          >
            {row.name}
          </Link>
          <span className="block text-xs text-muted-foreground">
            {row.sourceFilename} · {(row.fileSize / (1024 * 1024)).toFixed(1)} MB
            {row.pageCount ? ` · ${row.pageCount} pages` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const conf = STATUS_CONFIG[row.status] ?? { label: row.status, tone: "neutral" as const };
        return <StatusBadge status={row.status} label={conf.label} tone={conf.tone} dot />;
      },
    },
    {
      key: "products",
      header: "Extracted Products",
      className: "text-center",
      cell: (row) => (
        <div className="text-sm">
          <span className="font-semibold">{row.totalProducts}</span>
          <span className="text-xs text-muted-foreground ml-1">items</span>
          {row.importedProducts > 0 ? (
            <span className="block text-[11px] text-success">
              {row.importedProducts} published to ERP
            </span>
          ) : row.approvedProducts > 0 ? (
            <span className="block text-[11px] text-primary">
              {row.approvedProducts} approved
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "date",
      header: "Uploaded At",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <Button asChild size="sm" variant={row.status === "REVIEW_REQUIRED" ? "default" : "outline"}>
          <Link href={`/products/catalogue-import/${row.id}`}>
            {row.status === "REVIEW_REQUIRED"
              ? "Review Products"
              : row.status === "IMPORTED"
              ? "View Details"
              : "Open"}
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalogue OCR Import"
        description="AI-powered supplier brochure ingestion, OCR specification extraction, and product swatch image matching."
        backButton={
          <Button asChild variant="ghost" size="sm">
            <Link href="/products">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Products
            </Link>
          </Button>
        }
        actions={user.permissions.includes("products.create") ? <UploadCatalogueModal /> : null}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Review</CardTitle>
            <Clock className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.reviewRequired}</div>
            <p className="text-xs text-muted-foreground">Brochures ready for data & image verification</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Published to Master</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{counts.imported}</div>
            <p className="text-xs text-muted-foreground">Brochures with products published in ERP</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Ingestion Jobs</CardTitle>
            <Sparkles className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalJobs}</div>
            <p className="text-xs text-muted-foreground">All time supplier catalogue imports</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Catalogue Ingestion Jobs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            empty={
              <div className="p-8 text-center text-sm text-muted-foreground">
                No supplier brochures uploaded yet. Click &apos;Upload Catalogue PDF&apos; to import your first supplier catalogue.
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
