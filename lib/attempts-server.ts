import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { events } from "@/lib/db/schema";

/** The verbs that count as an outreach attempt: a logged call with an outcome, or a cold email sent or scheduled. */
export const ATTEMPT_VERBS = ["deal.call_logged", "deal.email_sent", "deal.email_scheduled"] as const;

const isAttempt = or(
  inArray(events.verb, ["deal.email_sent", "deal.email_scheduled"]),
  and(eq(events.verb, "deal.call_logged"), sql`${events.payload}->>'outcome' is not null`),
);

/** How many times we've tried this lead, by call or email. */
export async function attemptCount(workspaceId: string, dealId: string) {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.workspaceId, workspaceId), eq(events.subjectType, "deal"), eq(events.subjectId, dealId), isAttempt));
  return row?.n ?? 0;
}
