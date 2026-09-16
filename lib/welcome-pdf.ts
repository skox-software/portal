import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

/**
 * The branded welcome guide: a personal, printable "here's what happens next"
 * for a new client, in SKOX's typefaces and colours. Everything on it is
 * either their own information or how the portal actually works, so nothing
 * over-promises.
 */

export type WelcomeGuideInput = {
  companyName: string;
  contactName: string | null;
  email: string;
  projectName: string;
  kindLabel: string;
  launch: string | null;
  recap: string | null;
  goal: string | null;
  teamIntro: string | null;
  schedulingUrl: string | null;
  portalUrl: string;
  hasAgreement: boolean;
  checklist: { label: string; done: boolean; note?: string }[];
  preparedOn: Date;
};

const c = (r: number, g: number, b: number) => rgb(r / 255, g / 255, b / 255);
const INK = c(28, 32, 29);
const CANVAS = c(250, 249, 246);
const PAPER = c(255, 255, 255);
const AMBER = c(228, 169, 7);
const AMBER_INK = c(122, 90, 5);
const BLUSH = c(247, 230, 196);
const BLUSH_INK = c(90, 63, 10);
const MUTED = c(92, 97, 87);
const LINE = c(228, 226, 216);
const FOG = c(243, 241, 235);
const OK = c(47, 107, 67);
const COVER_MUTED = c(201, 198, 184);

const W = 612;
const H = 792;
const M = 56;

const LOGO_SK =
  "M134 2L471 3L414 59L132 59L106 67L92 87L95 113L103 121L115 125L391 125L413 129L430 137L454 161L466 196L465 234L458 255L448 271L431 287L411 298L371 307L0 307L59 250L364 250L381 245L394 229L394 200L384 188L372 184L99 184L66 176L46 164L33 149L21 114L22 80L32 52L49 31L71 16L101 6ZM540 2L610 2L612 132L695 132L862 2L972 3L771 151L957 308L848 308L696 184L612 184L610 308L536 308L536 3Z";
const LOGO_O_OUTER = "M1091 6H1363A80 66 0 0 1 1443 72V242A80 66 0 0 1 1363 308H1091A80 66 0 0 1 1011 242V72A80 66 0 0 1 1091 6Z";
const LOGO_O_INNER = "M1105 62H1349A28 28 0 0 1 1377 90V224A28 28 0 0 1 1349 252H1105A28 28 0 0 1 1077 224V90A28 28 0 0 1 1105 62Z";
const LOGO_X = "M1480 0L1579 1L1936 308L1835 308L1525 43L1478 1ZM1647 169L1694 211L1573 308L1478 308ZM1861 0L1958 1L1776 147L1730 106Z";

type Fonts = { serif: PDFFont; serifItalic: PDFFont; sans: PDFFont; medium: PDFFont; semibold: PDFFont; mono: PDFFont };

async function loadFonts(pdf: PDFDocument): Promise<Fonts> {
  const dir = path.join(process.cwd(), "assets", "fonts");
  // Subsetting makes fontkit write a real TrueType program; embedding the WOFF
  // bytes as-is produces a PDF whose text doesn't render in most viewers.
  const load = async (file: string) => pdf.embedFont(await readFile(path.join(dir, file)), { subset: true });
  const [serif, serifItalic, sans, medium, semibold, mono] = await Promise.all([
    load("InstrumentSerif-Regular.woff"),
    load("InstrumentSerif-Italic.woff"),
    load("Geist-Regular.woff"),
    load("Geist-Medium.woff"),
    load("Geist-SemiBold.woff"),
    load("GeistMono-Medium.woff"),
  ]);
  return { serif, serifItalic, sans, medium, semibold, mono };
}

/** Rounded rectangle as an SVG path (drawn from the top-left corner). */
function rr(w: number, h: number, r: number) {
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

function box(page: PDFPage, x: number, top: number, w: number, h: number, opts: { fill: RGB; border?: RGB; r?: number }) {
  page.drawSvgPath(rr(w, h, opts.r ?? 12), {
    x,
    y: top,
    color: opts.fill,
    borderColor: opts.border,
    borderWidth: opts.border ? 1 : 0,
  });
}

/** Keeps only characters the embedded latin fonts can draw. */
function clean(text: string) {
  return text.replace(/[←-⇿☀-➿\u{1f000}-\u{1faff}]/gu, "").replace(/\r/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

/** Draws wrapped text from a top baseline; returns the y below the last line. */
function para(
  page: PDFPage,
  text: string,
  o: { x: number; y: number; width: number; font: PDFFont; size: number; color: RGB; leading?: number; maxLines?: number },
) {
  const leading = o.leading ?? o.size * 1.45;
  let lines = wrap(text, o.font, o.size, o.width);
  if (o.maxLines && lines.length > o.maxLines) {
    lines = lines.slice(0, o.maxLines);
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[\s,.;:]+\S*$/, "")}…`;
  }
  let y = o.y;
  for (const l of lines) {
    page.drawText(l, { x: o.x, y, size: o.size, font: o.font, color: o.color });
    y -= leading;
  }
  return y;
}

function logo(page: PDFPage, x: number, top: number, width: number, skColor: RGB, ground: RGB) {
  const scale = width / 1959;
  page.drawSvgPath(LOGO_SK, { x, y: top, scale, color: skColor });
  page.drawSvgPath(LOGO_O_OUTER, { x, y: top, scale, color: AMBER });
  page.drawSvgPath(LOGO_O_INNER, { x, y: top, scale, color: ground });
  page.drawSvgPath(LOGO_X, { x, y: top, scale, color: AMBER });
}

function tick(page: PDFPage, x: number, y: number, size: number, color: RGB) {
  page.drawLine({ start: { x: x + size * 0.2, y: y + size * 0.5 }, end: { x: x + size * 0.42, y: y + size * 0.28 }, thickness: 1.8, color });
  page.drawLine({ start: { x: x + size * 0.42, y: y + size * 0.28 }, end: { x: x + size * 0.82, y: y + size * 0.74 }, thickness: 1.8, color });
}

function contentPage(pdf: PDFDocument, f: Fonts, n: number, eyebrow: string, title: string) {
  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: CANVAS });
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: AMBER });
  logo(page, M, H - 44, 58, INK, CANVAS);
  page.drawText(`${String(n).padStart(2, "0")}`, { x: W - M - f.mono.widthOfTextAtSize("00", 9), y: H - 56, size: 9, font: f.mono, color: MUTED });
  page.drawText(eyebrow.toUpperCase(), { x: M, y: H - 96, size: 9, font: f.mono, color: AMBER_INK });
  const after = para(page, title, { x: M, y: H - 132, width: W - M * 2, font: f.serif, size: 34, color: INK, leading: 36 });
  page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.6, color: LINE });
  page.drawText("SKOX Client Portal  ·  Welcome guide", { x: M, y: 26, size: 8, font: f.mono, color: MUTED });
  const url = "portal.skoxsoftware.com";
  page.drawText(url, { x: W - M - f.mono.widthOfTextAtSize(url, 8), y: 26, size: 8, font: f.mono, color: MUTED });
  return { page, y: after - 10 };
}

export async function buildWelcomeGuide(input: WelcomeGuideInput) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const f = await loadFonts(pdf);
  const first = input.contactName?.split(/\s+/)[0] || null;
  const dateText = input.preparedOn.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const inner = W - M * 2;

  /* ---------- 1. Cover ---------- */
  {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: INK });
    // Oversized X mark bleeding off the page.
    // The X's path starts at x=1478 in logo units, so shift it back into view.
    page.drawSvgPath(LOGO_X, { x: 300 - 1478 * 1.1, y: 640, scale: 1.1, color: AMBER, opacity: 0.08 });
    logo(page, M, H - 56, 132, CANVAS, INK);
    page.drawText(`WELCOME GUIDE  ·  ${dateText.toUpperCase()}`, { x: M, y: H - 110, size: 9, font: f.mono, color: AMBER });

    let y = H - 250;
    page.drawText("Welcome to SKOX,", { x: M, y, size: 58, font: f.serif, color: CANVAS });
    y -= 64;
    for (const line of wrap(`${input.companyName}.`, f.serifItalic, 58, inner)) {
      page.drawText(line, { x: M, y, size: 58, font: f.serifItalic, color: AMBER });
      y -= 62;
    }
    y -= 8;
    y = para(page, `Everything you need to know about building ${input.projectName} with us, and exactly what happens next.`, {
      x: M,
      y,
      width: 380,
      font: f.sans,
      size: 14,
      color: COVER_MUTED,
      leading: 21,
    });

    // The road from yes to launch.
    const stops = ["You said yes", ...(input.hasAgreement ? ["Agreement"] : []), "Kickoff", "Weekly updates", "Launch"];
    const roadY = 170;
    page.drawLine({ start: { x: M, y: roadY }, end: { x: W - M, y: roadY }, thickness: 1.2, color: c(85, 89, 79) });
    stops.forEach((s, i) => {
      const x = M + (inner * i) / (stops.length - 1);
      page.drawCircle({ x, y: roadY, size: i === 0 ? 7 : 5, color: i === 0 ? AMBER : i === stops.length - 1 ? CANVAS : c(122, 126, 116) });
      const w = f.mono.widthOfTextAtSize(s.toUpperCase(), 7.5);
      const lx = Math.min(Math.max(x - w / 2, M - 4), W - M - w + 4);
      page.drawText(s.toUpperCase(), { x: lx, y: roadY - 22, size: 7.5, font: f.mono, color: i === 0 ? AMBER : COVER_MUTED });
    });

    page.drawText(first ? `Prepared for ${input.contactName}` : `Prepared for ${input.companyName}`, { x: M, y: 70, size: 10, font: f.medium, color: CANVAS });
    page.drawText(input.projectName, { x: M, y: 55, size: 10, font: f.sans, color: COVER_MUTED });
    const tag = "Good ideas deserve to be built.";
    page.drawText(tag, { x: W - M - f.serifItalic.widthOfTextAtSize(tag, 15), y: 58, size: 15, font: f.serifItalic, color: AMBER });
  }

  /* ---------- 2. The project ---------- */
  {
    const { page, y: top } = contentPage(pdf, f, 2, "01  ·  The project", `${first ? `${first}, here's` : "Here's"} what we're building together.`);
    let y = top - 6;
    const facts = [
      { k: "Project", v: input.projectName },
      { k: "Type", v: input.kindLabel },
      { k: "Launch", v: input.launch ?? "Set together at kickoff" },
    ];
    const gap = 12;
    const bw = (inner - gap * 2) / 3;
    facts.forEach((fact, i) => {
      const x = M + i * (bw + gap);
      box(page, x, y, bw, 70, { fill: PAPER, border: LINE });
      page.drawText(fact.k.toUpperCase(), { x: x + 14, y: y - 22, size: 8, font: f.mono, color: MUTED });
      para(page, fact.v, { x: x + 14, y: y - 44, width: bw - 28, font: f.semibold, size: 12, color: INK, leading: 15, maxLines: 2 });
    });
    y -= 96;

    const quote = input.recap || input.goal;
    if (quote) {
      const lines = wrap(quote, f.serifItalic, 19, inner - 64).slice(0, 9);
      const h = 64 + lines.length * 26;
      box(page, M, y, inner, h, { fill: BLUSH, r: 16 });
      page.drawRectangle({ x: M + 24, y: y - h + 26, width: 3, height: h - 52, color: AMBER });
      page.drawText((input.recap ? "What we heard on our call" : "Your goal, in your words").toUpperCase(), {
        x: M + 40,
        y: y - 28,
        size: 8,
        font: f.mono,
        color: BLUSH_INK,
      });
      let qy = y - 54;
      for (const l of lines) {
        page.drawText(l, { x: M + 40, y: qy, size: 19, font: f.serifItalic, color: INK });
        qy -= 26;
      }
      y -= h + 28;
    }

    page.drawText("HOW WE WORK", { x: M, y, size: 9, font: f.mono, color: AMBER_INK });
    y -= 22;
    const promises = [
      { t: "A fixed price and a date", d: "Agreed upfront, in writing, before we build." },
      { t: "An update every week", d: "What shipped, what's next, and anything we need from you." },
      { t: "One place for everything", d: "Agreement, designs, files, invoices and updates in your portal." },
      { t: "You're in the loop", d: "Click anywhere on a design to comment. Approve when it's right." },
    ];
    const pw = (inner - gap) / 2;
    promises.forEach((p, i) => {
      const x = M + (i % 2) * (pw + gap);
      const by = y - Math.floor(i / 2) * 92;
      box(page, x, by, pw, 80, { fill: PAPER, border: LINE });
      page.drawText(`0${i + 1}`, { x: x + 16, y: by - 24, size: 8, font: f.mono, color: AMBER_INK });
      page.drawText(p.t, { x: x + 16, y: by - 42, size: 13, font: f.semibold, color: INK });
      para(page, p.d, { x: x + 16, y: by - 60, width: pw - 32, font: f.sans, size: 10, color: MUTED, leading: 13, maxLines: 2 });
    });
  }

  /* ---------- 3. The path ---------- */
  {
    const { page, y: top } = contentPage(pdf, f, 3, "02  ·  How we'll work together", "From yes to launch, step by step.");
    const steps = [
      ...(input.hasAgreement
        ? [{ when: "Today", t: "Agreement and deposit", d: "Review and sign your agreement in the portal, then settle the deposit. That's what makes it official." }]
        : []),
      { when: "This week", t: "Your setup, about 15 minutes", d: "Tell us about you and your team, your goals, your brand and the access we'll need. It saves as you go." },
      { when: "Kickoff", t: "The kickoff call", d: "We walk through your answers, confirm the plan and set the launch date together. The agenda is built from what you told us." },
      { when: "Every week", t: "We build, you stay in the loop", d: "A weekly update with what shipped and what's next. Review designs by clicking right on them; approve when you're happy." },
      { when: "Launch", t: "Launch, and beyond", d: "Your launch kit, requests for changes tracked to done, and a monthly look at how it's performing." },
    ];
    let y = top - 10;
    const railX = M + 16;
    const stepH = (y - 80) / steps.length;
    page.drawLine({ start: { x: railX, y: y - 14 }, end: { x: railX, y: y - stepH * (steps.length - 1) - 14 }, thickness: 1.2, color: LINE });
    steps.forEach((s, i) => {
      const cy = y - 14;
      page.drawCircle({ x: railX, y: cy, size: 14, color: i === 0 ? AMBER : PAPER, borderColor: i === 0 ? AMBER : INK, borderWidth: 1.2 });
      const num = String(i + 1);
      page.drawText(num, { x: railX - f.semibold.widthOfTextAtSize(num, 11) / 2, y: cy - 4, size: 11, font: f.semibold, color: INK });
      page.drawText(s.when.toUpperCase(), { x: M + 50, y: y - 4, size: 8, font: f.mono, color: AMBER_INK });
      page.drawText(s.t, { x: M + 50, y: y - 24, size: 17, font: f.serif, color: INK });
      para(page, s.d, { x: M + 50, y: y - 44, width: inner - 60, font: f.sans, size: 10.5, color: MUTED, leading: 15, maxLines: 3 });
      y -= stepH;
    });
  }

  /* ---------- 4. The portal ---------- */
  {
    const { page, y: top } = contentPage(pdf, f, 4, "03  ·  Your portal", "One link for everything. Here's what's inside.");
    let y = top - 4;
    const signinH = 70;
    box(page, M, y, inner, signinH, { fill: INK, r: 14 });
    page.drawText("HOW TO SIGN IN", { x: M + 20, y: y - 24, size: 8, font: f.mono, color: AMBER });
    para(page, `Go to ${input.portalUrl.replace(/^https?:\/\//, "")} and enter ${input.email}. We email you a 6-digit code. No passwords, ever.`, {
      x: M + 20,
      y: y - 44,
      width: inner - 40,
      font: f.medium,
      size: 12,
      color: CANVAS,
      leading: 16,
      maxLines: 2,
    });
    y -= signinH + 20;
    const tabs = [
      { t: "Overview", d: "Your launch date, progress, the latest update, and one to-do list for anything that needs you." },
      { t: "Review", d: "See designs and click anywhere to leave a comment on that exact spot. Approve rounds when they're right." },
      { t: "Documents", d: "Agreements to sign in under a minute, and signed copies with a signature certificate." },
      { t: "Files", d: "Logos, photos and content in one private place, instead of lost in email." },
      { t: "Billing", d: "Every invoice, what's paid and what's due, with secure online payment." },
      { t: "Requests", d: "Need a change or found an issue? Ask here and follow it all the way to done." },
      { t: "Results", d: "After launch: monthly numbers, your care plan, and ideas for what to build next." },
      { t: "Your team", d: "Invite colleagues and choose who can view, who approves, signs and pays." },
    ];
    const gap = 12;
    const cw = (inner - gap) / 2;
    const ch = 92;
    tabs.forEach((tab, i) => {
      const x = M + (i % 2) * (cw + gap);
      const by = y - Math.floor(i / 2) * (ch + 10);
      box(page, x, by, cw, ch, { fill: PAPER, border: LINE });
      page.drawCircle({ x: x + 20, y: by - 24, size: 4, color: AMBER });
      page.drawText(tab.t, { x: x + 32, y: by - 28, size: 13, font: f.semibold, color: INK });
      para(page, tab.d, { x: x + 20, y: by - 48, width: cw - 40, font: f.sans, size: 10, color: MUTED, leading: 13.5, maxLines: 3 });
    });
  }

  /* ---------- 5. Your checklist ---------- */
  {
    const { page, y: top } = contentPage(pdf, f, 5, "04  ·  Your checklist", "What we need from you, and what you can count on from us.");
    let y = top - 6;
    const rowH = 44;
    box(page, M, y, inner, input.checklist.length * rowH + 20, { fill: PAPER, border: LINE, r: 16 });
    y -= 10;
    input.checklist.forEach((item, i) => {
      const ry = y - i * rowH;
      const cy = ry - 26;
      if (i > 0) page.drawLine({ start: { x: M + 20, y: ry }, end: { x: W - M - 20, y: ry }, thickness: 0.5, color: FOG });
      if (item.done) {
        page.drawSvgPath(rr(18, 18, 5), { x: M + 20, y: cy + 13, color: OK });
        tick(page, M + 20, cy - 5, 18, PAPER);
      } else {
        page.drawSvgPath(rr(18, 18, 5), { x: M + 20, y: cy + 13, color: PAPER, borderColor: INK, borderWidth: 1.2 });
      }
      page.drawText(item.label, { x: M + 52, y: cy, size: 12.5, font: item.done ? f.sans : f.medium, color: item.done ? MUTED : INK });
      const status = item.done ? "DONE" : item.note ?? "";
      if (status) {
        const w = f.mono.widthOfTextAtSize(status.toUpperCase(), 8);
        page.drawText(status.toUpperCase(), { x: W - M - 20 - w, y: cy + 1, size: 8, font: f.mono, color: item.done ? OK : AMBER_INK });
      }
    });
    y -= input.checklist.length * rowH + 44;

    box(page, M, y, inner, 150, { fill: BLUSH, r: 16 });
    page.drawText("ONE PROMISE ABOUT SECURITY", { x: M + 24, y: y - 30, size: 8, font: f.mono, color: BLUSH_INK });
    page.drawText("We will never ask for your passwords.", { x: M + 24, y: y - 60, size: 22, font: f.serif, color: INK });
    para(
      page,
      "When we need access to an account (your domain, email, payments, analytics), invite founder@skoxsoftware.com as a user or admin. You stay in control and can remove us any time. Not sure how? Tell us in the portal and we'll set it up together at kickoff.",
      { x: M + 24, y: y - 86, width: inner - 48, font: f.sans, size: 11, color: BLUSH_INK, leading: 16, maxLines: 4 },
    );
  }

  /* ---------- 6. Questions ---------- */
  {
    const { page, y: top } = contentPage(pdf, f, 6, "05  ·  We're here", "Questions? Just ask.");
    let y = top - 4;
    box(page, M, y, inner, input.schedulingUrl ? 128 : 108, { fill: INK, r: 16 });
    page.drawText("YOUR TEAM AT SKOX", { x: M + 24, y: y - 28, size: 8, font: f.mono, color: AMBER });
    page.drawText(input.teamIntro || "The SKOX founders", { x: M + 24, y: y - 56, size: 22, font: f.serif, color: CANVAS });
    page.drawText("founder@skoxsoftware.com", { x: M + 24, y: y - 80, size: 12, font: f.medium, color: CANVAS });
    page.drawText(input.portalUrl.replace(/^https?:\/\//, ""), { x: M + 24, y: y - 96, size: 10, font: f.sans, color: COVER_MUTED });
    if (input.schedulingUrl) {
      page.drawText(`Book time: ${input.schedulingUrl.replace(/^https?:\/\//, "")}`, { x: M + 24, y: y - 112, size: 10, font: f.sans, color: AMBER });
    }
    y -= (input.schedulingUrl ? 128 : 108) + 30;

    const faqs = [
      { q: "How do I ask for a change?", a: "Open Requests in your portal, describe what you need, and follow it until it's done. You'll get an email when we reply." },
      { q: "Can my colleagues join?", a: "Yes. Invite them from Your team on the Overview page, and choose whether they can just view or also approve, sign and pay." },
      { q: "Where do I find my agreement and files?", a: "Documents holds your agreement and signed copies. Files holds everything you and we share, privately." },
      { q: "What if I'm not sure how to answer something?", a: "Answer what you can and choose \"Do this later\". Anything saved for later becomes a simple to-do, and we'll cover it at kickoff." },
      { q: "What's the fastest way to reach you?", a: "Reply to any email from us, or write to founder@skoxsoftware.com. A founder reads every message." },
    ];
    for (const item of faqs) {
      page.drawText(item.q, { x: M, y, size: 13, font: f.semibold, color: INK });
      y = para(page, item.a, { x: M, y: y - 18, width: inner, font: f.sans, size: 10.5, color: MUTED, leading: 15, maxLines: 3 });
      y -= 16;
    }

    const tag = "Good ideas deserve to be built.";
    page.drawText(tag, { x: M, y: 76, size: 24, font: f.serifItalic, color: AMBER_INK });
    logo(page, W - M - 96, 96, 96, INK, CANVAS);
  }

  pdf.setTitle(`Welcome to SKOX: ${input.companyName}`);
  pdf.setAuthor("SKOX Software");
  pdf.setSubject(`Welcome guide for ${input.projectName}`);
  pdf.setProducer("SKOX Client Portal");
  pdf.setCreationDate(input.preparedOn);
  return pdf.save();
}
