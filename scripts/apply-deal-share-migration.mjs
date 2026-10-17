/** Apply only 0015 after checking the deployed 0014 baseline; no old migrations replayed. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
const sql=neon(process.env.DATABASE_URL);
const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
const migration=journal.entries.find(e=>e.tag==='0015_deal_ownership_shares');
const source=readFileSync(new URL('../drizzle/0015_deal_ownership_shares.sql',import.meta.url),'utf8');
const hash=createHash('sha256').update(source).digest('hex');
const previousHash=createHash('sha256').update(readFileSync(new URL('../drizzle/0014_revenue_goal.sql',import.meta.url))).digest('hex');
const [latest]=await sql`select hash,created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`;
if(latest?.hash===hash){console.log('0015 already applied');process.exit(0);}
if(latest?.hash!==previousHash) throw new Error('Unexpected deployed migration; inspect before applying');
console.log('Verified 0014 baseline. 0015 adds per-recipient payment/refund uniqueness and idempotent reversal IDs.');
if(!process.argv.includes('--apply')){console.log('Dry run; pass --apply to migrate.');process.exit(0);}
await sql.transaction([
 sql`select pg_advisory_xact_lock(hashtextextended('skox:deal-share-migration',0))`,
 sql`select 1 / case when hash=${previousHash} then 1 else 0 end from drizzle.__drizzle_migrations order by created_at desc limit 1`,
 ...source.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean).map(s=>sql.query(s)),
 sql`insert into drizzle.__drizzle_migrations(hash,created_at) values (${hash},${migration.when})`,
]);
console.log('0015 committed with migration journal entry.');
