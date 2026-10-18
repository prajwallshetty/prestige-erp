import { NextResponse } from "next/server";

import { getCurrentUser, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { errorStatus } from "@/lib/action-result";
import { buildLedger } from "@/lib/services/ledger";
import { generateLedgerPDF } from "@/lib/pdf/pdf-templates";
import { LEDGER_KINDS, ledgerToCsv, type LedgerKind } from "@/lib/ledger/types";
import { parseLedgerParams } from "@/lib/ledger/params";

/** GET /api/ledgers/:kind?format=pdf|csv&party=&fy=&from=&to=&q= */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.activeFirmId) return NextResponse.json({ error: "Select a firm first" }, { status: 403 });
    if (!hasPermission(user, [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.PAYMENTS_VIEW])) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { kind } = await params;
    if (!(LEDGER_KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: "Unknown ledger" }, { status: 404 });
    }

    const url = new URL(request.url);
    const query = parseLedgerParams(kind as LedgerKind, Object.fromEntries(url.searchParams));
    const ledger = await buildLedger(user, query);
    const format = url.searchParams.get("format") ?? "csv";

    if (format === "pdf") {
      const { buffer, fileName } = await generateLedgerPDF(user.activeFirmId, ledger);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const slug = ledger.title.replace(/[^A-Za-z0-9]+/g, "-");
    // UTF-8 BOM so Excel reads ₹ and accented names correctly.
    return new NextResponse("﻿" + ledgerToCsv(ledger), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="technic-${slug}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: errorStatus(error) });
  }
}
