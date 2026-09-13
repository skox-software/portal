/**
 * The "Get started" path a new client walks: sign the agreement, pay the
 * deposit, then we're building. Pure so it can be tested directly.
 */

export type StartStep = {
  key: "sign" | "pay" | "build";
  label: string;
  detail: string;
  state: "done" | "current" | "locked";
  href?: string;
};

type DocLike = { id: string; title: string; status: "out_for_signature" | "completed" | "void" };
type InvoiceLike = { id: string; number: string; status: "open" | "paid" | "void" };

export function startSteps(input: {
  projectId: string;
  projectStatus: "kickoff" | "building" | "review" | "launched" | "paused";
  document: DocLike | null;
  invoice: InvoiceLike | null;
}): StartStep[] | null {
  const { projectId, projectStatus } = input;
  const document = input.document?.status === "void" ? null : input.document;
  const invoice = input.invoice?.status === "void" ? null : input.invoice;
  if (!document && !invoice) return null;

  const signed = !document || document.status === "completed";
  const paid = !invoice || invoice.status === "paid";
  const building = projectStatus !== "kickoff";
  // Once everything is done and the build is under way, the card has done its job.
  if (signed && paid && building) return null;

  const base = `/projects/${projectId}`;
  const raw: Omit<StartStep, "state">[] = [
    ...(document
      ? [{ key: "sign" as const, label: "Sign the agreement", detail: document.title, href: `${base}/documents/${document.id}` }]
      : []),
    ...(invoice
      ? [{ key: "pay" as const, label: "Pay the deposit", detail: `Invoice ${invoice.number}`, href: `${base}/billing` }]
      : []),
    { key: "build", label: "We start building", detail: "Your first update arrives within a week" },
  ];
  const done = { sign: signed, pay: paid, build: building };
  let currentFound = false;
  return raw.map((step) => {
    if (done[step.key]) return { ...step, state: "done" as const };
    if (!currentFound) {
      currentFound = true;
      return { ...step, state: "current" as const };
    }
    return { ...step, state: "locked" as const, href: undefined };
  });
}

/** A deposit tied to an agreement can't be paid until the agreement is signed. */
export function invoiceLocked(invoice: { documentId: string | null }, linkedDocumentStatus: string | undefined) {
  return Boolean(invoice.documentId) && linkedDocumentStatus !== undefined && linkedDocumentStatus !== "completed";
}
