import { getAuth } from "@/lib/auth/server";

type Middleware = ReturnType<ReturnType<typeof getAuth>["middleware"]>;

/**
 * Sends signed-out visitors to /sign-in and keeps sessions fresh. This is an
 * optimistic check only: every page and server action still authorizes on
 * the server through lib/access.ts.
 */
export default function proxy(...args: Parameters<Middleware>) {
  return getAuth().middleware({ loginUrl: "/sign-in" })(...args);
}

export const config = {
  // Public: sign-in, read-only status links (/s), referral pages (/r), the
  // daily reminder cron and Stripe's webhook (both verify their own secrets).
  matcher: ["/((?!api/auth|api/cron|api/stripe|sign-in|s/|r/|_next/static|_next/image|favicon.ico|icon).*)"],
};
