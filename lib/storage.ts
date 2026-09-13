import { createHash } from "node:crypto";
import { get, head, put } from "@vercel/blob";

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

/** Streams a private blob to the browser after the caller has checked access. */
export async function blobResponse(
  pathnameOrUrl: string,
  { fileName, inline }: { fileName: string; inline: boolean },
) {
  const result = await readPrivate(pathnameOrUrl);
  if (!result) return new Response("Not found", { status: 404 });
  const safeName = fileName.replace(/["\r\n]/g, "");
  return new Response(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType || "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
