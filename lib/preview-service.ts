import { timingSafeEqual } from "node:crypto";
import { PREVIEW_STATUS_VALUES, type PreviewStatus } from "./pipeline.ts";

/**
 * The preview builder (docs/prospects/preview-playbook.md, "Automating it from
 * the portal") calls /api/lead-previews with `Authorization: Bearer
 * $PREVIEW_SERVICE_SECRET`. Without the secret set, the API is closed.
 */
export function previewServiceAuthorized(request: Request) {
  const secret = process.env.PREVIEW_SERVICE_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The builder's actor id in a deal's history. */
export const PREVIEW_SERVICE_ACTOR = "preview-service";

/** Where the builder may move a preview. Requesting is a person's call, and so is Gate A. */
export const SERVICE_STATUSES = PREVIEW_STATUS_VALUES.filter((s) => s !== "none" && s !== "requested") as [PreviewStatus, ...PreviewStatus[]];

/**
 * Checks a builder update against the preview's state. It can't start a
 * build Josh hasn't approved, and can't move a preview that was never
 * requested. Returns the status to save, or an error.
 */
export function serviceTransition(
  current: PreviewStatus,
  decision: unknown,
  update: { status?: PreviewStatus; sentAt?: string | null; firstOpenAt?: string },
): { ok: true; status: PreviewStatus } | { ok: false; error: string } {
  if (current === "none") return { ok: false, error: "No preview was requested for this deal." };
  // Convenience: a send or a first open moves the status on when none was given.
  let status = update.status ?? current;
  if (!update.status && update.sentAt && (current === "ready" || current === "building")) status = "sent";
  if (!update.status && update.firstOpenAt && (current === "sent" || current === "ready")) status = "opened";
  if (status === "building" && current !== "building") {
    const d = (decision ?? {}) as { decision?: string };
    if (d.decision !== "go" && d.decision !== "go_with_changes") return { ok: false, error: "Building needs a Go at Gate A first." };
  }
  if (current === "archived" && status !== "archived") return { ok: false, error: "This preview is archived. Request a new one from the portal." };
  return { ok: true, status };
}
