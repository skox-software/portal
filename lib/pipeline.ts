/**
 * The sales pipeline, built from what the portal already knows.
 *
 * Three kinds of record become cards:
 * - deals (Outreach 1 → Won, or Lost): the only rows the pipeline owns;
 * - referrals nobody has worked yet, as leads;
 * - projects, whose status places them in Won, In build or Shipped.
 *
 * Nothing here touches the database, so the rules can be tested alone.
 */

import { isCallable } from "./local-time.ts";

export const COLUMNS = [
  { key: "outreach_1", label: "Attempt 1" },
  { key: "outreach_2", label: "Attempt 2" },
  { key: "outreach_3", label: "Attempt 3" },
  { key: "outreach_4", label: "Attempt 4" },
  { key: "outreach_closed", label: "Closed" },
  { key: "replied", label: "Interested" },
  { key: "meeting", label: "Scope call" },
  { key: "proposal_sent", label: "Proposal" },
  { key: "won", label: "Won" },
  { key: "in_build", label: "In build" },
  { key: "shipped", label: "Shipped" },
] as const;

export type ColumnKey = (typeof COLUMNS)[number]["key"];
export type ProjectStatus = "kickoff" | "building" | "review" | "launched" | "paused";
export type CardType = "deal" | "project" | "referral";

/**
 * Two tracks over one record. Outreach holds contact attempts: calls and cold
 * emails, however many, never make a lead more than a lead. Pipeline holds
 * real opportunities, and a lead only gets there on a signal from them (see
 * PROMOTION_SIGNALS). Moving between tracks only changes `deals.stage`, so
 * contact details and history carry over.
 */
export const OUTREACH_STAGES = ["outreach_1", "outreach_2", "outreach_3", "outreach_4", "outreach_closed"] as const;
export const ACTIVE_STAGES = ["replied", "meeting", "proposal_sent", "won", "lost"] as const;
export const STAGES = [...OUTREACH_STAGES, ...ACTIVE_STAGES] as const;
export type DealStage = (typeof STAGES)[number];
export type Track = "outreach" | "active";

export const STAGE_LABEL: Record<DealStage, string> = {
  outreach_1: "Attempt 1",
  outreach_2: "Attempt 2",
  outreach_3: "Attempt 3",
  outreach_4: "Attempt 4",
  outreach_closed: "Closed",
  replied: "Interested",
  meeting: "Scope call",
  proposal_sent: "Proposal",
  won: "Won",
  lost: "Lost",
};

export const TRACK_LABEL: Record<Track, string> = { outreach: "Outreach", active: "Pipeline" };

export function stageLabel(stage: string) {
  // "emailed" was a Pipeline stage until migration 0022; old history still names it.
  if (stage === "emailed") return "Emailed";
  return STAGE_LABEL[stage as DealStage] ?? stage;
}

export function isStage(value: string): value is DealStage {
  return (STAGES as readonly string[]).includes(value);
}

export function trackOf(stage: DealStage): Track {
  return (OUTREACH_STAGES as readonly string[]).includes(stage) ? "outreach" : "active";
}

/** `?track=` from a link: "deals" is the old name for the Pipeline track. */
export function readTrack(value: string | null | undefined): Track | null {
  if (value === "active" || value === "deals") return "active";
  if (value === "outreach") return "outreach";
  return null;
}

/** Attempt 1 → 2 → 3 → 4; null from Attempt 4, Closed or any Pipeline stage. */
export function nextOutreach(stage: DealStage): DealStage | null {
  const i = ["outreach_1", "outreach_2", "outreach_3"].indexOf(stage);
  return i === -1 ? null : OUTREACH_STAGES[i + 1];
}

/** Where a new lead starts, and where a promoted lead lands unless it booked a call. */
export const FIRST_STAGE: DealStage = "outreach_1";
export const FIRST_ACTIVE_STAGE: DealStage = "replied";

/** Still being worked: neither closed, won nor lost. */
export const OPEN_STAGES: readonly DealStage[] = ["outreach_1", "outreach_2", "outreach_3", "outreach_4", "replied", "meeting", "proposal_sent"];
export const OPEN_ACTIVE: readonly DealStage[] = ["replied", "meeting", "proposal_sent"];

/** Board columns per track. Lost is kept but folded under the Pipeline board. */
export const TRACK_COLUMNS: Record<Track, readonly ColumnKey[]> = {
  outreach: ["outreach_1", "outreach_2", "outreach_3", "outreach_4", "outreach_closed"],
  active: ["replied", "meeting", "proposal_sent", "won"],
};

/** The board shows only these; builds and launches live on Projects. */
export const SALES_COLUMNS: readonly ColumnKey[] = [...TRACK_COLUMNS.outreach, ...TRACK_COLUMNS.active];

/** Pre-sale columns, where a card can sit untouched for too long. */
export const PRESALE: readonly ColumnKey[] = OPEN_STAGES as readonly ColumnKey[];
export const STALL_DAYS = 10;
/** Real opportunities go cold faster than cold leads: a week without moving is a stall. */
export const ACTIVE_STALL_DAYS = 7;

// ---- Promotion: the only door from Outreach into the Pipeline ----

/**
 * What a lead did that makes it a real opportunity. The first four are the
 * ones a person picks when promoting by hand; the last two are set by the
 * portal itself (a website enquiry, or a deal added straight to the Pipeline).
 */
export const PROMOTION_SIGNALS = [
  { value: "replied", label: "They replied", short: "Replied", pick: true },
  { value: "interested", label: "Interested on a call", short: "Interested on a call", pick: true },
  { value: "preview", label: "Asked for a preview", short: "Asked for a preview", pick: true },
  { value: "meeting", label: "Booked a scope call", short: "Booked a scope call", pick: true },
  { value: "inbound", label: "Enquired through the website", short: "Website enquiry", pick: false },
  { value: "direct", label: "Added straight to the Pipeline", short: "Added as a deal", pick: false },
] as const;
export type PromotionSignal = (typeof PROMOTION_SIGNALS)[number]["value"];
export const PICKABLE_SIGNALS = PROMOTION_SIGNALS.filter((s) => s.pick).map((s) => s.value) as PromotionSignal[];

export function signalLabel(signal: string | null | undefined) {
  return PROMOTION_SIGNALS.find((s) => s.value === signal)?.short ?? null;
}

/**
 * Where a signal takes a deal, or null when it changes nothing. From
 * Outreach: a booked call goes to Scope call, anything else to Interested. In
 * the Pipeline only a booked call moves an Interested deal on; nothing moves
 * a deal that's won or lost.
 */
export function promotionTarget(stage: DealStage, signal: PromotionSignal): DealStage | null {
  if (stage === "won" || stage === "lost") return null;
  if (trackOf(stage) === "outreach") return signal === "meeting" ? "meeting" : FIRST_ACTIVE_STAGE;
  if (signal === "meeting" && stage === "replied") return "meeting";
  return null;
}

/** A deal can only cross tracks by promotion (with a signal) or demotion (with a reason). */
export function crossesTracks(from: DealStage, to: DealStage) {
  return trackOf(from) !== trackOf(to);
}

/** Why a Pipeline deal went back to Outreach. Free text is kept too. */
export const DEMOTE_REASONS = ["Went quiet", "Not now, try later", "No budget yet", "Chose someone else"] as const;

/**
 * Where a demoted deal lands: the attempt after the ones already made, so the
 * call desk picks it up where it left off. Never past Attempt 4.
 */
export function demotedStage(attempts: number): DealStage {
  return `outreach_${Math.min(Math.max(attempts + 1, 1), 4)}` as DealStage;
}

/** Only open Pipeline deals can be sent back: won and lost are settled. */
export function canDemote(stage: DealStage) {
  return OPEN_ACTIVE.includes(stage);
}

// ---- Closing outreach: why we stopped, kept so the lead brain can learn ----

export const CLOSE_REASONS = [
  { value: "no_answer", label: "No answer after 4 tries" },
  { value: "bad_number", label: "Bad number" },
  { value: "not_interested", label: "Not interested" },
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number]["value"];

/** Why they weren't interested, one tap each. */
export const NOT_INTERESTED_REASONS = [
  { value: "retiring", label: "Retiring" },
  { value: "has_someone", label: "Has someone" },
  { value: "redid_site", label: "Just redid site" },
  { value: "no_budget", label: "No budget" },
  { value: "not_decision_maker", label: "Not decision-maker" },
] as const;
export type NotInterestedReason = (typeof NOT_INTERESTED_REASONS)[number]["value"];

export function closeReasonLabel(reason: string | null | undefined, detail?: string | null) {
  const main = CLOSE_REASONS.find((r) => r.value === reason)?.label ?? null;
  const why = NOT_INTERESTED_REASONS.find((r) => r.value === detail)?.label ?? null;
  return main && why ? `${main} · ${why}` : main;
}

// ---- Preview websites for leads who ask for one (docs/prospects/preview-playbook.md) ----

export const PREVIEW_STATUSES = [
  { value: "none", label: "No preview" },
  { value: "requested", label: "Requested" },
  { value: "researching", label: "Researching" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "building", label: "Building" },
  { value: "ready", label: "Ready to send" },
  { value: "sent", label: "Sent" },
  { value: "opened", label: "Opened" },
  { value: "archived", label: "Archived" },
] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number]["value"];
export const PREVIEW_STATUS_VALUES = PREVIEW_STATUSES.map((s) => s.value) as [PreviewStatus, ...PreviewStatus[]];

export function previewLabel(status: string) {
  return PREVIEW_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/** A preview is in flight from the request until it's archived. */
export function previewInFlight(status: string) {
  return status !== "none" && status !== "archived";
}

/** What the builder still has to do: research a request, or build an approved one. */
export const PREVIEW_QUEUE: readonly PreviewStatus[] = ["requested", "building"];

/** Gate A, Josh's one tap on the research brief. */
export const PREVIEW_DECISIONS = [
  { value: "go", label: "Go" },
  { value: "go_with_changes", label: "Go with changes" },
  { value: "no_go", label: "No-go" },
] as const;
export type PreviewDecision = (typeof PREVIEW_DECISIONS)[number]["value"];

/** What the decision does: a go starts the build, a no-go archives the preview. */
export function statusAfterDecision(decision: PreviewDecision): PreviewStatus {
  return decision === "no_go" ? "archived" : "building";
}

export const DEAL_KINDS = [
  { value: "website", label: "Website" },
  { value: "web-app", label: "Web app" },
  { value: "portal", label: "Portal" },
  { value: "dashboard", label: "Dashboard" },
  { value: "internal-tool", label: "Internal tool" },
  { value: "automation", label: "Automation" },
  { value: "retainer", label: "Retainer" },
  { value: "other", label: "Other" },
] as const;

export function dealKindLabel(kind: string) {
  return DEAL_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export function columnLabel(key: ColumnKey) {
  return COLUMNS.find((c) => c.key === key)!.label;
}

/** Kickoff is "won, not started"; paused projects stay in build with a flag. */
export function columnForProject(status: ProjectStatus): ColumnKey {
  if (status === "kickoff") return "won";
  if (status === "launched") return "shipped";
  return "in_build";
}

/** What the project's status becomes when its card is dropped in a column. */
export function projectStatusForColumn(column: ColumnKey): ProjectStatus | null {
  if (column === "won") return "kickoff";
  if (column === "in_build") return "building";
  if (column === "shipped") return "launched";
  return null;
}

/** Deals can only sit in pre-sale columns or Won; building needs a project. */
export function dealStageForColumn(column: ColumnKey | "lost"): DealStage | null {
  if (column === "lost") return "lost";
  if (column === "in_build" || column === "shipped") return null;
  return column;
}

/**
 * Which columns a card may move to, for its stage menu and drag targets. A
 * deal stays inside its track: crossing over is Promote or Demote, which ask
 * for the signal or the reason. Referrals are leads until someone works them.
 */
export function allowedColumns(type: CardType, column?: ColumnKey): readonly (ColumnKey | "lost")[] {
  if (type === "project") return ["won", "in_build", "shipped"];
  if (type === "referral" || !column || trackOf(column as DealStage) === "outreach") return OUTREACH_STAGES;
  return ACTIVE_STAGES;
}

export function daysSince(from: Date, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

export function isStalled(column: ColumnKey, since: Date, now: Date) {
  const limit = (OPEN_ACTIVE as readonly string[]).includes(column) ? ACTIVE_STALL_DAYS : STALL_DAYS;
  return PRESALE.includes(column) && daysSince(since, now) > limit;
}

/** "reiss@skoxsoftware.com" → "RE"; "Josh Fox" → "JF". */
export function initials(nameOrEmail: string | null | undefined) {
  if (!nameOrEmail) return "";
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export type Card = {
  /** `${type}:${id}`, unique across the board. */
  key: string;
  type: CardType;
  id: string;
  column: ColumnKey;
  company: string;
  contact: string | null;
  valueCents: number;
  kind: string;
  ownerEmail: string | null;
  /** When it entered its current column (pre-sale only; drives "stalled"). */
  since: Date;
  href: string | null;
  source?: string;
  // For the Clients list
  clientId: string | null;
  dealId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  industry: string | null;
  location: string | null;
  leadSource: string | null;
  // Project cards
  progress?: { done: number; total: number };
  dueOn?: string | null;
  dateTentative?: boolean;
  paused?: boolean;
  launchedOn?: string | null;
  paid?: boolean;
  /** A won deal that still needs onboarding into a project. */
  needsOnboarding?: boolean;
};

export type BoardInput = {
  deals: {
    id: string;
    company: string;
    contactName: string | null;
    contactEmail: string | null;
    kind: string;
    valueCents: number | null;
    stage: DealStage;
    ownerEmail: string | null;
    source: string;
    referralId: string | null;
    projectId: string | null;
    clientId?: string | null;
    stageChangedAt: Date;
    industry?: string | null;
    location?: string | null;
    leadSource?: string | null;
  }[];
  projects: {
    id: string;
    name: string;
    kind: string;
    status: ProjectStatus;
    clientId: string;
    clientName: string;
    contact: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    deliveryDate: string;
    dateTentative: boolean;
    launchedOn: string | null;
    createdAt: Date;
    /** Non-void invoices. */
    billedCents: number;
    invoiceCount: number;
    unpaidCount: number;
    milestonesDone: number;
    milestonesTotal: number;
  }[];
  referrals: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    referrerEmail: string | null;
    /** e.g. the referrer's company, for "Referral · Harbor". */
    referrerLabel?: string | null;
    status: "new" | "contacted" | "won" | "lost";
    createdAt: Date;
  }[];
};

export function buildBoard(input: BoardInput) {
  const cards: Card[] = [];
  const lost: Card[] = [];
  const dealByProject = new Map(input.deals.filter((d) => d.projectId).map((d) => [d.projectId!, d]));
  const projectIds = new Set(input.projects.map((p) => p.id));
  const workedReferrals = new Set(input.deals.map((d) => d.referralId).filter(Boolean));

  for (const p of input.projects) {
    const deal = dealByProject.get(p.id);
    const column = columnForProject(p.status);
    cards.push({
      key: `project:${p.id}`,
      type: "project",
      id: p.id,
      column,
      company: p.clientName,
      contact: deal?.contactName ?? deal?.contactEmail ?? p.contact,
      // The agreed value when a deal carried one; otherwise what we've invoiced.
      valueCents: deal?.valueCents ?? p.billedCents,
      kind: deal?.kind ?? p.kind,
      ownerEmail: deal?.ownerEmail ?? null,
      since: deal?.stageChangedAt ?? p.createdAt,
      href: `/admin/projects/${p.id}`,
      source: deal?.source,
      clientId: p.clientId,
      dealId: deal?.id ?? null,
      contactName: deal?.contactName ?? p.contactName ?? null,
      contactEmail: deal?.contactEmail ?? p.contactEmail ?? null,
      industry: deal?.industry ?? null,
      location: deal?.location ?? null,
      leadSource: deal?.leadSource ?? null,
      progress: { done: p.milestonesDone, total: p.milestonesTotal },
      dueOn: p.deliveryDate,
      dateTentative: p.dateTentative,
      paused: p.status === "paused",
      launchedOn: p.launchedOn,
      paid: p.invoiceCount > 0 && p.unpaidCount === 0,
    });
  }

  for (const d of input.deals) {
    // A deal whose project still exists is shown as that project.
    if (d.projectId && projectIds.has(d.projectId)) continue;
    const card: Card = {
      key: `deal:${d.id}`,
      type: "deal",
      id: d.id,
      column: d.stage === "lost" ? "outreach_1" : d.stage,
      company: d.company,
      contact: d.contactName ?? d.contactEmail,
      valueCents: d.valueCents ?? 0,
      kind: d.kind,
      ownerEmail: d.ownerEmail,
      since: d.stageChangedAt,
      href: null,
      source: d.source,
      clientId: d.clientId ?? null,
      dealId: d.id,
      contactName: d.contactName,
      contactEmail: d.contactEmail,
      industry: d.industry ?? null,
      location: d.location ?? null,
      leadSource: d.leadSource ?? null,
      needsOnboarding: d.stage === "won",
    };
    (d.stage === "lost" ? lost : cards).push(card);
  }

  for (const r of input.referrals) {
    if (workedReferrals.has(r.id) || r.status === "won" || r.status === "lost") continue;
    cards.push({
      key: `referral:${r.id}`,
      type: "referral",
      id: r.id,
      column: "outreach_1",
      company: r.company || r.name,
      contact: r.company ? r.name : r.email,
      valueCents: 0,
      kind: "other",
      ownerEmail: null,
      since: r.createdAt,
      href: null,
      source: r.referrerEmail ? `Referral from ${r.referrerEmail}` : "Referral",
      clientId: null,
      dealId: null,
      contactName: r.name,
      contactEmail: r.email,
      industry: null,
      location: null,
      leadSource: r.referrerLabel ? `Referral · ${r.referrerLabel}` : "Referral",
    });
  }

  const columns = COLUMNS.map((c) => {
    const inColumn = cards
      .filter((card) => card.column === c.key)
      .sort((a, b) => b.since.getTime() - a.since.getTime());
    return { ...c, cards: inColumn, totalCents: inColumn.reduce((n, card) => n + card.valueCents, 0) };
  });
  return { columns, lost };
}

export function boardTotals(columns: ReturnType<typeof buildBoard>["columns"], now: Date) {
  const sum = (keys: ColumnKey[]) =>
    columns.filter((c) => keys.includes(c.key)).reduce((n, c) => n + c.totalCents, 0);
  return {
    openCents: sum(PRESALE as ColumnKey[]),
    wonCents: sum(["won", "in_build"]),
    stalled: columns.flatMap((c) => c.cards).filter((card) => isStalled(card.column, card.since, now)).length,
  };
}

/** Search and owner filters, shared by the board, the list and "Save & next". */
export type BoardFilter = { q: string; owner: string };

/** `owner` is "" for everyone, "none" for unassigned, or a team email. */
export function cardMatches(card: { search: string; ownerEmail: string | null }, { q, owner }: BoardFilter) {
  if (owner === "none" ? card.ownerEmail : owner && card.ownerEmail !== owner) return false;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => card.search.includes(w));
}

/** The text a card is searched by: names, contact details, place, notes. */
export function searchText(parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" \u0001 ").toLowerCase();
}

export type BoardView = {
  view: "board" | "list";
  q: string;
  owner: string;
  stage: string;
  /** Only leads it's business hours for now. */
  callable?: boolean;
  /** Which board: Outreach or Pipeline. Each has its own page; this keeps old links working. */
  track?: Track;
  /** A saved view on the board ("due", "previews", "next"…); empty for everything. */
  show?: string;
};

/** The view's query string, minus defaults, for links that keep the filters. */
export function viewQuery(v: BoardView, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (v.view === "list") p.set("view", "list");
  if (v.q) p.set("q", v.q);
  if (v.owner) p.set("owner", v.owner);
  if (v.view === "list" && v.stage) p.set("stage", v.stage);
  if (v.callable) p.set("callable", "1");
  if (v.show) p.set("show", v.show);
  for (const [k, val] of Object.entries(extra)) p.set(k, val);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Can this deal go in the call queue at all: open, with a working number, and no follow-up set for a later day. */
export function queueable(deal: { stage: DealStage; phone: string | null; badNumber?: boolean; nextStepOn: string | null }, today: string) {
  return PRESALE.includes(deal.stage as ColumnKey) && !!deal.phone && !deal.badNumber && !(deal.nextStepOn && deal.nextStepOn > today);
}

/**
 * The "Callable now" queue: queueable leads where it's business hours right
 * now, best first (lowest priority number). Shared by the board's filter and
 * the panel's next/previous, so "Log & next" follows what's on screen.
 */
export function callQueue<T extends { queueable: boolean; zone: string | null; priority: number }>(cards: T[], now: Date) {
  return cards.filter((c) => c.queueable && isCallable(c.zone, now)).sort((a, b) => a.priority - b.priority);
}

/**
 * Where an "Emailed" deal lands when migration 0022 retires that stage. Keep
 * in step with its CASE. Sending a cold email was never a sign of interest,
 * so only a booked meeting or a reply from them keeps it in the Pipeline;
 * otherwise it goes back to the outreach attempt its calls and emails reached,
 * or to Closed if the last call was "Not interested".
 */
export function retiredEmailedStage(d: { meetingAt: Date | null; replied: boolean; attempts: number; lastOutcome: string | null }): DealStage {
  if (d.meetingAt) return "meeting";
  if (d.replied) return "replied";
  if (d.lastOutcome === "not_interested") return "outreach_closed";
  return `outreach_${Math.min(Math.max(d.attempts + 1, 1), 4)}` as DealStage;
}

/**
 * Where a deal from before the two tracks lands (migration 0021). Keep in step
 * with its CASE: settled stages stay, Negotiation folds into Proposal, a booked
 * meeting or any email sent counts as a Potential Deal, "Not interested" closes
 * outreach, and otherwise the calls logged so far pick the outreach attempt.
 */
export function migratedStage(d: { stage: string; meetingAt: Date | null; emailed: boolean; calls: number; lastOutcome: string | null }): DealStage | "emailed" {
  if (d.stage === "won" || d.stage === "lost" || d.stage === "proposal_sent") return d.stage;
  if (d.stage === "negotiation") return "proposal_sent";
  if (d.meetingAt) return "meeting";
  if (d.emailed) return "emailed";
  if (d.lastOutcome === "not_interested") return "outreach_closed";
  return `outreach_${Math.min(d.calls + 1, 4)}` as DealStage;
}
