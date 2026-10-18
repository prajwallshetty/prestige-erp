import { NextResponse } from "next/server";

import { getCurrentUser, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { errorStatus } from "@/lib/action-result";
import { posLookup } from "@/lib/services/search";

/**
 * GET /api/pos-lookup?code=… — resolve a barcode / SKU / serial / IMEI to a
 * sellable product with live stock for the caller's branch. Used by the POS
 * scan box.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.activeFirmId || !user.branchId) {
      return NextResponse.json({ error: "No active firm or branch" }, { status: 403 });
    }
    if (!hasPermission(user, [PERMISSIONS.INVOICE_CREATE, PERMISSIONS.SALES_CREATE])) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const code = new URL(request.url).searchParams.get("code") ?? "";
    const result = await posLookup(user.activeFirmId, user.branchId, code);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: errorStatus(error) });
  }
}
