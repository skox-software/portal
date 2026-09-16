import type Stripe from "stripe";

/** Use the actual checkout payer, never infer a payer from the company contact. */
export function paymentEmailDetails(session: Pick<Stripe.Checkout.Session, "customer_details" | "customer_email" | "id">, company: string, project: string) {
  const payer = session.customer_details;
  return [
    { label: "Company", value: company },
    { label: "Paid by", value: payer?.individual_name?.trim() || payer?.name?.trim() || "Name not provided" },
    { label: "Payer email", value: payer?.email?.trim() || session.customer_email?.trim() || "Email not provided" },
    { label: "Project", value: project },
    { label: "Payment reference", value: session.id },
  ];
}
