import { Resend } from "resend";

/**
 * Branded transactional email. Every message uses one layout so the portal
 * always looks like SKOX: wordmark, warm paper background, one clear button.
 * Email clients ignore web fonts and most CSS, so the layout is inline-styled
 * tables with system-font fallbacks.
 */

export type EmailContent = {
  subject: string;
  /** Inbox preview text shown next to the subject. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  details?: { label: string; value: string }[];
  cta?: { label: string; href: string };
  /** Small grey line under the button, e.g. "Due Sep 30". */
  footnote?: string;
};

const INK = "#1c201d";
const MUTED = "#5c6157";
const AMBER = "#e4a907";
const CANVAS = "#faf9f6";
const LINE = "#e4e2d8";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmail(content: EmailContent) {
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font:400 16px/1.6 ${font};color:${INK};white-space:pre-line">${escapeHtml(p)}</p>`,
    )
    .join("");
  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-top:1px solid ${LINE}">${content.details.map(({ label, value }) => `<tr><td width="32%" valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid ${LINE};font:500 13px/1.5 ${font};color:${MUTED}">${escapeHtml(label)}</td><td valign="top" style="padding:10px 0;border-bottom:1px solid ${LINE};font:500 14px/1.5 ${font};color:${INK};overflow-wrap:anywhere;word-break:break-word">${escapeHtml(value)}</td></tr>`).join("")}</table>`
    : "";
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:999px;background:${AMBER}">
         <a href="${escapeHtml(content.cta.href)}" style="display:inline-block;padding:14px 26px;font:600 15px/1 ${font};color:${INK};text-decoration:none;border-radius:999px">${escapeHtml(content.cta.label)}</a>
       </td></tr></table>`
    : "";
  const footnote = content.footnote
    ? `<p style="margin:0;font:400 13px/1.5 ${font};color:${MUTED}">${escapeHtml(content.footnote)}</p>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS}">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${escapeHtml(content.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 4px 20px">
      <span style="font:800 22px/1 ${font};letter-spacing:0.14em;color:${INK}">SKO<span style="color:${AMBER}">X</span></span>
      <span style="font:500 11px/1 ${font};letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};padding-left:10px">Client Portal</span>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:16px;padding:32px 28px">
      <h1 style="margin:0 0 16px;font:700 24px/1.25 Georgia,'Times New Roman',serif;color:${INK}">${escapeHtml(content.heading)}</h1>
      ${paragraphs}${details}${cta}${footnote}
    </td></tr>
    <tr><td style="padding:20px 4px 0;font:400 12px/1.6 ${font};color:${MUTED}">
      SKOX Software · Good ideas deserve to be built.<br>
      This notification relates to your work with SKOX Software. If you have any questions, reply to this email to contact our team.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    content.heading,
    "",
    ...content.paragraphs,
    ...(content.details?.map(({ label, value }) => `${label}: ${value}`) ?? []),
    ...(content.cta ? ["", `${content.cta.label}: ${content.cta.href}`] : []),
    ...(content.footnote ? ["", content.footnote] : []),
    "",
    "SKOX Software · Reply to this email to reach the team.",
  ].join("\n");

  return { html, text };
}

let resend: Resend | null = null;

/**
 * Sends one branded email. Never throws: a failed email must not undo the
 * change that triggered it. In development it logs instead of sending unless
 * EMAIL_SEND_IN_DEV=1, so local testing never mails real clients.
 */
export async function sendEmail(to: string | string[], content: EmailContent) {
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
  if (recipients.length === 0) return false;

  const key = process.env.RESEND_API_KEY;
  const live = process.env.NODE_ENV === "production" || process.env.EMAIL_SEND_IN_DEV === "1";
  if (!key || !live) {
    console.info("[email] (not sent)", { to: recipients, subject: content.subject });
    return false;
  }

  resend ??= new Resend(key);
  const { html, text } = renderEmail(content);
  try {
    // One message per recipient so clients never see each other's addresses.
    const results = await Promise.all(
      recipients.map(async (address) => {
        const { error } = await resend!.emails.send({
          from: process.env.EMAIL_FROM ?? "SKOX Software <portal@skoxsoftware.com>",
          replyTo: process.env.EMAIL_REPLY_TO ?? "founders@skoxsoftware.com",
          to: address,
          subject: content.subject,
          html,
          text,
        });
        if (error) console.error("[email] send failed", { to: address, subject: content.subject, error });
        return !error;
      }),
    );
    return results.every(Boolean);
  } catch (error) {
    console.error("[email] send threw", { subject: content.subject, error });
    return false;
  }
}
