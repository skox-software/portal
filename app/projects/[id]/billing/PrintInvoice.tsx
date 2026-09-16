"use client";

export function PrintInvoice() {
  return <button className="btn btn-ghost btn-small" type="button" onClick={() => window.print()}>Print / save PDF</button>;
}
