# Outreach and the Pipeline

One `deals` row, two boards. The rules live in `lib/pipeline.ts` and `lib/follow-up.ts` (pure, tested).

## Outreach (`/admin/leads`)

Imported, scanned and hand-added leads, worked by call and cold email: Attempt 1–4, then Closed.

- Calls and cold emails are attempts. They never promote. "Save & move" steps to the next attempt.
- Closing asks why: no answer after 4 tries, bad number, or not interested (with a reason chip: retiring, has someone, just redid site, no budget, not decision-maker). Stored on `deals.close_reason` / `close_detail` and on the `deal.call_logged` event as `payload.reason`, which `scripts/lead-scan/lead_brain.py` reads.
- The strip shows attempts today and, over 30 days, connect rate (reached the owner / dials), interest rate and preview rate (over connects), by industry when you open it. Every rate shows its sample.
- Saved views: All leads, Due today, Not tried yet, Mine. "Callable now" walks the call queue with J/K.
- The Previews lane at the bottom lists every preview in flight.

## Promotion: the only way into the Pipeline

A lead moves to the Pipeline only on a signal from them, recorded as `deals.promoted_signal` / `promoted_at` and a `deal.promoted` event:

| Signal | Set by |
|---|---|
| `replied` | an inbound email on the lead's thread (not an opt-out), filing such a thread under the lead, or Promote |
| `interested` | the call outcome Interested, or Promote |
| `preview` | the call outcome Preview requested, the panel's Preview requested button, or Promote |
| `meeting` | a rep booking the scope call, or Promote (lands on Scope call) |
| `inbound` | a website enquiry |
| `direct` | a deal added straight to the Pipeline |

Drags, the stage menu and bulk moves stay inside a track. Going back is "Send back to Outreach" with a reason (`deal.demoted`); it lands on the attempt after the ones already made.

## Pipeline (`/admin/pipeline`)

Interested → Scope call → Proposal → Won, with Lost folded below. Cards show value, next step and days in stage; a deal stalls after 7 days without moving. The strip shows open value, win rate, average days from promotion to won, and open deals with no next step (or an overdue one). Saved views: All deals, Needs a next step, Stalled, Mine. `won_at` and the Google Ads upload file are unchanged.

## Preview websites

`deals.preview_status`: none → requested → researching → awaiting_approval → building → ready → sent → opened → archived, with `preview_requested_at`, `preview_url`, `preview_sent_at`, `preview_first_open_at`, `preview_brief` and `preview_decision`. Gate A (Go / Go with changes / No-go) shows in the lead panel while a preview is awaiting approval. A go moves it to building; a no-go archives it.

The builder (docs/prospects/preview-playbook.md in the SKOX repo) uses an internal API, separate from project design previews (`/api/previews/[id]/image`):

- `GET /portal/api/lead-previews/queue` returns deals in `requested` or `building`, oldest request first, with contact details, the call brief, the research brief and the Gate A decision.
- `PATCH /portal/api/lead-previews/<dealId>` with any of `status`, `url` (https), `brief`, `sentAt`, `firstOpenAt` (ISO times). The builder can't request a preview, can't start a build without a go, and can't revive an archived one. Only the first open is kept. A `sentAt` or `firstOpenAt` without a status moves it to sent or opened.

Both need `Authorization: Bearer $PREVIEW_SERVICE_SECRET`; without the env var the API answers 401.

## Migration 0022

Retired the Emailed stage: each Emailed deal went back to the attempt its calls and emails reached, unless they had replied or booked a meeting. Moved rows were copied to `deal_stage_backup_0022`; `drizzle/down/0022_two_track_promotion.sql` reverses it. `node scripts/two-track-dry-run.mjs` prints the counts before or after. Drop the backup table once nobody needs to roll back (a later `drizzle-kit generate` will also propose dropping it, since it isn't in the schema).
