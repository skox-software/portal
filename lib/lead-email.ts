export const LEAD_SENDER_EMAIL = "reiss@skoxsoftware.com";
export const LEAD_SENDER = `Reiss Skeen <${LEAD_SENDER_EMAIL}>`;

export function leadEmailPayload(to: string, subject: string, body: string) {
  return { from: LEAD_SENDER, replyTo: LEAD_SENDER_EMAIL, to, subject, text: body };
}
