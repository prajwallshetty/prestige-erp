import { NextResponse } from "next/server";

import { getCurrentUser, hasPermission, taxModeWhere } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { errorStatus, NotFoundError } from "@/lib/action-result";
import {
  generateInvoicePDF,
  generateQuotationPDF,
  generatePurchaseOrderPDF,
  generatePurchaseInvoicePDF,
  generatePurchaseReturnPDF,
  generatePaymentReceiptPDF,
  generateExpenseReceiptPDF,
} from "@/lib/pdf/pdf-templates";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/documents/invoice/:id — PDF download for every document type.
 * Authorization: session required, record must belong to the caller's active
 * firm, and the caller needs the module's view permission.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.activeFirmId) {
      return NextResponse.json({ error: "Select a firm first" }, { status: 403 });
    }

    const { kind, id } = await params;

    let result: { buffer: Buffer; fileName: string };
    switch (kind) {
      case "invoice": {
        if (!hasPermission(user, PERMISSIONS.INVOICE_VIEW)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const invoice = await prisma.invoice.findFirst({
          where: { id, firmId: user.activeFirmId, ...taxModeWhere(user) },
          select: { id: true },
        });
        if (!invoice) throw new NotFoundError("Invoice not found");
        result = await generateInvoicePDF(invoice.id);
        break;
      }
      case "quotation": {
        if (!hasPermission(user, PERMISSIONS.QUOTATION_VIEW)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const quotation = await prisma.quotation.findFirst({
          where: { id, firmId: user.activeFirmId, ...taxModeWhere(user) },
          select: { id: true },
        });
        if (!quotation) throw new NotFoundError("Quotation not found");
        result = await generateQuotationPDF(quotation.id);
        break;
      }
      case "purchase-order": {
        if (!hasPermission(user, PERMISSIONS.PURCHASE_VIEW)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const po = await prisma.purchaseOrder.findFirst({
          where: { id, firmId: user.activeFirmId, ...taxModeWhere(user) },
          select: { id: true },
        });
        if (!po) throw new NotFoundError("Purchase order not found");
        result = await generatePurchaseOrderPDF(po.id);
        break;
      }
      case "purchase-bill": {
        if (!hasPermission(user, PERMISSIONS.PURCHASE_VIEW)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const bill = await prisma.purchaseInvoice.findFirst({
          where: { id, firmId: user.activeFirmId, ...taxModeWhere(user) },
          select: { id: true },
        });
        if (!bill) throw new NotFoundError("Purchase bill not found");
        result = await generatePurchaseInvoicePDF(bill.id);
        break;
      }
      case "receipt": {
        if (!hasPermission(user, PERMISSIONS.PAYMENTS_VIEW)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const payment = await prisma.payment.findFirst({
          where: {
            id,
            firmId: user.activeFirmId,
            OR: [
              { invoice: taxModeWhere(user) },
              { purchaseInvoice: taxModeWhere(user) },
              { isAdvance: true },
              { salesReturn: { invoice: taxModeWhere(user) } },
            ],
          },
          select: { id: true },
        });
        if (!payment) throw new NotFoundError("Receipt not found");
        result = await generatePaymentReceiptPDF(payment.id);
        break;
      }
      case "expense": {
        if (!hasPermission(user, PERMISSIONS.EXPENSES_VIEW)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const expense = await prisma.expense.findFirst({ where: { id, firmId: user.activeFirmId }, select: { id: true } });
        if (!expense) throw new NotFoundError("Expense not found");
        result = await generateExpenseReceiptPDF(expense.id);
        break;
      }
      case "purchase-return": {
        if (!hasPermission(user, PERMISSIONS.PURCHASE_VIEW)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const purchaseReturn = await prisma.purchaseReturn.findFirst({
          where: { id, firmId: user.activeFirmId, ...taxModeWhere(user) },
          select: { id: true },
        });
        if (!purchaseReturn) throw new NotFoundError("Purchase return not found");
        result = await generatePurchaseReturnPDF(purchaseReturn.id);
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown document type" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${result.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = errorStatus(error);
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
