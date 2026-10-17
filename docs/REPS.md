# Sales reps and commissions

Outside sales reps are 1099 contractors paid a percentage of the cash SKOX
collects from clients they bring in. They work from `/rep`, a separate area of
the portal that shows their leads and their earnings and nothing else.

## What a rep can and can't see

A rep **can** see:
- Leads assigned to them, and leads they submitted. This covers contact details,
  industry, location, their own notes, their own call history, and a coarse
  status (Working, Call booked, With SKOX, Won, Closed).
- Their commission ledger: date, client company name, payment or refund amount,
  rate and commission. They also see approved and paid statements.
- Their own profile: rate, start date, paperwork status, and how they're paid.

A rep **never** sees:
- Projects, documents, files, updates, timelines, invoices, or the client portal.
- Deal values, internal notes, owners, attribution or internal stages.
- Other reps' leads or earnings, the Inbox, or anything under `/admin`.

How the wall is enforced:
- **Role:** reps have role `rep` with no client. "Staff" is decided by role, not
  by a missing client, through `lib/staff-filter.ts` and `staffMembershipIn`.
- **Project access:** `accessToProject` only grants client roles, so every
  project page and file route 404s for a rep.
- **Rep pages:** they read only through `lib/rep-data.ts`. Every query names its
  columns and filters on the rep's own membership.
- **Rep actions:** they live in `app/rep/actions.ts`. Each one re-checks that the
  rep owns the lead and writes rep-facing columns only.

## Lifecycle

1. **Invite.** On `/admin/reps`, the owner enters name, email, rate and start
   date. The email must not already be in the portal. The rep gets a welcome
   email and signs in with an emailed code.
2. **Leads.** Staff give leads to a rep from the lead panel ("Sales rep") or with
   the Clients bulk bar ("Sales rep…"). The rep gets an email unless they turned
   it off. Reps can also submit their own leads at `/rep/leads/new`.
   - Duplicates are rejected when the email, phone, website or company name
     matches any deal, client or referral. The rep isn't told who holds it.
3. **Work.** Reps log calls using the same outcomes and follow-ups as staff.
   They book a scope call on SKOX's booking link and mark it booked on the
   lead. The SKOX owner, or all staff when there is no owner, gets an email.
4. **Close.** SKOX quotes and closes as usual. "Start onboarding" from the won
   deal copies the deal's rep onto the new project (`projects.rep_membership_id`).
   Staff can change the credited rep on the admin project page.
5. **Earn.** Every invoice paid on that project adds an `earned` line:
   - The amount is invoice × rate, rounded half up to the cent.
   - The rate is snapshotted on the line, so a later rate change never rewrites
     history.
   - Both payment paths credit the rep: the Stripe webhook and "Paid outside
     checkout". The partial unique index on (invoice, paid at) makes webhook
     retries a no-op.
6. **Refunds.**
   - **Stripe:** refunds arrive as `charge.refunded` and record themselves.
   - **Outside Stripe:** use "Record a refund" on the invoice.
   - Each refund adds a negative `clawback` line at the original rate.
   - If an invoice is reopened or voided after payment, a pending earning is
     voided. An approved or paid earning gets a clawback instead.
7. **Statements.**
   - **Drafting:** the daily cron drafts last month's statements, one per rep
     with money owed. Each takes every pending line earned through month end,
     and the owner gets an email. "Close <month>" on `/admin/commissions` does
     the same by hand.
   - **Carry-forward:** a month where refunds outweigh earnings drafts nothing,
     and its lines carry forward.
   - **Approve:** owner only. It re-totals from the lines and emails the rep.
   - **Pay:** the owner pays outside the portal, then clicks "Mark paid" with
     the transfer reference. The rep is emailed. Paid lines never change, so
     corrections are `adjustment` lines.
8. **Year end.** "1099 export" on `/admin/commissions` downloads each rep's
   paid totals by month, counted by the date each statement was paid.

## Partner shares (staff who close their own deals)

A partner is someone on the SKOX team who earns a share of what they close
and deliver. Reiss (`reiss@skoxsoftware.com`, role `staff`) gets 50%.

- **Setup:** owner only, on `/admin/reps` → "Add a partner share". It adds a
  `rep_profiles` row on their existing **staff** membership. No invite or
  welcome email; they keep full staff access and see everything staff see.
- **Rate:** reps are capped at 10–20%; staff partners at 10–50%
  (`isValidRateFor` in `lib/permissions.ts`). Edits use the same role-aware
  check.
- **What it's paid on:** the full invoice amount, like every rep line. Stripe's
  fee is not deducted (it is to be passed to the client separately).
- **Ledger:** unchanged. Earnings, clawbacks, statements, approve and pay all
  key on `rep_profiles`, not the role. The partner shows a "Partner" chip on
  `/admin/reps`, appears in the "Sales rep" pickers, and is in the 1099 export
  once they have a profile.
- **Crediting:** a project earns for the partner when its credited rep
  (`projects.rep_membership_id`) is the partner. Pick them as the project's
  "Sales rep" (or on the deal before onboarding). Owning the deal
  (`deals.owner_email`) does not credit them by itself.
- **Statement emails:** link partners to `/admin/commissions`, since `/rep`
  404s for staff.
- **Past deals:** `scripts/backfill-partner.mjs` credits deals they already
  closed. Dry run first, review the list, then `--apply`:
  `node --env-file=.env.local scripts/backfill-partner.mjs [--apply]`.
  It sets the credited rep only where empty and is safe to re-run.

## Permissions

| Action | Owner (`staff_owner`) | Staff | Rep |
| --- | --- | --- | --- |
| Invite reps, add partner shares, change rate or status | ✓ | | |
| Assign leads to a rep, credit a project | ✓ | ✓ | |
| Close a month (draft statements) | ✓ | ✓ | |
| Approve, mark paid, discard, adjust | ✓ | | |
| 1099 export | ✓ | | |
| Submit and work own leads | | | ✓ |

## Setup checklist

- **Migration:** apply `drizzle/0013_rep_portal.sql` (`npm run db:migrate`)
  before deploying.
- **Stripe:** add `charge.refunded` to the webhook endpoint's events, so Stripe
  refunds claw back automatically.
- **Booking link:** set it in workspace settings. Reps see it on every lead.
- **Owner:** make sure the person who approves payouts has role
  `staff_owner`. Today that is founders@skoxsoftware.com.

## Decisions to revisit

- **Paused reps** earn nothing new, including on care plans for clients they
  brought. Keep them active if they should keep earning after they stop selling.
- **Invoices voided after a Stripe payment** claw back as if refunded. Record a
  real refund instead when money actually went back.
