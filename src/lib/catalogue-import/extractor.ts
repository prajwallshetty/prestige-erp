import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ExtractedImage {
  id: string;
  filename: string;
  storagePath: string;
  url: string;
  sourcePage: number;
  bbox: [number, number, number, number];
  pixelWidth?: number;
  pixelHeight?: number;
  method: "EMBEDDED" | "PAGE_CROP" | "CONTOUR_REGION";
  aspectRatio?: number;
  isPrimary?: boolean;
  confidence?: number;
}

export interface ExtractedProduct {
  sourcePage: number;
  productCode: string;
  productName: string;
  brandName?: string | null;
  categoryName?: string | null;
  subcategory?: string | null;
  size?: string | null;
  surface?: string | null;
  color?: string | null;
  material?: string | null;
  unit: string;
  piecesPerBox?: number | null;
  coveragePerBox?: number | null;
  mrp?: number | null;
  purchasePrice?: number | null;
  sellingPrice?: number | null;
  gstRate: number;
  hsnCode?: string | null;
  description?: string | null;
  confidence: number;
  reviewWarnings: string[];
  attributes: Array<{ name: string; value: string }>;
  rawText?: string | null;
  primaryImageUrl?: string | null;
  images: ExtractedImage[];
}

export interface ExtractedPage {
  pageNo: number;
  isScanned?: boolean;
  previewUrl?: string;
  previewPath?: string;
  brand?: string | null;
  productCount: number;
  imageCount: number;
  error?: string;
}

export interface ExtractionResult {
  jobId: string;
  totalPages: number;
  processedStartPage: number;
  processedEndPage: number;
  documentBrand?: string | null;
  totalProducts: number;
  pages: ExtractedPage[];
  products: ExtractedProduct[];
}

export async function runCatalogueExtractor(options: {
  pdfPath: string;
  outputDir: string;
  jobId: string;
  startPage?: number;
  endPage?: number;
}): Promise<ExtractionResult> {
  const pythonScript = path.join(process.cwd(), "scripts", "catalogue_extractor.py");
  const args = [
    pythonScript,
    "--pdf",
    options.pdfPath,
    "--output-dir",
    options.outputDir,
    "--job-id",
    options.jobId,
    "--start-page",
    String(options.startPage ?? 1),
    "--end-page",
    String(options.endPage ?? 0),
  ];

  try {
    const { stdout } = await run("python", args, {
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as ExtractionResult;
    return parsed;
  } catch (error) {
    // If output JSON was written to disk, load that
    const resultJsonPath = path.join(options.outputDir, "extraction_result.json");
    try {
      const data = await fs.readFile(resultJsonPath, "utf-8");
      return JSON.parse(data) as ExtractionResult;
    } catch {
      // Re-throw actionable error
      throw new Error(`Catalogue extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
