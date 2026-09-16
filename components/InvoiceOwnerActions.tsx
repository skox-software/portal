import Link from "next/link";
import { emailInvoice } from "@/app/projects/[id]/billing/actions";
import { CopyPaymentLink } from "@/components/CopyPaymentLink";
import { SubmitButton } from "@/components/SubmitButton";
import { portalLink } from "@/lib/notify";

export function InvoiceOwnerActions({ invoice, stripe, sandbox, locked, central = false }: {
  invoice: { id: string; projectId: string; status: string; payUrl: string | null };
  stripe: boolean; sandbox: boolean; locked: boolean; central?: boolean;
}) {
  if (invoice.status !== "open") return null;
  const billing = `/projects/${invoice.projectId}/billing`;
  const checkout = `${billing}/pay/${invoice.id}`;
  // Locked deposits go through Billing so the client can sign first.
  const url = locked ? portalLink(`${billing}#invoice-${invoice.id}`)
    : stripe ? portalLink(`${billing}/invoices/${invoice.id}`) : invoice.payUrl;
  return (
    <>
      {url && <CopyPaymentLink url={url} />}
      <form action={emailInvoice}>
        <input type="hidden" name="projectId" value={invoice.projectId} />
        <input type="hidden" name="invoiceId" value={invoice.id} />
        <input type="hidden" name="returnTo" value={central ? "billing" : "project"} />
        <SubmitButton className="btn btn-primary btn-small" pendingLabel="Sending…">Email invoice</SubmitButton>
      </form>
      {stripe && sandbox && !locked && <Link href={checkout} className="btn btn-ghost btn-small">Test checkout</Link>}
    </>
  );
}
