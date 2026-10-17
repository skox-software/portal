import type Stripe from "stripe";
import { stripeClient, stripeEnabled } from "@/lib/stripe";
import { toUnixRange, type PeriodRange } from "@/lib/finance-periods";
import { sumBalanceTransactions } from "@/lib/fee-math";

/**
 * Live reads from Stripe for the finance dashboard. Nothing here is stored:
 * each read is memoised in this module for a couple of minutes, and every
 * one returns `{ ok: false, reason }` instead of throwing, so a slow Stripe
 * or a restricted key missing a permission only greys out the Stripe cards.
 * The portal's own numbers never wait on these.
 *
 * Read permissions the key needs: Balance (includes balance transactions),
 * Payouts, Charges and PaymentIntents. See docs/FINANCE.md.
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

/** Gross, fees, net, refunds and payouts per bucket of the period. Capped at 2,000 transactions. */
export function stripeActivity(range: PeriodRange, fresh = false) {
  const created = toUnixRange(range);
  return cached(`activity:${range.key}:${range.endIso}`, WINDOW_TTL_MS, fresh, async () => {
    const txns = await stripeClient()
      .balanceTransactions.list({ created, limit: 100 }, REQUEST)
      .autoPagingToArray({ limit: 2_000 });
    return { ...sumBalanceTransactions(txns, range), count: txns.length, capped: txns.length >= 2_000 };
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
