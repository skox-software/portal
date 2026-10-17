import { SubmitButton } from "@/components/SubmitButton";
import { createInvoice } from "./actions";

export function CreateInvoiceForm({ projectId, nextNumber, docs, stripe }: {
  projectId: string; nextNumber: string; stripe: boolean;
  docs: { id: string; title: string; status: string }[];
}) {
  return (
            <form action={createInvoice} className="stack">
              <input type="hidden" name="projectId" value={projectId} />
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="i-number">Invoice number</label>
                  <input id="i-number" name="number" required defaultValue={nextNumber} maxLength={40} />
                </div>
                <div className="field">
                  <label htmlFor="i-title">What it&apos;s for</label>
                  <input id="i-title" name="title" required maxLength={160} placeholder="e.g. 50% deposit" />
                </div>
                <div className="field">
                  <label htmlFor="i-amount">Amount (USD)</label>
                  <input id="i-amount" name="amount" type="number" min="1" step="0.01" required placeholder="625.00" />
                </div>
                <div className="field">
                  <label htmlFor="i-due">Due</label>
                  <input id="i-due" name="dueOn" type="date" required />
                </div>
              </div>
              {stripe ? <input type="hidden" name="payUrl" value="" /> : <details className="billing-advanced"><summary>Use an external payment provider</summary><div className="field">
                <label htmlFor="i-pay">External payment link (optional)</label>
                <input id="i-pay" name="payUrl" type="url" placeholder="https://buy.stripe.com/…" />
              </div></details>}
              <div className="field">
                <label htmlFor="i-doc">Link to an agreement</label>
                <select id="i-doc" name="documentId" defaultValue="">
                  <option value="">No, a regular invoice</option>
                  {docs
                    .filter((d) => d.status !== "void")
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        Unlocks when “{d.title}” is signed{d.status === "completed" ? " (already signed)" : ""}
                      </option>
                    ))}
                </select>
                <span className="hint">When it&apos;s paid, the project moves from Kickoff to Building automatically.</span>
              </div>
              <div className="field">
                <label htmlFor="i-notes">Notes</label>
                <textarea id="i-notes" name="notes" maxLength={2000} placeholder="Payment terms, what's included…" />
              </div>
              <p className="small muted">Create an invoice to make it available in the client’s portal. Email it now, or share the payment link when you’re ready.</p><div className="row">
                <SubmitButton className="btn btn-primary" name="delivery" value="save" pendingLabel="Creating…">Create invoice</SubmitButton>
                <SubmitButton className="btn btn-ghost" name="delivery" value="email" pendingLabel="Creating…">Create and email invoice</SubmitButton>
              </div>
            </form>
  );
}
