import { NextResponse } from "next/server";

import { getCurrentUser, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { listInvoices } from "@/lib/services/invoice-list";
import { salesReport, purchaseReport, gstSummaryReport } from "@/lib/services/reports";
import { errorStatus } from "@/lib/action-result";

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (value: string | number) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\r\n");
}

function csvResponse(fileName: string, csv: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.activeFirmId) return NextResponse.json({ error: "Select a firm first" }, { status: 403 });

    const limit = rateLimit(`export:${user.id}`, RATE_LIMITS.EXPORT.limit, RATE_LIMITS.EXPORT.windowMs);
    if (!limit.success) {
      return NextResponse.json(
        { error: `Too many exports. Retry in ${limit.retryAfterSeconds}s.` },
        { status: 429 },
      );
    }
    if (!hasPermission(user, PERMISSIONS.REPORTS_EXPORT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "invoices";
    const params = {
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      preset: (url.searchParams.get("preset") ?? undefined) as never,
    };

    switch (type) {
      case "invoices": {
        const { invoices } = await listInvoices(user, { ...params, page: 1, pageSize: 100 });
        return csvResponse(
          `technic-invoices-${Date.now()}.csv`,
          toCsv(
            ["Invoice #", "Type", "Date", "Customer", "Branch", "Total", "Paid", "Due", "Status"],
            invoices.map((invoice) => [
              invoice.invoiceNumber,
              invoice.kind === "TAX_INVOICE" ? "Tax Invoice" : "Bill",
              invoice.invoiceDate.toISOString().slice(0, 10),
              invoice.customerName,
              invoice.branchName,
              invoice.total,
              invoice.paid,
              invoice.due,
              invoice.status,
            ]),
          ),
        );
      }
      case "sales": {
        const report = await salesReport(user, params);
        return csvResponse(
          `technic-sales-${Date.now()}.csv`,
          toCsv(
            ["Invoice #", "Date", "Kind", "Customer", "Subtotal", "Tax", "Total", "Paid", "Due", "Staff"],
            report.rows.map((row) => [
              row.invoiceNumber,
              row.invoiceDate.toISOString().slice(0, 10),
              row.kind === "TAX_INVOICE" ? "Tax Invoice" : "Bill",
              row.customerName,
              row.subtotal,
              row.taxAmount,
              row.total,
              row.paid,
              row.due,
              row.staffName ?? "",
            ]),
          ),
        );
      }
      case "purchases": {
        const report = await purchaseReport(user, params);
        return csvResponse(
          `technic-purchases-${Date.now()}.csv`,
          toCsv(
            ["Bill #", "Date", "Supplier", "Supplier ref", "Subtotal", "Tax", "Total", "Paid"],
            report.rows.map((row) => [
              row.invoiceNumber,
              row.invoiceDate.toISOString().slice(0, 10),
              row.supplierName,
              row.supplierRef ?? "",
              row.subtotal,
              row.taxAmount,
              row.total,
              row.paid,
            ]),
          ),
        );
      }
      case "gst-summary": {
        if (!hasPermission(user, PERMISSIONS.GST_REPORTS_VIEW)) {
          return NextResponse.json(
            { error: "GST reports require GST access mode" },
            { status: 403 },
          );
        }
        const report = await gstSummaryReport(user, params);
        return csvResponse(
          `technic-gst-summary-${Date.now()}.csv`,
          toCsv(
            ["Invoice #", "Date", "Taxable", "CGST", "SGST", "IGST", "Total"],
            report.invoices.map((row) => [
              row.invoiceNumber,
              row.date.toISOString().slice(0, 10),
              row.taxable,
              row.cgst,
              row.sgst,
              row.igst,
              row.total,
            ]),
          ),
        );
      }
      default:
        return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: errorStatus(error) });
  }
}
