/**
 * The call brief: what we researched about a cold lead, kept apart from the
 * seller's own notes. Lead imports used to write it into `deals.notes` as
 * labeled lines ("ASK FOR: …", "OPENER: …"); `parseBrief` pulls those lines
 * out into a structured brief and leaves everything else as notes.
 *
 * Pure, so it can be tested alone and shared with the import scripts.
 */

export type BriefWarning = { kind: "check_first" | "phone_unverified" | "weak_lead"; text: string };

export type SavedEmailDraft = {
  id: string;
  fromEmail: string;
  subject: string;
  body: string;
  status: "draft" | "sending" | "sent";
  updatedAt: string;
  sentAt?: string;
};

export type CallBrief = {
  emailDraft?: SavedEmailDraft;
  /** "NOT MOBILE", "SITE DOWN", "NO WEBSITE", "BROKEN PIECES", "HACKED". */
  tag?: string;
  /** "Medical, dental & care". */
  vertical?: string;
  askFor?: string;
  opener?: string;
  why?: string;
  about?: string;
  /** "(407) 876-0290 (number confirmed on own site) · SITE: …". */
  call?: string;
  alsoMention?: string;
  stillActive?: string;
  upgradeAngle?: string;
  askThem?: string;
  sources?: string;
  /** A website preview we built for them. */
  preview?: string;
  /** The last receptionist or gatekeeper who answered, from a logged call. */
  gatekeeper?: string;
  warnings?: BriefWarning[];
};

type Field = Exclude<keyof CallBrief, "warnings" | "tag" | "vertical" | "gatekeeper" | "emailDraft">;

/** Label → where it goes. Labels are matched case-sensitively at the start of a line, as the imports write them. */
const LABELS: [RegExp, Field | "callAbout" | "whyNoSite" | BriefWarning["kind"] | "drop"][] = [
  [/^CALL ABOUT:\s*/, "callAbout"],
  [/^ASK FOR:\s*/, "askFor"],
  [/^OPENER:\s*/, "opener"],
  [/^WHY WE'RE CALLING:\s*/, "why"],
  [/^WHY \(NO WEBSITE\):\s*/, "whyNoSite"],
  [/^ABOUT THEM:\s*/, "about"],
  [/^BUSINESS:\s*/, "about"],
  [/^STATE \([^)]*\):\s*/, "about"],
  [/^CALL:\s*/, "call"],
  [/^PHONE:\s*/, "call"],
  [/^ALSO MENTION:\s*/, "alsoMention"],
  [/^STILL ACTIVE:\s*/, "stillActive"],
  [/^UPGRADE ANGLE:\s*/, "upgradeAngle"],
  [/^ASK THEM:\s*/, "askThem"],
  [/^SOURCES:\s*/, "sources"],
  [/^PREVIEW:\s*/, "preview"],
  [/^CHECK FIRST:\s*/, "check_first"],
  [/^PHONE UNVERIFIED:?\s*/, "phone_unverified"],
  [/^WEAK LEAD:?\s*/, "weak_lead"],
  // The Florida import's bookkeeping line; the deal's own dates say the same.
  [/^Not contacted yet\. Added \d{4}-\d\d-\d\d from /, "drop"],
];

const unquote = (s: string) => s.trim().replace(/^"([^]*)"$/, "$1").trim();

/**
 * Splits notes into the brief and the seller's own notes. Returns `brief: null`
 * when there are no brief lines at all, so hand-written notes are left alone.
 */
export function parseBrief(notes: string | null | undefined): { brief: CallBrief | null; rest: string } {
  const brief: CallBrief = {};
  const rest: string[] = [];
  let found = false;
  for (const raw of (notes ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const hit = LABELS.find(([re]) => re.test(line));
    if (!hit) {
      rest.push(raw.replace(/\s+$/, ""));
      continue;
    }
    found = true;
    const [re, to] = hit;
    const value = line.replace(re, "").trim();
    if (to === "drop") continue;
    if (to === "callAbout") {
      const [tag, ...vertical] = value.split(" · ");
      if (tag) brief.tag = tag.trim();
      if (vertical.length) brief.vertical = vertical.join(" · ").trim();
    } else if (to === "whyNoSite") {
      brief.tag ??= "NO WEBSITE";
      brief.why = value;
    } else if (to === "check_first" || to === "phone_unverified" || to === "weak_lead") {
      (brief.warnings ??= []).push({ kind: to, text: value });
    } else if (to === "about" && brief.about) {
      brief.about = `${brief.about.replace(/\.?\s*$/, ".")} ${value}`;
    } else {
      brief[to] = to === "opener" ? unquote(value) : value;
    }
  }
  // Collapse the blank lines left where the brief was.
  const text = rest.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { brief: found ? brief : null, rest: text };
}

/** True when the brief has nothing worth showing. */
export function briefIsEmpty(brief: CallBrief | null | undefined) {
  return !brief || Object.entries(brief).every(([, v]) => (Array.isArray(v) ? v.length === 0 : !v));
}

/** Reads the jsonb column defensively: anything that isn't an object is no brief. */
export function readBrief(value: unknown): CallBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as CallBrief;
}

const WARNING_LABEL: Record<BriefWarning["kind"], string> = {
  check_first: "Check first",
  phone_unverified: "Phone unverified",
  weak_lead: "Weak lead",
};

export function warningLabel(kind: BriefWarning["kind"]) {
  return WARNING_LABEL[kind] ?? "Check";
}

/** Tags in the order they're worth calling about: a dead site is the easiest conversation. */
const TAG_RANK: Record<string, number> = { "SITE DOWN": 0, HACKED: 1, "NO WEBSITE": 2, "BROKEN PIECES": 3, "NOT MOBILE": 4 };

/**
 * The call sheet's order, lowest first: follow-ups already due, then fresh
 * leads with the strongest reason to call and the fullest brief. Leads with a
 * warning go last, since they need checking before a call.
 */
export function callPriority(input: { brief: CallBrief | null; followUp: "overdue" | "today" | "upcoming" | "none"; contacted: boolean }) {
  const { brief, followUp, contacted } = input;
  let score = 0;
  if (followUp === "overdue") score -= 200;
  else if (followUp === "today") score -= 150;
  else if (contacted) score += 50;
  score += (TAG_RANK[brief?.tag ?? ""] ?? 5) * 10;
  if (brief?.upgradeAngle) score -= 3;
  if (brief?.askFor && !/^the owner/i.test(brief.askFor)) score -= 2;
  if (brief?.warnings?.length) score += 100;
  return score;
}
