import { z } from "zod";

/**
 * The company: UnBusy's seats, who reports to whom, and what each seat may
 * decide alone. Josh owns the company and approves or denies; Claude is the
 * integrator; every other seat is an agent that runs on a schedule and sends
 * its work up as proposals (docs/COMPANY.md).
 *
 * Seats live in code, not the database, so a change to anyone's job is a
 * reviewed pull request. The database keeps only what happens: runs and
 * proposals (company_runs, company_proposals).
 */

export type Department = "owner" | "ceo" | "revenue" | "marketing" | "delivery" | "finance" | "risk" | "advisory";
export type SeatStatus = "live" | "planned";

export type Seat = {
  key: string;
  name: string;
  title: string;
  department: Department;
  parent: string | null;
  status: SeatStatus;
  /** The one number this seat answers for. */
  number: string;
  mission: string;
  /** Done alone, then logged. */
  decides: string[];
  /** Sent up as an approve/deny card. */
  asks: string[];
  /** When it runs, in words. */
  schedule: string;
};

export const SEATS: Seat[] = [
  {
    key: "josh", name: "Josh", title: "Owner", department: "owner", parent: null, status: "live",
    number: "Cards cleared within a day",
    mission: "Owns UnBusy. Approves or denies; nothing leaves the building without a yes.",
    decides: ["Every card in the inbox"], asks: [], schedule: "Whenever a card arrives",
  },
  {
    key: "claude", name: "Claude", title: "CEO / Integrator", department: "ceo", parent: "josh", status: "live",
    number: "Paying desks",
    mission: "Sets the week's priorities, keeps the scorecard, routes work between seats, settles conflicts and writes the Monday brief.",
    decides: ["Weekly priorities for each seat", "Which seat owns a piece of work", "Turning a seat on or off once Josh has approved it"],
    asks: ["Strategy changes", "Prices", "Anything a seat escalates"],
    schedule: "Daily brief, 7:00 am ET; Monday plan",
  },
  {
    key: "revenue", name: "Revenue", title: "Department", department: "revenue", parent: "claude", status: "live",
    number: "Reviews booked", mission: "Finds owner-run firms with a desk-sized job and gets them to a review and a signed proposal.",
    decides: [], asks: [], schedule: "",
  },
  {
    key: "prospector", name: "Prospector", title: "Lead engine", department: "revenue", parent: "revenue", status: "live",
    number: "Qualified firms added a week",
    mission: "Finds 5–50 person surveying, title, property management and CPA firms that pass the lead standard, and adds them to the pipeline.",
    decides: ["Which firms qualify", "Scoring and order of the call list", "Removing duplicates and dead numbers"],
    asks: ["Any new industry or region"], schedule: "Nightly",
  },
  {
    key: "researcher", name: "Researcher", title: "Account research", department: "revenue", parent: "revenue", status: "planned",
    number: "Firms with a verified hook",
    mission: "Writes one true, sourced hook per firm from the firm's own site and public records.",
    decides: ["What goes in the call brief"], asks: [], schedule: "After each Prospector run",
  },
  {
    key: "outreach-writer", name: "Outreach Writer", title: "Emails and notes", department: "revenue", parent: "revenue", status: "live",
    number: "Drafts approved without edits",
    mission: "Drafts first-touch emails, follow-ups and LinkedIn notes for a person to send, checked against the claims list and do-not-email flags.",
    decides: ["Which firms get a draft today", "The draft's wording"],
    asks: ["Every message before it is sent"], schedule: "Weekdays, 8:00 am ET",
  },
  {
    key: "call-desk", name: "Call Desk", title: "Reiss's day", department: "revenue", parent: "revenue", status: "planned",
    number: "Calls logged a day",
    mission: "Builds Reiss's call list and scripts, and keeps every follow-up dated.",
    decides: ["Call order", "Follow-up dates"], asks: ["Moving a lead to a proposal"], schedule: "Weekdays, 7:30 am ET",
  },
  {
    key: "deal-desk", name: "Deal Desk", title: "Proposals", department: "revenue", parent: "revenue", status: "live",
    number: "Proposals out",
    mission: "Turns review notes into a one-page, three-option proposal under the 25% rule and the $1,500 floor.",
    decides: ["Scope options", "The math behind each price"],
    asks: ["Every proposal before it goes out", "Any price below the floor"], schedule: "After each review",
  },
  {
    key: "marketing", name: "Marketing", title: "Department", department: "marketing", parent: "claude", status: "live",
    number: "Reviews by source", mission: "Makes owners aware the work can be done, with proof that is real.",
    decides: [], asks: [], schedule: "",
  },
  {
    key: "content", name: "Content", title: "Question pages", department: "marketing", parent: "marketing", status: "planned",
    number: "Pages live", mission: "Writes question pages built around a recorded live build.",
    decides: ["Topics and drafts"], asks: ["Publishing"], schedule: "Weekly",
  },
  {
    key: "site", name: "Site", title: "gounbusy.com", department: "marketing", parent: "marketing", status: "planned",
    number: "Review requests from the site", mission: "Keeps gounbusy.com true and clear, as pull requests.",
    decides: ["Opening pull requests"], asks: ["Merging", "New claims"], schedule: "Weekly",
  },
  {
    key: "partners", name: "Partners & Events", title: "Associations, referrals", department: "marketing", parent: "marketing", status: "planned",
    number: "Intros a month", mission: "Finds association slots and referral partners who already sit with these owners.",
    decides: ["Research and shortlists"], asks: ["Registering, paying, or writing to anyone"], schedule: "Weekly",
  },
  {
    key: "delivery", name: "Delivery", title: "Department", department: "delivery", parent: "claude", status: "live",
    number: "Desks running on time", mission: "Builds desks, keeps them running, and turns clients into referrals.",
    decides: [], asks: [], schedule: "",
  },
  {
    key: "desk-builder", name: "Desk Builder", title: "Samples and new desks", department: "delivery", parent: "delivery", status: "planned",
    number: "Samples sent in 3 days", mission: "Runs the three-job samples and builds new desks.",
    decides: ["How a desk is built"], asks: ["Anything that touches a client's systems", "Sending a sample"], schedule: "On request",
  },
  {
    key: "desk-ops", name: "Desk Ops", title: "Running desks", department: "delivery", parent: "delivery", status: "live",
    number: "Days without a failed run",
    mission: "Watches every running desk's self-test and fixes what breaks inside the existing design.",
    decides: ["Fixes that change no behaviour a client sees", "Retrying failed jobs"],
    asks: ["Any change a client would notice", "Telling a client about an outage"], schedule: "Daily, 7:00 am ET",
  },
  {
    key: "client-success", name: "Client Success", title: "Timing and referrals", department: "delivery", parent: "delivery", status: "planned",
    number: "Referrals asked", mission: "Times jobs before and after, and asks for the referral at handoff.",
    decides: ["What to measure"], asks: ["Every message to a client"], schedule: "Weekly",
  },
  {
    key: "finance", name: "Finance", title: "Department", department: "finance", parent: "claude", status: "live",
    number: "Cash in", mission: "Keeps the money honest.", decides: [], asks: [], schedule: "",
  },
  {
    key: "cfo", name: "CFO", title: "Pricing and cash", department: "finance", parent: "finance", status: "planned",
    number: "Monthly recurring revenue", mission: "Checks every price against the 25% rule, drafts invoices, watches cash.",
    decides: ["The math"], asks: ["Any invoice, charge, refund or billing change"], schedule: "Weekly",
  },
  {
    key: "risk", name: "Risk", title: "Department", department: "risk", parent: "claude", status: "live",
    number: "Bad cards stopped", mission: "Can block anything; approves nothing.", decides: [], asks: [], schedule: "",
  },
  {
    key: "compliance", name: "Compliance", title: "Claims and rules", department: "risk", parent: "risk", status: "planned",
    number: "Problems caught", mission: "Checks claims, CAN-SPAM, county site terms and referral-fee rules on every card before Josh sees it.",
    decides: ["Blocking a card, with the reason"], asks: [], schedule: "On every card",
  },
  {
    key: "advisory", name: "Advisory Board", title: "Masterclass panel", department: "advisory", parent: "claude", status: "live",
    number: "Decisions pressure-tested", mission: "Eight framework panelists, a red team and a chair, convened monthly and on demand.",
    decides: [], asks: ["Its ranked plan, as cards"], schedule: "Monthly",
  },
];

export const SEAT_KEYS = SEATS.map((s) => s.key) as [string, ...string[]];
export const seatByKey = new Map(SEATS.map((s) => [s.key, s]));

/** The chain from a seat up to Josh, seat first. */
export function chainToOwner(key: string): string[] {
  const chain: string[] = [];
  let at = seatByKey.get(key);
  while (at && chain.length < 10) {
    chain.push(at.key);
    at = at.parent ? seatByKey.get(at.parent) : undefined;
  }
  return chain;
}

/** Departments and the seats under them, in display order. */
export const DEPARTMENTS = SEATS.filter((s) => s.parent === "claude" && s.department !== "advisory");
export const seatsIn = (dept: string) => SEATS.filter((s) => s.parent === dept);

// ---- Proposals --------------------------------------------------------------

export const PROPOSAL_KINDS = ["message", "proposal", "decision", "spend", "publish", "client", "change", "other"] as const;
export const PROPOSAL_IMPACTS = ["high", "medium", "low"] as const;
export const PROPOSAL_STATUSES = ["pending", "approved", "denied", "done", "withdrawn"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const KIND_LABEL: Record<(typeof PROPOSAL_KINDS)[number], string> = {
  message: "Send a message", proposal: "Send a proposal", decision: "Decision", spend: "Spend money",
  publish: "Publish", client: "Client-facing", change: "Change", other: "Other",
};

/** What a seat sends up. Seats can only propose; they never approve. */
export const proposalInput = z
  .object({
    kind: z.enum(PROPOSAL_KINDS),
    title: z.string().trim().min(3).max(160),
    why: z.string().trim().min(3).max(1000),
    body: z.string().trim().max(20_000).optional(),
    impact: z.enum(PROPOSAL_IMPACTS).default("medium"),
    confidence: z.number().int().min(0).max(100),
    /** What would prove this wrong. */
    wrongIf: z.string().trim().max(500).optional(),
    links: z.array(z.object({ label: z.string().trim().max(80), url: z.url().max(500) })).max(8).optional(),
  })
  .strict();

export const runInput = z
  .object({
    seat: z.enum(SEAT_KEYS),
    summary: z.string().trim().min(3).max(2000),
    outcome: z.enum(["ok", "error"]).default("ok"),
    proposals: z.array(proposalInput).max(20).default([]),
  })
  .strict()
  .refine((r) => r.seat !== "josh", "Josh is not a seat that runs.");

/** A seat may move its own card only to these, and only from these. Approving is Josh's alone. */
export function serviceProposalTransition(current: ProposalStatus, next: "done" | "withdrawn"): ProposalStatus | { error: string } {
  if (next === "done" && current === "approved") return "done";
  if (next === "withdrawn" && current === "pending") return "withdrawn";
  return { error: `A card that is ${current} can't be marked ${next}.` };
}

/** Josh's decision on a pending card. */
export function ownerDecision(current: ProposalStatus, decision: "approve" | "deny"): ProposalStatus | { error: string } {
  if (current !== "pending") return { error: "This card has already been decided." };
  return decision === "approve" ? "approved" : "denied";
}

/** Order for the inbox: high impact first, then oldest first so nothing starves. */
export function inboxOrder<T extends { impact: string; createdAt: Date }>(cards: T[]): T[] {
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...cards].sort((a, b) => (rank[a.impact] ?? 3) - (rank[b.impact] ?? 3) || a.createdAt.getTime() - b.createdAt.getTime());
}

/** A seat is "working" if it ran in the last 15 minutes, "active" within two days. */
export function seatPulse(status: SeatStatus, lastRun: Date | null, now: Date): "working" | "active" | "idle" | "planned" {
  if (status === "planned") return "planned";
  if (!lastRun) return "idle";
  const age = now.getTime() - lastRun.getTime();
  if (age < 15 * 60_000) return "working";
  if (age < 2 * 86_400_000) return "active";
  return "idle";
}

/** Median hours from card to decision, for the scorecard. */
export function medianHoursToDecide(cards: { createdAt: Date; decidedAt: Date | null }[]): number | null {
  const hours = cards
    .filter((c) => c.decidedAt)
    .map((c) => (c.decidedAt!.getTime() - c.createdAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  if (!hours.length) return null;
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2;
}
