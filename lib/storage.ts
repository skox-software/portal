import { createHash } from "node:crypto";
import { del, get, head, put } from "@vercel/blob";

/**
 * Private file storage (Vercel Blob, private store). Nothing is ever served
 * from a public URL: every download goes through a portal route that checks
 * who is asking first.
 */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Every blob for a project lives under this prefix; uploads outside it are rejected. */
export function projectPrefix(projectId: string) {
  return `projects/${projectId}/`;
}

export async function putPrivate(pathname: string, body: Buffer | Uint8Array, contentType: string) {
  return put(pathname, Buffer.from(body), { access: "private", contentType, addRandomSuffix: true });
}

export async function statPrivate(pathnameOrUrl: string) {
  try {
    return await head(pathnameOrUrl);
  } catch {
    return null;
  }
}

/** Removes a stored file; never throws (the database row is the source of truth). */
export async function deletePrivate(pathnameOrUrl: string) {
  try {
    await del(pathnameOrUrl);
  } catch (error) {
    console.error("[storage] could not delete blob", { pathnameOrUrl, error });
  }
}

export async function readPrivate(pathnameOrUrl: string) {
  const result = await get(pathnameOrUrl, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return result;
}

export async function readPrivateBytes(pathnameOrUrl: string) {
  const result = await readPrivate(pathnameOrUrl);
  if (!result) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Streams a private blob to the browser after the caller has checked access.
 * `range` (one checked "bytes=a-b" range) is passed to storage so a video can
 * seek; the answer is 206 when storage returns just that part.
 */
export async function blobResponse(
  pathnameOrUrl: string,
  { fileName, inline, range }: { fileName: string; inline: boolean; range?: string | null },
) {
  let result: Awaited<ReturnType<typeof readPrivate>>;
  if (range) {
    try {
      const got = await get(pathnameOrUrl, { access: "private", headers: { Range: range } });
      result = got && got.statusCode === 200 ? got : null;
    } catch {
      // Storage refuses a range past the end of the file.
      return new Response("Range not satisfiable", { status: 416 });
    }
  } else {
    result = await readPrivate(pathnameOrUrl);
  }
  if (!result) return new Response("Not found", { status: 404 });
  const safeName = fileName.replace(/["\r\n]/g, "");
  const contentRange = range ? result.headers.get("content-range") : null;
  const length = result.headers.get("content-length");
  return new Response(result.stream, {
    status: contentRange ? 206 : 200,
    headers: {
      "Content-Type": result.blob.contentType || "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(range !== undefined ? { "Accept-Ranges": "bytes" } : {}),
      ...(contentRange ? { "Content-Range": contentRange } : {}),
      ...(range !== undefined && length ? { "Content-Length": length } : {}),
    },
  });
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
