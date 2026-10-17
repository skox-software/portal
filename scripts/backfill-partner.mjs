/**
 * One-off: credit a staff partner (Reiss) for deals he already closed.
 *
 *   node --env-file=.env.local scripts/backfill-partner.mjs            # dry run: prints what it would do
 *   node --env-file=.env.local scripts/backfill-partner.mjs --apply    # writes
 *   ... --email=someone@skoxsoftware.com                                # another partner
 *
 * For every deal the partner owns that became a project:
 *   1. the project's credited rep is set to the partner, only where it's empty
 *      (a project already credited to someone else is reported and left alone);
 *   2. each paid invoice on those projects earns one `earned` ledger line at the
 *      partner's rate on the full invoice amount, plus a `commission.earned`
 *      event, exactly as lib/commissions.ts recordEarning would write them.
 *
 * Safe to re-run: an invoice already credited for the same paid-at time is
 * skipped (the same (invoice_id, earned_at) rule the ledger's unique index
 * enforces). The partner needs an active commission profile first: add it
 * on /admin/reps ("Add a partner share").
 *
 * Plain SQL rather than recordEarning itself, because that lives in
 * TypeScript behind the app's `@/` imports, which plain node can't load.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const EMAIL = (process.argv.find((a) => a.startsWith("--email="))?.slice(8) ?? "reiss@skoxsoftware.com").trim().toLowerCase();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/backfill-partner.mjs");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

/** Same rounding as lib/commission-math.ts commissionCents: half up to the cent. */
function commissionCents(baseCents, rateBps) {
  return Math.round((baseCents * rateBps) / 10_000);
}
const money = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function earnedSoFar(membershipId) {
  const [row] = await sql`
    select count(*)::int as lines, coalesce(sum(amount_cents), 0)::int as cents
    from commission_entries
    where rep_membership_id = ${membershipId} and kind = 'earned' and status <> 'void'`;
  return row;
}

const partners = await sql`
  select m.id, m.workspace_id, m.role, p.display_name, p.rate_bps, p.status
  from memberships m
  left join rep_profiles p on p.membership_id = m.id
  where lower(m.email) = ${EMAIL} and m.client_id is null and m.role in ('staff_owner', 'staff')`;

if (!partners.length) {
  console.error(`No staff membership for ${EMAIL}.`);
  process.exit(1);
}

console.log(`${APPLY ? "APPLYING" : "DRY RUN (pass --apply to write)"} for ${EMAIL}\n`);

for (const partner of partners) {
  if (!partner.rate_bps) {
    console.error(`Workspace ${partner.workspace_id}: ${EMAIL} has no partner share yet. Add it on /admin/reps first.`);
    continue;
  }
  if (partner.status !== "active") {
    console.error(`Workspace ${partner.workspace_id}: ${partner.display_name}'s profile is ${partner.status}; recordEarning would credit nothing. Skipping.`);
    continue;
  }
  console.log(`Workspace ${partner.workspace_id}: ${partner.display_name} at ${partner.rate_bps / 100}%`);
  const before = await earnedSoFar(partner.id);

  const projects = await sql`
    select pr.id, pr.name, pr.rep_membership_id, c.name as client_name, d.company
    from deals d
    join projects pr on pr.id = d.project_id
    join clients c on c.id = pr.client_id
    where d.workspace_id = ${partner.workspace_id} and lower(d.owner_email) = ${EMAIL}
    order by c.name`;

  const toCredit = projects.filter((p) => p.rep_membership_id === null);
  const already = projects.filter((p) => p.rep_membership_id === partner.id);
  const elsewhere = projects.filter((p) => p.rep_membership_id !== null && p.rep_membership_id !== partner.id);

  console.log(`\n  Projects from ${EMAIL}'s deals: ${projects.length}`);
  for (const p of toCredit) console.log(`    + credit   ${p.client_name} · ${p.name}`);
  for (const p of already) console.log(`    = already  ${p.client_name} · ${p.name}`);
  for (const p of elsewhere) console.log(`    ! skipped  ${p.client_name} · ${p.name} (credited to another rep, left as is)`);

  const mine = [...toCredit, ...already];
  const ids = mine.map((p) => p.id);
  const invoices = ids.length
    ? await sql`
        select i.id, i.workspace_id, i.project_id, i.number, i.amount_cents, i.paid_at, c.name as client_name,
          exists (
            select 1 from commission_entries e
            where e.invoice_id = i.id and e.earned_at = i.paid_at and e.kind = 'earned'
          ) as credited
        from invoices i
        join projects pr on pr.id = i.project_id
        join clients c on c.id = pr.client_id
        where i.project_id = any(${ids}::uuid[]) and i.status = 'paid' and i.paid_at is not null and i.amount_cents > 0
        order by i.paid_at`
    : [];

  const fresh = invoices.filter((i) => !i.credited);
  console.log(`\n  Paid invoices on those projects: ${invoices.length}`);
  for (const i of invoices) {
    const share = commissionCents(i.amount_cents, partner.rate_bps);
    console.log(`    ${i.credited ? "= already credited" : "+ would credit   "}  ${i.number}  ${i.client_name}  paid ${new Date(i.paid_at).toISOString().slice(0, 10)}  ${money(i.amount_cents)} -> ${money(share)}`);
  }
  const total = fresh.reduce((s, i) => s + commissionCents(i.amount_cents, partner.rate_bps), 0);
  console.log(`\n  New earnings: ${fresh.length} line(s), ${money(total)}`);
  console.log(`  Ledger before: ${before.lines} line(s), ${money(before.cents)}`);

  if (!APPLY) {
    console.log("");
    continue;
  }

  if (toCredit.length) {
    await sql`
      update projects set rep_membership_id = ${partner.id}
      where id = any(${toCredit.map((p) => p.id)}::uuid[]) and rep_membership_id is null`;
  }
  let written = 0;
  for (const i of fresh) {
    const share = commissionCents(i.amount_cents, partner.rate_bps);
    const payload = JSON.stringify({ invoice: i.number, amountCents: share, rateBps: partner.rate_bps, rep: partner.display_name });
    // The ledger insert and its event in one statement: the event only lands if the line did.
    const rows = await sql`
      with ins as (
        insert into commission_entries
          (workspace_id, rep_membership_id, project_id, invoice_id, kind, base_cents, rate_bps, amount_cents, earned_at, client_name, note, created_by)
        values
          (${i.workspace_id}, ${partner.id}, ${i.project_id}, ${i.id}, 'earned', ${i.amount_cents}, ${partner.rate_bps}, ${share}, ${i.paid_at}, ${i.client_name}, ${`Invoice ${i.number}`}, 'backfill')
        on conflict do nothing
        returning id
      )
      insert into events (workspace_id, project_id, actor_id, verb, subject_type, subject_id, payload)
      select ${i.workspace_id}, ${i.project_id}, 'backfill', 'commission.earned', 'commission', ins.id::text, ${payload}::jsonb
      from ins
      returning subject_id`;
    written += rows.length;
  }
  const after = await earnedSoFar(partner.id);
  console.log(`  Wrote ${written} line(s). Ledger after: ${after.lines} line(s), ${money(after.cents)}\n`);
}
