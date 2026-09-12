import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * The portal's public origin, for links that leave the app (sign-in emails).
 * PORTAL_URL wins when set, so a spoofed Host header can never steer a link;
 * Neon Auth's trusted-domain list is the second guard.
 */
export async function portalOrigin() {
  if (process.env.PORTAL_URL) return process.env.PORTAL_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3300";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Sends the browser back to a page with a message the page shows as a banner. */
export function backWith(path: string, kind: "error" | "notice", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${kind}=${encodeURIComponent(message)}`);
}
