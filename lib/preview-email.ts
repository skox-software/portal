/**
 * The email that sends a lead their preview: their name in the subject, a
 * few plain lines with the link, one ask, signed by whoever sends it.
 * Pure, so it can be tested alone.
 */

import { greetingName, signatureFor, type DraftAuthor } from "./email-draft.ts";

export function buildPreviewEmail(input: { company: string; contactName?: string | null; askFor?: string | null; url: string; author: DraftAuthor }) {
  const name = greetingName(input.contactName) ?? greetingName(input.askFor);
  const subject = `${input.company}: your website preview`;
  const body = [
    `Hi ${name ?? "there"},`,
    "",
    `As promised, here's the preview I put together for ${input.company}, built from your own photos and details:`,
    "",
    input.url,
    "",
    "It works best on your phone. Try the buttons; they're live.",
    "",
    "Would you have 15 minutes this week to go over it? You'd get a fixed price and launch date before anything starts.",
    "",
    "Thanks,",
    ...signatureFor(input.author),
  ].join("\n");
  return { subject, body };
}
