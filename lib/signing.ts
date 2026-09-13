import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * Builds the signed copy of a document: the original pages, a small footer on
 * each page naming the document ID, and a signature certificate at the end
 * recording who signed, when, from where, and the fingerprint of the exact
 * file they saw. The certificate is what makes the signature defensible.
 */

export type SignatureRecord = {
  email: string;
  typedName: string;
  signedAt: Date;
  ip: string | null;
  userAgent: string | null;
  viewedAt: Date | null;
};

export const CONSENT_TEXT =
  "I agree that typing my name and selecting Sign is my electronic signature, that it is as legally binding as a handwritten signature, and that I consent to do business electronically with SKOX Software.";

const INK = rgb(0.11, 0.125, 0.114);
const MUTED = rgb(0.36, 0.38, 0.34);
const AMBER = rgb(0.894, 0.663, 0.027);

function stamp(date: Date) {
  return `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

/** pdf-lib's standard fonts only encode WinAnsi; drop anything they can't draw. */
function safe(text: string) {
  return text.replace(/[^\x20-\x7E -ÿ]/g, "?");
}

function wrap(text: string, max: number) {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > max) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildSignedPdf(input: {
  original: Uint8Array;
  documentId: string;
  title: string;
  originalSha256: string;
  projectName: string;
  clientName: string;
  signatures: SignatureRecord[];
  completedAt: Date;
}) {
  const pdf = await PDFDocument.load(input.original, { ignoreEncryption: true });
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const script = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  for (const page of pdf.getPages()) {
    const { width } = page.getSize();
    const text = safe(`Signed electronically via SKOX Client Portal · Document ${input.documentId}`);
    page.drawText(text, { x: 24, y: 14, size: 7, font: sans, color: MUTED, maxWidth: width - 48 });
  }

  let page = pdf.addPage([612, 792]);
  let y = 740;
  const left = 56;
  const line = (text: string, opts: { size?: number; font?: typeof sans; color?: typeof INK; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    if (y < 72) {
      page = pdf.addPage([612, 792]);
      y = 740;
    }
    page.drawText(safe(text), { x: left, y, size, font: opts.font ?? sans, color: opts.color ?? INK });
    y -= opts.gap ?? size + 6;
  };

  page.drawText("SKO", { x: left, y, size: 20, font: bold, color: INK });
  page.drawText("X", { x: left + bold.widthOfTextAtSize("SKO", 20), y, size: 20, font: bold, color: AMBER });
  y -= 36;
  line("Signature certificate", { size: 22, font: bold, gap: 30 });
  line(`Document: ${input.title}`, { size: 11 });
  line(`Project: ${input.projectName} (${input.clientName})`, { size: 11 });
  line(`Document ID: ${input.documentId}`, { size: 11 });
  line(`Completed: ${stamp(input.completedAt)}`, { size: 11, gap: 22 });
  line("Fingerprint of the document as sent (SHA-256)", { size: 9, color: MUTED, gap: 13 });
  line(input.originalSha256, { size: 9, gap: 26 });

  for (const s of input.signatures) {
    page.drawLine({ start: { x: left, y: y + 8 }, end: { x: 556, y: y + 8 }, thickness: 0.5, color: rgb(0.89, 0.886, 0.847) });
    y -= 10;
    line(s.typedName, { size: 24, font: script, gap: 30 });
    line(`${s.typedName} <${s.email}>`, { size: 10, font: bold });
    line(`Signed: ${stamp(s.signedAt)}`, { size: 9 });
    if (s.viewedAt) line(`First opened: ${stamp(s.viewedAt)}`, { size: 9 });
    line(`IP address: ${s.ip ?? "unknown"}`, { size: 9 });
    for (const l of wrap(`Device: ${s.userAgent ?? "unknown"}`, 100)) line(l, { size: 8, color: MUTED, gap: 11 });
    y -= 14;
  }

  y -= 6;
  line("Consent each signer agreed to", { size: 9, font: bold, gap: 13 });
  for (const l of wrap(CONSENT_TEXT, 105)) line(l, { size: 8, color: MUTED, gap: 11 });
  y -= 8;
  for (const l of wrap(
    "Each signer was signed in to the SKOX Client Portal with an email address verified by a one-time code at the time of signing. Changing the document after it was sent would change its fingerprint and invalidate these signatures.",
    105,
  ))
    line(l, { size: 8, color: MUTED, gap: 11 });

  pdf.setTitle(`${input.title} (signed)`);
  pdf.setProducer("SKOX Client Portal");
  return pdf.save();
}
