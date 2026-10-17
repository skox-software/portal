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

## Founder ownership and rep commissions

Founder-owned deals credit the assigned founder 100% of gross paid invoices.
Rep-owned deals credit the rep 20% and each of the two founders 40%.
Reiss uses `reiss@skoxsoftware.com`; Josh uses `founders@skoxsoftware.com`.
Both founders have founder earnings profiles. The separate “Josh Test” rep
account is not Josh's founder account.

Explicit project credit wins, followed by the linked deal's credited rep,
then its founder owner. Conflicting deal ownership requires an explicit
project credit. A rep deal requires exactly two founder profiles;
it fails rather than silently losing a founder's share if setup is incomplete.
Profile rates are fixed at 100% for founders and 20% for reps. Each rep deal
records 40% on the founders' actual ledger lines.

These are earned shares, not bank balances or proof of a payout. Operating
expenses and Stripe fees do not reduce the gross share. Actual client refunds
reverse each recipient's allocation, with cumulative rounding so a full refund
clears every cent. Odd cents in the 40/40 remainder go deterministically to
the founder whose membership ID sorts first.

Migration `0015_deal_ownership_shares` permits one earning per recipient per
payment, one clawback per recipient per refund, and one reversal per earning.
A payment's first allocation is frozen; retries cannot create new recipients
after ownership changes. Reversals append negative lines and never edit paid
statements. Founder shares remain owner draws and are excluded from rep exports.

`scripts/correct-lorenzen-shares.mjs` is the audited, idempotent correction for
the two $625 Lorenzen Motors invoices: both become 100% Reiss earnings, and
the affected draft statement is recalculated. It refuses approved/paid earnings
or statements and refunds. Run without `--apply` to inspect the plan first.
The $300 business expense does not reduce the $1,250 earned amount.

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

Team roles are displayed as **Founder** and **Sales rep**. The team page,
account role labels, sales-rep desk and invitation emails use those names.
Internal staff permission keys remain unchanged.
