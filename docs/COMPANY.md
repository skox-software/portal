# The company

`/admin/company` shows UnBusy as a company: Josh at the top, Claude as integrator, five departments of seats, and an advisory board. Every seat works on its own inside its lane and sends anything that leaves the building up as a card. Josh approves or denies.

## Where things live

| What | Where |
| --- | --- |
| Seats: job, number, what each decides alone and what it asks first | `lib/company.ts` (`SEATS`). A change to a seat's job is a pull request. |
| Runs and cards | `company_runs`, `company_proposals` (migration `0023_company`; `drizzle/down/0023_company.sql` reverses it) |
| The page | `app/admin/company`, `components/company` |
| Josh's approve and deny | `app/admin/company/actions.ts` (staff only, a pending card only, once) |
| The seats' API | `app/api/company` (Bearer `COMPANY_SERVICE_SECRET`; closed when unset) |

## The three lanes

- **Do:** research, scoring, drafts, internal docs, opening pull requests, self-tests. The seat does it and logs a run.
- **Ask:** any message going out, any proposal, publishing or merging, spending, any billing change, anything touching a client's systems, naming a client. The seat sends a card.
- **Never:** invented proof, AI named as the method in public copy, charging without a yes, getting around a site's terms.

Approving changes nothing by itself. The seat reads its approved cards on its next run, carries them out, and marks them done.

## The API

```
GET   /api/company?seat=<key>        seats, approved cards to carry out, pending cards, recent denials with reasons
POST  /api/company/runs              { seat, summary, outcome?: "ok"|"error", proposals?: [{ kind, title, why, body?, impact?, confidence, wrongIf?, links? }] }
PATCH /api/company/proposals/<id>    { status: "done" | "withdrawn", note? }   done only after approval; withdrawn only while pending
```

A seat can never approve or deny. `kind` is one of message, proposal, decision, spend, publish, client, change, other.

## A seat's run, in order

1. `GET /api/company?seat=<key>`: read approved cards (carry them out, then `PATCH … done`), pending cards (don't repeat them), denials (learn from the reasons).
2. Do the work in its lane.
3. `POST /api/company/runs` with a one-line summary and any cards.

## Turning it on

1. Merge, then run `npm run db:migrate` against production (additive: two tables and one enum).
2. Set `COMPANY_SERVICE_SECRET` on Vercel (Production) and redeploy.
3. Optional: `COMPANY_WORKSPACE_ID`; without it the first workspace is used.
4. `node scripts/company-seed.mjs` posts the first cards from the November strategy.
5. Schedule each live seat (Claude Code scheduled tasks) with its run prompt.

The scorecard tracks what decides whether this works: cards waiting, median hours to decide, and the share of drafts edited before approval.
