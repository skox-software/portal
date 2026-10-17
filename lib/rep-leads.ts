/**
 * Duplicate checks for leads a rep submits. First to submit wins, so a lead
 * is rejected when its email, phone, website or company already belongs to
 * anything in the workspace. Pure, so it can be tested alone.
 */

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "comcast.net", "att.net",
]);

export function normEmail(value: string | null | undefined) {
  const v = (value ?? "").trim().toLowerCase();
  return v.includes("@") ? v : null;
}

/** Last ten digits, so "+1 (904) 555-0100" and "904.555.0100" match. */
export function normPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Bare host without www, so "https://www.acme.com/about" matches "acme.com". */
export function normHost(value: string | null | undefined) {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  try {
    const host = new URL(v.includes("://") ? v : `https://${v}`).hostname.replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** A business email's domain counts as its website; free mail domains never do. */
export function emailDomain(email: string | null) {
  const domain = email?.split("@")[1];
  return domain && !FREE_MAIL.has(domain) ? domain : null;
}

const SUFFIXES = /\b(llc|l\.l\.c|inc|incorporated|co|corp|corporation|company|ltd|pllc|pa|p\.a|group|the)\b/g;

/** "The Acme Group, LLC" → "acme". */
export function normCompany(value: string | null | undefined) {
  const v = (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, "");
  return v.length >= 3 ? v : null;
}

export type LeadKeys = { email: string | null; phone: string | null; host: string | null; company: string | null };

export function leadKeys(lead: { email?: string | null; phone?: string | null; website?: string | null; company?: string | null }): LeadKeys {
  const email = normEmail(lead.email);
  return {
    email,
    phone: normPhone(lead.phone),
    host: normHost(lead.website) ?? emailDomain(email),
    company: normCompany(lead.company),
  };
}

/** True when the two leads share any identifying key. */
export function sameLead(a: LeadKeys, b: LeadKeys) {
  return Boolean(
    (a.email && a.email === b.email) ||
      (a.phone && a.phone === b.phone) ||
      (a.host && a.host === b.host) ||
      (a.company && a.company === b.company),
  );
}
