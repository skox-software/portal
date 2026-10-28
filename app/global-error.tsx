"use client";

import { BRAND, SUPPORT_EMAIL } from "@/lib/brand";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: BRAND.paper, color: BRAND.ink, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 24px" }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: BRAND.ink2 }}>UnBusy portal</p>
          <h1 style={{ fontWeight: 700, fontSize: 36, letterSpacing: "-0.02em", margin: "8px 0 12px" }}>We hit a snag.</h1>
          <p style={{ lineHeight: 1.6 }}>
            Nothing you saved has been lost. Try again in a moment, or email {SUPPORT_EMAIL}
            {error.digest ? ` with reference ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 20, padding: "12px 22px", borderRadius: 8, border: 0, background: BRAND.ink, color: BRAND.paper, fontSize: 15, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
