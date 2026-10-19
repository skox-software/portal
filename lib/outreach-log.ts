/**
 * The outreach log at /admin/outreach: every email sent to a lead from the
 * portal, with what Resend later reported about it (lib/resend-events.ts).
 *
 * Pure, with no Node or database imports, so the matching and the summary
 * numbers can be tested alone. lib/outreach-log-data.ts loads the records.
 */
import { EMAIL_STATUS_LABEL, latestStatus, type EmailStatus, type StatusReport } from "./resend-events.ts";
import { outreachSender } from "./lead-email.ts";

/**
 * One email that went out. "lead" is a send from the lead panel
 * (`deal.email_sent`), "scheduled" the 2026-10-19 campaign
 * (`deal.email_scheduled`, sent before delivery reports existed), "reply" an
 * Inbox reply to a prospect.
 */
export type SentEmail = {
  key: string;
  kind: "lead" | "scheduled" | "reply";
  dealId: string | null;
  lead: string | null;
  sentAt: string;
  to: string | null;
  subject: string | null;
  /** The From address, the Reply-To, and the sign-in of whoever pressed Send, when known. */
  from: string | null;
  replyTo: string | null;
  senderEmail: string | null;
  /** Resend's email id, without the inbox's "sent:" prefix. */
  providerId: string | null;
};

/** A `deal.email_status` event's payload. */
export type StatusEvent = StatusReport & { providerId?: string | null };

/** "sent": accepted, no report yet. "untracked": nothing will ever report on it. */
export type RowStatus = EmailStatus | "sent" | "untracked";

export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  ...EMAIL_STATUS_LABEL,
  sent: "Sent",
  untracked: "No tracking",
};

export type OutreachRow = SentEmail & {
  sender: string;
  status: RowStatus;
  /** Why a row has no status, shown under the badge. */
  note: string | null;
  reason: string | null;
  lastActivity: string;
  /** Every status any report reached, for the summary (a click implies it was delivered and opened). */
  reached: Set<EmailStatus>;
};

export const PERIODS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: null },
] as const;
export type Period = (typeof PERIODS)[number]["key"];

/** Resend's id as the send records hold it: bare on events, "sent:"-prefixed on inbox messages. */
export const bareProviderId = (id: string | null | undefined) => (id ? id.replace(/^sent:/, "") || null : null);

/** "Josh" or "Reiss": the sign-in first, then Reply-To (their own inbox), then the From address. */
export function senderName(email: Pick<SentEmail, "senderEmail" | "replyTo" | "from">) {
  const login = email.senderEmail || email.replyTo;
  if (login) return outreachSender(login).firstName;
  const local = email.from?.split("@")[0]?.toLowerCase();
  if (!local) return "Unknown";
  return local === "founders" ? "Josh" : local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).split(" ")[0];
}

/** What a delivered email implies about the stages before it. */
const IMPLIES: Record<EmailStatus, EmailStatus[]> = {
  delayed: ["delayed"],
  delivered: ["delivered"],
  opened: ["delivered", "opened"],
  clicked: ["delivered", "opened", "clicked"],
  bounced: ["bounced"],
  complained: ["delivered", "complained"],
};

/**
 * Pairs each sent email with its reports by Resend id. A lead's second email
 * gets only its own reports, never the first one's. Newest first.
 */
export function buildOutreachRows(sent: SentEmail[], reports: StatusEvent[]): OutreachRow[] {
  const byProvider = new Map<string, StatusEvent[]>();
  for (const r of reports) {
    const id = bareProviderId(r.providerId);
    if (!id) continue;
    const list = byProvider.get(id) ?? [];
    list.push(r);
    byProvider.set(id, list);
  }
  // The lead panel's send also files the message in the Inbox; keep the event, drop the copy.
  const seen = new Set<string>();
  const rows: OutreachRow[] = [];
  const ordered = [...sent].sort((a, b) => (a.kind === "reply" ? 1 : 0) - (b.kind === "reply" ? 1 : 0));
  for (const s of ordered) {
    const id = bareProviderId(s.providerId);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const mine = id ? byProvider.get(id) ?? [] : [];
    const best = latestStatus(mine);
    const reached = new Set<EmailStatus>(mine.flatMap((r) => IMPLIES[r.status] ?? []));
    const lastActivity = mine.reduce((at, r) => (r.at > at ? r.at : at), s.sentAt);
    const untracked = !best && (s.kind === "scheduled" || !id);
    rows.push({
      ...s,
      providerId: id,
      sender: senderName(s),
      status: best?.status ?? (untracked ? "untracked" : "sent"),
      note: best ? null : untracked ? (s.kind === "scheduled" ? "Sent before tracking" : "No provider id") : "No report yet",
      reason: best?.reason ?? null,
      lastActivity,
      reached,
    });
  }
  return rows.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

/** Rows sent inside the period ending at `now`. */
export function inPeriod(rows: OutreachRow[], period: Period, now: Date) {
  const days = PERIODS.find((p) => p.key === period)?.days ?? null;
  if (days === null) return rows;
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  return rows.filter((r) => r.sentAt >= from);
}

export type SummaryTile = { key: "sent" | EmailStatus; label: string; count: number; rate: number | null };

/**
 * Sent, then how many reached each stage. Rates are out of the emails that
 * can be tracked, so the campaign sent before tracking doesn't drag them down.
 */
export function summarize(rows: OutreachRow[]) {
  const tracked = rows.filter((r) => r.status !== "untracked");
  const count = (s: EmailStatus) => tracked.filter((r) => r.reached.has(s)).length;
  const rate = (n: number) => (tracked.length ? n / tracked.length : null);
  const tiles: SummaryTile[] = [{ key: "sent", label: "Sent", count: rows.length, rate: null }];
  for (const s of ["delivered", "opened", "clicked", "bounced", "complained"] as const) {
    const n = count(s);
    tiles.push({ key: s, label: EMAIL_STATUS_LABEL[s], count: n, rate: rate(n) });
  }
  return { tiles, tracked: tracked.length, untracked: rows.length - tracked.length };
}

export type OutreachFilters = { status?: string; sender?: string; q?: string };

/** The table's filters: latest status, who sent it, and words in the lead, recipient or subject. */
export function filterRows(rows: OutreachRow[], { status, sender, q }: OutreachFilters) {
  const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (status && r.status !== status) return false;
    if (sender && r.sender !== sender) return false;
    if (!words.length) return true;
    const text = [r.lead, r.to, r.subject].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** "62%", or "0%" with nothing to divide by shown as a dash by the caller. */
export const formatRate = (rate: number) => `${Math.round(rate * 100)}%`;
