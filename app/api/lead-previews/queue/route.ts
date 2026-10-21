import { asc, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deals } from "@/lib/db/schema";
import { readBrief } from "@/lib/call-brief";
import { portalLink } from "@/lib/notify";
import { PREVIEW_QUEUE } from "@/lib/pipeline";
import { previewServiceAuthorized } from "@/lib/preview-service";

/**
 * The preview builder's work queue: deals whose preview was requested (to
 * research) or approved at Gate A (to build), oldest request first, with
 * what a builder needs. Separate from project design previews (/api/previews).
 */
export async function GET(request: Request) {
  if (!previewServiceAuthorized(request)) return new Response("Unauthorized", { status: 401 });
  const rows = await getDb()
    .select()
    .from(deals)
    .where(inArray(deals.previewStatus, [...PREVIEW_QUEUE]))
    .orderBy(asc(deals.previewRequestedAt))
    .limit(50);
  return Response.json(
    {
      previews: rows.map((d) => {
        // The research brief without the saved email draft, which the builder doesn't need.
        const brief = readBrief(d.brief);
        if (brief) delete brief.emailDraft;
        return {
          dealId: d.id,
          workspaceId: d.workspaceId,
          status: d.previewStatus,
          requestedAt: d.previewRequestedAt?.toISOString() ?? null,
          company: d.company,
          contactName: d.contactName,
          contactEmail: d.contactEmail,
          phone: d.phone,
          website: d.website,
          industry: d.industry,
          location: d.location,
          owner: d.ownerEmail,
          notes: d.notes,
          callBrief: brief,
          previewBrief: d.previewBrief,
          decision: d.previewDecision ?? null,
          previewUrl: d.previewUrl,
          portalUrl: portalLink(`/admin/pipeline?deal=${d.id}`),
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
