/**
 * Sales files: the team's own sales material (demo videos, one-pagers, decks).
 * Pure rules, shared by the upload route, the actions and the download route.
 * Staff only: the people who can upload are the people who can see them.
 */

/** Demo videos run larger than project files; 500 MB covers a few minutes of 1080p. */
export const SALES_MAX_BYTES = 500 * 1024 * 1024;

/** Every sales file for a workspace lives under this prefix; uploads outside it are rejected. */
export function salesPrefix(workspaceId: string) {
  return `sales/${workspaceId}/`;
}

/** The stored path is inside this workspace's sales folder, with no way to climb out of it. */
export function isSalesPath(pathname: string, workspaceId: string) {
  return pathname.startsWith(salesPrefix(workspaceId)) && !pathname.includes("..") && pathname.length > salesPrefix(workspaceId).length;
}

/** The file name the browser sends, made safe for a storage path. */
export function safeUploadName(name: string) {
  return name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
}

export type InlineKind = "video" | "image" | "pdf";

/**
 * How a file may show inside the portal. Only types a browser renders without running
 * anything; everything else downloads, so an uploaded HTML or SVG file can never run in
 * the portal's origin.
 */
export function inlineKind(contentType: string | null | undefined): InlineKind | null {
  const type = (contentType ?? "").toLowerCase().split(";")[0].trim();
  if (/^video\/(mp4|webm|quicktime)$/.test(type)) return "video";
  if (/^image\/(png|jpeg|webp|gif)$/.test(type)) return "image";
  if (type === "application/pdf") return "pdf";
  return null;
}

/** A short label for the file's type, for the list. */
export function kindLabel(contentType: string | null | undefined, fileName: string) {
  const kind = inlineKind(contentType);
  if (kind === "video") return "Video";
  if (kind === "image") return "Image";
  if (kind === "pdf") return "PDF";
  const ext = fileName.split(".").pop();
  return ext && ext !== fileName && ext.length <= 4 ? ext.toUpperCase() : "File";
}

/** The title to store: what the person typed, else the file name without its extension. */
export function salesTitle(typed: unknown, fileName: string) {
  const title = String(typed ?? "").trim().replace(/\s+/g, " ").slice(0, 140);
  if (title) return title;
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 140) || "Untitled";
}

/** A single byte range from a Range header ("bytes=0-" or "bytes=100-199"), or null to send the whole file. */
export function singleByteRange(header: string | null | undefined) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] !== "" && match[2] !== "" && Number(match[2]) < Number(match[1])) return null;
  return `bytes=${match[1]}-${match[2]}`;
}
