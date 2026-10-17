import { and, eq, sql } from "drizzle-orm";
import { getViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { commissionStatements, memberships, repProfiles } from "@/lib/db/schema";
import { canApproveCommissions, staffMembershipIn } from "@/lib/permissions";

/**
 * What each rep was paid, by month, for one calendar year: the numbers for
 * their 1099-NEC. Counts statements by the day they were marked paid,
 * because a 1099 reports money paid in the year. Workspace owner only.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in", { status: 401 });
  const staff = staffMembershipIn(viewer.memberships);
  if (!staff || !canApproveCommissions(staff.role)) return new Response("Not found", { status: 404 });

  const param = new URL(request.url).searchParams.get("year") ?? "";
  const year = /^\d{4}$/.test(param) ? Number(param) : new Date().getFullYear();

  const rows = await getDb()
    .select({
      name: repProfiles.displayName,
      email: memberships.email,
      month: sql<number>`extract(month from ${commissionStatements.paidAt} at time zone 'America/New_York')::int`,
      cents: sql<number>`sum(${commissionStatements.totalCents})::int`,
    })
    .from(commissionStatements)
    .innerJoin(memberships, eq(memberships.id, commissionStatements.repMembershipId))
    .innerJoin(repProfiles, eq(repProfiles.membershipId, commissionStatements.repMembershipId))
    .where(
      and(
        eq(commissionStatements.workspaceId, staff.workspaceId),
        eq(commissionStatements.status, "paid"),
        sql`extract(year from ${commissionStatements.paidAt} at time zone 'America/New_York') = ${year}`,
      ),
    )
    .groupBy(repProfiles.displayName, memberships.email, sql`3`);

  const byRep = new Map<string, { name: string; email: string; months: number[] }>();
  for (const r of rows) {
    const rep = byRep.get(r.email) ?? { name: r.name, email: r.email, months: Array(12).fill(0) };
    rep.months[r.month - 1] += Number(r.cents);
    byRep.set(r.email, rep);
  }
  const money = (c: number) => (c / 100).toFixed(2);
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const lines = [
    ["Rep", "Email", ...months, `Total ${year}`].map(quote).join(","),
    ...[...byRep.values()].map((r) => [quote(r.name), quote(r.email), ...r.months.map(money), money(r.months.reduce((s, c) => s + c, 0))].join(",")),
  ];
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="skox-rep-commissions-${year}.csv"`,
      "cache-control": "no-store",
    },
  });
}
