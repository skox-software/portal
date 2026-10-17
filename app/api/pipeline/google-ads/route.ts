import { and, eq, isNotNull } from "drizzle-orm";
import { getViewer } from "@/lib/access";
import { getDb } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { googleAdsCsv } from "@/lib/inbound-lead";
import { staffMembershipIn } from "@/lib/permissions";
import { todayIso } from "@/lib/format";

/**
 * Won deals that started as a Google Ads click, as the CSV Google Ads takes
 * under Goals → Conversions → Uploads. Staff only.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in", { status: 401 });
  const staff = staffMembershipIn(viewer.memberships);
  if (!staff || staff.role !== "staff_owner") return new Response("Not found", { status: 404 });

  const rows = await getDb()
    .select({
      gclid: deals.gclid,
      createdAt: deals.createdAt,
      wonAt: deals.wonAt,
      stageChangedAt: deals.stageChangedAt,
      valueCents: deals.valueCents,
    })
    .from(deals)
    .where(and(eq(deals.workspaceId, staff.workspaceId), eq(deals.stage, "won"), isNotNull(deals.gclid)));

  const { csv } = googleAdsCsv(rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="skox-google-ads-won-deals-${todayIso()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
