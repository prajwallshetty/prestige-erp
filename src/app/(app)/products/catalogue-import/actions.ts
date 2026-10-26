"use server";

import { revalidatePath } from "next/cache";

import { runAction, BusinessRuleError } from "@/lib/action-result";
import { authorize, requireFirmId } from "@/lib/session";
import {
  createCatalogueJob,
  processCatalogueJob,
  saveReviewItem,
  approveItem,
  excludeItem,
  approveAllValidItems,
  publishApprovedProducts,
  createQuickBrand,
  createQuickCategory,
  type ReviewItemEdits,
} from "@/lib/services/catalogue-import";
import { prisma } from "@/lib/prisma";

export async function uploadCatalogueAction(formData: FormData) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof File)) {
      throw new BusinessRuleError("No PDF file provided for upload");
    }

    if (file.size === 0) {
      throw new BusinessRuleError("Uploaded file is empty");
    }

    // Limit to 50MB
    if (file.size > 50 * 1024 * 1024) {
      throw new BusinessRuleError("File size exceeds maximum limit of 50 MB");
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const job = await createCatalogueJob({
      firmId,
      branchId: user.branchId ?? null,
      filename: file.name,
      buffer,
      userId: user.id,
    });

    // Auto-advance process
    try {
      await processCatalogueJob(firmId, job.id, user.id);
    } catch {
      // Process error is stored in job record
    }

    const finalJob = await prisma.catalogueImportJob.findUnique({
      where: { id: job.id },
      select: { status: true },
    });

    revalidatePath("/products/catalogue-import");
    return { jobId: job.id, filename: job.sourceFilename, status: finalJob?.status ?? job.status };
  });
}

export async function processCatalogueJobAction(jobId: string) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const result = await processCatalogueJob(firmId, jobId, user.id);
    revalidatePath("/products/catalogue-import");
    revalidatePath(`/products/catalogue-import/${jobId}`);
    return result;
  });
}

export async function retryCatalogueJobAction(jobId: string) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const result = await processCatalogueJob(firmId, jobId, user.id);
    revalidatePath("/products/catalogue-import");
    revalidatePath(`/products/catalogue-import/${jobId}`);
    return result;
  });
}

export async function cancelCatalogueJobAction(jobId: string) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    await prisma.catalogueImportJob.update({
      where: { id: jobId, firmId },
      data: { status: "CANCELLED" },
    });

    revalidatePath("/products/catalogue-import");
    revalidatePath(`/products/catalogue-import/${jobId}`);
    return { cancelled: true };
  });
}

export async function saveReviewItemAction(itemId: string, edits: ReviewItemEdits) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const updated = await saveReviewItem(firmId, itemId, edits, user.id);
    revalidatePath(`/products/catalogue-import/${updated.jobId}`);
    return { id: updated.id, status: updated.status };
  });
}

export async function approveItemAction(itemId: string) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const updated = await approveItem(firmId, itemId);
    revalidatePath(`/products/catalogue-import/${updated.jobId}`);
    return { id: updated.id, status: updated.status };
  });
}

export async function excludeItemAction(itemId: string) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const updated = await excludeItem(firmId, itemId);
    revalidatePath(`/products/catalogue-import/${updated.jobId}`);
    return { id: updated.id, status: updated.status };
  });
}

export async function approveAllValidAction(jobId: string) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const result = await approveAllValidItems(firmId, jobId);
    revalidatePath(`/products/catalogue-import/${jobId}`);
    return result;
  });
}

export async function publishApprovedAction(jobId: string) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const result = await publishApprovedProducts(firmId, jobId, user.id);
    revalidatePath("/products");
    revalidatePath("/products/catalogue-import");
    revalidatePath(`/products/catalogue-import/${jobId}`);
    return result;
  });
}

export async function createQuickBrandAction(name: string) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const brand = await createQuickBrand(firmId, name);
    return brand;
  });
}

export async function createQuickCategoryAction(name: string) {
  return runAction(async () => {
    const user = await authorize("products.create");
    const firmId = requireFirmId(user);

    const category = await createQuickCategory(firmId, name);
    return category;
  });
}
