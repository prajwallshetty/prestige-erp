import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireUser } from "@/lib/session";
import { initials } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/rbac";
import type { UserRole } from "@/generated/prisma/enums";

export const metadata = { title: "My profile — Technic Technologies" };

const ROLE_TONE: Record<string, "info" | "neutral" | "success"> = {
  PLATFORM_ADMIN: "info",
  ADMIN: "success",
};

export default async function ProfilePage() {
  // Session identity only — every signed-in staff member can see their own
  // profile, so no firm permission is required here.
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center gap-4 pb-2">
          <Avatar className="size-14">
            <AvatarFallback className="text-lg">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-xl">{user.name}</CardTitle>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
          <StatusBadge
            status={user.role}
            label={ROLE_LABELS[user.role as UserRole] ?? user.role}
            tone={ROLE_TONE[user.role] ?? "neutral"}
            dot
          />
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Staff code</span>
            <span className="numeric font-medium">{user.employeeCode ?? "—"}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Branch</span>
            <span className="font-medium">{user.branchName ?? "All branches"}</span>
          </div>
          {user.firmName ? (
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Organization</span>
              <span className="font-medium">{user.firmName}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reporting view</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Transaction view</span>
            <StatusBadge
              status={user.accessView ?? "COMBINED"}
              label={user.accessView === "GST_ONLY" ? "Reconciliation view" : "Full view"}
              tone={user.accessView === "GST_ONLY" ? "info" : "neutral"}
            />
          </div>
          <p className="pt-1 text-xs text-muted-foreground">
            Your view is set by a Super Admin on your user record. It controls which
            transactions you see; it never changes how sales are billed or recorded.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Security</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="text-muted-foreground">
            You sign in with your 6-digit staff code. To change it or get a new one, ask a
            Super Admin in <span className="font-medium text-foreground">Administration → Users</span>.
          </p>
          <Separator className="my-3" />
          <p className="text-xs text-muted-foreground">
            Use the sign-out option in the top-right user menu to end this session.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
