/**
 * Cold outreach goes out from its own subdomain (verified in Resend), so spam
 * reports on cold email can't hurt skoxsoftware.com, which sends sign-in
 * codes, invoices and receipts. Replies come back to the sender's normal
 * inbox through Reply-To, so nobody needs a mailbox on the subdomain.
 */
export const OUTREACH_DOMAIN = "outreach.skoxsoftware.com";

/** Who an outreach email is from: the display name, the address on the outreach domain, and where replies go. */
export type OutreachSender = { name: string; firstName: string; fromEmail: string; replyTo: string; title: string };

/** The team's names as a lead should see them, keyed by portal sign-in. */
const KNOWN_SENDERS: Record<string, { name: string; local: string; title: string }> = {
  "reiss@skoxsoftware.com": { name: "Reiss Skeen", local: "reiss", title: "Co-founder, SKOX Software" },
  "founders@skoxsoftware.com": { name: "Josh Fox", local: "josh", title: "Co-founder, SKOX Software" },
};

/** Outreach goes out as whoever presses Send: their name, on the outreach domain. */
export function outreachSender(loginEmail: string): OutreachSender {
  const email = loginEmail.trim().toLowerCase();
  const known = KNOWN_SENDERS[email];
  const local = (known?.local ?? email.split("@")[0]).replace(/[^a-z0-9._-]/g, "") || "hello";
  const name = known?.name ?? local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { name, firstName: name.split(" ")[0], fromEmail: `${local}@${OUTREACH_DOMAIN}`, replyTo: email, title: known?.title ?? "SKOX Software" };
}

/** Reiss works most leads, so he's the default author of generated drafts. */
export const REISS = outreachSender("reiss@skoxsoftware.com");
export const LEAD_SENDER_EMAIL = REISS.replyTo;
export const OUTREACH_SENDER_EMAIL = REISS.fromEmail;

/** The "From" line a lead sees. */
export function senderLine(sender: OutreachSender) {
  return `${sender.name} <${sender.fromEmail}>`;
}

/** Another team member's name in a draft's body, e.g. a draft Reiss wrote that Josh is about to send. */
export function signedByOther(body: string, sender: OutreachSender) {
  return Object.values(KNOWN_SENDERS).find((k) => k.name !== sender.name && body.includes(k.name))?.name ?? null;
}
export const SKOX_WEBSITE = "https://www.skoxsoftware.com";
export const OPT_OUT_LINE = "Not interested? Reply 'no thanks' or use this link and we won't email you again";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** What every commercial email needs (CAN-SPAM): our postal address and a working opt-out. */
export type ComplianceFooter = { postalAddress: string; unsubscribeUrl: string };

/**
 * Keep the personal layout, linking the signature and standalone web URLs,
 * then add the postal address and opt-out. Throws without either, so a cold
 * email can never leave without them.
 */
export function leadEmailPayload(to: string, subject: string, body: string, footer: ComplianceFooter, sender: OutreachSender = REISS) {
  const postalAddress = footer.postalAddress?.trim();
  if (!postalAddress) throw new Error("SKOX_POSTAL_ADDRESS is not set; cold email needs our postal address.");
  if (!/^https:\/\/[^\s<>"]+$/i.test(footer.unsubscribeUrl ?? "")) throw new Error("Cold email needs an https unsubscribe link.");
  const url = footer.unsubscribeUrl;
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124">${lines.map(line => /^\s*SKOX Software\s*$/i.test(line)
    ? `<a href="${SKOX_WEBSITE}">${escapeHtml(line.trim())}</a>`
    : /^https?:\/\/[^\s<>]+$/i.test(line.trim()) ? `<a href="${escapeHtml(line.trim())}">${escapeHtml(line.trim())}</a>` : escapeHtml(line)).join("<br>\n")}</div>`
    + `\n<p style="font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#80868b;margin-top:24px">Advertisement from SKOX Software · ${escapeHtml(postalAddress)}<br>\n${escapeHtml(OPT_OUT_LINE)}: <a href="${escapeHtml(url)}" style="color:#80868b">unsubscribe</a></p>`;
  const text = lines.map(line => /^\s*SKOX Software\s*$/i.test(line) ? `${line.trim()} (${SKOX_WEBSITE})` : line).join("\n")
    + `\n\n--\nAdvertisement from SKOX Software · ${postalAddress}\n${OPT_OUT_LINE}: ${url}`;
  return {
    from: senderLine(sender), replyTo: sender.replyTo, to, subject, text, html,
    // One-click unsubscribe (RFC 8058), which Gmail and Yahoo expect from bulk senders.
    headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
