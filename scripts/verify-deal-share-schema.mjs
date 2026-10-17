/** Tests migration and retry constraints using transaction-local temporary tables only. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {neon} from '@neondatabase/serverless';
const sql=neon(process.env.DATABASE_URL);
const statements=readFileSync(new URL('../drizzle/0015_deal_ownership_shares.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
const insertEarnings=sql`insert into commission_entries(invoice_id,earned_at,rep_membership_id,kind,amount_cents) select '00000000-0000-0000-0000-000000000001', '2026-10-17'::timestamptz, id::uuid,'earned',cents from (values ('00000000-0000-0000-0000-000000000010',200),('00000000-0000-0000-0000-000000000020',400),('00000000-0000-0000-0000-000000000030',400)) x(id,cents) on conflict do nothing`;
const insertRefunds=sql`insert into commission_entries(refund_id,earned_at,rep_membership_id,kind,amount_cents) select '00000000-0000-0000-0000-000000000099','2026-10-18'::timestamptz,rep_membership_id,'clawback',-amount_cents from commission_entries where kind='earned' on conflict do nothing`;
const out=await sql.transaction([
 sql`create temporary table commission_entries(invoice_id uuid,earned_at timestamptz,rep_membership_id uuid,kind text,amount_cents int,refund_id uuid constraint commission_entries_refund_id_unique unique) on commit drop`,
 sql`create unique index commission_entries_earned_payment_key on commission_entries(invoice_id,earned_at) where kind='earned'`,
 ...statements.map(s=>sql.query(s)),insertEarnings,insertEarnings,insertRefunds,insertRefunds,
 sql`select kind,count(*)::int as count,sum(amount_cents)::int as cents from commission_entries group by kind order by kind`,
]);
assert.deepEqual(out.at(-1),[{kind:'clawback',count:3,cents:-1000},{kind:'earned',count:3,cents:1000}]);
console.log('PASS: three recipients; duplicate payment and refund retries do not duplicate earnings; refund clears every share. Temporary tables dropped at commit.');
