import { Resend } from "resend";
import { parseAddress } from "@/lib/inbox";
import { isOptOutReply } from "@/lib/reply-opt-out";
import { suppressOutreach } from "@/lib/cold-outreach";

/** HTML-only replies must lose quoted history before conversion to text. */
export function authoredHtmlText(html: string) {
  return html.split(/<blockquote\b|<[^>]+(?:class=["'][^"']*gmail_quote|id=["']divRplyFwdMsg)/i)[0]
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;|&#8217;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"').replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

/** Called only after the webhook signature is verified. No message/attachment
 * storage is needed: retain the address-level suppression, not the mail body.
 */
export async function receiveOptOut(emailId: string) {
  const key = process.env.RESEND_INBOUND_API_KEY ?? process.env.RESEND_API_KEY;
  const copy = process.env.OUTREACH_REPLY_COPY_ADDRESS?.trim().toLowerCase();
  if (!key || !copy) throw new Error("Reply opt-out receiving is not configured.");
  const { data: email, error } = await new Resend(key).emails.receiving.get(emailId);
  if (error || !email) throw new Error("Could not fetch received reply.");
  // Only the dedicated Gmail forwarding destination feeds this automation.
  if (!email.to.some(to => parseAddress(to)?.email === copy)) return { ignored: "other receiving address" };
  const sender = parseAddress(email.from)?.email;
  if (!sender || /@(outreach\.)?(skoxsoftware|gounbusy)\.com$/i.test(sender)) return { ignored: "internal sender" };
  const text = email.text ?? authoredHtmlText(email.html ?? "");
  if (!isOptOutReply(email.subject ?? "", text)) return { ignored: "not an explicit opt-out" };
  // Idempotent and global: all matching deals and newly added deals are blocked.
  // Throw on failure so Resend retries; never acknowledge a failed suppression.
  await suppressOutreach(sender);
  return { suppressed: true };
}
