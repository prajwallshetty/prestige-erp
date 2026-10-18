import "server-only";

import type { TaxMode } from "@/generated/prisma/enums";
import type { PermissionCode } from "@/lib/rbac";
import { AccessModeError } from "@/lib/action-result";
import { AuthenticationError, AuthorizationError, getCurrentUser } from "@/lib/session";

/**
 * Tax-mode helpers. Tax mode is a property of each document (Invoice.taxMode,
 * Quotation.taxMode, …); the reporting view is a property of the user
 * (User.accessView — see src/lib/session.ts taxModeWhere). There is no longer
 * a session-wide billing mode or an access-code gate: GST billing is granted
 * by the gst_reports.view permission, which only the roles intended to issue
 * tax invoices carry.
 */

/** Whether this user may issue GST (tax-invoice) documents. */
export function canBillGst(user: { permissions: PermissionCode[] }): boolean {
  return user.permissions.includes("gst_reports.view");
}

/** Default billing mode for a firm: GST when the firm is GST-registered. */
export async function firmDefaultMode(firmId: string): Promise<TaxMode> {
  const { prisma } = await import("@/lib/prisma");
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { gstin: true },
  });
  return firm?.gstin ? "GST" : "NON_GST";
}

/**
 * Authorize a server action or route handler for a tax-sensitive operation:
 * authentication + firm + permission + (optionally) GST capability. All are
 * resolved server-side. Throws AuthorizationError (403) when any layer fails.
 */
export async function authorizeTaxAction(
  permission: PermissionCode | PermissionCode[],
  options: { requireGst?: boolean } = {},
): Promise<{ id: string; activeFirmId: string; canBillGst: boolean }> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  if (!user.activeFirmId) {
    throw new AuthorizationError("Select a firm before performing this action");
  }
  const wanted = Array.isArray(permission) ? permission : [permission];
  if (!wanted.some((code) => user.permissions.includes(code))) {
    throw new AuthorizationError();
  }
  const gstAllowed = canBillGst(user);
  if (options.requireGst && !gstAllowed) {
    throw new AccessModeError(
      "This operation requires GST billing permission (gst_reports.view).",
    );
  }
  return { id: user.id, activeFirmId: user.activeFirmId, canBillGst: gstAllowed };
}
