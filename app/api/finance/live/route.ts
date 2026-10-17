import { getViewer } from "@/lib/access";
import { liveSnapshot } from "@/lib/finance-live";
import { staffMembershipIn } from "@/lib/permissions";

/**
 * The finance page's live numbers and activity feed, polled every 30 seconds
 * by components/finance/LiveProvider. Staff only, never cached. Stripe reads
 * inside are non-fatal (they come back null), so this answers even when
 * Stripe doesn't.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Sign in" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const staff = staffMembershipIn(viewer.memberships);
  if (!staff) return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(await liveSnapshot(staff.workspaceId), { headers: { "Cache-Control": "no-store" } });
}
