/**
 * The brand and the public addresses the portal names, in one place.
 *
 * Every address comes from the environment, so moving to gounbusy.com is a
 * config change (docs/DEPLOYMENT.md, "Cutover to gounbusy.com"). The defaults
 * are today's live values. No imports: next.config.ts reads this file too.
 */
const trim = (url: string) => url.replace(/\/$/, "");

export const BRAND_NAME = "UnBusy";

/** The marketing site. */
export const SITE_URL = trim(process.env.PUBLIC_SITE_URL || "https://www.skoxsoftware.com");

/** The portal's public address, including the /portal base path. */
export const PORTAL_URL = trim(process.env.PORTAL_URL || "https://www.skoxsoftware.com/portal");

/** The From line on every portal email. Its domain must be verified in Resend. */
export const MAIL_FROM = process.env.EMAIL_FROM || "UnBusy <portal@skoxsoftware.com>";

/**
 * Where clients write to a person: replies, "email us", account invitations.
 * NEXT_PUBLIC_ so the error pages, which render in the browser, read it too.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "founder@skoxsoftware.com";

/** The logo for email (480×116 PNG; Gmail drops SVG), shown at 120×29. */
export const EMAIL_LOGO_URL = `${PORTAL_URL}/brand/lockup-email.png`;

/** The brand colours, for places CSS can't reach: emails and PDFs. */
export const BRAND = {
  ink: "#15181D",
  ink2: "#5B6168",
  paper: "#FAFAF8",
  paper2: "#F1F1EE",
  blue: "#0B5CFF",
  blueDeep: "#0845C2",
  sky: "#E9F0FF",
  rule: "rgba(21,24,29,.14)",
  /** --rule flattened onto paper, for email clients that ignore rgba borders. */
  ruleSolid: "#DCDDDC",
} as const;
