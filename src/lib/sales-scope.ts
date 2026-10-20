import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, resolveBranchScope, taxModeWhere, type SessionUser } from "@/lib/session";

/**
 * Record-level access for the sales pipeline. Every list, detail, edit and
 * PDF path builds its Prisma `where` from these helpers, so visibility is
 * decided on the server from the session — never from request data.
 *
 * Rules
 *  - Always bounded to the caller's active firm.
 *  - Users without the "all branches" capability are pinned to their branch.
 *  - Leads: `leads.view_all` sees every lead in scope; otherwise only leads the
 *    user is assigned to or created.
 *  - Quotations (firm-wide, tax-view aware): a user who can create quotations but lacks `quotation.view_all`
 *    (i.e. sales staff) sees only quotations they created or own. Read-only
 *    roles (viewer, accountant) keep the firm-wide read access they had before.
 */

function branchFilter(user: SessionUser): { branchId?: string } {
  const scope = resolveBranchScope(user);
  return scope.canSeeAllBranches ? {} : { branchId: scope.branchId };
}

export function canViewAllLeads(user: Pick<SessionUser, "permissions">): boolean {
  return hasPermission(user, PERMISSIONS.LEADS_VIEW_ALL);
}

export function leadScopeWhere(user: SessionUser): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { firmId: requireFirmId(user), ...branchFilter(user) };
  if (canViewAllLeads(user)) return where;
  return { ...where, OR: [{ assignedToId: user.id }, { createdById: user.id }] };
}

/** True when the user is limited to their own quotations. */
export function isOwnQuotationsOnly(user: Pick<SessionUser, "permissions">): boolean {
  return (
    hasPermission(user, PERMISSIONS.QUOTATION_CREATE) &&
    !hasPermission(user, PERMISSIONS.QUOTATION_VIEW_ALL)
  );
}

export function quotationScopeWhere(user: SessionUser): Prisma.QuotationWhereInput {
  // No branch filter here: quotations were firm-wide before this module and
  // read-only roles must keep that; ownership narrows it for sales staff.
  const base: Prisma.QuotationWhereInput = { firmId: requireFirmId(user), ...taxModeWhere(user) };
  if (!isOwnQuotationsOnly(user)) return base;
  return { ...base, OR: [{ createdById: user.id }, { assignedToId: user.id }] };
}
