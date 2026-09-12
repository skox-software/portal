"use client";

import { useActionState } from "react";
import { sendMagicLink, type SignInState } from "./actions";

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(sendMagicLink, {
    status: "idle",
  });

  if (state.status === "sent") {
    return (
      <div className="signin-sent" role="status">
        <h2>Check your email</h2>
        <p>
          We sent a sign-in link to <strong>{state.email}</strong>. Open it on this
          device; it expires soon.
        </p>
        <p className="muted">
          Nothing after a couple of minutes? Check your spam folder, or{" "}
          <a href="/sign-in">send another link</a>.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="stack">
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          aria-invalid={state.status === "error"}
          aria-describedby={state.status === "error" ? "email-error" : undefined}
        />
        {state.status === "error" && (
          <p className="field-error" id="email-error" role="alert">
            {state.message}
          </p>
        )}
      </div>
      <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
        {pending ? "Sending your link…" : "Email me a sign-in link"}
      </button>
      <p className="muted small">No password. We&apos;ll email you a one-time link.</p>
    </form>
  );
}
