"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Upload,
  RefreshCw,
  ExternalLink,
  Edit,
  Eye,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Layers,
  Tag,
  CheckCheck,
  PackagePlus,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  approveItemAction,
  excludeItemAction,
  approveAllValidAction,
  publishApprovedAction,
  saveReviewItemAction,
  createQuickBrandAction,
  createQuickCategoryAction,
  retryCatalogueJobAction,
} from "../actions";

interface ProductCandidate {
  id: string;
  sourcePage: number;
  status: "PENDING_REVIEW" | "APPROVED" | "EXCLUDED" | "IMPORTED" | "FAILED";
  duplicateStatus: "NEW_PRODUCT" | "EXACT_MATCH" | "POSSIBLE_DUPLICATE" | "CHANGED_DETAILS";
  duplicateProductId: string | null;
  duplicateReason: string | null;
  confidence: number;
  reviewWarnings: string[] | null;
  brandName: string | null;
  brandId: string | null;
  productName: string;
  productCode: string | null;
  categoryName: string | null;
  categoryId: string | null;
  subcategory: string | null;
  size: string | null;
  surface: string | null;
  color: string | null;
  material: string | null;
  unit: string;
  piecesPerBox: number | null;
  coveragePerBox: number | null;
  mrp: number | null;
  purchasePrice: number | null;
  sellingPrice: number | null;
  gstRate: number;
  hsnCode: string | null;
  description: string | null;
  attributes: Array<{ name: string; value: string }> | null;
  primaryImageUrl: string | null;
  images: Array<{
    id: string;
    url: string;
    sourcePage: number;
    method: string;
    isPrimary?: boolean;
    confidence?: number;
  }> | null;
  importedProductId: string | null;
  modifiedFields: Record<string, any> | null;
}

interface ReviewWorkbenchProps {
  job: {
    id: string;
    name: string;
    sourceFilename: string;
    status: string;
    pageCount: number | null;
    totalProducts: number;
    approvedProducts: number;
    importedProducts: number;
    metadata: any;
    fileSize: number;
    lastError: string | null;
  };
  items: ProductCandidate[];
  brands: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
}

export function ReviewWorkbench({ job, items, brands, categories }: ReviewWorkbenchProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPage, setSelectedPage] = useState<number | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [duplicateFilter, setDuplicateFilter] = useState<string>("ALL");
  const [activeBrochurePage, setActiveBrochurePage] = useState<number>(1);

  // Edit item modal state
  const [editingItem, setEditingItem] = useState<ProductCandidate | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProductCandidate>>({});
  const [duplicateResolution, setDuplicateResolution] = useState<string>("CREATE_NEW");

  // Quick brand / category creation modals
  const [newBrandName, setNewBrandName] = useState("");
  const [showNewBrandModal, setShowNewBrandModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);

  // Image switcher state
  const [imageSwitcherItem, setImageSwitcherItem] = useState<ProductCandidate | null>(null);

  // Counts
  const pendingCount = items.filter((i) => i.status === "PENDING_REVIEW").length;
  const approvedCount = items.filter((i) => i.status === "APPROVED").length;
  const excludedCount = items.filter((i) => i.status === "EXCLUDED").length;
  const importedCount = items.filter((i) => i.status === "IMPORTED").length;

  // Filtered items
  const filteredItems = items.filter((item) => {
    if (selectedPage !== "ALL" && item.sourcePage !== selectedPage) return false;
    if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
    if (duplicateFilter !== "ALL") {
      if (duplicateFilter === "NEW" && item.duplicateStatus !== "NEW_PRODUCT") return false;
      if (duplicateFilter === "DUPLICATES" && item.duplicateStatus === "NEW_PRODUCT") return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = item.productName.toLowerCase().includes(q);
      const matchCode = (item.productCode || "").toLowerCase().includes(q);
      const matchSize = (item.size || "").toLowerCase().includes(q);
      const matchSurface = (item.surface || "").toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchSize && !matchSurface) return false;
    }
    return true;
  });

  const handleApprove = (itemId: string) => {
    startTransition(async () => {
      const res = await approveItemAction(itemId);
      if (!res.ok) {
        toast.error(res.error || "Failed to approve product");
        return;
      }
      toast.success("Product approved for publishing");
      router.refresh();
    });
  };

  const handleExclude = (itemId: string) => {
    startTransition(async () => {
      const res = await excludeItemAction(itemId);
      if (!res.ok) {
        toast.error(res.error || "Failed to exclude product");
        return;
      }
      toast.info("Product excluded from import");
      router.refresh();
    });
  };

  const handleApproveAll = () => {
    startTransition(async () => {
      const res = await approveAllValidAction(job.id);
      if (!res.ok) {
        toast.error(res.error || "Failed to approve all products");
        return;
      }
      toast.success(`Approved ${res.data.approvedCount} products!`);
      router.refresh();
    });
  };

  const handlePublish = () => {
    if (approvedCount === 0) {
      toast.error("No approved products to publish. Please approve products first.");
      return;
    }

    startTransition(async () => {
      const res = await publishApprovedAction(job.id);
      if (!res.ok) {
        toast.error(res.error || "Failed to publish products to ERP");
        return;
      }
      toast.success(`Successfully published ${res.data.publishedCount} products to ERP Product Master!`);
      router.refresh();
    });
  };

  const handleSaveEdit = () => {
    if (!editingItem) return;

    startTransition(async () => {
      const res = await saveReviewItemAction(editingItem.id, {
        productName: editForm.productName,
        productCode: editForm.productCode ?? undefined,
        brandId: editForm.brandId,
        categoryId: editForm.categoryId,
        subcategory: editForm.subcategory,
        size: editForm.size,
        surface: editForm.surface,
        color: editForm.color,
        material: editForm.material,
        unit: editForm.unit,
        piecesPerBox: editForm.piecesPerBox,
        coveragePerBox: editForm.coveragePerBox,
        mrp: editForm.mrp,
        purchasePrice: editForm.purchasePrice,
        sellingPrice: editForm.sellingPrice,
        gstRate: editForm.gstRate,
        hsnCode: editForm.hsnCode,
        description: editForm.description,
        duplicateResolution: duplicateResolution as any,
      });

      if (!res.ok) {
        toast.error(res.error || "Failed to save edits");
        return;
      }

      toast.success("Product details updated");
      setEditingItem(null);
      router.refresh();
    });
  };

  const handleSelectPrimaryImage = (item: ProductCandidate, imageUrl: string) => {
    startTransition(async () => {
      const res = await saveReviewItemAction(item.id, {
        primaryImageUrl: imageUrl,
      });
      if (!res.ok) {
        toast.error(res.error || "Failed to update image");
        return;
      }
      toast.success("Primary product image updated");
      setImageSwitcherItem(null);
      router.refresh();
    });
  };

  const handleCreateBrand = () => {
    if (!newBrandName.trim()) return;
    startTransition(async () => {
      const res = await createQuickBrandAction(newBrandName.trim());
      if (!res.ok) {
        toast.error(res.error || "Failed to create brand");
        return;
      }
      toast.success(`Brand "${res.data.name}" created!`);
      if (editingItem) {
        setEditForm((prev) => ({ ...prev, brandId: res.data.id }));
      }
      setNewBrandName("");
      setShowNewBrandModal(false);
      router.refresh();
    });
  };

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return;
    startTransition(async () => {
      const res = await createQuickCategoryAction(newCategoryName.trim());
      if (!res.ok) {
        toast.error(res.error || "Failed to create category");
        return;
      }
      toast.success(`Category "${res.data.name}" created!`);
      if (editingItem) {
        setEditForm((prev) => ({ ...prev, categoryId: res.data.id }));
      }
      setNewCategoryName("");
      setShowNewCategoryModal(false);
      router.refresh();
    });
  };

  const pagesList = Array.from({ length: job.pageCount || 1 }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <PageHeader
        title={job.name}
        description={`${job.sourceFilename} · ${job.totalProducts} extracted products across ${job.pageCount || 1} pages`}
        backButton={
          <Button asChild variant="ghost" size="sm">
            <Link href="/products/catalogue-import">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Catalogue Imports
            </Link>
          </Button>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {job.status === "FAILED" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  startTransition(async () => {
                    await retryCatalogueJobAction(job.id);
                    router.refresh();
                  });
                }}
                disabled={isPending}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry Ingestion
              </Button>
            ) : null}

            {pendingCount > 0 ? (
              <Button
                id="btn-approve-all"
                variant="outline"
                size="sm"
                onClick={handleApproveAll}
                disabled={isPending}
              >
                <CheckCheck className="mr-2 h-4 w-4 text-primary" />
                Approve All Valid ({pendingCount})
              </Button>
            ) : null}

            <Button
              id="btn-publish-approved"
              size="sm"
              onClick={handlePublish}
              disabled={isPending || approvedCount === 0}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              <PackagePlus className="mr-2 h-4 w-4" />
              Publish Approved ({approvedCount}) to ERP
            </Button>
          </div>
        }
      />

      {/* Inventory Rule Notice */}
      <div className="flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-foreground">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <div>
          <span className="font-semibold">Master Catalogue Ingestion:</span> Approving and publishing products creates catalogue master records, links specifications, and attaches high-res swatches. In strict accordance with ERP inventory controls, catalogue import never alters warehouse stock or records receipt vouchers.
        </div>
      </div>

      {/* Status Counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div
          onClick={() => setStatusFilter("PENDING_REVIEW")}
          className={`cursor-pointer rounded-lg border p-3 transition-colors ${
            statusFilter === "PENDING_REVIEW" ? "border-warning bg-warning/5" : "border-border hover:bg-muted/50"
          }`}
        >
          <div className="text-xs font-medium text-muted-foreground">Pending Review</div>
          <div className="text-xl font-bold text-warning">{pendingCount}</div>
        </div>

        <div
          onClick={() => setStatusFilter("APPROVED")}
          className={`cursor-pointer rounded-lg border p-3 transition-colors ${
            statusFilter === "APPROVED" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
          }`}
        >
          <div className="text-xs font-medium text-muted-foreground">Approved for Publishing</div>
          <div className="text-xl font-bold text-primary">{approvedCount}</div>
        </div>

        <div
          onClick={() => setStatusFilter("IMPORTED")}
          className={`cursor-pointer rounded-lg border p-3 transition-colors ${
            statusFilter === "IMPORTED" ? "border-success bg-success/5" : "border-border hover:bg-muted/50"
          }`}
        >
          <div className="text-xs font-medium text-muted-foreground">Published to ERP</div>
          <div className="text-xl font-bold text-success">{importedCount}</div>
        </div>

        <div
          onClick={() => setStatusFilter("EXCLUDED")}
          className={`cursor-pointer rounded-lg border p-3 transition-colors ${
            statusFilter === "EXCLUDED" ? "border-destructive bg-destructive/5" : "border-border hover:bg-muted/50"
          }`}
        >
          <div className="text-xs font-medium text-muted-foreground">Excluded / Skipped</div>
          <div className="text-xl font-bold text-muted-foreground">{excludedCount}</div>
        </div>
      </div>

      {/* Main Split Workbench */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Source Brochure Viewer */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-muted/60 px-3 py-2 text-xs font-medium">
            <span>Brochure Source Preview</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={activeBrochurePage <= 1}
                onClick={() => setActiveBrochurePage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span>
                Page {activeBrochurePage} of {job.pageCount || 1}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={activeBrochurePage >= (job.pageCount || 1)}
                onClick={() => setActiveBrochurePage((p) => Math.min(job.pageCount || 1, p + 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-b-lg border border-border bg-black/5 shadow-inner">
            <img
              src={`/api/files/catalogues/${job.id}/images/page_${job.id}_p${activeBrochurePage}.png`}
              alt={`Page ${activeBrochurePage}`}
              className="h-full w-full object-contain"
              onError={(e) => {
                // Fallback placeholder if rendered page not yet available
                (e.target as HTMLElement).style.display = "none";
              }}
            />
            <div className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-1 text-[11px] text-white backdrop-blur">
              Page {activeBrochurePage}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Flip through original catalogue pages to cross-verify product swatches, sizes, and manufacturer codes.
          </p>
        </div>

        {/* Right Column: Extracted Products Review Table / Cards */}
        <div className="lg:col-span-8 space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="min-w-[180px] flex-1">
              <Input
                placeholder="Search by code, tile name, size, finish..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <select
              value={selectedPage}
              onChange={(e) => setSelectedPage(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="ALL">All Pages</option>
              {pagesList.map((p) => (
                <option key={p} value={p}>
                  Page {p}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING_REVIEW">Pending Review</option>
              <option value="APPROVED">Approved</option>
              <option value="EXCLUDED">Excluded</option>
              <option value="IMPORTED">Published</option>
            </select>

            <select
              value={duplicateFilter}
              onChange={(e) => setDuplicateFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="ALL">All Products</option>
              <option value="NEW">New Only</option>
              <option value="DUPLICATES">Duplicates / Collisions</option>
            </select>
          </div>

          {/* Product Candidates List */}
          {filteredItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
              No product candidates match the current filters.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item, itemIndex) => {
                const brand = brands.find((b) => b.id === item.brandId);
                const category = categories.find((c) => c.id === item.categoryId);

                return (
                  <div
                    key={item.id}
                    className={`rounded-lg border p-4 transition-all shadow-sm ${
                      item.status === "APPROVED"
                        ? "border-primary/40 bg-primary/5"
                        : item.status === "EXCLUDED"
                        ? "border-border bg-muted/30 opacity-60"
                        : item.status === "IMPORTED"
                        ? "border-success/40 bg-success/5"
                        : item.duplicateStatus !== "NEW_PRODUCT"
                        ? "border-warning/50 bg-warning/5"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                      {/* Product Image Thumbnail & Selector */}
                      <div className="relative shrink-0">
                        {item.primaryImageUrl ? (
                          <div className="group relative h-24 w-24 overflow-hidden rounded-md border border-border bg-muted shadow-sm">
                            <img
                              src={item.primaryImageUrl}
                              alt={item.productName}
                              className="h-full w-full object-cover"
                            />
                            {item.images && item.images.length > 1 ? (
                              <button
                                onClick={() => setImageSwitcherItem(item)}
                                className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
                              >
                                {item.images.length} images
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex h-24 w-24 flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/60 text-xs text-muted-foreground">
                            <ImageIcon className="h-6 w-6 mb-1 opacity-50" />
                            No Swatch
                          </div>
                        )}

                        {item.images && item.images.length > 1 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setImageSwitcherItem(item)}
                            className="mt-1 h-6 w-24 text-[10px] px-1 text-muted-foreground hover:text-foreground"
                          >
                            Switch ({item.images.length})
                          </Button>
                        ) : null}
                      </div>

                      {/* Details & Specs */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-foreground">
                              {item.productCode || "NO-CODE"}
                            </span>
                            <span className="text-sm font-semibold text-foreground">
                              {item.productName}
                            </span>
                            <Badge tone="outline" className="text-[10px] font-normal">
                              Page {item.sourcePage}
                            </Badge>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {item.duplicateStatus === "NEW_PRODUCT" ? (
                              <Badge tone="success" className="text-[10px]">
                                New Product
                              </Badge>
                            ) : item.duplicateStatus === "EXACT_MATCH" ? (
                              <Badge tone="danger" className="text-[10px]">
                                Exact Duplicate SKU
                              </Badge>
                            ) : (
                              <Badge tone="warning" className="text-[10px]">
                                {item.duplicateStatus === "CHANGED_DETAILS" ? "Changed Details" : "Possible Duplicate"}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Duplicate Alert */}
                        {item.duplicateReason ? (
                          <div className="flex items-center gap-1.5 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-xs text-warning-foreground">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                            <span>{item.duplicateReason}</span>
                          </div>
                        ) : null}

                        {/* Warnings */}
                        {item.reviewWarnings && item.reviewWarnings.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {item.reviewWarnings.map((w, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                              >
                                ⚠ {w}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {/* Brand, Category, Specs Badges */}
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          {item.brandName || brand ? (
                            <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
                              Brand: {brand?.name || item.brandName}
                            </span>
                          ) : null}

                          {item.categoryName || category ? (
                            <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
                              Category: {category?.name || item.categoryName}
                            </span>
                          ) : null}

                          {item.size ? (
                            <span className="rounded bg-muted/60 px-2 py-0.5 text-muted-foreground">
                              Size: {item.size}
                            </span>
                          ) : null}

                          {item.surface ? (
                            <span className="rounded bg-muted/60 px-2 py-0.5 text-muted-foreground">
                              Surface: {item.surface}
                            </span>
                          ) : null}

                          {item.piecesPerBox ? (
                            <span className="rounded bg-muted/60 px-2 py-0.5 text-muted-foreground">
                              {item.piecesPerBox} Pcs/Box
                            </span>
                          ) : null}

                          {item.coveragePerBox ? (
                            <span className="rounded bg-muted/60 px-2 py-0.5 text-muted-foreground">
                              {item.coveragePerBox} Sqm/Box
                            </span>
                          ) : null}

                          {item.sellingPrice && item.sellingPrice > 0 ? (
                            <span className="rounded bg-muted/60 px-2 py-0.5 font-medium text-foreground">
                              ₹{item.sellingPrice}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex shrink-0 flex-row sm:flex-col items-center gap-1.5 pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActiveBrochurePage(item.sourcePage);
                          }}
                          title="View on source brochure"
                          className="h-8 px-2 text-xs"
                        >
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          View Page
                        </Button>

                        <Button
                          id={`btn-edit-item-${itemIndex}`}
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingItem(item);
                            setEditForm({
                              productName: item.productName,
                              productCode: item.productCode,
                              brandId: item.brandId,
                              categoryId: item.categoryId,
                              subcategory: item.subcategory,
                              size: item.size,
                              surface: item.surface,
                              color: item.color,
                              material: item.material,
                              unit: item.unit,
                              piecesPerBox: item.piecesPerBox,
                              coveragePerBox: item.coveragePerBox,
                              mrp: item.mrp,
                              sellingPrice: item.sellingPrice,
                              purchasePrice: item.purchasePrice,
                              gstRate: item.gstRate,
                              hsnCode: item.hsnCode,
                              description: item.description,
                            });
                            setDuplicateResolution(
                              item.duplicateStatus === "EXACT_MATCH" ? "UPDATE_EXISTING" : "CREATE_NEW",
                            );
                          }}
                          className="h-8 px-2 text-xs"
                        >
                          <Edit className="mr-1 h-3.5 w-3.5" />
                          Edit
                        </Button>

                        {item.status !== "APPROVED" && item.status !== "IMPORTED" ? (
                          <Button
                            id={`btn-approve-item-${itemIndex}`}
                            size="sm"
                            onClick={() => handleApprove(item.id)}
                            disabled={isPending}
                            className="h-8 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            Approve
                          </Button>
                        ) : null}

                        {item.status !== "EXCLUDED" && item.status !== "IMPORTED" ? (
                          <Button
                            id={`btn-skip-item-${itemIndex}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExclude(item.id)}
                            disabled={isPending}
                            className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" />
                            Skip
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Edit Candidate Product Modal */}
      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Extracted Product Details</DialogTitle>
            <DialogDescription>
              Review or correct product specifications extracted from the brochure before publishing to ERP.
            </DialogDescription>
          </DialogHeader>

          {editingItem ? (
            <div className="space-y-4 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-name">Product Name *</Label>
                  <Input
                    id="edit-name"
                    value={editForm.productName || ""}
                    onChange={(e) => setEditForm((p) => ({ ...p, productName: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-sku">Product Code / SKU *</Label>
                  <Input
                    id="edit-sku"
                    value={editForm.productCode || ""}
                    onChange={(e) => setEditForm((p) => ({ ...p, productCode: e.target.value.toUpperCase() }))}
                  />
                </div>
              </div>

              {/* Brand and Category with Quick Add */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-brand">Brand</Label>
                    <button
                      type="button"
                      onClick={() => setShowNewBrandModal(true)}
                      className="text-xs text-primary hover:underline"
                    >
                      + Add Brand
                    </button>
                  </div>
                  <select
                    id="edit-brand"
                    value={editForm.brandId || ""}
                    onChange={(e) => setEditForm((p) => ({ ...p, brandId: e.target.value || null }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select Brand</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-cat">Category</Label>
                    <button
                      type="button"
                      onClick={() => setShowNewCategoryModal(true)}
                      className="text-xs text-primary hover:underline"
                    >
                      + Add Category
                    </button>
                  </div>
                  <select
                    id="edit-cat"
                    value={editForm.categoryId || ""}
                    onChange={(e) => setEditForm((p) => ({ ...p, categoryId: e.target.value || null }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select Category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Specifications */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-size">Size / Dimensions</Label>
                  <Input
                    id="edit-size"
                    placeholder="e.g. 600x600 mm"
                    value={editForm.size || ""}
                    onChange={(e) => setEditForm((p) => ({ ...p, size: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-surf">Surface / Finish</Label>
                  <Input
                    id="edit-surf"
                    placeholder="e.g. Glossy, Matt"
                    value={editForm.surface || ""}
                    onChange={(e) => setEditForm((p) => ({ ...p, surface: e.target.value }))}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-mat">Material / Type</Label>
                  <Input
                    id="edit-mat"
                    placeholder="e.g. Vitrified, Ceramic"
                    value={editForm.material || ""}
                    onChange={(e) => setEditForm((p) => ({ ...p, material: e.target.value }))}
                  />
                </div>
              </div>

              {/* Packaging Details */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-pcs">Pieces / Box</Label>
                  <Input
                    id="edit-pcs"
                    type="number"
                    value={editForm.piecesPerBox ?? ""}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        piecesPerBox: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-cov">Coverage / Box (Sqm)</Label>
                  <Input
                    id="edit-cov"
                    type="number"
                    step="0.01"
                    value={editForm.coveragePerBox ?? ""}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        coveragePerBox: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-unit">Unit of Measure</Label>
                  <Input
                    id="edit-unit"
                    value={editForm.unit || "box"}
                    onChange={(e) => setEditForm((p) => ({ ...p, unit: e.target.value }))}
                  />
                </div>
              </div>

              {/* Commercial & Taxes */}
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-price">Selling Price (₹)</Label>
                  <Input
                    id="edit-price"
                    type="number"
                    step="0.01"
                    value={editForm.sellingPrice ?? ""}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        sellingPrice: e.target.value ? Number(e.target.value) : 0,
                      }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-mrp">MRP (₹)</Label>
                  <Input
                    id="edit-mrp"
                    type="number"
                    step="0.01"
                    value={editForm.mrp ?? ""}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, mrp: e.target.value ? Number(e.target.value) : 0 }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-gst">GST Rate (%)</Label>
                  <Input
                    id="edit-gst"
                    type="number"
                    value={editForm.gstRate ?? 18}
                    onChange={(e) =>
                      setEditForm((p) => ({ ...p, gstRate: Number(e.target.value) || 18 }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-hsn">HSN Code</Label>
                  <Input
                    id="edit-hsn"
                    value={editForm.hsnCode || "6907"}
                    onChange={(e) => setEditForm((p) => ({ ...p, hsnCode: e.target.value }))}
                  />
                </div>
              </div>

              {/* Duplicate Handling Resolution */}
              {editingItem.duplicateStatus !== "NEW_PRODUCT" ? (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
                  <Label className="text-xs font-semibold text-warning-foreground">
                    Duplicate / Existing Product Option:
                  </Label>
                  <select
                    value={duplicateResolution}
                    onChange={(e) => setDuplicateResolution(e.target.value)}
                    className="w-full h-8 rounded border border-input bg-background px-2 text-xs"
                  >
                    <option value="UPDATE_EXISTING">Update existing product specifications & image</option>
                    <option value="CREATE_NEW">Create as new separate product (appends unique SKU suffix)</option>
                    <option value="SKIP">Skip this product during publishing</option>
                  </select>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button id="btn-cancel-edit-modal" variant="outline" onClick={() => setEditingItem(null)}>
              Cancel
            </Button>
            <Button id="btn-save-edit-modal" onClick={handleSaveEdit} disabled={isPending}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Switcher Modal */}
      <Dialog
        open={Boolean(imageSwitcherItem)}
        onOpenChange={(open) => !open && setImageSwitcherItem(null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Select Product Swatch Image</DialogTitle>
            <DialogDescription>
              Choose the best matching product swatch image extracted from page {imageSwitcherItem?.sourcePage}.
            </DialogDescription>
          </DialogHeader>

          {imageSwitcherItem ? (
            <div className="grid grid-cols-3 gap-3 py-3">
              {imageSwitcherItem.images?.map((img, idx) => {
                const isSelected = img.url === imageSwitcherItem.primaryImageUrl;
                return (
                  <div
                    key={img.id || idx}
                    onClick={() => handleSelectPrimaryImage(imageSwitcherItem, img.url)}
                    className={`cursor-pointer rounded-lg border p-2 text-center transition-all ${
                      isSelected
                        ? "border-primary bg-primary/10 ring-2 ring-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="relative aspect-square overflow-hidden rounded bg-muted">
                      <img src={img.url} alt="Candidate image" className="h-full w-full object-cover" />
                      {isSelected ? (
                        <div className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-white">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1.5 text-[10px] text-muted-foreground">
                      {img.method} · {img.confidence ? `${Math.round(img.confidence * 100)}%` : "Matched"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Quick Add Brand Modal */}
      <Dialog open={showNewBrandModal} onOpenChange={setShowNewBrandModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add New Brand</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Label htmlFor="quick-brand-name">Brand Name</Label>
            <Input
              id="quick-brand-name"
              placeholder="e.g. Kajaria, Somany..."
              value={newBrandName}
              onChange={(e) => setNewBrandName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowNewBrandModal(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateBrand} disabled={!newBrandName.trim() || isPending}>
              Create Brand
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Add Category Modal */}
      <Dialog open={showNewCategoryModal} onOpenChange={setShowNewCategoryModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add New Category</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Label htmlFor="quick-cat-name">Category Name</Label>
            <Input
              id="quick-cat-name"
              placeholder="e.g. Floor Tiles, Slab Tiles..."
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowNewCategoryModal(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateCategory} disabled={!newCategoryName.trim() || isPending}>
              Create Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
