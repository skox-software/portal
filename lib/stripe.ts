import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Optional Stripe Checkout. With STRIPE_SECRET_KEY set, "Pay now" opens a
 * Stripe-hosted checkout for the exact invoice amount (card, Apple/Google Pay,
 * and US bank transfer if enabled in Stripe), and the webhook marks the invoice
 * paid automatically. Without it, invoices use their manual pay link.
 * Plain fetch keeps the dependency list short.
 */

export function stripeEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function createCheckoutSession(input: {
  invoiceId: string;
  number: string;
  title: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const body = new URLSearchParams({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail,
    client_reference_id: input.invoiceId,
    "metadata[invoice_id]": input.invoiceId,
    "payment_intent_data[metadata][invoice_id]": input.invoiceId,
    "payment_intent_data[description]": `SKOX invoice ${input.number}: ${input.title}`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency,
    "line_items[0][price_data][unit_amount]": String(input.amountCents),
    "line_items[0][price_data][product_data][name]": `Invoice ${input.number}: ${input.title}`,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `invoice-${input.invoiceId}-${Math.floor(Date.now() / 600_000)}`,
    },
    body,
  });
  const json = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !json.url) throw new Error(json.error?.message ?? "Stripe checkout failed");
  return json.url;
}

/** Verifies a Stripe webhook signature (v1, 5-minute tolerance). */
export function verifyStripeSignature(payload: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const signatures = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  return signatures.some((sig) => {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
