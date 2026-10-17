/**
 * The sales pipeline, built from what the portal already knows.
 *
 * Three kinds of record become cards:
 * - deals (Lead → Won, or Lost): the only rows the pipeline owns;
 * - referrals nobody has worked yet, as leads;
 * - projects, whose status places them in Won, In build or Shipped.
 *
 * Nothing here touches the database, so the rules can be tested alone.
 */

export const COLUMNS = [
  { key: "lead", label: "Lead" },
  { key: "initial_outreach", label: "Initial outreach" },
  { key: "proposal_sent", label: "Proposal sent" },
  { key: "negotiation", label: "Negotiation" },
  { key: "won", label: "Won" },
  { key: "in_build", label: "In build" },
  { key: "shipped", label: "Shipped" },
] as const;

export type ColumnKey = (typeof COLUMNS)[number]["key"];
export type DealStage = "lead" | "initial_outreach" | "proposal_sent" | "negotiation" | "won" | "lost";
export type ProjectStatus = "kickoff" | "building" | "review" | "launched" | "paused";
export type CardType = "deal" | "project" | "referral";

/** The board shows only these; builds and launches live on Projects. */
export const SALES_COLUMNS: readonly ColumnKey[] = ["lead", "initial_outreach", "proposal_sent", "negotiation", "won"];

/** Pre-sale columns, where a card can sit untouched for too long. */
export const PRESALE: readonly ColumnKey[] = ["lead", "initial_outreach", "proposal_sent", "negotiation"];
export const STALL_DAYS = 10;

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

/** Which columns a card may move to, for its stage menu. */
export function allowedColumns(type: CardType): readonly (ColumnKey | "lost")[] {
  if (type === "project") return ["won", "in_build", "shipped"];
  return ["lead", "initial_outreach", "proposal_sent", "negotiation", "won", "lost"];
}

export function daysSince(from: Date, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000));
}

export function isStalled(column: ColumnKey, since: Date, now: Date) {
  return PRESALE.includes(column) && daysSince(since, now) > STALL_DAYS;
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
      column: d.stage === "lost" ? "lead" : d.stage,
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
      column: "lead",
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
    openCents: sum(["lead", "initial_outreach", "proposal_sent", "negotiation"]),
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

export type BoardView = { view: "board" | "list"; q: string; owner: string; stage: string };

/** The view's query string, minus defaults, for links that keep the filters. */
export function viewQuery(v: BoardView, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (v.view === "list") p.set("view", "list");
  if (v.q) p.set("q", v.q);
  if (v.owner) p.set("owner", v.owner);
  if (v.view === "list" && v.stage) p.set("stage", v.stage);
  for (const [k, val] of Object.entries(extra)) p.set(k, val);
  const s = p.toString();
  return s ? `?${s}` : "";
}
