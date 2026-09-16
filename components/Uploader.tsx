"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { withBase } from "@/lib/paths";

type Purpose = "file" | "document" | "screenshot";

/**
 * Uploads straight to private storage, then hands the stored path to a server
 * action that checks it and records it. `fields` are extra form values for
 * that action (title, signers…), read from the surrounding form.
 */
export function Uploader({
  projectId,
  purpose,
  action,
  accept,
  label,
  buttonLabel,
  formId,
  multiple = false,
}: {
  projectId: string;
  purpose: Purpose;
  action: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
  accept?: string;
  label: string;
  buttonLabel: string;
  /** Optional form whose fields are sent along with each upload. */
  formId?: string;
  multiple?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message?: string; error?: boolean; progress?: number }>({
    busy: false,
  });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const chosen = Array.from(input.current?.files ?? []);
    if (chosen.length === 0) {
      setState({ busy: false, message: "Choose a file first.", error: true });
      return;
    }
    if (formId) {
      const form = document.getElementById(formId) as HTMLFormElement | null;
      if (form && !form.reportValidity()) return;
    }
    setState({ busy: true, progress: 0 });
    try {
      let last = { ok: true, message: "" };
      for (const file of chosen) {
        const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
        const blob = await upload(`projects/${projectId}/${purpose}/${safeName}`, file, {
          access: "private",
          handleUploadUrl: withBase("/api/uploads"),
          clientPayload: JSON.stringify({ projectId, purpose }),
          onUploadProgress: ({ percentage }) => setState((s) => ({ ...s, progress: Math.round(percentage) })),
        });
        const data = formId
          ? new FormData(document.getElementById(formId) as HTMLFormElement)
          : new FormData();
        data.set("projectId", projectId);
        data.set("pathname", blob.pathname);
        data.set("fileName", file.name);
        last = await action(data);
        if (!last.ok) break;
      }
      setState({ busy: false, message: last.message, error: !last.ok });
      if (last.ok) {
        if (input.current) input.current.value = "";
        if (formId) (document.getElementById(formId) as HTMLFormElement | null)?.reset();
        router.refresh();
      }
    } catch (error) {
      setState({ busy: false, message: (error as Error).message || "Upload failed. Try again.", error: true });
    }
  }

  return (
    <form onSubmit={onSubmit} className="uploader">
      <label className="dropzone">
        <input ref={input} type="file" accept={accept} multiple={multiple} disabled={state.busy} />
        <span className="dropzone-label">{label}</span>
      </label>
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={state.busy}>
          {state.busy ? `Uploading… ${state.progress ?? 0}%` : buttonLabel}
        </button>
        {state.message && (
          <span className={state.error ? "field-error" : "muted small"} role={state.error ? "alert" : "status"}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
