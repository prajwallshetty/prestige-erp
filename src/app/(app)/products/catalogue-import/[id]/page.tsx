import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requirePermissionInFirm } from "@/lib/session";
import { ReviewWorkbench } from "./review-workbench";

export const metadata = { title: "Review Catalogue Import — Technic Technologies" };

export default async function CatalogueImportReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermissionInFirm("products.view");
  const firmId = user.activeFirmId;
  const { id } = await params;

  const [job, items, brands, categories] = await Promise.all([
    prisma.catalogueImportJob.findFirst({
      where: { id, firmId },
    }),
    prisma.catalogueImportItem.findMany({
      where: { jobId: id, firmId },
      orderBy: [{ sourcePage: "asc" }, { createdAt: "asc" }],
    }),
    prisma.brand.findMany({
      where: { firmId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({
      where: { firmId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!job) notFound();

  // Format candidate data for client component
  const formattedItems = items.map((item) => ({
    id: item.id,
    sourcePage: item.sourcePage,
    status: item.status,
    duplicateStatus: item.duplicateStatus,
    duplicateProductId: item.duplicateProductId,
    duplicateReason: item.duplicateReason,
    confidence: Number(item.confidence),
    reviewWarnings: (item.reviewWarnings as string[]) || null,
    brandName: item.brandName,
    brandId: item.brandId,
    productName: item.productName,
    productCode: item.productCode,
    categoryName: item.categoryName,
    categoryId: item.categoryId,
    subcategory: item.subcategory,
    size: item.size,
    surface: item.surface,
    color: item.color,
    material: item.material,
    unit: item.unit,
    piecesPerBox: item.piecesPerBox,
    coveragePerBox: item.coveragePerBox ? Number(item.coveragePerBox) : null,
    mrp: item.mrp ? Number(item.mrp) : null,
    purchasePrice: item.purchasePrice ? Number(item.purchasePrice) : null,
    sellingPrice: item.sellingPrice ? Number(item.sellingPrice) : null,
    gstRate: Number(item.gstRate),
    hsnCode: item.hsnCode,
    description: item.description,
    attributes: (item.attributes as Array<{ name: string; value: string }>) || null,
    primaryImageUrl: item.primaryImageUrl,
    images: (item.images as any[]) || null,
    importedProductId: item.importedProductId,
    modifiedFields: (item.modifiedFields as any) || null,
  }));

  return (
    <ReviewWorkbench
      job={{
        id: job.id,
        name: job.name,
        sourceFilename: job.sourceFilename,
        status: job.status,
        pageCount: job.pageCount,
        totalProducts: job.totalProducts,
        approvedProducts: job.approvedProducts,
        importedProducts: job.importedProducts,
        metadata: job.metadata,
        fileSize: job.fileSize,
        lastError: job.lastError,
      }}
      items={formattedItems}
      brands={brands}
      categories={categories}
    />
  );
}
