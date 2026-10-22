import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deals, type Deal } from "@/lib/db/schema";
import { eventInsert } from "@/lib/events";
import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";
import type { PreviewStatus } from "@/lib/pipeline";
import { afterSending, linksPreview, openKind, sentOnEmail } from "@/lib/preview-tracking";

/**
 * When an email that carries the deal's preview link goes out, the preview
 * is sent: from then on, views of it count and the first one alerts the team.
 * Returns the queries to run in the sender's batch, or nothing.
 */
export function previewSentQueries(deal: Pick<Deal, "id" | "workspaceId" | "projectId" | "company" | "previewStatus" | "previewUrl">, body: string, actorId: string, at: Date) {
  if (!sentOnEmail(deal.previewStatus as PreviewStatus) || !linksPreview(body, deal.previewUrl)) return [];
  const db = getDb();
  return [
    db.update(deals).set({ previewStatus: "sent", previewSentAt: at }).where(and(eq(deals.id, deal.id), eq(deals.previewStatus, deal.previewStatus))),
    eventInsert({
      workspaceId: deal.workspaceId,
      projectId: deal.projectId,
      actorId,
      verb: "deal.preview_updated",
      subjectType: "deal",
      subjectId: deal.id,
      payload: { company: deal.company, from: deal.previewStatus, to: "sent", via: "email" },
    }),
  ] as const;
}

export const PREVIEW_VIEWER_ACTOR = "preview-viewer";

/**
 * A view of a lead's preview site, reported by the page's beacon. Ignored
 * until the preview was sent. The first view after that marks it opened and
 * emails the team so someone calls while it's on their screen.
 */
export async function recordPreviewOpen(dealId: string, device: "phone" | "desktop") {
  const db = getDb();
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) return "unknown" as const;
  const kind = openKind(deal.previewStatus as PreviewStatus, deal.previewFirstOpenAt);
  if (kind === "ignore") return "ignored" as const;
  const at = new Date();
  let first = false;
  if (kind === "first") {
    // Only one caller wins the first open, so the team gets one alert.
    const won = await db
      .update(deals)
      .set({ previewStatus: "opened", previewFirstOpenAt: at })
      .where(and(eq(deals.id, deal.id), eq(deals.previewStatus, "sent"), isNull(deals.previewFirstOpenAt)))
      .returning({ id: deals.id });
    first = won.length > 0;
  }
  await eventInsert({
    workspaceId: deal.workspaceId,
    projectId: deal.projectId,
    actorId: PREVIEW_VIEWER_ACTOR,
    verb: "deal.preview_viewed",
    subjectType: "deal",
    subjectId: deal.id,
    payload: { company: deal.company, device, first },
  });
  if (first) {
    const after = afterSending(deal.previewSentAt, at);
    notifyLater(() => staffRecipients(deal.workspaceId), {
      subject: `${deal.company} just opened their preview`,
      preheader: "Call now, while it's on their screen.",
      heading: `${deal.company} is looking at their preview`,
      paragraphs: [
        `They opened it on a ${device}${after ? `, ${after} after it was sent` : ""}. Call now, while it's on their screen.`,
      ],
      details: [
        ...(deal.phone ? [{ label: "Phone", value: deal.phone }] : []),
        ...(deal.contactName ? [{ label: "Contact", value: deal.contactName }] : []),
        ...(deal.previewUrl ? [{ label: "Preview", value: deal.previewUrl }] : []),
      ],
      cta: { label: "Open the lead", href: portalLink(`/admin/pipeline?deal=${deal.id}`) },
      footnote: "Later views are logged in the lead's history.",
    });
  }
  return first ? ("first" as const) : ("repeat" as const);
}
