import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/session";
import { ROLE_LABELS, ROLE_PERMISSIONS, PERMISSION_DESCRIPTIONS, type PermissionCode } from "@/lib/rbac";
import type { UserRole } from "@/generated/prisma/enums";

export const metadata = { title: "Roles & Permissions — Technic Technologies" };

export default async function RolesPage() {
  await requirePermission("roles.manage");

  const roles = Object.keys(ROLE_PERMISSIONS) as UserRole[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles & Permissions"
        description="The default matrix — per-user overrides live in the database and layer on top of these"
      />

      <div className="grid gap-3 md:grid-cols-2">
        {roles.map((role) => (
          <Card key={role}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                {ROLE_LABELS[role]}
                <Badge tone="outline">{ROLE_PERMISSIONS[role].length} permissions</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              {ROLE_PERMISSIONS[role].map((code) => (
                <p key={code}>
                  <span className="font-mono text-xs text-foreground">{(code as PermissionCode)}</span>
                  {" — "}
                  {PERMISSION_DESCRIPTIONS[code as PermissionCode] ?? code}
                </p>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
