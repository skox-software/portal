import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProjectHeader } from "@/components/ProjectHeader";
import { getDb } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { loadProjectShell } from "@/lib/project-shell";
import { checkoutStatus } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment" };

/**
 * Where Stripe sends the client back after they pay. It only reports what
 * happened: the invoice is settled by the webhook, which arrives whether or
 * not this page is ever loaded.
 */
export default async function PaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const shell = await loadProjectShell(id);
  const { project } = shell;
  const back = `/projects/${project.id}/billing`;
  const sessionId = typeof sp.session_id === "string" ? sp.session_id : null;
  if (!sessionId) redirect(back);

  let checkout: Awaited<ReturnType<typeof checkoutStatus>> | null = null;
  try {
    checkout = await checkoutStatus(sessionId);
  } catch (error) {
    console.error("[billing] could not read the checkout session", error);
  }
  if (!checkout) redirect(`${back}?notice=${encodeURIComponent("We couldn't read that payment. Your billing page has the latest.")}`);

  // The session has to belong to an invoice on this project, or it's not ours to report on.
  const [invoice] = checkout.invoiceId
    ? await getDb()
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, checkout.invoiceId), eq(invoices.projectId, project.id)))
        .limit(1)
    : [];
  if (!invoice) redirect(back);
  // Payment failed or was abandoned: let them pick up where they left off.
  if (checkout.status === "open") redirect(`${back}/pay/${invoice.id}`);

  const settled = checkout.paymentStatus !== "unpaid";
  const amount = formatMoney(checkout.amountTotal ?? invoice.amountCents, invoice.currency);

  return (
    <>
      <ProjectHeader
        shell={shell}
        tab="billing"
        title={settled ? "Thank you, payment received" : "Payment started"}
        intro={
          settled
            ? `We've received ${amount} for invoice ${invoice.number}.`
            : `Your payment of ${amount} for invoice ${invoice.number} is on its way. Some payment methods take a few days to clear.`
        }
      />
      <main className="shell page page-after-band">
        <section className="card" aria-label="Payment result">
          <p>
            {settled
              ? "A receipt is on its way to your inbox, and this invoice now shows as paid on your billing page."
              : "We'll email you as soon as it clears, and the invoice will show as paid here."}
          </p>
          <p className="row" style={{ marginTop: 14 }}>
            <Link className="btn btn-primary" href={back}>
              Back to billing
            </Link>
            <Link className="btn btn-ghost" href={`/projects/${project.id}`}>
              Your project
            </Link>
          </p>
        </section>
      </main>
    </>
  );
}
