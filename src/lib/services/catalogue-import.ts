import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import { createProduct, updateProduct } from "@/lib/services/products";
import { runCatalogueExtractor, type ExtractedProduct, type ExtractionResult } from "@/lib/catalogue-import/extractor";

export interface CreateJobInput {
  firmId: string;
  branchId?: string | null;
  filename: string;
  buffer: Buffer;
  userId?: string | null;
}

export interface ReviewItemEdits {
  productName?: string;
  productCode?: string;
  brandId?: string | null;
  categoryId?: string | null;
  subcategory?: string | null;
  size?: string | null;
  surface?: string | null;
  color?: string | null;
  material?: string | null;
  unit?: string;
  piecesPerBox?: number | null;
  coveragePerBox?: number | null;
  mrp?: number | null;
  purchasePrice?: number | null;
  sellingPrice?: number | null;
  gstRate?: number;
  hsnCode?: string | null;
  description?: string | null;
  primaryImageUrl?: string | null;
  duplicateResolution?: "CREATE_NEW" | "UPDATE_EXISTING" | "ADD_IMAGES" | "SKIP";
}

const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

/**
 * Creates a new catalogue import job and stores the source file securely.
 */
export async function createCatalogueJob(input: CreateJobInput) {
  if (!input.filename.toLowerCase().endsWith(".pdf")) {
    throw new BusinessRuleError("Only PDF catalogues are supported");
  }

  // Validate magic bytes (%PDF-)
  if (input.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new BusinessRuleError("Uploaded file is not a valid PDF document (missing %PDF- header)");
  }

  const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const baseName = path.basename(input.filename, path.extname(input.filename));

  const job = await prisma.$transaction(async (tx) => {
    const createdJob = await tx.catalogueImportJob.create({
      data: {
        firmId: input.firmId,
        branchId: input.branchId ?? null,
        name: baseName,
        sourceFilename: input.filename,
        sourcePath: `uploads/catalogues/sources/${sha256}.pdf`,
        fileSize: input.buffer.length,
        mimeType: "application/pdf",
        sha256,
        status: "UPLOADED",
        createdById: input.userId ?? null,
      },
    });

    // Save source PDF into DB file store
    await tx.catalogueImportFile.create({
      data: {
        jobId: createdJob.id,
        data: new Uint8Array(input.buffer),
      },
    });

    // Also persist to local uploads directory for worker processing
    const sourcesDir = path.join(UPLOADS_ROOT, "catalogues", "sources");
    await fs.mkdir(sourcesDir, { recursive: true });
    await fs.writeFile(path.join(sourcesDir, `${createdJob.id}.pdf`), input.buffer);

    return createdJob;
  });

  await recordAudit({
    action: "CATALOGUE_UPLOADED",
    entity: "CatalogueImportJob",
    entityId: job.id,
    summary: `Uploaded catalogue "${input.filename}" (${(input.buffer.length / 1024 / 1024).toFixed(2)} MB)`,
    firmId: input.firmId,
    userId: input.userId,
    after: { filename: input.filename, size: input.buffer.length, sha256 },
  });

  return job;
}

/**
 * Runs the extraction pipeline on the uploaded catalogue job, detects duplicates,
 * and sets status to REVIEW_REQUIRED.
 */
export async function processCatalogueJob(firmId: string, jobId: string, userId?: string | null) {
  const job = await prisma.catalogueImportJob.findFirst({
    where: { id: jobId, firmId },
    include: { file: true },
  });
  if (!job) throw new NotFoundError("Catalogue import job not found");

  if (job.status === "IMPORTED" || job.status === "APPROVED") {
    throw new BusinessRuleError(`Job is already in ${job.status} state`);
  }

  // Update status to PROCESSING
  await prisma.catalogueImportJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING", lastError: null },
  });

  const jobOutputDir = path.join(UPLOADS_ROOT, "catalogues", jobId, "images");
  await fs.mkdir(jobOutputDir, { recursive: true });

  const pdfPath = path.join(UPLOADS_ROOT, "catalogues", "sources", `${job.id}.pdf`);
  // Ensure source file exists on disk
  try {
    await fs.access(pdfPath);
  } catch {
    if (job.file?.data) {
      const sourcesDir = path.join(UPLOADS_ROOT, "catalogues", "sources");
      await fs.mkdir(sourcesDir, { recursive: true });
      await fs.writeFile(pdfPath, job.file.data);
    } else {
      throw new BusinessRuleError("Source catalogue PDF data missing");
    }
  }

  let extraction: ExtractionResult;
  try {
    extraction = await runCatalogueExtractor({
      pdfPath,
      outputDir: jobOutputDir,
      jobId: job.id,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.catalogueImportJob.update({
      where: { id: jobId },
      data: { status: "FAILED", lastError: errorMsg },
    });
    throw new BusinessRuleError(`Catalogue extraction failed: ${errorMsg}`);
  }

  // Fetch existing brands and categories to match against
  const [existingBrands, existingCategories, existingProducts] = await Promise.all([
    prisma.brand.findMany({ where: { firmId }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { firmId }, select: { id: true, name: true } }),
    prisma.product.findMany({
      where: { firmId },
      select: {
        id: true,
        sku: true,
        name: true,
        brandId: true,
        brand: { select: { name: true } },
        categoryId: true,
        category: { select: { name: true } },
        sellingPrice: true,
        imageUrl: true,
      },
    }),
  ]);

  // Map to ease lookups
  const brandByName = new Map<string, string>();
  for (const b of existingBrands) {
    brandByName.set(b.name.trim().toLowerCase(), b.id);
  }

  const categoryByName = new Map<string, string>();
  for (const c of existingCategories) {
    categoryByName.set(c.name.trim().toLowerCase(), c.id);
  }

  // Delete previous items if reprocessing
  await prisma.catalogueImportItem.deleteMany({ where: { jobId } });

  // Process extracted products & evaluate duplicates
  const candidateItems = extraction.products.map((product) => {
    // 1. Brand matching
    let brandId: string | null = null;
    if (product.brandName) {
      brandId = brandByName.get(product.brandName.trim().toLowerCase()) ?? null;
    }

    // 2. Category matching
    let categoryId: string | null = null;
    if (product.categoryName) {
      categoryId = categoryByName.get(product.categoryName.trim().toLowerCase()) ?? null;
    }

    // 3. Duplicate detection
    const skuClean = product.productCode?.trim().toUpperCase();
    const exactSkuProduct = existingProducts.find((p) => p.sku.toUpperCase() === skuClean);

    let duplicateStatus: "NEW_PRODUCT" | "EXACT_MATCH" | "POSSIBLE_DUPLICATE" | "CHANGED_DETAILS" = "NEW_PRODUCT";
    let duplicateProductId: string | null = null;
    let duplicateReason: string | null = null;

    if (exactSkuProduct) {
      duplicateProductId = exactSkuProduct.id;
      const priceDiffers = product.sellingPrice && Math.abs(Number(exactSkuProduct.sellingPrice) - product.sellingPrice) > 0.01;
      if (priceDiffers) {
        duplicateStatus = "CHANGED_DETAILS";
        duplicateReason = `SKU "${skuClean}" already exists as "${exactSkuProduct.name}" with different price (Current: ₹${Number(exactSkuProduct.sellingPrice)}, Extracted: ₹${product.sellingPrice})`;
      } else {
        duplicateStatus = "EXACT_MATCH";
        duplicateReason = `Product with SKU "${skuClean}" already exists: "${exactSkuProduct.name}"`;
      }
    } else {
      // Secondary similarity check: Brand + Model / Name match
      const nameClean = product.productName.trim().toLowerCase();
      const nameMatch = existingProducts.find(
        (p) => p.name.trim().toLowerCase() === nameClean && (!brandId || p.brandId === brandId),
      );
      if (nameMatch) {
        duplicateStatus = "POSSIBLE_DUPLICATE";
        duplicateProductId = nameMatch.id;
        duplicateReason = `Existing product "${nameMatch.name}" (${nameMatch.sku}) shares the same name and brand`;
      }
    }

    return {
      jobId,
      firmId,
      sourcePage: product.sourcePage,
      status: "PENDING_REVIEW" as const,
      duplicateStatus,
      duplicateProductId,
      duplicateReason,
      confidence: product.confidence,
      reviewWarnings: product.reviewWarnings.length > 0 ? product.reviewWarnings : null,
      brandName: product.brandName ?? null,
      brandId,
      productName: product.productName,
      productCode: product.productCode,
      categoryName: product.categoryName ?? null,
      categoryId,
      subcategory: product.subcategory ?? null,
      size: product.size ?? null,
      surface: product.surface ?? null,
      color: product.color ?? null,
      material: product.material ?? null,
      unit: product.unit || "box",
      piecesPerBox: product.piecesPerBox ?? null,
      coveragePerBox: product.coveragePerBox ?? null,
      mrp: product.mrp ?? 0,
      purchasePrice: product.purchasePrice ?? 0,
      sellingPrice: product.sellingPrice ?? 0,
      gstRate: product.gstRate ?? 18,
      hsnCode: product.hsnCode ?? "6907",
      description: product.description ?? null,
      attributes: product.attributes,
      rawText: product.rawText ?? null,
      primaryImageUrl: product.primaryImageUrl ?? null,
      images: product.images,
    };
  });

  // Batch insert items
  await prisma.$transaction([
    prisma.catalogueImportItem.createMany({
      data: candidateItems as any,
    }),
    prisma.catalogueImportJob.update({
      where: { id: jobId },
      data: {
        status: candidateItems.length > 0 ? "REVIEW_REQUIRED" : "APPROVED",
        pageCount: extraction.totalPages,
        processedPages: extraction.pages.length,
        totalProducts: candidateItems.length,
        metadata: {
          totalPages: extraction.totalPages,
          documentBrand: extraction.documentBrand,
          pages: extraction.pages,
        } as any,
      },
    }),
  ]);

  await recordAudit({
    action: "CATALOGUE_PROCESSED",
    entity: "CatalogueImportJob",
    entityId: jobId,
    summary: `Extracted ${candidateItems.length} products across ${extraction.pages.length} pages`,
    firmId,
    userId,
    after: { totalProducts: candidateItems.length, pages: extraction.pages.length },
  });

  return { totalProducts: candidateItems.length, pages: extraction.totalPages };
}

/**
 * Saves reviewer adjustments for a single candidate product.
 */
export async function saveReviewItem(
  firmId: string,
  itemId: string,
  edits: ReviewItemEdits,
  userId?: string | null,
) {
  const item = await prisma.catalogueImportItem.findFirst({
    where: { id: itemId, firmId },
  });
  if (!item) throw new NotFoundError("Catalogue product candidate not found");

  const modifiedFields: Record<string, unknown> = (item.modifiedFields as Record<string, unknown>) ?? {};

  for (const [key, val] of Object.entries(edits)) {
    if (val !== undefined) {
      modifiedFields[key] = val;
    }
  }

  // Update attributes if size, surface, material, pcs/box changed
  const attrs: Array<{ name: string; value: string }> = (item.attributes as Array<{ name: string; value: string }>) ?? [];
  const setAttr = (name: string, val: string | null | undefined) => {
    const idx = attrs.findIndex((a) => a.name.toLowerCase() === name.toLowerCase());
    if (val) {
      if (idx >= 0) attrs[idx].value = val;
      else attrs.push({ name, value: val });
    } else if (idx >= 0) {
      attrs.splice(idx, 1);
    }
  };

  if (edits.size !== undefined) setAttr("Size", edits.size);
  if (edits.surface !== undefined) setAttr("Surface / Finish", edits.surface);
  if (edits.material !== undefined) setAttr("Material", edits.material);
  if (edits.piecesPerBox !== undefined) setAttr("Pieces per Box", edits.piecesPerBox ? String(edits.piecesPerBox) : null);
  if (edits.coveragePerBox !== undefined) setAttr("Coverage per Box", edits.coveragePerBox ? `${edits.coveragePerBox} Sqm` : null);

  const updated = await prisma.catalogueImportItem.update({
    where: { id: itemId },
    data: {
      productName: edits.productName !== undefined ? edits.productName.trim() : item.productName,
      productCode: edits.productCode !== undefined ? edits.productCode.trim().toUpperCase() : item.productCode,
      brandId: edits.brandId !== undefined ? edits.brandId : item.brandId,
      categoryId: edits.categoryId !== undefined ? edits.categoryId : item.categoryId,
      subcategory: edits.subcategory !== undefined ? edits.subcategory : item.subcategory,
      size: edits.size !== undefined ? edits.size : item.size,
      surface: edits.surface !== undefined ? edits.surface : item.surface,
      color: edits.color !== undefined ? edits.color : item.color,
      material: edits.material !== undefined ? edits.material : item.material,
      unit: edits.unit !== undefined ? edits.unit : item.unit,
      piecesPerBox: edits.piecesPerBox !== undefined ? edits.piecesPerBox : item.piecesPerBox,
      coveragePerBox: edits.coveragePerBox !== undefined ? edits.coveragePerBox : item.coveragePerBox,
      mrp: edits.mrp !== undefined ? edits.mrp : item.mrp,
      purchasePrice: edits.purchasePrice !== undefined ? edits.purchasePrice : item.purchasePrice,
      sellingPrice: edits.sellingPrice !== undefined ? edits.sellingPrice : item.sellingPrice,
      gstRate: edits.gstRate !== undefined ? edits.gstRate : item.gstRate,
      hsnCode: edits.hsnCode !== undefined ? edits.hsnCode : item.hsnCode,
      description: edits.description !== undefined ? edits.description : item.description,
      primaryImageUrl: edits.primaryImageUrl !== undefined ? edits.primaryImageUrl : item.primaryImageUrl,
      attributes: attrs as any,
      modifiedFields: modifiedFields as any,
    },
  });

  return updated;
}

/**
 * Approves a single candidate product for publishing.
 */
export async function approveItem(firmId: string, itemId: string) {
  const item = await prisma.catalogueImportItem.findFirst({ where: { id: itemId, firmId } });
  if (!item) throw new NotFoundError("Catalogue product candidate not found");

  if (!item.productName.trim()) {
    throw new BusinessRuleError("Product name is required before approval");
  }
  if (!item.productCode?.trim()) {
    throw new BusinessRuleError("Product code / SKU is required before approval");
  }

  const updated = await prisma.catalogueImportItem.update({
    where: { id: itemId },
    data: { status: "APPROVED" },
  });

  // Check if job should update approved count
  const approvedCount = await prisma.catalogueImportItem.count({
    where: { jobId: item.jobId, status: "APPROVED" },
  });
  await prisma.catalogueImportJob.update({
    where: { id: item.jobId },
    data: { approvedProducts: approvedCount },
  });

  return updated;
}

/**
 * Excludes an unwanted candidate product from import.
 */
export async function excludeItem(firmId: string, itemId: string) {
  const item = await prisma.catalogueImportItem.findFirst({ where: { id: itemId, firmId } });
  if (!item) throw new NotFoundError("Catalogue product candidate not found");

  const updated = await prisma.catalogueImportItem.update({
    where: { id: itemId },
    data: { status: "EXCLUDED" },
  });

  return updated;
}

/**
 * Approves all valid candidate products in a job (ignoring excluded ones).
 */
export async function approveAllValidItems(firmId: string, jobId: string) {
  const job = await prisma.catalogueImportJob.findFirst({ where: { id: jobId, firmId } });
  if (!job) throw new NotFoundError("Catalogue job not found");

  // Approve all PENDING_REVIEW items that have a product code and name
  await prisma.catalogueImportItem.updateMany({
    where: {
      jobId,
      firmId,
      status: "PENDING_REVIEW",
      productName: { not: "" },
      productCode: { not: null },
    },
    data: { status: "APPROVED" },
  });

  const approvedCount = await prisma.catalogueImportItem.count({
    where: { jobId, status: "APPROVED" },
  });

  await prisma.catalogueImportJob.update({
    where: { id: jobId },
    data: { approvedProducts: approvedCount },
  });

  return { approvedCount };
}

/**
 * Publishes all approved products directly into the existing ERP Product master.
 *
 * CRITICAL INVENTORY SAFEGUARD:
 * Strictly avoids creating purchase invoices, goods receipts, stock ledgers,
 * or inventory balances. Product master creation only!
 */
export async function publishApprovedProducts(
  firmId: string,
  jobId: string,
  userId?: string | null,
) {
  const job = await prisma.catalogueImportJob.findFirst({
    where: { id: jobId, firmId },
    include: {
      items: {
        where: { status: "APPROVED" },
      },
    },
  });
  if (!job) throw new NotFoundError("Catalogue job not found");

  if (job.items.length === 0) {
    throw new BusinessRuleError("No approved products to publish. Please review and approve products first.");
  }

  const results: Array<{ itemId: string; productId: string; action: "CREATED" | "UPDATED" }> = [];

  for (const item of job.items) {
    const sku = item.productCode?.trim().toUpperCase() ?? `PRD-${item.id.slice(-6).toUpperCase()}`;

    // Check if product with this SKU already exists
    const existing = await prisma.product.findFirst({
      where: { firmId, sku },
    });

    const modified = (item.modifiedFields as Record<string, unknown>) ?? {};
    const resolution = (modified.duplicateResolution as string) ?? (existing ? "UPDATE_EXISTING" : "CREATE_NEW");

    if (resolution === "SKIP") {
      await prisma.catalogueImportItem.update({
        where: { id: item.id },
        data: { status: "EXCLUDED" },
      });
      continue;
    }

    if (existing && resolution === "UPDATE_EXISTING") {
      // Update permitted fields without resetting transaction history
      const updated = await updateProduct(firmId, existing.id, {
        firmId,
        name: item.productName,
        sku,
        brandId: item.brandId ?? existing.brandId,
        categoryId: item.categoryId ?? existing.categoryId,
        subcategory: item.subcategory ?? existing.subcategory,
        sellingPrice: Number(item.sellingPrice) || Number(existing.sellingPrice),
        mrp: Number(item.mrp) || Number(existing.mrp),
        purchasePrice: Number(item.purchasePrice) || Number(existing.purchasePrice),
        gstRate: Number(item.gstRate) || Number(existing.gstRate),
        hsnCode: item.hsnCode ?? existing.hsnCode,
        unit: item.unit || existing.unit,
        description: item.description ?? existing.description,
        imageUrl: item.primaryImageUrl ?? existing.imageUrl,
        attributes: (item.attributes as Array<{ name: string; value: string }>) ?? [],
        userId,
      });

      await prisma.catalogueImportItem.update({
        where: { id: item.id },
        data: {
          status: "IMPORTED",
          importedProductId: updated.id,
          importedAt: new Date(),
        },
      });

      results.push({ itemId: item.id, productId: updated.id, action: "UPDATED" });
    } else {
      // Create new product in ERP product master
      // If SKU is collision but resolution is CREATE_NEW, generate a unique suffix
      let targetSku = sku;
      if (existing) {
        targetSku = `${sku}-${Math.floor(1000 + Math.random() * 9000)}`;
      }

      const created = await createProduct({
        firmId,
        name: item.productName,
        subName: item.subcategory || item.surface || null,
        sku: targetSku,
        brandId: item.brandId ?? null,
        categoryId: item.categoryId ?? null,
        subcategory: item.subcategory ?? null,
        sellingPrice: Number(item.sellingPrice) || 0,
        mrp: Number(item.mrp) || 0,
        purchasePrice: Number(item.purchasePrice) || 0,
        gstRate: Number(item.gstRate) || 18,
        hsnCode: item.hsnCode || "6907",
        unit: item.unit || "box",
        description: item.description ?? null,
        imageUrl: item.primaryImageUrl ?? null,
        attributes: (item.attributes as Array<{ name: string; value: string }>) ?? [],
        userId,
      });

      await prisma.catalogueImportItem.update({
        where: { id: item.id },
        data: {
          status: "IMPORTED",
          importedProductId: created.id,
          importedAt: new Date(),
        },
      });

      results.push({ itemId: item.id, productId: created.id, action: "CREATED" });
    }
  }

  // Update job status
  const remainingApproved = await prisma.catalogueImportItem.count({
    where: { jobId, status: "APPROVED" },
  });
  const totalImported = await prisma.catalogueImportItem.count({
    where: { jobId, status: "IMPORTED" },
  });
  const totalPending = await prisma.catalogueImportItem.count({
    where: { jobId, status: "PENDING_REVIEW" },
  });

  const finalJobStatus = totalPending > 0 || remainingApproved > 0 ? "PARTIALLY_IMPORTED" : "IMPORTED";

  await prisma.catalogueImportJob.update({
    where: { id: jobId },
    data: {
      status: finalJobStatus,
      importedProducts: totalImported,
      completedAt: new Date(),
    },
  });

  await recordAudit({
    action: "CATALOGUE_IMPORTED",
    entity: "CatalogueImportJob",
    entityId: jobId,
    summary: `Published ${results.length} products to ERP Product Master`,
    firmId,
    userId,
    after: { publishedCount: results.length, finalStatus: finalJobStatus },
  });

  return {
    publishedCount: results.length,
    finalStatus: finalJobStatus,
    results,
  };
}

/**
 * Creates a new brand inline from the review screen if missing.
 */
export async function createQuickBrand(firmId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new BusinessRuleError("Brand name is required");

  const existing = await prisma.brand.findFirst({
    where: { firmId, name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return existing;

  return prisma.brand.create({
    data: { firmId, name: trimmed },
  });
}

/**
 * Creates a new category inline from the review screen if missing.
 */
export async function createQuickCategory(firmId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new BusinessRuleError("Category name is required");

  const existing = await prisma.category.findFirst({
    where: { firmId, name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return existing;

  return prisma.category.create({
    data: { firmId, name: trimmed },
  });
}
