import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PrintButton } from "@/components/PrintButton";
import { Money } from "@/components/rep/Money";
import { Receipt } from "@/components/rep/Receipt";
import { requireRep } from "@/lib/access";
import { periodLabel } from "@/lib/commission-math";
import { formatDate } from "@/lib/format";
import { myProfile, myStatement } from "@/lib/rep-data";

export const metadata = { title: "Statement" };

export default async function RepStatement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { rep } = await requireRep();
  const [found, profile] = await Promise.all([myStatement(rep, id), myProfile(rep)]);
  if (!found) notFound();
  const { statement, lines } = found;
  const when = statement.paidAt ?? statement.approvedAt;
  return (
    <>
      <Link className="rp-back" href="/rep/earnings">← Earnings</Link>
      <section className="rp-hero">
        <div>
          <p className="rp-kicker">Commission statement · {profile?.displayName}</p>
          <h1 className="rp-title">{periodLabel(statement.periodStart)}</h1>
          <p className="rp-lede">{formatDate(statement.periodStart)} to {formatDate(statement.periodEnd)}</p>
        </div>
        <div style={{ display: "grid", gap: 18, justifyItems: "start" }}>
          <span className="rp-stamp" data-status={statement.status}>{statement.status === "paid" ? "Paid" : "Approved"}</span>
          <p className="rp-bignum" style={{ fontSize: "clamp(56px, 7vw, 96px)" }}><Money cents={statement.totalCents} /></p>
          <p className="rp-note">
            {statement.status === "paid" ? "Paid" : "Approved"} {when?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            {statement.paymentReference ? ` · Ref ${statement.paymentReference}` : ""}
          </p>
          <span className="rp-no-print"><PrintButton label="Save as PDF" /></span>
        </div>
      </section>
      <section className="rp-section">
        <ul className="rp-feed">{lines.map((l) => <Receipt key={l.id} line={l} />)}</ul>
        <p className="rp-note" style={{ marginTop: 18 }}>Lines from an earlier month appear here when that month carried forward.</p>
      </section>
    </>
  );
}
