import { createNeonAuth } from "@neondatabase/auth/next/server";

let instance: ReturnType<typeof createNeonAuth> | undefined;

/**
 * Neon Auth (Managed Better Auth). Sign-in only proves who someone is; what
 * they may do is decided by the portal's own memberships (lib/access.ts).
 *
 * Created on first use so builds without the auth env vars still compile.
 */
export function getAuth() {
  if (!instance) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret) {
      throw new Error("NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET must be set");
    }
    instance = createNeonAuth({
      baseUrl,
      cookies: {
        secret,
        // Lax, not the default strict: clients arrive from links in emails,
        // and a strict cookie would make them look signed out on that click.
        sameSite: "lax",
      },
    });
  }
  return instance;
}
