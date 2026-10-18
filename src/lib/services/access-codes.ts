import "server-only";

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";

/**
 * Access-code management (Super Admin). Codes are generated server-side,
 * stored as bcrypt hashes and never echoed back after creation — the plain
 * code is shown once, at creation, then only its description/metadata remains.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

function generateCode(prefix: "TECH-GST" | "TECH-NONGST"): string {
  let digits = "";
  for (let i = 0; i < 4; i += 1) {
    digits += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${prefix}-${digits}`;
}

export async function createAccessCode(input: {
  firmId: string;
  type: "GST" | "NON_GST";
  description?: string | null;
  expiresAt?: Date | null;
  createdById?: string | null;
}) {
  const firm = await prisma.firm.findUnique({ where: { id: input.firmId }, select: { id: true } });
  if (!firm) throw new NotFoundError("Firm not found");

  const bcrypt = await import("bcryptjs");
  const plain = generateCode(input.type === "GST" ? "TECH-GST" : "TECH-NONGST");
  const codeHash = await bcrypt.hash(plain, 12);

  const accessCode = await prisma.accessCode.create({
    data: {
      firmId: input.firmId,
      codeHash,
      type: input.type,
      description: input.description ?? null,
      expiresAt: input.expiresAt ?? null,
      createdById: input.createdById ?? null,
    },
  });

  await recordAudit({
    action: "ACCESS_CODE_CREATED",
    entity: "AccessCode",
    entityId: accessCode.id,
    summary: `${input.type} access code created for ${input.firmId}`,
    firmId: input.firmId,
    userId: input.createdById,
  });

  // The only moment the plain code is visible.
  return { id: accessCode.id, code: plain, type: input.type };
}

export async function listAccessCodes(firmId: string) {
  return prisma.accessCode.findMany({
    where: { firmId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      type: true,
      description: true,
      isActive: true,
      expiresAt: true,
      lastUsedAt: true,
      useCount: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
}

export async function updateAccessCode(
  firmId: string,
  accessCodeId: string,
  input: {
    isActive?: boolean;
    description?: string | null;
    expiresAt?: Date | null;
    userId?: string | null;
  },
) {
  const existing = await prisma.accessCode.findFirst({
    where: { id: accessCodeId, firmId },
  });
  if (!existing) throw new NotFoundError("Access code not found");

  const updated = await prisma.accessCode.update({
    where: { id: accessCodeId },
    data: {
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    },
  });

  await recordAudit({
    action: "ACCESS_CODE_UPDATED",
    entity: "AccessCode",
    entityId: accessCodeId,
    summary: `${existing.type} code ${input.isActive === false ? "disabled" : "updated"}`,
    firmId,
    userId: input.userId,
  });

  return updated;
}

export async function rotateAccessCode(
  firmId: string,
  accessCodeId: string,
  userId?: string | null,
) {
  const existing = await prisma.accessCode.findFirst({
    where: { id: accessCodeId, firmId },
  });
  if (!existing) throw new NotFoundError("Access code not found");

  const bcrypt = await import("bcryptjs");
  const plain = generateCode(existing.type === "GST" ? "TECH-GST" : "TECH-NONGST");
  const codeHash = await bcrypt.hash(plain, 12);

  await prisma.accessCode.update({
    where: { id: accessCodeId },
    data: { codeHash, useCount: 0, lastUsedAt: null },
  });

  await recordAudit({
    action: "ACCESS_CODE_UPDATED",
    entity: "AccessCode",
    entityId: accessCodeId,
    summary: `${existing.type} code rotated`,
    firmId,
    userId,
  });

  return { code: plain };
}

export async function firmHasCodes(firmId: string): Promise<boolean> {
  const count = await prisma.accessCode.count({
    where: { firmId, isActive: true },
  });
  return count > 0;
}
