import Link from "next/link";
import { AlertTriangle, CalendarClock, ClipboardCheck, FileText, Target, Trophy } from "lucide-react";

import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { canViewAllLeads, leadScopeWhere, quotationScopeWhere } from "@/lib/sales-scope";
import { OPEN_LEAD_STAGES } from "@/lib/sales-config";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";

/**
 * Role-specific work panel: a salesperson sees their own follow-ups, leads and
 * quotations; a manager additionally sees the review queue and the team's
 * numbers. Everything is built from the same scope helpers as the list pages.
 */
export async function SalesPanel({ user }: { user: SessionUser & { activeFirmId: string } }) {
  const team = canViewAllLeads(user);
  const mine = { assignedToId: user.id };
  const scope = leadScopeWhere(user);
  const open = { stage: { in: OPEN_LEAD_STAGES } } as const;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + 86_400_000);
  const monthStart = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);
  const canQuotes = user.permissions.includes("quotation.view");
  const canReview = user.permissions.includes("quotation.review");
  const qScope = quotationScopeWhere(user);

  const [openLeads, dueToday, overdue, wonMonth, nextUp, myDrafts, awaitingReview, convertedMonth] = await Promise.all([
    prisma.lead.count({ where: { AND: [scope, mine, open] } }),
    prisma.lead.count({ where: { AND: [scope, mine, open, { nextFollowUpAt: { gte: startOfToday, lt: endOfToday } }] } }),
    prisma.lead.count({ where: { AND: [scope, mine, open, { nextFollowUpAt: { lt: startOfToday } }] } }),
    prisma.lead.count({ where: { AND: [scope, mine, { stage: "WON", wonAt: { gte: monthStart } }] } }),
    prisma.lead.findMany({
      where: { AND: [scope, mine, open, { nextFollowUpAt: { not: null } }] },
      orderBy: { nextFollowUpAt: "asc" },
      take: 5,
      select: { id: true, name: true, phone: true, nextFollowUpAt: true },
    }),
    canQuotes ? prisma.quotation.count({ where: { AND: [qScope, { OR: [{ assignedToId: user.id }, { createdById: user.id }] }, { status: { in: ["DRAFT", "SENT"] } }] } }) : Promise.resolve(0),
    canReview ? prisma.quotation.count({ where: { AND: [qScope, { reviewStatus: "PENDING" }] } }) : Promise.resolve(0),
    canQuotes
      ? prisma.invoice.aggregate({
          where: { status: { not: "CANCELLED" }, quotation: { AND: [qScope, { OR: [{ assignedToId: user.id }, { createdById: user.id }] }], convertedAt: { gte: monthStart } } },
          _sum: { totalAmount: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <section className="space-y-3" aria-label="Sales">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{team ? "My sales work" : "Your sales work"}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open leads" value={openLeads} icon={Target} href="/leads?owner=me" />
        <StatCard label="Follow-ups today" value={dueToday} icon={CalendarClock} tone="info" href="/leads?followUp=today" />
        <StatCard label="Overdue follow-ups" value={overdue} icon={AlertTriangle} tone={overdue > 0 ? "danger" : "default"} href="/leads?followUp=overdue" />
        {canReview ? (
          <StatCard label="Quotations to review" value={awaitingReview} icon={ClipboardCheck} tone={awaitingReview > 0 ? "warning" : "default"} href="/quotations?review=PENDING" />
        ) : canQuotes ? (
          <StatCard label="My open quotations" value={myDrafts} icon={FileText} href="/quotations?owner=me" />
        ) : (
          <StatCard label="Won this month" value={wonMonth} icon={Trophy} tone="success" href="/leads?stage=WON" />
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Next follow-ups</CardTitle></CardHeader>
          <CardContent>
            {nextUp.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled — open a lead and schedule its next follow-up.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {nextUp.map((lead) => (
                  <li key={lead.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/leads/${lead.id}`} className="font-medium hover:text-primary hover:underline">{lead.name}</Link>
                    <span className={lead.nextFollowUpAt! < startOfToday ? "font-medium text-destructive" : "numeric text-muted-foreground"}>
                      {formatDate(lead.nextFollowUpAt!)}{lead.nextFollowUpAt! < startOfToday ? " · overdue" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">This month</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Leads won: <strong className="numeric">{wonMonth}</strong></p>
            {convertedMonth ? <p>Invoiced from my quotations: <strong className="numeric">{formatCurrency(Number(convertedMonth._sum.totalAmount ?? 0))}</strong></p> : null}
            {canQuotes ? <p>Quotations in progress: <strong className="numeric">{myDrafts}</strong></p> : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
