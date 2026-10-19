export const LEAD_SENDER_EMAIL = "reiss@skoxsoftware.com";
export const LEAD_SENDER = `Reiss Skeen <${LEAD_SENDER_EMAIL}>`;
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
export function leadEmailPayload(to: string, subject: string, body: string, footer: ComplianceFooter) {
  const postalAddress = footer.postalAddress?.trim();
  if (!postalAddress) throw new Error("SKOX_POSTAL_ADDRESS is not set; cold email needs our postal address.");
  if (!/^https:\/\/[^\s<>"]+$/i.test(footer.unsubscribeUrl ?? "")) throw new Error("Cold email needs an https unsubscribe link.");
  const url = footer.unsubscribeUrl;
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124">${lines.map(line => /^\s*SKOX Software\s*$/i.test(line)
    ? `<a href="${SKOX_WEBSITE}">${escapeHtml(line.trim())}</a>`
    : /^https?:\/\/[^\s<>]+$/i.test(line.trim()) ? `<a href="${escapeHtml(line.trim())}">${escapeHtml(line.trim())}</a>` : escapeHtml(line)).join("<br>\n")}</div>`
    + `\n<p style="font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#80868b;margin-top:24px">SKOX Software · ${escapeHtml(postalAddress)}<br>\n${escapeHtml(OPT_OUT_LINE)}: <a href="${escapeHtml(url)}" style="color:#80868b">unsubscribe</a></p>`;
  const text = lines.map(line => /^\s*SKOX Software\s*$/i.test(line) ? `${line.trim()} (${SKOX_WEBSITE})` : line).join("\n")
    + `\n\n--\nSKOX Software · ${postalAddress}\n${OPT_OUT_LINE}: ${url}`;
  return {
    from: LEAD_SENDER, replyTo: LEAD_SENDER_EMAIL, to, subject, text, html,
    // One-click unsubscribe (RFC 8058), which Gmail and Yahoo expect from bulk senders.
    headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
