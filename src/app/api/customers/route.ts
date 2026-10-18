import { NextResponse } from "next/server";

import { getCurrentUser, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { searchCustomers } from "@/lib/services/partners";
import { errorStatus } from "@/lib/action-result";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!user.activeFirmId || !hasPermission(user, PERMISSIONS.CUSTOMERS_VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const query = new URL(request.url).searchParams.get("q") ?? undefined;
    const customers = await searchCustomers(user.activeFirmId, query, 50);
    return NextResponse.json({ customers });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: errorStatus(error) });
  }
}
