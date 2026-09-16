"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useCallback } from "react";
import { checkoutClientSecret } from "./actions";

/**
 * Stripe's payment form, mounted on the portal's own page. Card details go
 * straight from the browser to Stripe inside its frame — they never reach us.
 *
 * loadStripe runs once per browser, outside render, as Stripe requires.
 */
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export function EmbeddedPay({ projectId, invoiceId }: { projectId: string; invoiceId: string }) {
  const fetchClientSecret = useCallback(
    () => checkoutClientSecret(projectId, invoiceId),
    [projectId, invoiceId],
  );

  if (!stripePromise) {
    return (
      <p className="small muted">
        Online payment isn&apos;t switched on yet. Reply to your invoice email and we&apos;ll sort it.
      </p>
    );
  }

  return (
    <EmbeddedCheckoutProvider stripe={stripePromise} options={{ fetchClientSecret }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}
