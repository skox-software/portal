/**
 * A first cold email, written from the call brief: a subject naming their
 * specific problem and four or five plain sentences, signed by Reiss.
 * Pure, so it can be tested alone.
 */

import type { CallBrief } from "./call-brief.ts";

export const SIGNATURE = ["Reiss Skeen", "Co-founder, SKOX Software", "skoxsoftware.com"];

const SUBJECTS: Record<string, (company: string) => string> = {
  "SITE DOWN": (c) => `${c}'s website isn't loading`,
  HACKED: (c) => `${c}'s website has been hacked`,
  "NO WEBSITE": (c) => `A website for ${c}`,
  "BROKEN PIECES": (c) => `A few things broken on ${c}'s website`,
  "NOT MOBILE": (c) => `${c}'s website on phones`,
};

/** "Dr. Anthony Oswick" → "Dr. Oswick"; "Barry Davis, President" → "Barry"; "the owner" → null. */
export function greetingName(name: string | null | undefined) {
  const first = (name ?? "").split(/,| or |;|\(/)[0].trim();
  if (!first || /^(the |owner|ask|unknown|n\/?a)/i.test(first)) return null;
  const words = first.split(/\s+/);
  if (/^(dr|mr|mrs|ms|capt|captain|rev|pastor|father|chef|coach)\.?$/i.test(words[0]) && words.length > 1) return `${/^(dr|mr|mrs|ms|capt|rev)$/i.test(words[0].replace(/\.$/, "")) ? words[0].replace(/\.?$/, ".") : words[0]} ${words[words.length - 1]}`;
  return words[0];
}

/** "www.example.com" from a full URL, for "I was looking at …". */
export function siteLabel(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** The first reason in "WHY WE'RE CALLING", without the technical aside: "the site doesn't fit a phone screen". */
export function mainProblem(why: string | undefined) {
  if (!why) return null;
  const first = why.split(/;\s*/)[0].replace(/\s*\([^)]*\)/g, "").trim().replace(/\.$/, "");
  return first ? lowerFirst(first) : null;
}

/**
 * The build we'd propose, from the upgrade angle, phrased to follow "We could
 * build you": "a new site with an advertiser page where …" from "Upgrades: …",
 * or "a roofing site with …" from "the pitch is a roofing site with …".
 * Null when the angle doesn't spell one out.
 */
export function proposedBuild(angle: string | undefined) {
  if (!angle) return null;
  const clean = (t: string) => lowerFirst(t.trim().replace(/;\s*confirm\b.*$/i, "").replace(/\.$/, ""));
  const list = angle.match(/(?:^|[.;]\s+)(?:the\s+|for [^,]+, the (?:likely\s+)?)?upgrades?(?:,\s*kept small)?(?:\s+(?:would be|are|is)\s+|\s*:\s*)([^]*?)(?:\.\s+(?=[A-Z])|\.?$)/i);
  if (list) return `a new site with ${clean(list[1])}`;
  const pitch = angle.match(/the pitch is\s+((?:an?)\b[^]*?)(?:\.\s+(?=[A-Z])|\.?$)/i);
  if (pitch) return clean(pitch[1]);
  return null;
}

export function buildEmailDraft(input: {
  company: string;
  contactName?: string | null;
  website?: string | null;
  brief: CallBrief | null;
}) {
  const { company, website, brief } = input;
  if (brief?.emailDraft) return { subject: brief.emailDraft.subject, body: brief.emailDraft.body };
  const name = greetingName(input.contactName) ?? greetingName(brief?.askFor);
  const subject = (SUBJECTS[brief?.tag ?? ""] ?? ((c: string) => `${c}'s website`))(company);
  const site = siteLabel(website);
  const problem = mainProblem(brief?.why);
  const build = proposedBuild(brief?.upgradeAngle);

  const lines: string[] = [];
  if (brief?.tag === "NO WEBSITE") {
    lines.push(`I'm Reiss with SKOX Software. I looked ${company} up and couldn't find a website, just your listing.`);
  } else {
    lines.push(`I'm Reiss with SKOX Software. I was looking at ${site ?? "your website"} and noticed ${problem ?? "it's showing its age"}.`);
  }
  lines.push(
    build
      ? `We could build you ${build}, at a fixed price agreed before we start.`
      : "We build new websites at a fixed price agreed before we start, with the launch date set up front.",
  );
  if (brief?.preview) lines.push(`I put together a quick preview of what yours could look like: ${brief.preview}`);
  const ask = brief?.askThem?.trim();
  if (ask) lines.push(/[?.!]$/.test(ask) ? ask : `${ask}?`);
  lines.push("Would you be open to a 15-minute call this week?");

  const body = [`Hi ${name ?? "there"},`, "", lines.join(" "), "", "Thanks,", ...SIGNATURE].join("\n");
  return { subject, body };
}

/** A mailto: link with the subject and body filled in. */
export function mailtoHref(to: string | null | undefined, draft: { subject: string; body: string }) {
  const q = `subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  return `mailto:${to ? encodeURIComponent(to).replace(/%40/g, "@") : ""}?${q}`;
}
