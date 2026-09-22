/**
 * CRM rules with no database or framework in them, so they can be tested
 * directly (lib/crm.test.ts). Pages, actions and the inbound webhook all
 * read stage order, stalled rules and email parsing from here.
 */

export const BOARD_STAGES = ["lead", "proposal_sent", "negotiation", "won", "in_build", "shipped"] as const;
export const ALL_STAGES = [...BOARD_STAGES, "lost"] as const;
export type DealStage = (typeof ALL_STAGES)[number];

export const STAGE_LABEL: Record<DealStage, string> = {
  lead: "Lead",
  proposal_sent: "Proposal sent",
  negotiation: "Negotiation",
  won: "Won",
  in_build: "In build",
  shipped: "Shipped",
  lost: "Lost",
};

export const PRICING_LABEL = { fixed: "Fixed", retainer: "Retainer / mo", hourly: "Hourly" } as const;

/** Days in one stage before a deal is flagged. Delivery stages are exempt. */
export const STALLED_AFTER_DAYS = 10;

export function isDealStage(value: unknown): value is DealStage {
  return typeof value === "string" && (ALL_STAGES as readonly string[]).includes(value);
}

export function daysInStage(stageEnteredAt: Date, now: number = Date.now()) {
  return Math.max(0, Math.floor((now - stageEnteredAt.getTime()) / 86_400_000));
}

export function isStalled(stage: DealStage, days: number) {
  return days > STALLED_AFTER_DAYS && stage !== "shipped" && stage !== "lost" && stage !== "in_build";
}

/** Date stamps a stage move sets. Only the first time: moving back and forth keeps the original. */
export function stageStamps(
  to: DealStage,
  current: { wonAt: Date | null; shippedAt: Date | null; lostAt: Date | null },
  now: Date = new Date(),
) {
  const stamps: { wonAt?: Date; shippedAt?: Date; lostAt?: Date } = {};
  if ((to === "won" || to === "in_build" || to === "shipped") && !current.wonAt) stamps.wonAt = now;
  if (to === "shipped" && !current.shippedAt) stamps.shippedAt = now;
  if (to === "lost" && !current.lostAt) stamps.lostAt = now;
  return stamps;
}

/** "$18,500" from cents, no decimals: deal values are whole dollars. */
export function formatDealValue(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

/** "18,500" or "$18500.00" typed into a form, to cents. Null when it isn't a number. */
export function parseDollars(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Two-letter badge for a staff member from their email: reiss@… → "RE". */
export function initialsFor(email: string | null | undefined) {
  if (!email) return "—";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase() || "—";
}

/** "Sep 21" for timelines; the year only when it isn't this year. SKOX time (New York). */
export function formatShortDate(value: Date, now: Date = new Date()) {
  const tz = "America/New_York";
  const sameYear = value.toLocaleString("en-US", { timeZone: tz, year: "numeric" }) === now.toLocaleString("en-US", { timeZone: tz, year: "numeric" });
  return value.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/* ---- Email ---- */

/** Trimmed, lower case. Every stored and compared address goes through this. */
export function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Splits a From header into address and display name.
 * `"Dana Whitfield" <Dana@Harbor.com>` → { email: "dana@harbor.com", name: "Dana Whitfield" }.
 * A bare address comes back with no name.
 */
export function parseAddress(raw: string): { email: string; name: string | null } {
  const angle = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angle) {
    const name = raw.slice(0, angle.index).trim().replace(/^"(.*)"$/, "$1").trim();
    return { email: normalizeAddress(angle[1]), name: name || null };
  }
  return { email: normalizeAddress(raw.replace(/^mailto:/i, "")), name: null };
}

/** "Re: Fwd: Booking flow" → "booking flow", for matching replies to threads. */
export function normalizeSubject(subject: string | null | undefined) {
  return (subject ?? "")
    .replace(/^(\s*(re|fwd?|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** "Re: …" exactly once. */
export function replySubject(subject: string | null | undefined) {
  const base = (subject ?? "").trim();
  return /^re\s*:/i.test(base) ? base : `Re: ${base}`.trim();
}

/** Message-IDs from an In-Reply-To or References header, angle brackets kept. */
export function parseMessageIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.match(/<[^<>\s]+>/g) ?? [];
}

/** Case-insensitive header lookup; Resend returns headers as a plain object. */
export function headerValue(headers: Record<string, string> | null | undefined, name: string) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

/** Readable text from an email: the text part, or the HTML part with tags stripped. */
export function plainText(text: string | null | undefined, html: string | null | undefined) {
  if (text) return text;
  return (html ?? "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** First 200 characters of readable text, for the inbox list. */
export function snippetOf(text: string | null | undefined, html: string | null | undefined) {
  return plainText(text, html).replace(/\s+/g, " ").trim().slice(0, 200);
}

/** A Message-ID for mail the portal sends, so the client's reply can find its thread. */
export function newMessageId(domain: string, random: string = crypto.randomUUID()) {
  return `<${random}@${domain}>`;
}

/** The part after @, for building Message-IDs on our own domain. */
export function domainOf(address: string) {
  return parseAddress(address).email.split("@")[1] ?? "skoxsoftware.com";
}
