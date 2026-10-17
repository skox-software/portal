/**
 * Moves the call brief out of `deals.notes` into `deals.brief`.
 *
 *   node --env-file=.env.local scripts/backfill-briefs.mts                 # dry run
 *   node --env-file=.env.local scripts/backfill-briefs.mts --apply         # fill `brief` only
 *   node --env-file=.env.local scripts/backfill-briefs.mts --strip-notes   # also take the brief lines out of notes
 *
 * `--apply` is safe while the old panel is still live: it fills the new
 * column and leaves notes as they are. Run `--strip-notes` after the panel
 * that shows the brief card is deployed, so notes hold only the seller's own
 * writing. The new panel hides brief lines from notes either way.
 *
 * Only deals with no brief yet are filled, so it's safe to re-run. A deal
 * whose notes have no labeled lines is left alone.
 */
import { neon } from "@neondatabase/serverless";
import { parseBrief } from "../lib/call-brief.ts";

const APPLY = process.argv.includes("--apply") || process.argv.includes("--strip-notes");
const STRIP = process.argv.includes("--strip-notes");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/backfill-briefs.mts");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const rows = (await sql`select id, company, notes, brief from deals where notes is not null`) as {
  id: string;
  company: string;
  notes: string;
  brief: unknown;
}[];

let filled = 0;
let stripped = 0;
for (const d of rows) {
  const { brief, rest } = parseBrief(d.notes);
  if (!brief) continue;
  const fill = !d.brief;
  if (!fill && !STRIP) continue;
  console.log(`  ${fill ? "brief" : "     "}${STRIP ? " +strip" : ""}  ${d.company}${brief.tag ? ` · ${brief.tag}` : ""}${brief.warnings?.length ? " · WARNING" : ""}${rest ? ` · keeps notes: ${rest.replace(/\s+/g, " ").slice(0, 60)}` : ""}`);
  if (APPLY) {
    if (fill && STRIP) await sql`update deals set brief = ${JSON.stringify(brief)}::jsonb, notes = ${rest || null} where id = ${d.id}`;
    else if (fill) await sql`update deals set brief = ${JSON.stringify(brief)}::jsonb where id = ${d.id}`;
    else await sql`update deals set notes = ${rest || null} where id = ${d.id}`;
  }
  if (fill) filled++;
  if (STRIP) stripped++;
}
console.log(`\n${APPLY ? "" : "Dry run: "}${filled} briefs ${APPLY ? "filled" : "to fill"}${STRIP ? `, ${stripped} notes ${APPLY ? "stripped" : "to strip"}` : ""}.`);
if (!APPLY) console.log("Add --apply to write the briefs, or --strip-notes to also clean notes.");
