import { createHmac, timingSafeEqual } from "node:crypto";

/** Webhook signatures as Svix (Resend's webhook sender) makes them. Pure, so it can be tested alone. */

const TOLERANCE_SECONDS = 5 * 60;

/**
 * Svix signature check: HMAC-SHA256 over `id.timestamp.body` with the
 * base64 key after `whsec_`, any `v1,` signature in the header may match, and
 * the timestamp must be within five minutes so a captured request can't be
 * replayed later.
 */
export function verifySvix(
  payload: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
