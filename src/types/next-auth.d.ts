import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/generated/prisma/enums";
import type { PermissionCode } from "@/lib/rbac";

/**
 * Which transaction stream a session may see, derived server-side from the
 * signed-in user's record (User.accessView):
 * - COMBINED — full view: both GST and non-GST transactions (default).
 * - GST_ONLY — internal GST-reconciliation view: non-GST transactions are
 *   filtered out of every backend read path. It never changes billing, tax
 *   classification or what is stored and audited.
 */
export type AccessView = "COMBINED" | "GST_ONLY";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      branchId: string | null;
      branchName: string | null;
      branchCode: string | null;
      employeeCode: string | null;
      permissions: PermissionCode[];
      firmId: string | null;
      firmName: string | null;
      activeFirmId: string | null;
      activeFirmName: string | null;
      accessView: AccessView;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    branchId: string | null;
    branchName?: string | null;
    branchCode?: string | null;
    employeeCode?: string | null;
    permissions: PermissionCode[];
    firmId: string | null;
    firmName?: string | null;
    activeFirmId: string | null;
    activeFirmName?: string | null;
    accessView?: AccessView;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    branchId: string | null;
    branchName: string | null;
    branchCode: string | null;
    employeeCode: string | null;
    permissions: PermissionCode[];
    firmId: string | null;
    firmName: string | null;
    activeFirmId: string | null;
    activeFirmName: string | null;
    accessView: AccessView;
  }
}
