import type Stripe from "stripe";
import { stripeClient, stripeEnabled } from "@/lib/stripe";
import { toUnixRange, type PeriodRange } from "@/lib/finance-periods";
import { sumBalanceTransactions } from "@/lib/fee-math";
import { dailyNets } from "@/lib/forecast-math";

/**
 * Live reads from Stripe for the finance dashboard. Nothing here is stored:
 * each read is memoised in this module for a couple of minutes, and every
 * one returns `{ ok: false, reason }` instead of throwing, so a slow Stripe
 * or a restricted key missing a permission only greys out the Stripe cards.
 * The portal's own numbers never wait on these.
 *
 * Read permissions the key needs: Balance (includes balance transactions),
 * Payouts, Charges, PaymentIntents and, for the business account, Money
 * management → Financial accounts (`financial_account_read`). See docs/FINANCE.md.
 */

export type StripeRead<T> = { ok: true; data: T } | { ok: false; reason: string };

const BALANCE_TTL_MS = 2 * 60_000;
const WINDOW_TTL_MS = 5 * 60_000;
/** Each call gives up after this, and doesn't retry: a dashboard can't hang on Stripe. */
const REQUEST: Stripe.RequestOptions = { timeout: 6_000, maxNetworkRetries: 0 };

const memo = new Map<string, { at: number; value: unknown }>();

/** Runs a read through the memo. Only successes are kept, so a failure retries next load. */
async function cached<T>(key: string, ttlMs: number, fresh: boolean, read: () => Promise<T>): Promise<StripeRead<T>> {
  if (!stripeEnabled()) return { ok: false, reason: "Stripe isn't connected" };
  const hit = memo.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttlMs) return { ok: true, data: hit.value as T };
  try {
    const value = await read();
    memo.set(key, { at: Date.now(), value });
    return { ok: true, data: value };
  } catch (error) {
    console.error(`[finance] stripe ${key} failed`, error);
    return { ok: false, reason: describe(error) };
  }
}

/** A short, safe reason for the "Stripe unavailable" strip. Never the key or raw payload. */
function describe(error: unknown) {
  const e = error as { type?: string; statusCode?: number; message?: string };
  if (e?.statusCode === 401) return "the API key was rejected";
  if (e?.statusCode === 403 || e?.type === "StripePermissionError") return "the API key is missing a read permission";
  if (e?.type === "StripeConnectionError") return "Stripe didn't answer in time";
  if (e?.statusCode === 429) return "Stripe is rate limiting";
  return "Stripe returned an error";
}

function usd(list: { amount: number; currency: string }[]) {
  return list.filter((b) => b.currency === "usd").reduce((s, b) => s + b.amount, 0);
}

export function stripeBalance(fresh = false) {
  return cached("balance", BALANCE_TTL_MS, fresh, async () => {
    const b = await stripeClient().balance.retrieve({}, REQUEST);
    return { available: usd(b.available), pending: usd(b.pending) };
  });
}

export type TreasuryAccount = { id: string; name: string | null; cash: number; inboundPending: number; outboundPending: number };

/** A v2 FinancialAccount, as far as the dashboard reads it. Amounts are per currency: `{ usd: { value, currency } }`. */
type V2FinancialAccount = {
  id: string;
  display_name: string | null;
  status: "open" | "pending" | "closed";
  type: string;
  balance: Record<"available" | "inbound_pending" | "outbound_pending", Record<string, { value: number; currency: string }> | undefined>;
};

/** The v2 money-management API is in preview: it needs this version header, not the SDK default. */
const V2_API_VERSION = "2026-09-30.preview";

/**
 * UnBusy's money sits in a Stripe business account (a v2 FinancialAccount of
 * type `storage`), not the payments balance: "Earnings auto-transfer"
 * sweeps each payment there, so the payments balance reads $0 and no bank
 * payouts exist. This is the balance Josh and Reiss mean by "the account".
 *
 * The installed SDK has no wrapper for `/v2/money_management`, so this is a
 * raw request. Not the older `/v1/treasury` API, which is for platforms and
 * returns "Unrecognized request URL" on this account.
 */
export function stripeTreasury(fresh = false) {
  return cached("business-account", BALANCE_TTL_MS, fresh, async () => {
    const page = (await stripeClient().rawRequest("GET", "/v2/money_management/financial_accounts?limit=10", undefined, { ...REQUEST, apiVersion: V2_API_VERSION })) as {
      data?: V2FinancialAccount[];
    };
    const usd = (m?: Record<string, { value: number }>) => m?.usd?.value ?? 0;
    const accounts: TreasuryAccount[] = (page.data ?? [])
      .filter((fa) => fa.status === "open")
      .map((fa) => ({
        id: fa.id,
        name: fa.display_name,
        cash: usd(fa.balance?.available),
        inboundPending: usd(fa.balance?.inbound_pending),
        outboundPending: usd(fa.balance?.outbound_pending),
      }));
    return { accounts, cash: accounts.reduce((s, a) => s + a.cash, 0), inboundPending: accounts.reduce((s, a) => s + a.inboundPending, 0) };
  });
}

export type PayoutRow = { id: string; amount: number; status: string; arrivalDate: number; created: number };

export function stripePayouts(fresh = false) {
  return cached("payouts", BALANCE_TTL_MS, fresh, async () => {
    const list = await stripeClient().payouts.list({ limit: 10 }, REQUEST);
    const recent: PayoutRow[] = list.data.map((p) => ({ id: p.id, amount: p.amount, status: p.status, arrivalDate: p.arrival_date, created: p.created }));
    // Newest first, so the last pending or in-transit one is the next to arrive.
    const upcoming = recent.filter((p) => p.status === "pending" || p.status === "in_transit");
    const next = upcoming.sort((a, b) => a.arrivalDate - b.arrivalDate)[0] ?? null;
    return { recent, next };
  });
}

/**
 * Gross, fees, net, refunds and payouts per bucket of the period, and the
 * same transactions netted per day for the runway. Capped at 2,000.
 */
export function stripeActivity(range: PeriodRange, fresh = false) {
  const created = toUnixRange(range);
  return cached(`activity:${range.key}:${range.endIso}`, WINDOW_TTL_MS, fresh, async () => {
    const txns = await stripeClient()
      .balanceTransactions.list({ created, limit: 100 }, REQUEST)
      .autoPagingToArray({ limit: 2_000 });
    return { ...sumBalanceTransactions(txns, range), days: dailyNets(txns), count: txns.length, capped: txns.length >= 2_000 };
  });
}

export type ChargeRow = {
  id: string;
  amount: number;
  refunded: number;
  status: string;
  created: number;
  receiptUrl: string | null;
  paymentIntent: string | null;
  description: string | null;
};

export function stripeCharges(range: PeriodRange, fresh = false) {
  const { gte } = toUnixRange(range);
  return cached(`charges:${range.key}:${range.endIso}`, WINDOW_TTL_MS, fresh, async () => {
    const list = await stripeClient().charges.list({ created: { gte }, limit: 20 }, REQUEST);
    return list.data.map<ChargeRow>((c) => ({
      id: c.id,
      amount: c.amount,
      refunded: c.amount_refunded,
      status: c.status,
      created: c.created,
      receiptUrl: c.receipt_url,
      paymentIntent: typeof c.payment_intent === "string" ? c.payment_intent : (c.payment_intent?.id ?? null),
      description: c.description,
    }));
  });
}

/** Exact invoice fees, including historical invoices imported without a PaymentIntent ID. */
export function stripeInvoiceFee(invoice: { id: string; number: string; intent: string | null; paidAt: Date; amount: number }, fresh = false) {
  return cached(`invoice-fee:${invoice.id}`, WINDOW_TTL_MS, fresh, async () => {
    let charge: Stripe.Charge | null = null;
    if (invoice.intent) {
      const payment = await stripeClient().paymentIntents.retrieve(invoice.intent, { expand: ["latest_charge.balance_transaction"] }, REQUEST);
      if (payment.latest_charge && typeof payment.latest_charge !== "string") charge = payment.latest_charge;
    } else {
      const at = Math.floor(invoice.paidAt.getTime() / 1000);
      const page = await stripeClient().charges.list({ created: { gte: at - 86400, lte: at + 86400 }, limit: 100, expand: ["data.balance_transaction"] }, REQUEST);
      const matches = page.data.filter(c => c.paid && c.currency === "usd" && c.amount === invoice.amount &&
        (c.metadata.invoice_id === invoice.id || ["UnBusy", "SKOX"].some(brand => c.description?.startsWith(`${brand} invoice ${invoice.number}:`))));
      if (page.has_more || matches.length !== 1) throw new Error("Invoice charge needs reconciliation");
      charge = matches[0];
    }
    if (!charge?.paid || charge.currency !== "usd") throw new Error("Charge unavailable");
    const txn = charge.balance_transaction;
    if (!txn || typeof txn === "string" || txn.currency !== "usd") throw new Error("Fee unavailable");
    return { fee: txn.fee, amount: charge.amount };
  });
}
