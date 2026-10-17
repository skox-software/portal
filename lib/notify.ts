import { and, eq, isNull } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { sendEmail, type EmailContent } from "@/lib/email";

/**
 * Who hears about what. Recipient lookups and sending run after the response
 * (next/server `after`), so a slow email provider never slows a click.
 */

export async function clientRecipients(
  clientId: string,
  /** actionRequired: money, signatures, approvals and milestones reach people even with updates turned off. */
  opts: { approversOnly?: boolean; exceptEmail?: string; actionRequired?: boolean } = {},
) {
  const rows = await getDb()
    .select({ email: memberships.email, role: memberships.role, emailUpdates: memberships.emailUpdates })
    .from(memberships)
    .where(and(eq(memberships.clientId, clientId), isNull(memberships.revokedAt)));
  return rows
    .filter((r) => opts.actionRequired || r.emailUpdates)
    .filter((r) => !opts.approversOnly || r.role === "client_approver")
    .filter((r) => r.email !== opts.exceptEmail)
    .map((r) => r.email);
}

export async function staffRecipients(workspaceId: string, exceptEmail?: string) {
  const rows = await getDb()
    .select({ email: memberships.email })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        isNull(memberships.clientId),
        eq(memberships.role, "staff_owner"),
        isNull(memberships.revokedAt),
      ),
    );
  return rows.map((r) => r.email).filter((e) => e !== exceptEmail);
}

/** Queue an email to be sent once the response has gone out. */
export function notifyLater(recipients: () => Promise<string[]> | string[], content: EmailContent) {
  after(async () => {
    try {
      const to = await recipients();
      await sendEmail(to, content);
    } catch (error) {
      console.error("[notify] failed", { subject: content.subject, error });
    }
  });
}

export function portalLink(path: string) {
  const base = (process.env.PORTAL_URL ?? "https://portal.skoxsoftware.com").replace(/\/$/, "");
  return `${base}${path}`;
}
