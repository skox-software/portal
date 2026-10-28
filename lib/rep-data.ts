import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { commissionEntries, commissionStatements, deals, events, memberships, repProfiles } from "@/lib/db/schema";
import { repStatus } from "@/lib/rep-status";

/**
 * Everything a sales rep can read, and nothing else. Each query names its
 * columns: internal notes, deal values, attribution, owners and projects
 * never leave the database for a rep. Every query is scoped to the rep's
 * own membership.
 */

type Rep = { id: string; workspaceId: string };

const leadColumns = {
  id: deals.id,
  company: deals.company,
  contactName: deals.contactName,
  contactEmail: deals.contactEmail,
  phone: deals.phone,
  website: deals.website,
  industry: deals.industry,
  location: deals.location,
  stage: deals.stage,
  meetingAt: deals.meetingAt,
  onboarded: sql<boolean>`${deals.projectId} is not null`,
  repNotes: deals.repNotes,
  repSource: deals.repSource,
  nextStep: deals.nextStep,
  nextStepOn: deals.nextStepOn,
  lastContactedAt: deals.lastContactedAt,
  createdAt: deals.createdAt,
};

function shape<T extends { stage: (typeof deals.$inferSelect)["stage"]; meetingAt: Date | null; onboarded: boolean }>(row: T) {
  const { stage, onboarded, ...rest } = row;
  return { ...rest, status: repStatus({ stage, meetingAt: row.meetingAt, projectId: onboarded ? "yes" : null }) };
}


function rawLeads(rep: Rep) {
  return getDb()
    .select(leadColumns)
    .from(deals)
    .where(and(eq(deals.workspaceId, rep.workspaceId), eq(deals.repMembershipId, rep.id)))
    .orderBy(asc(deals.nextStepOn), desc(deals.createdAt));
}

export async function myLeads(rep: Rep) {
  return (await rawLeads(rep)).map(shape);
}

export type RepLead = Awaited<ReturnType<typeof myLeads>>[number];

export async function myLead(rep: Rep, id: string) {
  const [row] = await getDb()
    .select(leadColumns)
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.workspaceId, rep.workspaceId), eq(deals.repMembershipId, rep.id)))
    .limit(1);
  return row ? shape(row) : null;
}

/** The rep's own activity on a lead. UnBusy's calls and notes stay internal. */
export async function myLeadHistory(rep: Rep, userId: string, dealId: string) {
  return getDb()
    .select({ verb: events.verb, payload: events.payload, createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.workspaceId, rep.workspaceId), eq(events.subjectType, "deal"), eq(events.subjectId, dealId), eq(events.actorId, userId)))
    .orderBy(desc(events.createdAt))
    .limit(50);
}

export async function myProfile(rep: Rep) {
  const [row] = await getDb()
    .select({
      displayName: repProfiles.displayName,
      rateBps: repProfiles.rateBps,
      status: repProfiles.status,
      phone: repProfiles.phone,
      payoutNotes: repProfiles.payoutNotes,
      w9ReceivedAt: repProfiles.w9ReceivedAt,
      agreementSignedAt: repProfiles.agreementSignedAt,
      startedOn: repProfiles.startedOn,
      email: memberships.email,
      emailUpdates: memberships.emailUpdates,
      lastSeenAt: memberships.lastSeenAt,
    })
    .from(repProfiles)
    .innerJoin(memberships, eq(memberships.id, repProfiles.membershipId))
    .where(eq(repProfiles.membershipId, rep.id))
    .limit(1);
  return row ?? null;
}

const entryColumns = {
  id: commissionEntries.id,
  kind: commissionEntries.kind,
  clientName: commissionEntries.clientName,
  baseCents: commissionEntries.baseCents,
  rateBps: commissionEntries.rateBps,
  amountCents: commissionEntries.amountCents,
  status: commissionEntries.status,
  earnedAt: commissionEntries.earnedAt,
  statementId: commissionEntries.statementId,
  note: commissionEntries.note,
};

export async function myEntries(rep: Rep, year?: number) {
  return getDb()
    .select(entryColumns)
    .from(commissionEntries)
    .where(
      and(
        eq(commissionEntries.repMembershipId, rep.id),
        eq(commissionEntries.workspaceId, rep.workspaceId),
        sql`${commissionEntries.status} <> 'void'`,
        ...(year ? [sql`extract(year from ${commissionEntries.earnedAt} at time zone 'America/New_York') = ${year}`] : []),
      ),
    )
    .orderBy(desc(commissionEntries.earnedAt));
}

const statementColumns = {
  id: commissionStatements.id,
  periodStart: commissionStatements.periodStart,
  periodEnd: commissionStatements.periodEnd,
  totalCents: commissionStatements.totalCents,
  status: commissionStatements.status,
  approvedAt: commissionStatements.approvedAt,
  paidAt: commissionStatements.paidAt,
  paymentReference: commissionStatements.paymentReference,
};

/** Drafts are UnBusy's working copy; reps see a statement once it's approved. */
export async function myStatements(rep: Rep) {
  return getDb()
    .select(statementColumns)
    .from(commissionStatements)
    .where(and(eq(commissionStatements.repMembershipId, rep.id), sql`${commissionStatements.status} in ('approved', 'paid')`))
    .orderBy(desc(commissionStatements.periodStart));
}

export async function myStatement(rep: Rep, id: string) {
  const db = getDb();
  const [statement] = await db
    .select(statementColumns)
    .from(commissionStatements)
    .where(and(eq(commissionStatements.id, id), eq(commissionStatements.repMembershipId, rep.id), sql`${commissionStatements.status} in ('approved', 'paid')`))
    .limit(1);
  if (!statement) return null;
  const lines = await db.select(entryColumns).from(commissionEntries).where(and(eq(commissionEntries.statementId, id), eq(commissionEntries.repMembershipId, rep.id))).orderBy(asc(commissionEntries.earnedAt));
  return { statement, lines };
}
