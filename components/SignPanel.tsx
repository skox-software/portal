"use client";

import { useActionState, useState } from "react";
import { signDocument, type SignState } from "@/app/projects/[id]/documents/actions";

/** Type your name, agree, sign. Shows the signature as it will appear. */
export function SignPanel({ documentId, consentText, defaultName }: { documentId: string; consentText: string; defaultName: string }) {
  const [state, action, pending] = useActionState<SignState, FormData>(signDocument, { status: "idle" });
  const [name, setName] = useState(defaultName);

  if (state.status === "signed") {
    return (
      <div className="signed-done" role="status">
        <p className="signed-check" aria-hidden="true">
          ✓
        </p>
        <h2>Signed. Thank you.</h2>
        <p className="muted">
          {state.next
            ? "Everyone has signed. One step left before we start building."
            : state.complete
              ? "Everyone has signed. Your signed copy with its certificate is ready below."
              : "We'll email you the fully signed copy as soon as everyone else signs."}
        </p>
        {state.next && (
          <a className="btn btn-primary" href={state.next.href}>
            {state.next.label} →
          </a>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="stack sign-form">
      <input type="hidden" name="documentId" value={documentId} />
      <div className="field">
        <label htmlFor="typedName">Type your full name</label>
        <input
          id="typedName"
          name="typedName"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="signature-preview" aria-hidden="true">
        <span>{name || "Your signature"}</span>
      </div>
      <label className="check consent">
        <input type="checkbox" name="consent" required />
        <span className="small">{consentText}</span>
      </label>
      <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
        {pending ? "Signing…" : "Sign document"}
      </button>
      {state.status === "error" && (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      )}
      <p className="small muted">We record the time, your IP address and device, and a fingerprint of this exact file.</p>
    </form>
  );
}
