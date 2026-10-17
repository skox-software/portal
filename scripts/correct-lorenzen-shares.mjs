/** Audited, guarded correction requested by Reiss. Dry run unless --apply.
 * node --env-file=.env.local scripts/correct-lorenzen-shares.mjs [--apply]
 * Never sends money, emails or changes bank balances.
 */
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");
const founders = ["reiss@skoxsoftware.com", "founders@skoxsoftware.com"];
const members = await sql`select id,workspace_id,email,role from memberships where email=any(${founders}) and client_id is null and role in ('staff','staff_owner')`;
if (members.length !== 2 || new Set(members.map(m => m.workspace_id)).size !== 1) throw new Error("Expected the two confirmed founders in one workspace");
const ws = members[0].workspace_id;
const reiss = members.find(m => m.email === founders[0]);
const josh = members.find(m => m.email === founders[1]);
const rows = await sql`
  select e.id,e.amount_cents,e.rate_bps,e.status,e.statement_id,i.id as invoice_id,i.number,i.amount_cents as invoice_cents,i.paid_at,s.status as statement_status
  from commission_entries e join invoices i on i.id=e.invoice_id
  join projects p on p.id=i.project_id join clients c on c.id=p.client_id
  left join commission_statements s on s.id=e.statement_id
  where e.workspace_id=${ws} and c.name='Lorenzen Motors' and e.rep_membership_id=${reiss.id} and e.kind='earned'
    and i.status='paid' and p.rep_membership_id=${reiss.id} and e.earned_at=i.paid_at`;
if (rows.length !== 2 || rows.reduce((sum,r)=>sum+r.invoice_cents,0)!==125000) throw new Error("Lorenzen invoice scope changed; inspect before applying");
if (rows.some(r=>r.status!=='pending' || (r.statement_id && r.statement_status!=='draft') || ![5000,10000].includes(r.rate_bps))) throw new Error("Only pending earnings and draft statements can be corrected here");
const ids=rows.map(r=>r.id);
const invoiceIds=rows.map(r=>r.invoice_id);
if ((await sql`select id from invoice_refunds where invoice_id=any(${invoiceIds}::uuid[])`).length) throw new Error("Refunds need reconciliation before applying");
console.log(JSON.stringify({mode:apply?'apply':'dry run',workspace:ws,founders:members.map(m=>({email:m.email,id:m.id})),invoices:rows.map(r=>({number:r.number,before:r.amount_cents,after:r.invoice_cents,statement:r.statement_id})),earnedTotalCents:125000,businessExpenseDeductionCents:0},null,2));
if (!apply) process.exit(0);
await sql.transaction([
  sql`lock table commission_entries,commission_statements,rep_profiles,invoice_refunds,invoices,projects in share row exclusive mode`,
  sql`select 1 / case when count(*)=2 and sum(i.amount_cents)=125000 then 1 else 0 end as guard
    from commission_entries e join invoices i on i.id=e.invoice_id join projects p on p.id=i.project_id
    left join commission_statements s on s.id=e.statement_id
    where e.id=any(${ids}::uuid[]) and e.status='pending' and e.earned_at=i.paid_at and i.status='paid' and p.rep_membership_id=${reiss.id}
      and (e.statement_id is null or s.status='draft') and not exists(select 1 from invoice_refunds r where r.invoice_id=i.id)`,
  sql`with changed as (
    update commission_entries e set rate_bps=10000,amount_cents=i.amount_cents,note=concat(e.note,' · corrected to 100% gross owner share; business expenses separate')
    from invoices i where e.invoice_id=i.id and e.id=any(${ids}::uuid[]) and (e.rate_bps<>10000 or e.amount_cents<>i.amount_cents)
    returning e.*
  ) insert into events(workspace_id,project_id,actor_id,verb,subject_type,subject_id,payload)
    select workspace_id,project_id,'reiss-request:deal-ownership-2026-10-17','commission.corrected','commission',id::text,
      jsonb_build_object('previousRateBps',5000,'previousAmountCents',base_cents/2,'rateBps',rate_bps,'amountCents',amount_cents,'reason','Founder-owned deal earns 100% before business expenses') from changed`,
  sql`with changed as (
    update commission_statements s set total_cents=(select coalesce(sum(e.amount_cents),0)::int from commission_entries e where e.statement_id=s.id and e.status<>'void')
    where s.status='draft' and s.id in (select statement_id from commission_entries where id=any(${ids}::uuid[]))
      and s.total_cents<>(select coalesce(sum(e.amount_cents),0)::int from commission_entries e where e.statement_id=s.id and e.status<>'void') returning s.*
  ) insert into events(workspace_id,actor_id,verb,subject_type,subject_id,payload)
    select workspace_id,'reiss-request:deal-ownership-2026-10-17','statement.corrected','statement',id::text,jsonb_build_object('totalCents',total_cents,'reason','100% founder ownership correction') from changed`,
  sql`with changed as (
    insert into rep_profiles(workspace_id,membership_id,display_name,rate_bps,status)
    values (${ws},${reiss.id},'Reiss',10000,'active'),(${ws},${josh.id},'Josh',10000,'active')
    on conflict(membership_id) do update set rate_bps=10000,display_name=excluded.display_name
    where rep_profiles.rate_bps<>10000 or rep_profiles.display_name<>excluded.display_name returning *
  ) insert into events(workspace_id,actor_id,verb,subject_type,subject_id,payload)
    select workspace_id,'reiss-request:deal-ownership-2026-10-17','rep.updated','membership',membership_id::text,jsonb_build_object('name',display_name,'rateBps',10000,'reason','100% on own deals; 40% on rep deals') from changed`,
  sql`with changed as (
    update rep_profiles p set rate_bps=2000 from memberships m where p.membership_id=m.id and p.workspace_id=${ws} and m.role='rep' and p.rate_bps<>2000 returning p.*
  ) insert into events(workspace_id,actor_id,verb,subject_type,subject_id,payload)
    select workspace_id,'reiss-request:deal-ownership-2026-10-17','rep.rate_changed','membership',membership_id::text,jsonb_build_object('rateBps',2000,'reason','20% on rep-closed deals') from changed`,
]);
console.log('Correction committed. No payouts or expense records changed.');
