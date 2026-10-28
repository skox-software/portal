"use client";

import Link from "next/link";
import { useEffect } from "react";
import { SUPPORT_EMAIL } from "@/lib/brand";

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[portal] page error", error);
  }, [error]);

  return (
    <main className="shell" style={{ maxWidth: 640, paddingTop: 80, paddingBottom: 80 }}>
      <p className="eyebrow">Something went wrong</p>
      <h1>This page didn&apos;t load.</h1>
      <p className="lede">
        Nothing you saved has been lost. Try again in a moment. If it keeps happening, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        {error.digest ? ` and mention reference ${error.digest}` : ""}.
      </p>
      <div className="row" style={{ marginTop: 24 }}>
        <button className="btn btn-primary" type="button" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-ghost" href="/">
          Go to your projects
        </Link>
      </div>
    </main>
  );
}
