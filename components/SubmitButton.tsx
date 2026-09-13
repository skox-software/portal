"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that shows it's working and can't be pressed twice
 * (no double payments, approvals or saves).
 */
export function SubmitButton({
  pendingLabel,
  children,
  disabled,
  ...props
}: Omit<ComponentProps<"button">, "type"> & { pendingLabel?: string }) {
  const { pending, data } = useFormStatus();
  // With several submit buttons in one form, only the one that was pressed says it's working.
  const pressed = pending && (!props.name || data?.get(props.name) === props.value);
  return (
    <button {...props} type="submit" disabled={disabled || pending} aria-busy={pressed || undefined}>
      {pressed && pendingLabel ? pendingLabel : children}
    </button>
  );
}
