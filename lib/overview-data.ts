import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, max, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  approvals,
  clients,
  commissionEntries,
  commissionStatements,
  deals,
  documents,
  documentSigners,
  emailThreads,
  events,
  feedback,
  ideas,
  invoices,
  memberships,
  onboardings,
  projects,
  referrals,
  repProfiles,
  supportRequests,
  tasks,
  updates,
  workspaces,
} from "@/lib/db/schema";
import { outreachConfig } from "@/lib/cold-outreach";
import { callPriority, parseBrief, readBrief } from "@/lib/call-brief";
import { collectedByBucket, collectedSince, leaderboard, outstanding } from "@/lib/finance-data";
import { liveSnapshot } from "@/lib/finance-live";
import { periodRange, type PeriodRange } from "@/lib/finance-periods";
import { stripePayouts } from "@/lib/finance-stripe";
import { followUpState } from "@/lib/follow-up";
import { dueFollowUps } from "@/lib/follow-up-data";
import { formatDateTime, formatMoney, formatMonth } from "@/lib/format";
import { isCallable, zoneFor } from "@/lib/local-time";
import { loadOutreachLog } from "@/lib/outreach-log-data";
import { inPeriod as outreachInPeriod, summarize } from "@/lib/outreach-log";
import {
  followUpTier,
  goalPace,
  lateLabel,
  openCommissionFlags,
  weeklyActivity,
  type ActivityCount,
  type QueueItem,
} from "@/lib/overview-math";
import { loadPipeline } from "@/lib/pipeline-data";
import { isStalled, PRESALE, queueable, type ColumnKey } from "@/lib/pipeline";
import { canApproveCommissions, type PortalRole } from "@/lib/permissions";
import { staffOf } from "@/lib/staff-filter";

const DAY = 86_400_000;
const STALE_UPDATE_DAYS = 7;

export type OverviewInput = { ws: string; me: string; role: PortalRole; today: string; now: Date };

/**
 * Everything the admin Overview shows, read once. It reuses the loaders the
 * other admin pages already have (Pipeline, Finance, Follow-ups, the outreach
 * log) and adds the few queries only the Overview needs. Stripe reads go
 * through the memoised finance reads and never fail the page.
 */
export async function loadOverview({ ws, me, role, today, now }: OverviewInput) {
  const db = getDb();
  const threeDaysAgo = new Date(now.getTime() - 3 * DAY);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const monthAgo = new Date(now.getTime() - 30 * DAY);
  const monthStart = `${today.slice(0, 7)}-01`;
  const mtd = { key: "30d", startIso: monthStart, endIso: today, bucket: "month", label: "Month to date" } as PeriodRange;
  const owner = canApproveCommissions(role);

  const [
    pipeline,
    live,
    owed,
    ytdCents,
    monthly,
    payouts,
    leaders,
    followUps,
    outreachLog,
    workspace,
    staffRows,
    // delivery
    projectRows,
    waiting,
    lastUpdates,
    clientVisits,
    openInvoices,
    unsigned,
    newRequests,
    pendingApprovals,
    openMustFix,
    warmIdeas,
    newReferrals,
    onboardingRows,
    // sales and money
    inboxRows,
    statements,
    flags,
    activity,
    meetings,
  ] = await Promise.all([
    loadPipeline(ws),
    liveSnapshot(ws),
    outstanding(ws),
    collectedSince(ws, `${today.slice(0, 4)}-01-01`),
    collectedByBucket(ws, periodRange("12m", today)),
    stripePayouts(),
    leaderboard(ws, mtd),
    dueFollowUps(ws, today),
    loadOutreachLog(ws),
    db.select({ goalCents: workspaces.revenueGoalCents, goalYear: workspaces.revenueGoalYear }).from(workspaces).where(eq(workspaces.id, ws)),
    db.select({ userId: memberships.userId, email: memberships.email }).from(memberships).where(staffOf(ws)),
    db
      .select({ client: clients, project: projects })
      .from(clients)
      .leftJoin(projects, eq(projects.clientId, clients.id))
      .where(eq(clients.workspaceId, ws))
      .orderBy(asc(clients.name), asc(projects.deliveryDate)),
    db
      .select({ projectId: tasks.projectId, n: count() })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, ws), eq(tasks.side, "client"), isNull(tasks.doneAt)))
      .groupBy(tasks.projectId),
    db.select({ projectId: updates.projectId, last: max(updates.createdAt) }).from(updates).where(eq(updates.workspaceId, ws)).groupBy(updates.projectId),
    db
      .select({ clientId: memberships.clientId, last: max(memberships.lastSeenAt), people: count() })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, ws), isNotNull(memberships.clientId)))
      .groupBy(memberships.clientId),
    db
      .select({ invoice: invoices, project: projects })
      .from(invoices)
      .innerJoin(projects, eq(projects.id, invoices.projectId))
      .where(and(eq(invoices.workspaceId, ws), eq(invoices.status, "open"))),
    db
      .select({ doc: documents, pending: count(documentSigners.id) })
      .from(documents)
      .innerJoin(documentSigners, and(eq(documentSigners.documentId, documents.id), ne(documentSigners.status, "signed")))
      .where(and(eq(documents.workspaceId, ws), eq(documents.status, "out_for_signature"), lt(documents.createdAt, threeDaysAgo)))
      .groupBy(documents.id),
    db
      .select({ request: supportRequests, project: projects })
      .from(supportRequests)
      .innerJoin(projects, eq(projects.id, supportRequests.projectId))
      .where(and(eq(supportRequests.workspaceId, ws), eq(supportRequests.status, "new"))),
    db
      .select({ approval: approvals, project: projects })
      .from(approvals)
      .innerJoin(projects, eq(projects.id, approvals.projectId))
      .where(and(eq(approvals.workspaceId, ws), eq(approvals.state, "changes_requested"))),
    db
      .select({ projectId: feedback.projectId, n: count() })
      .from(feedback)
      .where(and(eq(feedback.workspaceId, ws), eq(feedback.tag, "must_fix"), inArray(feedback.status, ["open", "in_progress"])))
      .groupBy(feedback.projectId),
    db.select({ idea: ideas, project: projects }).from(ideas).innerJoin(projects, eq(projects.id, ideas.projectId)).where(and(eq(ideas.workspaceId, ws), eq(ideas.status, "interested"))),
    db.select().from(referrals).where(and(eq(referrals.workspaceId, ws), eq(referrals.status, "new"))).orderBy(desc(referrals.createdAt)).limit(20),
    db
      .select({ onboarding: onboardings, client: clients })
      .from(onboardings)
      .innerJoin(projects, eq(projects.id, onboardings.projectId))
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(eq(onboardings.workspaceId, ws)),
    db
      .select({ clientId: emailThreads.clientId, dealId: emailThreads.dealId, createdAt: emailThreads.createdAt, lastInboundAt: emailThreads.lastInboundAt, readAt: emailThreads.readAt })
      .from(emailThreads)
      .where(and(eq(emailThreads.workspaceId, ws), isNull(emailThreads.archivedAt))),
    owner
      ? db
          .select({ id: commissionStatements.id, status: commissionStatements.status, totalCents: commissionStatements.totalCents, periodStart: commissionStatements.periodStart, name: repProfiles.displayName, createdAt: commissionStatements.createdAt })
          .from(commissionStatements)
          .leftJoin(repProfiles, eq(repProfiles.membershipId, commissionStatements.repMembershipId))
          .where(and(eq(commissionStatements.workspaceId, ws), inArray(commissionStatements.status, ["draft", "approved"])))
      : Promise.resolve([]),
    owner
      ? db
          .select({ invoiceId: events.subjectId, payload: events.payload, at: events.createdAt })
          .from(events)
          .where(and(eq(events.workspaceId, ws), eq(events.verb, "commission.needs_attention"), gte(events.createdAt, monthAgo)))
      : Promise.resolve([]),
    db
      .select({
        verb: events.verb,
        actor: events.actorId,
        won: sql<boolean>`coalesce(${events.payload}->>'to' = 'won', false)`,
        n: sql<number>`count(*)::int`,
      })
      .from(events)
      .where(
        and(
          eq(events.workspaceId, ws),
          gte(events.createdAt, weekAgo),
          inArray(events.verb, ["deal.call_logged", "deal.email_sent", "deal.created", "deal.stage_changed", "deal.updated"]),
        ),
      )
      .groupBy(events.verb, events.actorId, sql`3`),
    db
      .select({ id: deals.id, company: deals.company, meetingAt: deals.meetingAt, ownerEmail: deals.ownerEmail, rep: repProfiles.displayName })
      .from(deals)
      .leftJoin(repProfiles, eq(repProfiles.membershipId, deals.repMembershipId))
      .where(
        and(
          eq(deals.workspaceId, ws),
          ne(deals.stage, "lost"),
          isNotNull(deals.meetingAt),
          gte(deals.meetingAt, new Date(now.getTime() - 2 * 3_600_000)),
          lte(deals.meetingAt, new Date(now.getTime() + 7 * DAY)),
        ),
      )
      .orderBy(asc(deals.meetingAt)),
  ]);

  // Commission flags close once the ledger has a later entry for the invoice.
  const flagInvoiceIds = [...new Set(flags.map((f) => f.invoiceId).filter((id): id is string => !!id))];
  const ledger = flagInvoiceIds.length
    ? await db
        .select({ invoiceId: commissionEntries.invoiceId, at: max(commissionEntries.createdAt) })
        .from(commissionEntries)
        .where(and(eq(commissionEntries.workspaceId, ws), inArray(commissionEntries.invoiceId, flagInvoiceIds)))
        .groupBy(commissionEntries.invoiceId)
    : [];

  const emailOf = new Map(staffRows.flatMap((s) => (s.userId ? [[s.userId, s.email.toLowerCase()] as const] : [])));
  const waitingBy = new Map(waiting.map((w) => [w.projectId, Number(w.n)]));
  const lastBy = new Map(lastUpdates.map((u) => [u.projectId, u.last]));
  const visitBy = new Map(clientVisits.map((v) => [v.clientId, v]));
  const projectById = new Map(projectRows.flatMap((r) => (r.project ? [[r.project.id, r.project] as const] : [])));
  const clientById = new Map(projectRows.map((r) => [r.client.id, r.client]));
  const dealById = new Map(pipeline.dealRows.map((d) => [d.id, d]));
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

  // ---------- The queue ----------
  const queue: QueueItem[] = [];
  const push = (item: QueueItem) => queue.push(item);

  for (const f of followUps) {
    if (f.kind === "deal") {
      const deal = dealById.get(f.id);
      if (deal && (deal.stage === "lost" || deal.stage === "won")) continue;
    }
    push({
      key: `fu-${f.kind}-${f.id}`,
      tier: followUpTier(f.dueOn, today),
      source: "follow_up",
      owner: f.owner,
      text: `Follow up with ${f.name}`,
      detail: [lateLabel(f.dueOn, today), f.note].filter(Boolean).join(" · "),
      href: f.href,
      at: f.dueOn,
    });
  }

  for (const m of meetings) {
    const day = m.meetingAt!.toISOString().slice(0, 10);
    push({
      key: `meet-${m.id}`,
      tier: day <= today ? "today" : "week",
      source: "meeting",
      owner: null,
      text: `Scope call with ${m.company}`,
      detail: `${formatDateTime(m.meetingAt!)}${m.rep ? ` · booked by ${m.rep}` : ""}`,
      href: `/admin/clients?deal=${m.id}`,
      at: iso(m.meetingAt),
    });
  }

  for (const { invoice, project } of openInvoices) {
    if (invoice.dueOn > today) continue;
    const overdue = invoice.dueOn < today;
    push({
      key: `inv-${invoice.id}`,
      tier: overdue ? "now" : "today",
      source: "invoice",
      owner: null,
      text: `${overdue ? "Overdue" : "Due today"}: invoice ${invoice.number} · ${formatMoney(invoice.amountCents, invoice.currency)}`,
      detail: `${clientById.get(project.clientId)?.name ?? project.name}${overdue ? ` · ${lateLabel(invoice.dueOn, today)}` : ""}`,
      href: `/projects/${project.id}/billing/invoices/${invoice.id}`,
      at: invoice.dueOn,
    });
  }

  for (const s of statements) {
    const draft = s.status === "draft";
    push({
      key: `stmt-${s.id}`,
      tier: "now",
      source: "commission",
      owner: me.toLowerCase(),
      text: `${draft ? "Approve" : "Pay"} ${s.name ?? "a"} commission statement · ${formatMoney(s.totalCents)}`,
      detail: draft ? `${formatMonth(s.periodStart)} · waiting for your approval` : `${formatMonth(s.periodStart)} · approved, not yet marked paid`,
      href: "/admin/commissions",
      at: iso(s.createdAt),
    });
  }

  const flagRows = flags.flatMap((f) => {
    if (!f.invoiceId) return [];
    const p = (f.payload ?? {}) as { invoice?: unknown; reason?: unknown };
    return [{ invoiceId: f.invoiceId, number: typeof p.invoice === "string" ? p.invoice : null, reason: typeof p.reason === "string" ? p.reason : null, at: f.at.toISOString() }];
  });
  const ledgerAt = new Map(ledger.flatMap((l) => (l.invoiceId && l.at ? [[l.invoiceId, new Date(l.at).toISOString()] as const] : [])));
  for (const f of openCommissionFlags(flagRows, ledgerAt)) {
    push({
      key: `flag-${f.invoiceId}`,
      tier: "now",
      source: "commission",
      owner: me.toLowerCase(),
      text: `Commission review required${f.number ? `: invoice ${f.number}` : ""}`,
      detail: f.reason,
      href: "/admin/commissions",
      at: f.at,
    });
  }

  for (const { request, project } of newRequests) {
    const urgent = request.priority === "urgent";
    push({
      key: `req-${request.id}`,
      tier: urgent ? "now" : "today",
      source: "request",
      owner: null,
      text: `${urgent ? "Urgent request" : "New request"}: ${request.title}`,
      detail: project.name,
      href: `/projects/${project.id}/support#r-${request.id}`,
      at: iso(request.createdAt),
    });
  }

  for (const { approval, project } of pendingApprovals) {
    push({
      key: `ap-${approval.id}`,
      tier: "now",
      source: "approval",
      owner: null,
      text: `Changes requested on ${project.name}`,
      detail: approval.note ? `“${approval.note.slice(0, 80)}”` : null,
      href: `/projects/${project.id}/review`,
      at: iso(approval.decidedAt ?? approval.createdAt),
    });
  }

  for (const { idea, project } of warmIdeas) {
    push({
      key: `idea-${idea.id}`,
      tier: "today",
      source: "idea",
      owner: null,
      text: `Warm lead: ${project.name} wants “${idea.title}”`,
      href: `/projects/${project.id}/results#ideas`,
      at: iso(idea.respondedAt ?? idea.createdAt),
    });
  }

  for (const r of newReferrals) {
    push({ key: `ref-${r.id}`, tier: "today", source: "referral", owner: null, text: `New referral: ${r.name}`, detail: r.email, href: "/admin/settings#referrals", at: iso(r.createdAt) });
  }

  for (const { doc, pending } of unsigned) {
    const n = Number(pending);
    push({
      key: `doc-${doc.id}`,
      tier: "week",
      source: "document",
      owner: null,
      text: `${doc.title}: ${n} signature${n === 1 ? "" : "s"} outstanding`,
      detail: "Out for 3+ days",
      href: `/projects/${doc.projectId}/documents/${doc.id}`,
      at: iso(doc.createdAt),
    });
  }

  for (const f of openMustFix) {
    const n = Number(f.n);
    push({ key: `fix-${f.projectId}`, tier: "week", source: "feedback", owner: null, text: `${n} must-fix comment${n === 1 ? "" : "s"} open on ${projectById.get(f.projectId)?.name ?? "a project"}`, href: `/projects/${f.projectId}/review` });
  }

  for (const { onboarding: o, client } of onboardingRows) {
    const idle = Math.floor((now.getTime() - (o.lastActivityAt ?? o.welcomeSentAt ?? o.createdAt).getTime()) / DAY);
    if (!o.welcomeSentAt) {
      push({ key: `ob-draft-${o.id}`, tier: "now", source: "onboarding", owner: null, text: `Send the welcome to ${client.name}`, detail: "Set up, not sent yet", href: `/admin/onboard/${o.projectId}`, at: iso(o.createdAt) });
    } else if (o.status === "completed" && o.completedAt && now.getTime() - o.completedAt.getTime() < 7 * DAY) {
      push({ key: `ob-done-${o.id}`, tier: "today", source: "onboarding", owner: null, text: `Brief ready: ${client.name} finished onboarding`, href: `/admin/projects/${o.projectId}/brief`, at: iso(o.completedAt) });
    } else if (o.status !== "completed" && idle >= 3) {
      push({ key: `ob-idle-${o.id}`, tier: idle >= 5 ? "today" : "week", source: "onboarding", owner: null, text: `${client.name} paused onboarding`, detail: `${idle} days without activity`, href: "/admin/onboard", at: iso(o.lastActivityAt ?? o.createdAt) });
    }
    if (o.recapConfirmed === false && o.status !== "completed") {
      push({ key: `ob-recap-${o.id}`, tier: "now", source: "onboarding", owner: null, text: `${client.name} added to the call recap`, href: `/admin/projects/${o.projectId}/brief` });
    }
  }

  for (const client of clientById.values()) {
    if (visitBy.get(client.id)?.people) continue;
    push({ key: `contact-${client.id}`, tier: "week", source: "contact", owner: null, text: `Add a contact for ${client.name}`, detail: "No one can receive invoices or updates", href: `/admin/clients/${client.id}#invite-title` });
  }

  // Sales: stalled deals and bounced outreach.
  for (const card of pipeline.columns.flatMap((c) => c.cards)) {
    if (card.type !== "deal" || (card.column !== "proposal_sent" && card.column !== "negotiation")) continue;
    if (!isStalled(card.column, card.since, now)) continue;
    const days = Math.floor((now.getTime() - card.since.getTime()) / DAY);
    push({
      key: `stall-${card.id}`,
      tier: "week",
      source: "deal",
      owner: card.ownerEmail?.toLowerCase() ?? null,
      text: `${card.company} has sat in ${card.column === "negotiation" ? "Negotiation" : "Proposal sent"} for ${days} days`,
      detail: card.valueCents ? formatMoney(card.valueCents) : null,
      href: `/admin/clients?deal=${card.id}`,
      at: iso(card.since),
    });
  }

  const outreach30 = outreachInPeriod(outreachLog, "30d", now);
  const bouncedSeen = new Set<string>();
  for (const row of outreach30) {
    if (!row.dealId || (row.status !== "bounced" && row.status !== "complained") || bouncedSeen.has(row.dealId)) continue;
    const deal = dealById.get(row.dealId);
    // Gone once the lead is closed or has a different address on file.
    if (!deal || deal.stage === "lost" || deal.stage === "won") continue;
    if (row.to && deal.contactEmail && deal.contactEmail.trim().toLowerCase() !== row.to.trim().toLowerCase()) continue;
    bouncedSeen.add(row.dealId);
    push({
      key: `bounce-${row.dealId}`,
      tier: "today",
      source: "outreach",
      owner: deal.ownerEmail?.toLowerCase() ?? null,
      text: row.status === "bounced" ? `Email to ${deal.company} bounced` : `${deal.company} marked our email as spam`,
      detail: row.status === "bounced" ? `Find a working address for ${row.to ?? "this lead"}` : "Do not email again",
      href: `/admin/clients?deal=${row.dealId}`,
      at: row.lastActivity,
    });
  }

  // Inbox roll-ups: one line each, not one per thread.
  const unfiled = inboxRows.filter((t) => !t.clientId && !t.dealId);
  const unfiledOld = unfiled.filter((t) => t.createdAt.getTime() < now.getTime() - DAY);
  const unread = inboxRows.filter((t) => t.lastInboundAt && (!t.readAt || t.readAt < t.lastInboundAt));
  if (unread.length) {
    const oldest = unread.reduce((a, b) => (a.lastInboundAt! < b.lastInboundAt! ? a : b));
    push({ key: "inbox-unread", tier: "today", source: "inbox", owner: null, text: `${unread.length} unread email${unread.length === 1 ? "" : "s"} in the Inbox`, href: "/admin/inbox", at: iso(oldest.lastInboundAt) });
  }
  if (unfiledOld.length) {
    push({ key: "inbox-unfiled", tier: "week", source: "inbox", owner: null, text: `${unfiledOld.length} conversation${unfiledOld.length === 1 ? "" : "s"} still need a client`, detail: "Filed threads show on the client's page", href: "/admin/inbox" });
  }

  // ---------- Pulse ----------
  const goalRow = workspace[0];
  const goal = goalRow?.goalYear === Number(today.slice(0, 4)) ? goalRow.goalCents : null;
  const pace = goalPace(ytdCents, goal, today);
  const lastMonthCents = monthly.length >= 2 ? monthly[monthly.length - 2].value.cents : 0;
  const openDeals = pipeline.columns.filter((c) => PRESALE.includes(c.key)).flatMap((c) => c.cards);
  const myFollowUps = followUps.filter((f) => f.owner === me.toLowerCase() || f.owner === null).length;

  // ---------- Sales desk ----------
  const stages = pipeline.columns
    .filter((c) => (PRESALE as readonly ColumnKey[]).includes(c.key))
    .map((c) => ({ key: c.key, label: c.label, count: c.cards.length, cents: c.totalCents }));
  const wonThisMonth = pipeline.dealRows.filter((d) => d.wonAt && d.wonAt.toISOString().slice(0, 10) >= monthStart);

  const queueCards = pipeline.dealRows
    .filter((d) => queueable(d, today))
    .map((d) => {
      const brief = readBrief(d.brief) ?? parseBrief(d.notes).brief;
      const zone = zoneFor(d);
      return {
        id: d.id,
        company: d.company,
        owner: d.ownerEmail?.toLowerCase() ?? null,
        zone,
        callable: isCallable(zone, now),
        followUp: followUpState(d.nextStepOn, today),
        tag: brief?.tag ?? null,
        reason: brief?.why ?? brief?.upgradeAngle ?? null,
        priority: callPriority({ brief, followUp: followUpState(d.nextStepOn, today), contacted: !!d.lastContactedAt }),
      };
    })
    .sort((a, b) => Number(b.callable) - Number(a.callable) || a.priority - b.priority);

  const counts: ActivityCount[] = [];
  for (const row of activity) {
    const actor = row.actor ? emailOf.get(row.actor) ?? null : null;
    if (row.won) counts.push({ verb: "deal.won", actor, n: Number(row.n) });
    if (row.verb === "deal.call_logged" || row.verb === "deal.email_sent" || row.verb === "deal.created") counts.push({ verb: row.verb, actor, n: Number(row.n) });
  }

  let outreachBlocked = false;
  try {
    outreachConfig();
  } catch {
    outreachBlocked = true;
  }

  // ---------- Delivery ----------
  const progressBy = new Map(
    pipeline.columns.flatMap((c) => c.cards).flatMap((card) => (card.type === "project" && card.progress ? [[card.id, card.progress] as const] : [])),
  );
  const projectsInMotion = [...projectById.values()]
    .filter((p) => p.status !== "launched" && p.status !== "paused")
    .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
    .map((p) => {
      const last = lastBy.get(p.id);
      const stale = !last || now.getTime() - new Date(last).getTime() > STALE_UPDATE_DAYS * DAY;
      const invoice = openInvoices.find((row) => row.project.id === p.id);
      const next = invoice
        ? { label: "Review invoice", href: `/projects/${p.id}/billing` }
        : stale
          ? { label: "Post an update", href: `/projects/${p.id}` }
          : { label: waitingBy.get(p.id) ? "Review client tasks" : "Open project", href: `/projects/${p.id}` };
      const seen = visitBy.get(p.clientId)?.last ?? null;
      return { project: p, clientName: clientById.get(p.clientId)?.name ?? "", progress: progressBy.get(p.id) ?? null, clientLastSeen: seen ? new Date(seen) : null, next };
    });

  const payments = [...openInvoices]
    .sort((a, b) => a.invoice.dueOn.localeCompare(b.invoice.dueOn))
    .slice(0, 5)
    .map(({ invoice, project }) => ({ invoice, project, clientName: clientById.get(project.clientId)?.name ?? project.name }));

  const setups = onboardingRows.filter(({ onboarding: o }) => o.status !== "completed").slice(0, 4);

  return {
    queue,
    pulse: {
      bankCents: live.balanceCents,
      bankSource: live.balanceSource,
      collectedMonthCents: live.collectedMonthCents,
      lastMonthCents,
      ytdCents,
      goalCents: goal,
      pace,
      weightedPipelineCents: live.openPipelineCents,
      openDealCount: openDeals.length,
      openDealCents: openDeals.reduce((n, c) => n + c.valueCents, 0),
      owed,
      followUpsMine: myFollowUps,
      followUpsTeam: followUps.length,
      inboxUnfiled: unfiled.length,
      inboxUnread: unread.length,
    },
    sales: {
      stages,
      wonThisMonth: { count: wonThisMonth.length, cents: wonThisMonth.reduce((n, d) => n + (d.valueCents ?? 0), 0) },
      nextCalls: queueCards.slice(0, 5),
      callableNow: queueCards.filter((c) => c.callable).length,
      queueSize: queueCards.length,
      activity: weeklyActivity(counts),
      outreach: { ...summarize(outreach30), blocked: outreachBlocked },
    },
    delivery: { projects: projectsInMotion, payments, setups },
    money: {
      monthly: monthly.map((b) => ({ key: b.key, cents: b.value.cents })),
      nextPayout: payouts.ok ? payouts.data.next : null,
      payoutsOk: payouts.ok,
      commissionOwedCents: leaders.reduce((n, l) => n + (l.owedCents ?? 0), 0),
      race: leaders.filter((l) => l.collectedCents || l.dealsWon || l.email),
    },
    feed: live.events.slice(0, 12),
  };
}

export type Overview = Awaited<ReturnType<typeof loadOverview>>;

