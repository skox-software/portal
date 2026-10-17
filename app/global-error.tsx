"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#faf9f6", color: "#1c201d", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 24px" }}>
          <p style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#676b62" }}>SKOX portal</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 36, margin: "8px 0 12px" }}>We hit a snag.</h1>
          <p style={{ lineHeight: 1.6 }}>
            Nothing you saved has been lost. Try again in a moment, or email founder@skoxsoftware.com
            {error.digest ? ` with reference ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 20, padding: "12px 22px", borderRadius: 999, border: 0, background: "#1c201d", color: "#faf9f6", fontSize: 15, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
