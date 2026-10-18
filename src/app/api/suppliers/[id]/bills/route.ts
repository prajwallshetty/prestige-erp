import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await authorize("purchase.view");
    const { id } = await params;

    if (!user.activeFirmId) {
      return NextResponse.json({ bills: [] }, { status: 400 });
    }

    const bills = await prisma.purchaseInvoice.findMany({
      where: {
        supplierId: id,
        firmId: user.activeFirmId,
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        amountPaid: true,
      },
      orderBy: { invoiceDate: "desc" },
    });

    return NextResponse.json({ bills });
  } catch (error) {
    return NextResponse.json({ bills: [] }, { status: 401 });
  }
}
