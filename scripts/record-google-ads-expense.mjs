/** User-confirmed existing spend; records allocation only. Does not send money. */
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const ws = 'bdefd952-a3bc-45d2-a0a1-65374fd9dc72';
const member = '2683ab00-0934-4c3a-9aa1-dab80614fd77';
const reference = 'google-ads-confirmed-2026-10-17';
const found = await sql`select id from memberships where id=${member} and workspace_id=${ws} and email='reiss@skoxsoftware.com' and role in ('staff','staff_owner')`;
if (found.length !== 1) throw new Error('Confirmed founder membership not found');
console.log('Record $300 Google Ads against Reiss withdrawals only; preserve gross earnings.');
if (!process.argv.includes('--apply')) { console.log('Dry run; pass --apply to record.'); process.exit(0); }
await sql.transaction([
  sql`with added as (
    insert into withdrawal_expenses(workspace_id,membership_id,reference,description,amount_cents)
    values (${ws},${member},${reference},'Google Ads · allocated to Reiss',30000)
    on conflict(workspace_id,reference) do nothing returning *
  ) insert into events(workspace_id,actor_id,verb,subject_type,subject_id,payload)
    select workspace_id,'reiss-request:withdrawal-expense-2026-10-17','finance.expense_recorded','withdrawal_expense',id::text,
    jsonb_build_object('membershipId',membership_id,'amountCents',amount_cents,'description',description,'reason','Existing spend confirmed by Reiss; reduce only his available withdrawal') from added`,
  sql`select 1 / case when count(*)=1 then 1 else 0 end from withdrawal_expenses where workspace_id=${ws} and reference=${reference} and membership_id=${member} and amount_cents=30000`,
]);
console.log('Verified one $300 expense record. No payment executed.');
