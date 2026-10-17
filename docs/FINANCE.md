# Finance dashboard

`/portal/admin/finance` (Finance in the admin sidebar, and under More on
phones). Both staff roles see all of it.

## What it shows

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
  from the database: `lib/finance-data.ts`. A deal counts as won when it
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

## Partner share

Reiss earns 50% of every paid invoice on projects credited to him, on the full
invoice amount. It is a commission profile on his staff membership; see
"Partner shares" in `docs/REPS.md`. His owed commission appears in the Team
table here and on `/admin/commissions`.
