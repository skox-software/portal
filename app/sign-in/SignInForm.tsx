"use client";

import { useActionState } from "react";
import { signInWithCode, type SignInState } from "./actions";

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInWithCode, {
    step: "email",
  });

  if (state.step === "code") {
    return (
      <form action={action} className="stack">
        <input type="hidden" name="email" value={state.email} />
        <p role="status">
          {state.resent ? "New code sent" : "Code sent"} to <strong>{state.email}</strong>. It
          expires in a few minutes.
        </p>
        <div className="field">
          <label htmlFor="otp">6-digit code</label>
          <input
            id="otp"
            name="otp"
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            autoFocus
            aria-invalid={Boolean(state.error)}
            aria-describedby={state.error ? "otp-error" : undefined}
          />
          {state.error && (
            <p className="field-error" id="otp-error" role="alert">
              {state.error}
            </p>
          )}
        </div>
        <button
          className="btn btn-primary btn-block"
          type="submit"
          name="intent"
          value="verify"
          disabled={pending}
        >
          {pending ? "Checking…" : "Sign in"}
        </button>
        <p className="muted small">
          Nothing arrived? Check spam, then{" "}
          <button className="btn btn-link small" type="submit" name="intent" value="resend" formNoValidate>
            send a new code
          </button>{" "}
          or <a href="/sign-in">use a different email</a>.
        </p>
      </form>
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
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "email-error" : undefined}
        />
        {state.error && (
          <p className="field-error" id="email-error" role="alert">
            {state.error}
          </p>
        )}
      </div>
      <button className="btn btn-primary btn-block" type="submit" name="intent" value="send" disabled={pending}>
        {pending ? "Sending your code…" : "Email me a sign-in code"}
      </button>
      <p className="muted small">No password. We&apos;ll email you a 6-digit code.</p>
    </form>
  );
}
