/**
 * Website enquiries arriving from skoxsoftware.com (its lib/portal.ts), and
 * the file that sends won deals back to Google Ads. Pure, so it can be tested
 * without a database; the route in app/api/inbound/lead does the writing.
 */

import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).optional().catch(undefined);
const touch = z
  .object({
    utm_source: text(200),
    utm_medium: text(200),
    utm_campaign: text(200),
    utm_term: text(200),
    utm_content: text(200),
    gclid: text(200),
    fbclid: text(200),
    referrer: text(200),
    landing: text(200),
    at: text(40),
  })
  .partial()
  .optional()
  .catch(undefined);

export const inboundLeadSchema = z.object({
  status: z.enum(["submitted", "unfinished"]),
  email: z.email().max(254),
  name: text(120),
  company: text(200),
  website: text(200),
  industry: text(120),
  location: text(120),
  projectType: text(40),
  message: text(4000),
  timeline: text(120),
  gclid: text(200),
  visit: touch,
  firstTouch: touch,
  pages: z.array(z.string().max(100)).max(30).optional().catch(undefined),
  visits: z.number().int().nonnegative().optional().catch(undefined),
  secondsOnSite: z.number().int().nonnegative().optional().catch(undefined),
  device: text(120),
  leadEventId: text(64),
});

export type InboundLead = z.infer<typeof inboundLeadSchema>;

/* The site's build types, in the portal's words. */
const KINDS: Record<string, string> = { websites: "website", "web-apps": "web-app", dashboards: "dashboard" };

export function dealKind(projectType: string | undefined): string {
  return (projectType && KINDS[projectType]) || "other";
}

function host(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** "Google Ads · Spring search", "Google search", "Direct" — what the card shows. */
export function channel(lead: InboundLead): string {
  const t = lead.visit?.utm_source || lead.visit?.gclid || lead.visit?.referrer ? lead.visit! : lead.firstTouch ?? {};
  const campaign = t.utm_campaign ? ` · ${t.utm_campaign}` : "";
  if (lead.gclid || t.gclid) return `Google Ads${campaign}`;
  if (t.fbclid) return `Meta ads${campaign}`;
  if (t.utm_source) return `${t.utm_source}${t.utm_medium ? ` ${t.utm_medium}` : ""}${campaign}`;
  const ref = host(t.referrer);
  if (ref) return /google\./.test(ref) ? "Google search" : /bing\.|duckduckgo\./.test(ref) ? `${ref.split(".")[0]} search` : ref;
  return "Direct";
}

export function leadSourceLabel(lead: InboundLead): string {
  return `${lead.status === "unfinished" ? "Unfinished · " : "Website · "}${channel(lead)}`.slice(0, 80);
}

/** The card title: the company if we know it, else the person, else the address. */
export function companyFor(lead: InboundLead): string {
  return (lead.company || lead.name || lead.email).slice(0, 200);
}

/** What staff read on the deal: the enquiry first, then how they got here. */
export function notesFor(lead: InboundLead, receivedAt: Date): string {
  const first = lead.firstTouch;
  const lines = [
    lead.status === "unfinished"
      ? `Unfinished enquiry (they left the form before sending), ${receivedAt.toISOString().slice(0, 10)}.`
      : `Website enquiry, ${receivedAt.toISOString().slice(0, 10)}.`,
    lead.message && `\n${lead.message}`,
    lead.timeline && `\nTimeline: ${lead.timeline}`,
    "",
    `Came from: ${channel(lead)}`,
    lead.visit?.utm_term && `Keyword: ${lead.visit.utm_term}`,
    first?.at && `First visit: ${first.at.slice(0, 10)}${first.landing ? ` on ${first.landing}` : ""}`,
    lead.visits && `Visits: ${lead.visits}`,
    lead.pages?.length && `Pages: ${lead.pages.join(" → ")}`,
    lead.secondsOnSite !== undefined && `Time on site: ${Math.round(lead.secondsOnSite / 60)} min`,
    lead.device && `Device: ${lead.device}`,
    lead.leadEventId && `Recording: Clarity → Recordings → filter lead_event_id = ${lead.leadEventId}`,
  ];
  return lines.filter((l) => l !== undefined && l !== false && l !== null && l !== 0).join("\n").slice(0, 4000);
}

export function attributionFor(lead: InboundLead) {
  return {
    status: lead.status,
    visit: lead.visit ?? null,
    firstTouch: lead.firstTouch ?? null,
    pages: lead.pages ?? [],
    visits: lead.visits ?? null,
    secondsOnSite: lead.secondsOnSite ?? null,
    device: lead.device ?? null,
    leadEventId: lead.leadEventId ?? null,
  };
}

/* ---------- Google Ads offline conversion upload ---------- */

/** Must match the conversion action's name in Google Ads exactly. */
export const WON_CONVERSION = "Won deal";
/** Google refuses clicks older than this. */
const CLICK_WINDOW_DAYS = 90;
export const ADS_TIMEZONE = "America/New_York";

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "2026-10-05 14:03:00" in the account's timezone, the format Google's template uses. */
export function adsTime(d: Date, timeZone = ADS_TIMEZONE): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export type WonDeal = { gclid: string | null; createdAt: Date; wonAt: Date | null; stageChangedAt: Date; valueCents: number | null };

/**
 * Google Ads' click-conversion upload template: one row per won deal that
 * came from an ad click in the last 90 days. Re-uploading a row is harmless;
 * Google drops the duplicate.
 */
export function googleAdsCsv(rows: WonDeal[], now = new Date()): { csv: string; count: number } {
  const cutoff = now.getTime() - CLICK_WINDOW_DAYS * 86_400_000;
  const usable = rows.filter((r) => r.gclid && r.createdAt.getTime() >= cutoff);
  const lines = [
    `Parameters:TimeZone=${ADS_TIMEZONE}`,
    "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency",
    ...usable.map((r) =>
      [
        csvCell(r.gclid!),
        WON_CONVERSION,
        adsTime(r.wonAt ?? r.stageChangedAt),
        r.valueCents ? (r.valueCents / 100).toFixed(2) : "",
        r.valueCents ? "USD" : "",
      ].join(","),
    ),
  ];
  return { csv: lines.join("\n") + "\n", count: usable.length };
}
