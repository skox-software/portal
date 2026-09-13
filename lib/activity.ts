/**
 * Turns audit events into the plain-English lines clients see under
 * "Since your last visit". Unknown or internal verbs are skipped.
 */

type EventLike = { verb: string; payload: unknown; createdAt: Date };

const payloadOf = (e: EventLike) => (e.payload ?? {}) as Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function describeEvent(e: EventLike): string | null {
  const p = payloadOf(e);
  switch (e.verb) {
    case "update.posted":
      return "We posted a new progress update";
    case "project.date_changed":
      return `The delivery date moved to ${str(p.to)}`;
    case "project.status_changed":
      return str(p.to) === "launched" ? "Your project launched" : "The project moved to a new stage";
    case "milestone.state_changed":
      return str(p.state) === "done" ? "A milestone was completed" : null;
    case "task.added":
      return str(p.side) === "client" ? `New to-do for you: ${str(p.title)}` : null;
    case "document.sent":
      return `${str(p.title)} is ready for signature`;
    case "document.completed":
      return `${str(p.title)} is fully signed`;
    case "review.requested":
      return `New designs to review: ${str(p.label)}`;
    case "approval.decided":
      return str(p.state) === "approved" ? "A review round was approved" : "Changes were requested on a review";
    case "feedback.resolved":
      return "We finished one of your feedback items";
    case "file.uploaded":
      return str(p.fromClient) === "true" ? null : `New file: ${str(p.name)}`;
    case "invoice.created":
      return `New invoice: ${str(p.title)}`;
    case "request.status_changed":
      return str(p.status) === "done" ? `Done: ${str(p.title)}` : null;
    case "report.published":
      return "Your monthly results report is ready";
    case "idea.posted":
      return `New idea for you: ${str(p.title)}`;
    case "resource.added":
      return `Added to your launch kit: ${str(p.title)}`;
    default:
      return null;
  }
}

/** Newest first, de-duplicated so five updates in a row read as one line. */
export function summarizeSince(events: EventLike[], limit = 6) {
  const seen = new Set<string>();
  const lines: { text: string; at: Date }[] = [];
  for (const e of events) {
    const text = describeEvent(e);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push({ text, at: e.createdAt });
    if (lines.length >= limit) break;
  }
  return lines;
}
