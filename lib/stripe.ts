import Stripe from "stripe";

/**
 * Optional Stripe Checkout. With STRIPE_SECRET_KEY set, "Pay now" opens the
 * portal's own checkout page, where Stripe's payment form is embedded for the
 * exact invoice amount (card, Apple/Google Pay, and US bank transfer if enabled
 * in Stripe), and the webhook marks the invoice paid. Without it, invoices fall
 * back to their manual pay link.
 *
 * Which payment methods appear is decided in the Stripe dashboard, never here:
 * Stripe ranks the eligible ones per customer.
 */

/** Labels these sessions in Stripe's dashboard so portal payments are legible. */
const INTEGRATION_ID = "skox-portal-invoice-qhzkmwft";

let client: Stripe | undefined;

export function stripeEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key);
  return client;
}

/**
 * Starts a checkout for one invoice and returns the secret its payment form
 * mounts with. Paying twice in quick succession reuses the same session: the
 * idempotency key only changes every ten minutes.
 */
export async function createEmbeddedCheckout(input: {
  invoiceId: string;
  number: string;
  title: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  returnUrl: string;
}) {
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      ui_mode: "embedded_page",
      return_url: input.returnUrl,
      customer_email: input.customerEmail,
      client_reference_id: input.invoiceId,
      integration_identifier: INTEGRATION_ID,
      metadata: { invoice_id: input.invoiceId },
      payment_intent_data: {
        metadata: { invoice_id: input.invoiceId },
        description: `SKOX invoice ${input.number}: ${input.title}`,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency,
            unit_amount: input.amountCents,
            product_data: { name: `Invoice ${input.number}: ${input.title}` },
          },
        },
      ],
    },
    { idempotencyKey: `invoice-${input.invoiceId}-${Math.floor(Date.now() / 600_000)}` },
  );
  if (!session.client_secret) throw new Error("Stripe returned no client secret");
  return session.client_secret;
}

/**
 * What Stripe says about a finished checkout, for the return page. The invoice
 * itself is settled by the webhook, never by this read: someone can close the
 * tab before the return page ever loads.
 */
export async function checkoutStatus(sessionId: string) {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  return {
    status: session.status,
    paymentStatus: session.payment_status,
    invoiceId: session.metadata?.invoice_id ?? null,
    amountTotal: session.amount_total,
    currency: session.currency,
  };
}

/** Verifies a webhook's signature. Returns null when it doesn't check out. */
export function stripeEvent(payload: string, signature: string | null, secret: string) {
  if (!signature) return null;
  try {
    return stripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    console.error("[stripe] webhook signature rejected", error);
    return null;
  }
}
