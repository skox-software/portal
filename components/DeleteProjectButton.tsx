"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { DeleteProjectState } from "@/lib/project-deletion";

type Props = {
  projectId: string;
  projectName: string;
  action: (state: DeleteProjectState, formData: FormData) => Promise<DeleteProjectState>;
};

export function DeleteProjectButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-danger btn-small"
        aria-label={`Delete project: ${props.projectName}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Delete
      </button>
      {open && <DeleteProjectDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteProjectDialog({ projectId, projectName, action, onClose }: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [confirmation, setConfirmation] = useState("");
  const [state, formAction, pending] = useActionState(action, { error: null });

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="delete-project-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onClose={() => { if (!dialog.current?.open) onClose(); }}
      onCancel={(event) => { if (pending) event.preventDefault(); }}
    >
      <form action={formAction} className="stack" aria-busy={pending}>
        <input type="hidden" name="projectId" value={projectId} />
        <h2 id={`${id}-title`}>Delete {projectName}?</h2>
        <p id={`${id}-description`} className="small muted">
          This permanently removes the project and its files, documents, invoice records,
          updates and onboarding history. The client account and their other projects remain.
          This cannot be undone.
        </p>
        <div className="field">
          <label htmlFor={`${id}-confirmation`}>Type <strong>{projectName}</strong> to confirm</label>
          <input
            id={`${id}-confirmation`}
            name="confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            maxLength={140}
            autoComplete="off"
            spellCheck={false}
            readOnly={pending}
          />
        </div>
        {state.error && <p className="field-error" role="alert">{state.error}</p>}
        <div className="row delete-project-dialog-actions">
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-danger-solid"
            disabled={pending || confirmation.trim() !== projectName}
          >
            {pending ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
