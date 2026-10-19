/**
 * Delivery reports for outreach email. Resend posts each report to
 * app/api/resend/events, signed the Svix way (lib/svix.ts); the route matches it to the
 * deal whose `deal.email_sent` event carries the same provider id and records
 * a `deal.email_status` event.
 *
 * Pure, with no Node imports, so the email card can show the labels in the
 * browser and the mapping can be tested alone.
 */

export type EmailStatus = "delayed" | "delivered" | "opened" | "clicked" | "bounced" | "complained";

const BY_TYPE: Record<string, EmailStatus> = {
  "email.delivery_delayed": "delayed",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export const EMAIL_STATUS_TYPES = Object.keys(BY_TYPE);

export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = {
  delayed: "Delayed",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  bounced: "Bounced",
  complained: "Marked spam",
};

/**
 * Which status wins when several reports arrive. Resend can deliver them out
 * of order, so a later "delivered" must not hide an "opened", and a bounce or
 * spam complaint outranks everything.
 */
const RANK: Record<EmailStatus, number> = { delayed: 0, delivered: 1, opened: 2, clicked: 3, bounced: 4, complained: 5 };

/** A bounce or spam complaint: the deal is marked do-not-email. */
export const blocksEmail = (status: EmailStatus) => status === "bounced" || status === "complained";

export type StatusReport = { status: EmailStatus; at: string; reason?: string };

/** The deal's status from its reports, highest-ranked first, newest on a tie. */
export function latestStatus(reports: Iterable<StatusReport>): StatusReport | null {
  let best: StatusReport | null = null;
  for (const r of reports) {
    if (!(r.status in RANK)) continue;
    if (!best || RANK[r.status] > RANK[best.status] || (RANK[r.status] === RANK[best.status] && r.at > best.at)) best = r;
  }
  return best;
}

type ResendEvent = {
  type?: unknown;
  created_at?: unknown;
  data?: { email_id?: unknown; bounce?: { message?: unknown; type?: unknown; subType?: unknown }; click?: { link?: unknown } };
};

/** The provider id and status a webhook body reports, or null for anything else. */
export function readStatusEvent(body: unknown): (StatusReport & { emailId: string; link?: string }) | null {
  const e = body as ResendEvent | null;
  const status = typeof e?.type === "string" ? BY_TYPE[e.type] : undefined;
  const emailId = e?.data?.email_id;
  if (!status || typeof emailId !== "string" || !emailId) return null;
  const at = typeof e?.created_at === "string" && !Number.isNaN(Date.parse(e.created_at)) ? new Date(e.created_at).toISOString() : new Date().toISOString();
  const report: StatusReport & { emailId: string; link?: string } = { emailId, status, at };
  if (status === "bounced") {
    const b = e?.data?.bounce;
    const reason = [b?.type, b?.subType].filter((s) => typeof s === "string" && s).join(" / ");
    const message = typeof b?.message === "string" ? b.message.trim().slice(0, 500) : "";
    if (message || reason) report.reason = message ? (reason ? `${reason}: ${message}` : message) : reason;
  }
  if (status === "clicked" && typeof e?.data?.click?.link === "string") report.link = e.data.click.link.slice(0, 500);
  return report;
}
