import { notifyLater, portalLink, staffRecipients } from "@/lib/notify";

/**
 * Tells the rest of the team a preview was asked for, whichever way it was
 * (the panel button, a call outcome, a promotion, a rep's call). The person
 * who asked doesn't get their own email.
 */
export function notifyPreviewRequested(
  deal: { id: string; workspaceId: string; company: string; phone?: string | null; contactName?: string | null; website?: string | null },
  requestedBy: string,
  note?: string | null,
) {
  notifyLater(() => staffRecipients(deal.workspaceId, requestedBy), {
    subject: `Preview requested: ${deal.company}`,
    preheader: `${requestedBy} asked for a preview site.`,
    heading: `${deal.company} wants a preview`,
    paragraphs: [
      `${requestedBy} asked for a preview site for ${deal.company}.${note ? ` Note: ${note}` : ""}`,
      "The lead's panel has the build prompt to copy and a box for the finished link.",
    ],
    details: [
      ...(deal.contactName ? [{ label: "Contact", value: deal.contactName }] : []),
      ...(deal.phone ? [{ label: "Phone", value: deal.phone }] : []),
      ...(deal.website ? [{ label: "Current site", value: deal.website }] : []),
    ],
    cta: { label: "Open the lead", href: portalLink(`/admin/pipeline?deal=${deal.id}`) },
  });
}
