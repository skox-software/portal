import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SkoxLogo } from "@/components/SkoxLogo";
import { getDb } from "@/lib/db";
import { clients, memberships } from "@/lib/db/schema";
import { submitReferral } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "You were referred to SKOX",
  description: "Good ideas deserve to be built. Tell SKOX what you want to build.",
  robots: { index: false, follow: false },
};

export default async function ReferralLanding({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  if (!/^[a-z0-9]{4,20}$/.test(code)) notFound();
  const [row] = await getDb()
    .select({ clientName: clients.name })
    .from(memberships)
    .innerJoin(clients, eq(clients.id, memberships.clientId))
    .where(eq(memberships.referralCode, code))
    .limit(1);
  if (!row) notFound();
  const sent = sp.sent === "1";

  return (
    <main className="signin">
      <section className="signin-intro">
        <SkoxLogo className="signin-logo" />
        <p className="eyebrow">Referred by {row.clientName}</p>
        <h1>Good ideas deserve to be built.</h1>
        <ul className="signin-points">
          <li>Web apps, portals, dashboards and websites</li>
          <li>Built fast, without dev-shop prices</li>
          <li>One portal to follow every step, like {row.clientName} does</li>
        </ul>
      </section>
      <section className="signin-card" aria-labelledby="ref-title">
        {sent ? (
          <div className="signin-sent" role="status">
            <h2 id="ref-title">Thanks, we&apos;ll be in touch</h2>
            <p className="muted">A founder will email you within one business day.</p>
          </div>
        ) : (
          <>
            <h2 id="ref-title">Tell us what you want to build</h2>
            <form action={submitReferral} className="stack" style={{ marginTop: 14 }}>
              <input type="hidden" name="code" value={code} />
              <div className="hp" aria-hidden="true">
                <label htmlFor="website">Leave empty</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              <div className="field">
                <label htmlFor="ref-name">Your name</label>
                <input id="ref-name" name="name" required maxLength={120} autoComplete="name" />
              </div>
              <div className="field">
                <label htmlFor="ref-email">Email</label>
                <input id="ref-email" name="email" type="email" required maxLength={200} autoComplete="email" />
              </div>
              <div className="field">
                <label htmlFor="ref-company">Company (optional)</label>
                <input id="ref-company" name="company" maxLength={120} autoComplete="organization" />
              </div>
              <div className="field">
                <label htmlFor="ref-idea">The idea</label>
                <textarea id="ref-idea" name="idea" maxLength={3000} placeholder="A sentence or two is plenty" />
              </div>
              <button className="btn btn-primary btn-block" type="submit">
                Send to SKOX
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
