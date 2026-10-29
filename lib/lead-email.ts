/**
 * Cold outreach goes out from its own subdomain (verified in Resend), so spam
 * can be managed separately from transactional mail. Reputation isolation
 * is not guaranteed. The main domain sends sign-in
 * codes, invoices and receipts. Replies come back to the sender's normal
 * inbox through Reply-To, so nobody needs a mailbox on the subdomain.
 */
/**
 * Stays on the old subdomain until outreach.gounbusy.com is verified in Resend
 * and warmed up; then set OUTREACH_DOMAIN=outreach.gounbusy.com. Mail from an
 * unverified domain is rejected, so this is a setting, not a code change.
 */
export const OUTREACH_DOMAIN = process.env.OUTREACH_DOMAIN?.trim() || "outreach.skoxsoftware.com";

/** Who an outreach email is from: the display name, the address on the outreach domain, and where replies go. */
export type OutreachSender = { name: string; firstName: string; fromEmail: string; replyTo: string; title: string };

/** The team's names as a lead should see them, keyed by portal sign-in. */
const KNOWN_SENDERS: Record<string, { name: string; local: string; title: string }> = {
  "reiss@skoxsoftware.com": { name: "Reiss Skeen", local: "reiss", title: "Co-founder, UnBusy (formerly SKOX Software)" },
  "founders@skoxsoftware.com": { name: "Josh Fox", local: "josh", title: "Co-founder, UnBusy (formerly SKOX Software)" },
  "reiss@gounbusy.com": { name: "Reiss Skeen", local: "reiss", title: "Co-founder, UnBusy (formerly SKOX Software)" },
  "founders@gounbusy.com": { name: "Josh Fox", local: "josh", title: "Co-founder, UnBusy (formerly SKOX Software)" },
};

/** Outreach goes out as whoever presses Send: their name, on the outreach domain. */
export function outreachSender(loginEmail: string): OutreachSender {
  const email = loginEmail.trim().toLowerCase();
  const known = KNOWN_SENDERS[email];
  const local = (known?.local ?? email.split("@")[0]).replace(/[^a-z0-9._-]/g, "") || "hello";
  const name = known?.name ?? local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { name, firstName: name.split(" ")[0], fromEmail: `${local}@${OUTREACH_DOMAIN}`, replyTo: email, title: known?.title ?? "UnBusy" };
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
export const SKOX_WEBSITE = "https://gounbusy.com";
/** The wordmark for email (480×84 PNG; Gmail drops SVG), shown at 120×21. */
const SKOX_LOGO = `${SKOX_WEBSITE}/email/unbusy-logo.png`;
const SKOX_INK = "#1c201d";
const SKOX_AMBER = "#e4a907";
export const OPT_OUT_LINE = "Not interested? Reply 'no thanks' or use this link and we won't email you again";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A link to a lead's preview site, on a line of its own. */
const PREVIEW_LINE = /^https:\/\/previews\.(?:skoxsoftware|gounbusy)\.com\/[^\s<>]*$/i;

/**
 * A preview link becomes a SKOX-amber button with the domain under it: no
 * long address to squint at, and the real domain in plain sight so it
 * doesn't read as a disguised link. Tables and inline styles so it renders
 * in Outlook too.
 */
function previewButton(url: string) {
  const href = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px"><tr><td style="background:${SKOX_AMBER};border-radius:999px">`
    + `<a href="${href}" style="display:inline-block;padding:13px 24px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;line-height:1.2;color:${SKOX_INK};text-decoration:none;border-radius:999px">View your website preview &rarr;</a>`
    + `</td></tr></table><span style="font-size:12px;color:#80868b">${escapeHtml(new URL(url).host)}</span>`;
}

/**
 * In a preview email (the lead asked for it), the signature's last line
 * ("skoxsoftware.com") becomes the SKOX wordmark, linked to the site. Cold
 * first emails stay image-free, which keeps them out of spam folders.
 */
const SIGNATURE_SITE = /^\s*(?:skoxsoftware|gounbusy)\.com\s*$/i;
const signatureLogo = () =>
  `<a href="${SKOX_WEBSITE}" style="display:inline-block;margin-top:10px;text-decoration:none"><img src="${SKOX_LOGO}" width="120" height="29" alt="UnBusy" style="display:block;border:0;outline:none;width:120px;height:29px"></a>`;

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
  const branded = lines.some((line) => PREVIEW_LINE.test(line.trim()));
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124">${lines.map(line => /^\s*(?:SKOX Software|UnBusy)\s*$/i.test(line)
    ? `<a href="${SKOX_WEBSITE}">${escapeHtml(line.trim())}</a>`
    : branded && SIGNATURE_SITE.test(line) ? signatureLogo()
    : PREVIEW_LINE.test(line.trim()) ? previewButton(line.trim())
    : /^https?:\/\/[^\s<>]+$/i.test(line.trim()) ? `<a href="${escapeHtml(line.trim())}">${escapeHtml(line.trim())}</a>` : escapeHtml(line)).join("<br>\n")}</div>`
    + `\n<p style="font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#80868b;margin-top:24px">Advertisement from UnBusy (formerly SKOX Software) · ${escapeHtml(postalAddress)}<br>\n${escapeHtml(OPT_OUT_LINE)}: <a href="${escapeHtml(url)}" style="color:#80868b">unsubscribe</a></p>`;
  const text = lines.map(line => /^\s*(?:SKOX Software|UnBusy)\s*$/i.test(line) ? `${line.trim()} (${SKOX_WEBSITE})` : line).join("\n")
    + `\n\n--\nAdvertisement from UnBusy (formerly SKOX Software) · ${postalAddress}\n${OPT_OUT_LINE}: ${url}`;
  return {
    from: senderLine(sender), replyTo: sender.replyTo, to, subject, text, html,
    // One-click unsubscribe (RFC 8058), which Gmail and Yahoo expect from bulk senders.
    headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
