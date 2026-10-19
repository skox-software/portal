export const LEAD_SENDER_EMAIL = "reiss@skoxsoftware.com";
export const LEAD_SENDER = `Reiss Skeen <${LEAD_SENDER_EMAIL}>`;
export const SKOX_WEBSITE = "https://www.skoxsoftware.com";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Keep the personal layout, linking the signature and standalone web URLs. */
export function leadEmailPayload(to: string, subject: string, body: string) {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124">${lines.map(line => /^\s*SKOX Software\s*$/i.test(line)
    ? `<a href="${SKOX_WEBSITE}">${escapeHtml(line.trim())}</a>`
    : /^https?:\/\/[^\s<>]+$/i.test(line.trim()) ? `<a href="${escapeHtml(line.trim())}">${escapeHtml(line.trim())}</a>` : escapeHtml(line)).join("<br>\n")}</div>`;
  const text = lines.map(line => /^\s*SKOX Software\s*$/i.test(line) ? `${line.trim()} (${SKOX_WEBSITE})` : line).join("\n");
  return { from: LEAD_SENDER, replyTo: LEAD_SENDER_EMAIL, to, subject, text, html };
}
