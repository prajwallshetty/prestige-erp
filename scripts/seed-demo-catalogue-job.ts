import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { createCatalogueJob, processCatalogueJob } from "../src/lib/services/catalogue-import";

async function main() {
  const firmId = "firm_technic_main";
  const user = await prisma.user.findFirst({
    where: { accessCode: "900002" },
  });
  if (!user) {
    throw new Error("Admin user not found");
  }

  const pdfPath = path.join(process.cwd(), "tests", "catalogue-import", "demo_brochure.pdf");
  const buffer = fs.readFileSync(pdfPath);

  console.log("Creating catalogue import job...");
  const job = await createCatalogueJob({
    firmId,
    userId: user.id,
    branchId: user.branchId,
    filename: "Kajaria_Somany_Architectural_Tiles_2026.pdf",
    buffer,
  });

  console.log("Processing catalogue job id:", job.id);
  await processCatalogueJob(firmId, job.id, user.id);

  console.log("Job processed successfully! ID:", job.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
