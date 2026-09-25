/**
 * The Inbox's rules, kept free of the database so they can be tested alone:
 * reading addresses, threading replies, trimming quoted history, and deciding
 * which client or deal a conversation belongs to.
 */

export type Address = { email: string; name: string | null };

/** `Dana Whitfield <dana@harbor.com>`, `"Whitfield, Dana" <dana@…>` or a bare address. */
export function parseAddress(raw: string): Address | null {
  const value = raw.trim();
  const angle = value.match(/^(.*)<([^<>\s]+@[^<>\s]+)>\s*$/);
  const email = (angle ? angle[2] : value).trim().toLowerCase().replace(/^mailto:/, "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = angle ? angle[1].trim().replace(/^"(.*)"$/, "$1").trim() || null : null;
  return { email, name };
}

export function parseAddresses(raw: string | string[] | null | undefined): Address[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  return parts.map(parseAddress).filter((a): a is Address => !!a);
}

/** "RE: Fwd: [External] Intake form fields" → "intake form fields", for matching threads. */
export function subjectKey(subject: string) {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(\[[^\]]*\]\s*|(re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)/i, "");
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The subject for a reply: "Re: " once, never "Re: Re:". */
export function replySubject(subject: string) {
  return /^re\s*:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

/** Message-IDs from In-Reply-To / References headers, without angle brackets. */
export function messageIds(header: string | null | undefined) {
  return (header ?? "").match(/<[^<>\s]+>/g)?.map((id) => id.slice(1, -1)) ?? [];
}

export function bareMessageId(id: string | null | undefined) {
  return id ? id.trim().replace(/^<|>$/g, "") : null;
}

/**
 * The new part of a reply: drops the quoted history ("On … wrote:", "> "
 * lines, Outlook's "From: … Sent: …" block) and trailing blank lines.
 */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .{3,200}wrote:\s*$/i.test(line)) break;
    if (/^\s*On .{3,200}$/i.test(line) && /wrote:\s*$/i.test(next)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && lines.slice(i + 1, i + 4).some((l) => /^\s*(Sent|Date):\s/i.test(l))) break;
    if (/^\s*_{20,}\s*$/.test(line)) break;
    out.push(line);
  }
  const trimmed = out.join("\n").replace(/\s+$/, "");
  return trimmed || text.trim();
}

/** A one-line preview for the list. */
export function snippet(text: string, max = 110) {
  const flat = stripQuoted(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Who a message is with. Mail from a SKOX address is outbound, and the
 * conversation is with its first outside recipient; anything else is inbound
 * from the sender. `ignore` holds the inbox's own copy address.
 */
export function counterpartOf(
  from: Address,
  recipients: Address[],
  isStaff: (email: string) => boolean,
  ignore: string[] = [],
): { direction: "inbound" | "outbound"; counterpart: Address } | null {
  const outside = (a: Address) => !isStaff(a.email) && !ignore.includes(a.email);
  if (isStaff(from.email)) {
    const to = recipients.find(outside);
    return to ? { direction: "outbound", counterpart: to } : null;
  }
  return { direction: "inbound", counterpart: from };
}

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "msn.com", "comcast.net", "att.net",
]);

export function domainOf(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export type Owner = { clientId: string | null; dealId: string | null };
export type KnownContact = Owner & { email: string };

/**
 * Which client or deal an address belongs to: an exact contact first, then a
 * colleague at the same company domain (never for gmail.com and the like).
 * Ambiguous domains (two different owners) stay unassigned.
 */
export function matchOwner(email: string, contacts: KnownContact[]): Owner | null {
  const address = email.toLowerCase();
  const exact = contacts.find((c) => c.email.toLowerCase() === address);
  if (exact) return { clientId: exact.clientId, dealId: exact.dealId };
  const domain = domainOf(address);
  if (!domain || FREE_MAIL.has(domain)) return null;
  const owners = new Map<string, Owner>();
  for (const c of contacts) {
    if (domainOf(c.email) !== domain) continue;
    owners.set(`${c.clientId}:${c.dealId}`, { clientId: c.clientId, dealId: c.dealId });
  }
  return owners.size === 1 ? [...owners.values()][0] : null;
}
