import type { PreviewStatus } from "./pipeline.ts";

/**
 * Rules for tracking a lead's preview site once it's out the door. Only views
 * after the link was sent count, so the team checking its own work never
 * fires the "they opened it" alert.
 */

/** A URL reduced to host and path, so http/https, www and a trailing slash all match. */
function bare(url: string) {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/** Whether an email body carries the deal's preview link. */
export function linksPreview(body: string, previewUrl: string | null | undefined) {
  if (!previewUrl) return false;
  const want = bare(previewUrl);
  if (!want) return false;
  const found = body.match(/https?:\/\/[^\s<>"')]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s<>"')]*/gi) ?? [];
  return found.some((u) => bare(u.replace(/[.,;:!]+$/, "")) === want);
}

/** Sending an email with the link marks a ready preview as sent. */
export function sentOnEmail(status: PreviewStatus) {
  return status === "ready" || status === "building";
}

/**
 * What a view of the preview means for the deal: ignored (not sent yet, or
 * archived), the first open (alert the team), or a later view (history only).
 */
export function openKind(status: PreviewStatus, firstOpenAt: Date | null): "ignore" | "first" | "repeat" {
  if (status === "sent") return firstOpenAt ? "repeat" : "first";
  if (status === "opened") return "repeat";
  return "ignore";
}

export function deviceLabel(device: unknown, userAgent: string | null) {
  if (device === "phone" || device === "desktop") return device;
  return /mobile|iphone|android/i.test(userAgent ?? "") ? "phone" : "desktop";
}

/** "4 minutes", "2 hours", "3 days": how long after sending they opened it. */
export function afterSending(sentAt: Date | null, at: Date) {
  if (!sentAt) return null;
  const min = Math.max(0, Math.round((at.getTime() - sentAt.getTime()) / 60000));
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}
