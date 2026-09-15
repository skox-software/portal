import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SkoxLogo } from "@/components/SkoxLogo";
import { getViewer } from "@/lib/access";
import { SignInForm } from "./SignInForm";
import { billingDestination } from "@/lib/sign-in-destination";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { email, next } = await searchParams;
  const destination = billingDestination(next);
  if (await getViewer()) redirect(destination);
  const prefill = typeof email === "string" && /^[^\s@]+@[^\s@]+$/.test(email) ? email.slice(0, 200) : "";

  return (
    <main className="signin">
      <section className="signin-intro">
        <SkoxLogo className="signin-logo" />
        <p className="eyebrow">Client Portal</p>
        <h1>Your project, in one place.</h1>
        <ul className="signin-points">
          <li>Your launch date and progress, always on screen</li>
          <li>Weekly updates on what shipped and what&apos;s next</li>
          <li>What we need from you, and by when</li>
        </ul>
      </section>
      <section className="signin-card" aria-labelledby="signin-title">
        <h2 id="signin-title">Sign in</h2>
        <p className="muted">Use the email your invitation went to.</p>
        {destination !== "/" && <p className="small muted">Sign in to view your invoice and continue to payment.</p>}
        <SignInForm defaultEmail={prefill} destination={destination} />
      </section>
    </main>
  );
}
