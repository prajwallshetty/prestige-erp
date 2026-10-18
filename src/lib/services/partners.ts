import "server-only";

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { nextCustomerCode, nextSupplierCode } from "@/lib/sequence";
import { validateGstin } from "@/lib/services/products";
import { recordAudit } from "@/lib/audit";

/**
 * Customer & supplier services. GSTIN format is validated when supplied;
 * codes are firm-scoped and generated from the document sequences.
 */

export interface CustomerInput {
  firmId: string;
  branchId: string;
  name: string;
  company?: string | null;
  phone: string;
  email?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  pan?: string | null;
  type?: "RETAIL" | "BUSINESS" | "DEALER" | "CORPORATE" | "OTHER";
  creditLimit?: number;
  openingBalance?: number;
  notes?: string | null;
  userId?: string | null;
}

export async function createCustomer(input: CustomerInput) {
  if (!input.name.trim()) throw new BusinessRuleError("Customer name is required");
  if (!input.phone.trim()) throw new BusinessRuleError("Phone number is required");
  if (!validateGstin(input.gstin)) {
    throw new BusinessRuleError("Invalid GSTIN format");
  }

  const code = await nextCustomerCode(input.firmId);

  const customer = await prisma.customer.create({
    data: {
      code,
      firmId: input.firmId,
      branchId: input.branchId,
      name: input.name.trim(),
      company: input.company?.trim() || null,
      phone: input.phone.trim(),
      email: input.email?.trim() || null,
      addressLine: input.addressLine?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      stateCode: input.stateCode?.trim() || null,
      pincode: input.pincode?.trim() || null,
      gstin: input.gstin?.trim().toUpperCase() || null,
      pan: input.pan?.trim().toUpperCase() || null,
      type: input.type ?? "RETAIL",
      creditLimit: input.creditLimit ?? 0,
      openingBalance: input.openingBalance ?? 0,
      outstandingAmount: input.openingBalance ?? 0,
      notes: input.notes ?? null,
    },
  });

  await recordAudit({
    action: "CUSTOMER_CREATED",
    entity: "Customer",
    entityId: customer.id,
    summary: `${customer.name} (${customer.code})`,
    firmId: input.firmId,
    branchId: input.branchId,
    userId: input.userId,
  });

  return customer;
}

export async function updateCustomer(firmId: string, customerId: string, input: CustomerInput) {
  const existing = await prisma.customer.findFirst({ where: { id: customerId, firmId } });
  if (!existing) throw new NotFoundError("Customer not found");
  if (!validateGstin(input.gstin)) {
    throw new BusinessRuleError("Invalid GSTIN format");
  }

  return prisma.customer.update({
    where: { id: customerId },
    data: {
      name: input.name.trim(),
      company: input.company?.trim() || null,
      phone: input.phone.trim(),
      email: input.email?.trim() || null,
      addressLine: input.addressLine?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      stateCode: input.stateCode?.trim() || null,
      pincode: input.pincode?.trim() || null,
      gstin: input.gstin?.trim().toUpperCase() || null,
      pan: input.pan?.trim().toUpperCase() || null,
      type: input.type ?? "RETAIL",
      creditLimit: input.creditLimit ?? 0,
      openingBalance: input.openingBalance ?? 0,
      notes: input.notes ?? null,
    },
  });
}

export async function searchCustomers(
  firmId: string,
  query: string | undefined,
  take = 20,
) {
  return prisma.customer.findMany({
    where: {
      firmId,
      isActive: true,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
              { code: { contains: query, mode: "insensitive" } },
              { gstin: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take,
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      email: true,
      gstin: true,
      type: true,
      state: true,
      outstandingAmount: true,
      creditLimit: true,
    },
  });
}

export interface SupplierInput {
  firmId: string;
  name: string;
  company?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  paymentTerms?: string | null;
  creditDays?: number;
  openingBalance?: number;
  userId?: string | null;
}

export async function createSupplier(input: SupplierInput) {
  if (!input.name.trim()) throw new BusinessRuleError("Supplier name is required");
  if (!validateGstin(input.gstin)) {
    throw new BusinessRuleError("Invalid GSTIN format");
  }
  const code = await nextSupplierCode(input.firmId);

  const supplier = await prisma.supplier.create({
    data: {
      code,
      firmId: input.firmId,
      name: input.name.trim(),
      company: input.company?.trim() || null,
      gstin: input.gstin?.trim().toUpperCase() || null,
      pan: input.pan?.trim().toUpperCase() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      addressLine: input.addressLine?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      stateCode: input.stateCode?.trim() || null,
      pincode: input.pincode?.trim() || null,
      paymentTerms: input.paymentTerms?.trim() || null,
      creditDays: input.creditDays ?? 0,
      openingBalance: input.openingBalance ?? 0,
      outstandingAmount: input.openingBalance ?? 0,
    },
  });

  await recordAudit({
    action: "SUPPLIER_CREATED",
    entity: "Supplier",
    entityId: supplier.id,
    summary: `${supplier.name} (${supplier.code})`,
    firmId: input.firmId,
    userId: input.userId,
  });

  return supplier;
}

export async function updateSupplier(firmId: string, supplierId: string, input: SupplierInput) {
  const existing = await prisma.supplier.findFirst({ where: { id: supplierId, firmId } });
  if (!existing) throw new NotFoundError("Supplier not found");
  if (!validateGstin(input.gstin)) {
    throw new BusinessRuleError("Invalid GSTIN format");
  }

  return prisma.supplier.update({
    where: { id: supplierId },
    data: {
      name: input.name.trim(),
      company: input.company?.trim() || null,
      gstin: input.gstin?.trim().toUpperCase() || null,
      pan: input.pan?.trim().toUpperCase() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      addressLine: input.addressLine?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      stateCode: input.stateCode?.trim() || null,
      pincode: input.pincode?.trim() || null,
      paymentTerms: input.paymentTerms?.trim() || null,
      creditDays: input.creditDays ?? 0,
      openingBalance: input.openingBalance ?? 0,
    },
  });
}

export async function searchSuppliers(firmId: string, query: string | undefined, take = 50) {
  return prisma.supplier.findMany({
    where: {
      firmId,
      isActive: true,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
              { code: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take,
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      gstin: true,
      outstandingAmount: true,
    },
  });
}
