# Finance dashboard

`/portal/admin/finance` (Finance in the admin sidebar, and under More on
phones). Both staff roles see all of it.

## Mission Control

The page runs in a dark theme scoped to Finance (`data-theme="mission"` on its
`<main>`; tokens in `app/admin/finance/finance.css`). The rest of the admin
stays light. Top to bottom:

1. **Live ticker** (sticky): business account (or the payments balance when
   there is no business account), cash collected this month, the weighted
   pipeline and invoices due today. Digits roll to new values and the strip
   flashes amber when anything changed. "live · updated 12s ago" shows the
   last poll; "reconnecting" means the last poll failed and it will try
   again; "paused, sign in again" means the session lapsed.
2. **Metric strip** (below), then **Money flow**: a Sankey from the open
   pipeline (weighted) to won, invoiced and paid in the period, then earned
   shares and unallocated gross. These are ownership amounts, not cash paid
   out. Fees, refunds and business expenses are separate cash measures and
   never scale down the displayed earned shares. The unallocated figure is
   not the current business account balance.
3. **Runway**: the balance through the period, walked back day by day from
   today's balance using Stripe's balance transactions, then 60 days ahead
   assuming every open invoice is paid on its due date (overdue ones
   tomorrow) and every draft or approved commission statement is paid on the
   5th after its month. The hatched band is what depends on clients paying;
   its lower edge is "if nobody pays". For the business account, sweeps from
   the payments balance are ignored (they fill it); money moved out of the
   business account by other means is not in Stripe's balance transactions,
   so the history can't show it.
4. **Goal**: cash collected this year against the revenue target, with the
   business account in the middle, a tick where an even year would be by
   today, and "on track for $X" at the current pace. Set the target on
   Workspace settings ("Revenue target for <year>", stored in
   `workspaces.revenue_goal_cents` / `revenue_goal_year`; migration
   `drizzle/0014_revenue_goal.sql`). A target only counts for the year it was
   saved in, so it needs setting again each January.
5. **The race**: cash collected and deals won per owner, month to date and
   year to date. The two people with the most this year get lanes, everyone
   else is Others. The tick is where each lane lands at its current pace; the
   arrow is places moved on cash since last month. Cash here is per owner,
   like the Team table: payments on projects that came from their deals.
6. **The year, day by day**: a heat map of the last 12 months (whatever the
   period) by cash collected, deals won or calls logged (`?heat=`).
7. **Funnel**: deals that reached each stage in the period, read from the
   audit trail (`to` on stage moves, edits and logged calls, plus new deals),
   each deal counted once per stage. With nothing recorded for the period it
   shows where open deals stand now plus deals won. Each stage links to
   Clients filtered to it.
8. **Activity** (right rail at 1280px and wider, below otherwise): the last
   25 payments, new invoices, stage moves, calls, new deals, commission
   earned and statements paid.

### Live updates

`GET /api/finance/live` (staff only, `Cache-Control: no-store`) returns the
ticker figures and the feed: `{ at, balanceCents, balanceSource,
paymentsBalanceCents, collectedMonthCents, openPipelineCents, dueTodayCount,
events }` (`lib/finance-live.ts`). The page renders the same snapshot first,
then `components/finance/LiveProvider.tsx` polls every **30 seconds** while
the tab is visible, and once straight away when it becomes visible again
after 30 seconds or more. Stripe figures go through the same memo as the
page (two minutes for balances), so polling doesn't add Stripe calls; when
Stripe fails they come back `null` and the ticker shows a dash.

### Payment celebration and sound

When a poll brings an `invoice.paid` event that wasn't there before (never on
first load), a 1.5-second confetti burst plays over the page. With sound on,
a short two-note chime plays too, synthesised with WebAudio (no audio file).
Sound is **off by default**; the toggle in the ticker remembers the choice in
this browser (`localStorage` key `skox.finance.sound`). Browsers only allow
audio after a click, so turn it on once per browser by clicking the toggle.
Neither plays for anyone who prefers reduced motion (confetti) or has sound
off (chime).

### Wall mode

"Wall mode ↗" opens `/portal/admin/finance/wall` in a new tab: no sidebar,
big type, the ticker on top and one panel at a time (money flow, runway,
race, heat map, funnel) crossfading every **20 seconds**. The data re-renders
every **60 seconds** (`router.refresh()`); the ticker keeps its own 30-second
poll. Arrow keys step, space pauses. It is staff only like the rest of the
admin. On a phone it shows a note instead: it's meant for a big screen. To
hear the chime on the wall, click the sound toggle there once.

### Motion

Every animation (rolling digits, flash, feed slide-in, bands, bars, dial,
confetti, wall crossfade) is off under `prefers-reduced-motion: reduce`.

## The older sections

1. **Metric strip:** Stripe available and pending balance, next payout (date
   and amount), cash collected in the period, and outstanding invoices with the
   overdue count.
2. **Revenue:** paid invoices per bucket, split into kept and refunded, with
   Stripe's net (after fees and refunds) drawn as a line when Stripe answers.
3. **Stripe:** gross, fees and net for the period, the 20 most recent charges
   (matched to portal invoices by payment intent) and the last 10 payouts.
   **Owed to SKOX:** outstanding vs overdue, and the open pipeline weighted by
   stage (lead 10%, outreach 20%, proposal 50%, negotiation 75%).
4. **Deals won** per bucket, by owner: the two owners with the most wins get
   their own color, everyone else is "Others".
5. **Team:** deals won, won value and cash collected per owner for the period,
   and commission owed (pending + approved, all time), linking to each
   person's ledger.

Periods are 30 days (daily), 90 days (weekly, Monday start), 12 months and
year to date (monthly), all in Florida time (`America/New_York`).

## Where the numbers come from

- **Portal numbers** (collected, refunds, outstanding, deals, commission) come
  from the database: `lib/finance-data.ts`. The Mission Control panels read
  through one loader, `lib/finance-mission.ts`, shared by the page and wall
  mode; their math is pure and tested (`lib/sankey-math.ts`,
  `lib/forecast-math.ts`, `lib/funnel-math.ts`, `lib/chart-math.ts`,
  `lib/live-feed.ts`, `lib/odometer.ts`). A deal counts as won when it
  reached Won or was onboarded, dated by `won_at`; deals won before `won_at`
  existed have no date and don't appear in the chart.
- **Stripe numbers** are read live on each request: `lib/finance-stripe.ts`.
  Nothing is stored and there is no sync job. Each read is memoised in the
  server process: balance and payouts for 2 minutes, the period's balance
  transactions and charges for 5 minutes. "Refresh Stripe" (`?fresh=1`)
  skips the memo. Each call times out after 6 seconds and doesn't retry.
  Balance transactions are capped at 2,000 per period.
- Stripe covers the whole account, so charges taken outside the portal show
  under Stripe but not in the portal's "Collected".

## When Stripe is missing or fails

- No `STRIPE_SECRET_KEY`: a "Connect Stripe" strip, and the Stripe cards show
  dashes. Everything else renders.
- A read fails (bad key, missing permission, timeout, rate limit): a muted
  "Stripe unavailable: <reason>" strip. The page never errors because of
  Stripe, and failures are not memoised, so the next load retries.

## Stripe key permissions

The production key should be a restricted key (`rk_live_…`). On top of what
checkout and the webhook need, the dashboard needs **Read** on:

| Resource | Used for |
| --- | --- |
| Balance | available / pending balance, and balance transactions (gross, fees, net) |
| Payouts | recent and next payout |
| Charges | recent charges and receipts |
| PaymentIntents | matching charges to portal invoices |
| Money management → Financial accounts (`financial_account_read`) | the business account balance (see below) |

### Where the money actually is

SKOX's Stripe account has "Earnings auto-transfer" on: every payment is swept
from the payments balance into a **Stripe business account** (``··7315``,
earning yield). So the payments balance reads $0, there are no payouts to a
bank, and the number that matters is that account's available balance. It is a
v2 `FinancialAccount` (`GET /v2/money_management/financial_accounts`, preview
API version `2026-09-30.preview`, read with `rawRequest` because the SDK has no
wrapper yet). It is **not** the `/v1/treasury` API, which is Treasury for
platforms and answers "Unrecognized request URL" here. The restricted key
needs the *Money management → Financial accounts* read permission, not the
Treasury one.
The dashboard shows it first as **Business account**; the payments balance is
the second card; "Next payout" appears only when a payout exists.

## Deal ownership

Reiss earns 100% on his own deals, Josh earns 100% on his own deals, and
rep-owned deals split 20% to the rep and 40% to each founder. Shares apply to
gross paid invoice amounts before Stripe fees or business expenses. Actual
client refunds reverse the corresponding earnings. See `docs/REPS.md`.

Lorenzen Motors has two paid $625 invoices credited to Reiss: $1,250 earned.
The separately incurred $300 business expense changes available cash, not
that ownership amount. Commission owed and the business balance are distinct.

## Gross earnings and withdrawals

Finance and Commissions now show lifetime gross earnings separately from cash
available to withdraw. Actual Stripe balance-transaction fees are allocated by
the recorded earning rate. Legacy imported invoices without PaymentIntent IDs
match a unique paid USD charge by invoice metadata (or the exact portal invoice
number prefix), amount and a one-day window around payment; ambiguous matches
show Unavailable. No percentage estimate is substituted for missing Stripe data.

`withdrawal_expenses` records spending allocated to one person's withdrawal,
without altering gross ownership, statements, or the account balance. Migration
0018 creates this table. `record-google-ads-expense.mjs --apply` idempotently
records the user-confirmed $300 against Reiss, with an audit event. This is an
existing expense, not another payment or an adjustment to the commission ledger.

Available is unpaid ledger balance less lifetime invoice fees and allocated
expenses, floored at zero. Total availability is capped by live business cash;
shortfalls are divided proportionally, rounded down. Unknown fee or cash data
suppresses availability instead of treating missing data as zero. This is an
informational cash estimate; statement approval and payment remain separate.
The existing statement workflow still uses gross amounts; consult this
breakdown before making a withdrawal. Revenue period filters do not change
lifetime earnings or withdrawal balances.
