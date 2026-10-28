import { getAuth } from "@/lib/auth/server";
import { BASE_PATH } from "@/lib/paths";
import { billingDestination } from "@/lib/sign-in-destination";

type Middleware = ReturnType<ReturnType<typeof getAuth>["middleware"]>;

/**
 * Sends signed-out visitors to /sign-in and keeps sessions fresh. This is an
 * optimistic check only: every page and server action still authorizes on
 * the server through lib/access.ts.
 *
 * The login URL carries the base path by hand — Neon Auth resolves it against
 * the request URL, so a bare "/sign-in" would land on the marketing site.
 */
export default function proxy(...args: Parameters<Middleware>) {
  const url = new URL(args[0].url);
  const next = billingDestination(`${url.pathname}${url.search}`);
  const loginUrl = `${BASE_PATH}/sign-in${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`;
  return getAuth().middleware({ loginUrl })(...args);
}

export const config = {
  // Public: sign-in, read-only status links (/s), referral pages (/r), email opt-out links (/u), the
  // daily reminder cron, Stripe's and Resend's webhooks, Resend's delivery reports and the preview builder's API (all verify their own secrets),
  // and the icons, share image, brand images (the email logo) and app manifest that browsers, mail clients and link previews fetch.
  matcher: ["/((?!api/auth|api/cron|api/stripe|api/inbound|api/resend|api/lead-previews|sign-in|s/|r/|u/|_next/static|_next/image|favicon.ico|icon|apple-icon|share-image|brand/|manifest.webmanifest).*)"],
};
