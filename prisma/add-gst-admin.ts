import { prisma } from "../src/lib/prisma";

async function main() {
  const firm = await prisma.firm.findFirst({ where: { name: { contains: "Technic" } }, select: { id: true, name: true } });
  if (!firm) throw new Error("Technic firm not found");
  const ho = await prisma.branch.findFirst({ where: { firmId: firm.id, type: "HEAD_OFFICE" }, select: { id: true } });
  const existing = await prisma.user.findUnique({ where: { accessCode: "900000" } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { accessView: "GST_ONLY", role: "ADMIN", status: "ACTIVE", firmId: firm.id, branchId: ho?.id ?? null } });
    console.log("updated existing 900000");
  } else {
    await prisma.user.create({
      data: {
        firmId: firm.id,
        employeeCode: "EMP0000",
        name: "GST Reconciliation Admin",
        email: "gst.admin@technic.example",
        accessCode: "900000",
        role: "ADMIN",
        branchId: ho?.id ?? null,
        status: "ACTIVE",
        accessView: "GST_ONLY",
      },
    });
    console.log("created 900000");
  }
}

main().finally(() => prisma.$disconnect());
