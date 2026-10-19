import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed opt-out links for cold outreach: `<stable recipient id>.<HMAC of stable recipient id + email>`.
 * The address is signed but not carried, so the link never puts it in a URL.
 * The recipient record survives deal changes and deletion; tokens do not expire.
 *
 * Pure (node:crypto only) so it can be tested alone.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(dealId: string, email: string, secret: string) {
  return createHmac("sha256", secret).update(`${dealId.toLowerCase()}\n${email.trim().toLowerCase()}`).digest("base64url");
}

export function unsubscribeToken(dealId: string, email: string, secret: string) {
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not set.");
  return `${dealId.toLowerCase()}.${sign(dealId, email, secret)}`;
}

/** The stable recipient id a token names, before its signature is checked. Null when malformed. */
export function tokenDealId(token: string) {
  const [dealId, sig, extra] = token.split(".");
  return extra === undefined && sig && UUID.test(dealId) ? dealId.toLowerCase() : null;
}

/** True when the token was signed for this deal and one of these addresses. */
export function verifyUnsubscribeToken(token: string, emails: (string | null | undefined)[], secret: string) {
  const dealId = tokenDealId(token);
  if (!dealId || !secret) return false;
  const given = Buffer.from(token.split(".")[1]);
  return emails.some((email) => {
    if (!email) return false;
    const expected = Buffer.from(sign(dealId, email, secret));
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** The public opt-out address for a deal's email, under the portal's base URL. */
export function unsubscribeUrl(portalUrl: string, dealId: string, email: string, secret: string) {
  return `${portalUrl.replace(/\/$/, "")}/u/${unsubscribeToken(dealId, email, secret)}`;
}
