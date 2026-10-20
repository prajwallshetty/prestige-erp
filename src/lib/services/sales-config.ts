import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSalesConfig, SALES_CONFIG_KEYS, type SalesConfig } from "@/lib/sales-config";

/** Firm-level sales/marketing configuration, read from the settings table. */
export async function getSalesConfig(firmId: string): Promise<SalesConfig> {
  const rows = await prisma.setting.findMany({
    where: { firmId, key: { in: Object.values(SALES_CONFIG_KEYS) } },
    select: { key: true, value: true },
  });
  return buildSalesConfig(new Map(rows.map((row) => [row.key, row.value])));
}
