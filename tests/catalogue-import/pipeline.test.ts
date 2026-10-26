import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import PDFDocument from "pdfkit";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalogue-test-"));
const g = globalThis as { __testSession?: unknown };

describe("AI Catalogue OCR & Import Pipeline", { timeout: 120_000 }, () => {
  let prisma: typeof import("../../src/lib/prisma").prisma;
  let rbac: typeof import("../../src/lib/rbac");
  let catalogueSvc: typeof import("../../src/lib/services/catalogue-import");

  const run = Date.now().toString(36);
  const firmId = `catfirm_${run}`;
  const ids = {
    branch: "",
    user: "",
    existingTileId: "",
    kajariaBrandId: "",
    floorTilesCatId: "",
  };

  // Helper to create a representative PDF brochure containing 2 pages, multiple products,
  // specifications (Size, Surface, Packaging, Prices) and real embedded swatch images.
  async function generateSampleBrochurePdf(): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const buffers: Buffer[] = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      // Use valid 120x120 JPEG swatch image
      const swatchBuffer = fs.readFileSync(path.join(process.cwd(), "tests", "catalogue-import", "sample_tile.jpg"));

      // --- PAGE 1: Kajaria Eternity Ceramics ---
      doc.fontSize(22).font("Helvetica-Bold").text("Kajaria Eternity Premium Collection", 40, 40);
      doc.fontSize(10).font("Helvetica").text("Architectural Glazed Vitrified Tiles · Catalogue 2026", 40, 68);

      // Product 1 Card
      doc.image(swatchBuffer, 40, 95, { width: 120, height: 120 });
      doc.fontSize(14).font("Helvetica-Bold").text("Statuario Gold", 180, 100);
      doc.fontSize(11).font("Helvetica-Bold").text("PGVT-8012", 180, 118);
      doc.fontSize(10).font("Helvetica").text("Size: 600x1200 mm · Surface: Glossy", 180, 136);
      doc.fontSize(10).font("Helvetica").text("Material: Glazed Vitrified · 2 Pcs/Box · 1.44 Sqm", 180, 152);
      doc.fontSize(10).font("Helvetica").text("MRP: Rs. 950 · HSN: 6907 · GST: 18%", 180, 168);

      // Product 2 Card
      doc.image(swatchBuffer, 40, 240, { width: 120, height: 120 });
      doc.fontSize(14).font("Helvetica-Bold").text("Calacatta Matt Floor Tile", 180, 245);
      doc.fontSize(11).font("Helvetica-Bold").text("MARBLE-01", 180, 263);
      doc.fontSize(10).font("Helvetica").text("Size: 600x600 mm · Surface: Matt", 180, 281);
      doc.fontSize(10).font("Helvetica").text("Material: Vitrified · 4 Pcs/Box · 1.44 Sqm", 180, 297);
      doc.fontSize(10).font("Helvetica").text("MRP: Rs. 650 · HSN: 6907 · GST: 18%", 180, 313);

      // --- PAGE 2: Somany & Duplicate Collision Test ---
      doc.addPage();
      doc.fontSize(22).font("Helvetica-Bold").text("Somany Ceramics Architectural Series", 40, 40);
      doc.fontSize(10).font("Helvetica").text("Wood Finish Planks & Heavy Duty Vitrified", 40, 68);

      // Product 3 Card
      doc.image(swatchBuffer, 40, 95, { width: 120, height: 120 });
      doc.fontSize(14).font("Helvetica-Bold").text("Rustic Oak Plank", 180, 100);
      doc.fontSize(11).font("Helvetica-Bold").text("SL-204", 180, 118);
      doc.fontSize(10).font("Helvetica").text("Size: 200x1200 mm · Surface: Rustic", 180, 136);
      doc.fontSize(10).font("Helvetica").text("Material: Vitrified · 6 Pcs/Box · 1.44 Sqm", 180, 152);
      doc.fontSize(10).font("Helvetica").text("MRP: Rs. 820 · HSN: 6907 · GST: 18%", 180, 168);

      // Product 4: Collision / Duplicate SKU test (TL-600 already exists in ERP)
      doc.image(swatchBuffer, 40, 240, { width: 120, height: 120 });
      doc.fontSize(14).font("Helvetica-Bold").text("Glossy Ivory Tile (Supplier Revision)", 180, 245);
      doc.fontSize(11).font("Helvetica-Bold").text("TL-600", 180, 263);
      doc.fontSize(10).font("Helvetica").text("Size: 600x600 mm · Surface: Glossy", 180, 281);
      doc.fontSize(10).font("Helvetica").text("Material: Vitrified · 4 Pcs/Box · 1.44 Sqm", 180, 297);
      doc.fontSize(10).font("Helvetica").text("MRP: Rs. 1150 · HSN: 6907 · GST: 18%", 180, 313);

      doc.end();
    });
  }

  before(async () => {
    delete process.env.DATABASE_URL;
    process.env.PGLITE_DIR = dir;

    ({ prisma } = await import("../../src/lib/prisma"));
    rbac = await import("../../src/lib/rbac");
    catalogueSvc = await import("../../src/lib/services/catalogue-import");

    // Initialize test firm & branch
    const code = `CAT_${run}`.toUpperCase().slice(0, 10);
    await prisma.firm.create({
      data: {
        id: firmId,
        code,
        name: "Test Tile Importers Pvt Ltd",
        state: "Karnataka",
      },
    });

    ids.branch = (
      await prisma.branch.create({
        data: {
          firmId,
          code: "MAIN",
          name: "Main Showroom",
          type: "HEAD_OFFICE",
          state: "Karnataka",
        },
      })
    ).id;

    // Create test user with inventory/product management permissions
    const userRow = await prisma.user.create({
      data: {
        firmId,
        branchId: ids.branch,
        name: "Admin User",
        email: `admin-${run}@test.local`,
        accessCode: `${run}1`.slice(-9).padStart(9, "7"),
        role: "ADMIN",
      },
    });
    ids.user = userRow.id;

    // Seed existing brand and category
    const brand = await prisma.brand.create({
      data: { firmId, name: "Kajaria" },
    });
    ids.kajariaBrandId = brand.id;

    const cat = await prisma.category.create({
      data: { firmId, name: "Floor Tiles" },
    });
    ids.floorTilesCatId = cat.id;

    // Seed existing product with SKU "TL-600" to test duplicate detection
    const existingTile = await prisma.product.create({
      data: {
        firmId,
        sku: "TL-600",
        name: "Glossy Ivory Vitrified Tile",
        sellingPrice: 1000,
        mrp: 1000,
        gstRate: 18,
        unit: "box",
        hsnCode: "6907",
        brandId: brand.id,
        categoryId: cat.id,
      },
    });
    ids.existingTileId = existingTile.id;
  });

  after(async () => {
    await prisma?.$disconnect().catch(() => {});
    const globalPGlite = globalThis as { pgliteInstance?: { close(): Promise<void> } };
    await globalPGlite.pgliteInstance?.close().catch(() => {});
  });

  it("validates file upload format and magic bytes", async () => {
    // Non-PDF extension
    await assert.rejects(
      catalogueSvc.createCatalogueJob({
        firmId,
        filename: "test.docx",
        buffer: Buffer.from("not a pdf"),
        userId: ids.user,
      }),
      /Only PDF catalogues are supported/,
    );

    // PDF extension but invalid magic bytes
    await assert.rejects(
      catalogueSvc.createCatalogueJob({
        firmId,
        filename: "fake.pdf",
        buffer: Buffer.from("Plain text file disguised as pdf"),
        userId: ids.user,
      }),
      /missing %PDF- header/,
    );
  });

  it("creates catalogue job and runs multi-stage extraction pipeline", async () => {
    const pdfBuffer = await generateSampleBrochurePdf();

    // 1. Create Job
    const job = await catalogueSvc.createCatalogueJob({
      firmId,
      branchId: ids.branch,
      filename: "Kajaria_Somany_2026_Brochure.pdf",
      buffer: pdfBuffer,
      userId: ids.user,
    });

    assert.ok(job.id, "Job ID should be created");
    assert.equal(job.status, "UPLOADED");
    assert.equal(job.sourceFilename, "Kajaria_Somany_2026_Brochure.pdf");

    // 2. Process Job
    const result = await catalogueSvc.processCatalogueJob(firmId, job.id, ids.user);
    assert.ok(result.totalProducts >= 4, `Expected at least 4 products extracted, got ${result.totalProducts}`);

    // Verify job status updated
    const updatedJob = await prisma.catalogueImportJob.findUnique({ where: { id: job.id } });
    assert.equal(updatedJob?.status, "REVIEW_REQUIRED");
    assert.equal(updatedJob?.pageCount, 2);

    // Verify candidate items created in database
    const items = await prisma.catalogueImportItem.findMany({
      where: { jobId: job.id },
      orderBy: { sourcePage: "asc" },
    });
    assert.ok(items.length >= 4);

    // Verify product 1: PGVT-8012 (Statuario Gold)
    const p1 = items.find((i) => i.productCode === "PGVT-8012");
    assert.ok(p1, "Product PGVT-8012 should be extracted");
    assert.match(p1.productName, /Statuario/i);
    assert.equal(p1.size, "600x1200 mm");
    assert.equal(p1.surface, "Glossy");
    assert.equal(p1.material, "Glazed Vitrified");
    assert.equal(p1.piecesPerBox, 2);
    assert.equal(p1.coveragePerBox ? Number(p1.coveragePerBox) : null, 1.44);
    assert.equal(p1.mrp ? Number(p1.mrp) : null, 950);
    assert.equal(p1.duplicateStatus, "NEW_PRODUCT");
    assert.ok(p1.primaryImageUrl, "Should have associated product image");

    // Verify product 2: MARBLE-01 (Calacatta)
    const p2 = items.find((i) => i.productCode === "MARBLE-01");
    assert.ok(p2, "Product MARBLE-01 should be extracted");
    assert.equal(p2.size, "600x600 mm");
    assert.equal(p2.surface, "Matt");
    assert.equal(p2.piecesPerBox, 4);

    // Verify product 4: TL-600 duplicate detection against existing product in ERP
    const p4 = items.find((i) => i.productCode === "TL-600");
    assert.ok(p4, "Product TL-600 should be extracted");
    assert.equal(p4.duplicateStatus, "CHANGED_DETAILS");
    assert.equal(p4.duplicateProductId, ids.existingTileId);
    assert.ok(p4.duplicateReason?.includes("TL-600"));
  });

  it("supports reviewer editing, approval, and exclusion", async () => {
    const job = await prisma.catalogueImportJob.findFirst({
      where: { firmId },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(job);

    const items = await prisma.catalogueImportItem.findMany({ where: { jobId: job.id } });
    const p1 = items.find((i) => i.productCode === "PGVT-8012")!;

    // Save reviewer modifications
    const updatedP1 = await catalogueSvc.saveReviewItem(
      firmId,
      p1.id,
      {
        productName: "Kajaria Statuario Gold Extra Polished",
        sellingPrice: 890,
        brandId: ids.kajariaBrandId,
        categoryId: ids.floorTilesCatId,
      },
      ids.user,
    );

    assert.equal(updatedP1.productName, "Kajaria Statuario Gold Extra Polished");
    assert.equal(Number(updatedP1.sellingPrice), 890);
    assert.equal(updatedP1.brandId, ids.kajariaBrandId);

    // Approve p1
    const approvedP1 = await catalogueSvc.approveItem(firmId, p1.id);
    assert.equal(approvedP1.status, "APPROVED");

    // Exclude p2
    const p2 = items.find((i) => i.productCode === "MARBLE-01")!;
    const excludedP2 = await catalogueSvc.excludeItem(firmId, p2.id);
    assert.equal(excludedP2.status, "EXCLUDED");

    // Approve all remaining valid products
    const approveAllResult = await catalogueSvc.approveAllValidItems(firmId, job.id);
    assert.ok(approveAllResult.approvedCount >= 2);
  });

  it("publishes approved products to ERP Product Master with ZERO stock impact", async () => {
    const job = await prisma.catalogueImportJob.findFirst({
      where: { firmId },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(job);

    const initialStockTxns = await prisma.stockTransaction.count({ where: { firmId } });

    // Publish approved products to ERP
    const publishResult = await catalogueSvc.publishApprovedProducts(firmId, job.id, ids.user);
    assert.ok(publishResult.publishedCount >= 2, "Expected at least 2 products published");

    // Verify product exists in ERP Product master
    const createdProduct = await prisma.product.findFirst({
      where: { firmId, sku: "PGVT-8012" },
      include: { attributes: true, brand: true, category: true },
    });

    assert.ok(createdProduct, "Product PGVT-8012 should exist in Product master");
    assert.equal(createdProduct.name, "Kajaria Statuario Gold Extra Polished");
    assert.equal(createdProduct.brand?.name, "Kajaria");
    assert.equal(createdProduct.category?.name, "Floor Tiles");
    assert.equal(Number(createdProduct.sellingPrice), 890);
    assert.ok(createdProduct.imageUrl, "Product should have imageUrl set");

    // Verify flexible specifications (ProductAttribute)
    const sizeAttr = createdProduct.attributes.find((a) => a.name === "Size");
    assert.equal(sizeAttr?.value, "600x1200 mm");

    const surfaceAttr = createdProduct.attributes.find((a) => a.name === "Surface / Finish");
    assert.equal(surfaceAttr?.value, "Glossy");

    // CRITICAL ACCEPTANCE CRITERIA 9:
    // Catalogue import must never create stock transactions or increase inventory quantities
    const finalStockTxns = await prisma.stockTransaction.count({ where: { firmId } });
    assert.equal(
      finalStockTxns,
      initialStockTxns,
      "Stock transaction count must remain unchanged after catalogue import!",
    );

    // Verify stock balance for newly imported product is 0
    const inv = await import("../../src/lib/services/inventory");
    const stockLevels = await inv.getStockLevelsForProducts(firmId, ids.branch, [createdProduct.id]);
    assert.equal(stockLevels.get(createdProduct.id) ?? 0, 0, "Imported product must have 0 stock balance");

    // Verify job status updated to IMPORTED or PARTIALLY_IMPORTED
    const completedJob = await prisma.catalogueImportJob.findUnique({ where: { id: job.id } });
    assert.ok(
      completedJob?.status === "IMPORTED" || completedJob?.status === "PARTIALLY_IMPORTED",
      `Job status should be IMPORTED or PARTIALLY_IMPORTED, got ${completedJob?.status}`,
    );

    // Verify audit log entry
    const audit = await prisma.auditLog.findFirst({
      where: { firmId, entityId: job.id, action: "CATALOGUE_IMPORTED" },
    });
    assert.ok(audit, "Audit log for CATALOGUE_IMPORTED must be recorded");
  });
});
