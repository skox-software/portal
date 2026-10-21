// Dry run for migration 0022: what retiring "Emailed" would move, and the signals and close
// reasons it would backfill. Read-only (SELECTs only).
//   DATABASE_URL=… node scripts/two-track-dry-run.mjs
// Works before the migration (counts what it would do) and after it (counts what the backup table recorded).
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const replied = `NOT d.do_not_email AND EXISTS (SELECT 1 FROM email_messages m JOIN email_threads t ON t.id = m.thread_id WHERE t.deal_id = d.id AND m.direction = 'inbound')`;
const lastOutcome = `(SELECT e.payload->>'outcome' FROM events e WHERE e.subject_type = 'deal' AND e.subject_id = d.id::text AND e.verb = 'deal.call_logged' ORDER BY e.created_at DESC LIMIT 1)`;
const attempts = `(SELECT count(*) FROM events e WHERE e.subject_type = 'deal' AND e.subject_id = d.id::text AND (e.verb IN ('deal.email_sent', 'deal.email_scheduled') OR (e.verb = 'deal.call_logged' AND e.payload->>'outcome' IS NOT NULL)))`;

const [{ applied }] = await sql`SELECT to_regclass('public.deal_stage_backup_0022') IS NOT NULL AS applied`;
if (applied) {
  const rows = await sql.query(`SELECT b.stage AS from_stage, d.stage::text AS to_stage, count(*)::int AS n FROM deal_stage_backup_0022 b JOIN deals d ON d.id = b.deal_id GROUP BY 1, 2 ORDER BY 3 DESC`);
  console.log("Migration 0022 is applied. Moved rows recorded in deal_stage_backup_0022:");
  console.table(rows);
  process.exit(0);
}

const moves = await sql.query(`SELECT 'emailed' AS from_stage, CASE
    WHEN d.meeting_at IS NOT NULL THEN 'meeting'
    WHEN ${replied} THEN 'replied'
    WHEN ${lastOutcome} = 'not_interested' THEN 'outreach_closed'
    ELSE 'outreach_' || least(greatest(${attempts} + 1, 1), 4)::text
  END AS to_stage, count(*)::int AS n
  FROM deals d WHERE d.stage::text = 'emailed' GROUP BY 2 ORDER BY 3 DESC`);
const stages = await sql`SELECT stage::text AS stage, count(*)::int AS n FROM deals GROUP BY 1 ORDER BY 1`;
const signals = await sql.query(`SELECT CASE
    WHEN d.source = 'website' THEN 'inbound'
    WHEN ${replied} THEN 'replied'
    WHEN d.meeting_at IS NOT NULL THEN 'meeting'
    ELSE '(unknown, left empty)'
  END AS signal, count(*)::int AS n
  FROM deals d WHERE d.stage::text IN ('replied', 'meeting', 'proposal_sent', 'won') GROUP BY 1 ORDER BY 2 DESC`);
const closes = await sql.query(`SELECT CASE
    WHEN ${lastOutcome} = 'not_interested' THEN 'not_interested'
    WHEN d.bad_number THEN 'bad_number'
    ELSE '(unknown, left empty)'
  END AS close_reason, count(*)::int AS n
  FROM deals d WHERE d.stage::text = 'outreach_closed' OR (d.stage::text = 'emailed' AND ${lastOutcome} = 'not_interested') GROUP BY 1 ORDER BY 2 DESC`);

console.log("DRY RUN, nothing changed.\n\nDeals by stage now:");
console.table(stages);
console.log(`Emailed deals that would move (${moves.reduce((n, r) => n + r.n, 0)} rows):`);
console.table(moves);
console.log("Promotion signal backfilled on Pipeline deals:");
console.table(signals);
console.log("Close reason backfilled on Closed leads:");
console.table(closes);
