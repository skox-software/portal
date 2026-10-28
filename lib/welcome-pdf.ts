import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { SUPPORT_EMAIL } from "@/lib/brand";

/**
 * The branded welcome guide: a personal, printable "here's what happens next"
 * for a new client, in UnBusy's typefaces and colours. Everything on it is
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
// The brand tokens (lib/brand.ts, app/styles/tokens.css). Blue is punctuation:
// dots, the first step, the logo's own dot. Never a surface.
const INK = c(0x15, 0x18, 0x1d);
const CANVAS = c(0xfa, 0xfa, 0xf8);
const PAPER = c(255, 255, 255);
const BLUE = c(0x0b, 0x5c, 0xff);
const SKY = c(0xe9, 0xf0, 0xff);
const MUTED = c(0x5b, 0x61, 0x68);
const LINE = c(0xdc, 0xdd, 0xdc);
const FOG = c(0xf1, 0xf1, 0xee);
const OK = INK;
// Paper at 72% on ink, for secondary text on the dark cover.
const COVER_MUTED = c(0xbb, 0xbc, 0xbd);
const COVER_RULE = c(0x4a, 0x4e, 0x54);

const W = 612;
const H = 792;
const M = 56;

type Fonts = { display: PDFFont; sans: PDFFont; medium: PDFFont; semibold: PDFFont };
type Logos = { light: PDFImage; dark: PDFImage };

async function loadFonts(pdf: PDFDocument): Promise<Fonts> {
  const dir = path.join(process.cwd(), "assets", "fonts");
  // Subsetting makes fontkit write a real TrueType program; embedding the WOFF
  // bytes as-is produces a PDF whose text doesn't render in most viewers.
  const load = async (file: string) => pdf.embedFont(await readFile(path.join(dir, file)), { subset: true });
  const [display, sans, medium, semibold] = await Promise.all([
    load("BricolageGrotesque-Bold.woff"),
    load("IBMPlexSans-Regular.woff"),
    load("IBMPlexSans-Medium.woff"),
    load("IBMPlexSans-SemiBold.woff"),
  ]);
  return { display, sans, medium, semibold };
}

/** The horizontal lockup, ink on light pages and paper on the dark cover. */
async function loadLogos(pdf: PDFDocument): Promise<Logos> {
  const dir = path.join(process.cwd(), "public", "brand");
  const [light, dark] = await Promise.all([
    readFile(path.join(dir, "lockup-light.png")).then((b) => pdf.embedPng(b)),
    readFile(path.join(dir, "lockup-dark.png")).then((b) => pdf.embedPng(b)),
  ]);
  return { light, dark };
}

/** Rounded rectangle as an SVG path (drawn from the top-left corner). */
function rr(w: number, h: number, r: number) {
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

function box(page: PDFPage, x: number, top: number, w: number, h: number, opts: { fill: RGB; border?: RGB; r?: number }) {
  page.drawSvgPath(rr(w, h, opts.r ?? 8), {
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

/** Draws a lockup `width` wide with its top edge at `top`. */
function logo(page: PDFPage, image: PDFImage, x: number, top: number, width: number) {
  const height = (image.height / image.width) * width;
  page.drawImage(image, { x, y: top - height, width, height });
}

function tick(page: PDFPage, x: number, y: number, size: number, color: RGB) {
  page.drawLine({ start: { x: x + size * 0.2, y: y + size * 0.5 }, end: { x: x + size * 0.42, y: y + size * 0.28 }, thickness: 1.8, color });
  page.drawLine({ start: { x: x + size * 0.42, y: y + size * 0.28 }, end: { x: x + size * 0.82, y: y + size * 0.74 }, thickness: 1.8, color });
}

function contentPage(pdf: PDFDocument, f: Fonts, logos: Logos, portalUrl: string, n: number, eyebrow: string, title: string) {
  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: CANVAS });
  logo(page, logos.light, M, H - 36, 84);
  page.drawText(`${String(n).padStart(2, "0")}`, { x: W - M - f.medium.widthOfTextAtSize("00", 9), y: H - 52, size: 9, font: f.medium, color: MUTED });
  page.drawText(eyebrow, { x: M, y: H - 96, size: 10, font: f.medium, color: MUTED });
  const after = para(page, title, { x: M, y: H - 132, width: W - M * 2, font: f.display, size: 32, color: INK, leading: 35 });
  page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.6, color: LINE });
  page.drawText("UnBusy Client Portal  ·  Welcome guide", { x: M, y: 26, size: 8, font: f.medium, color: MUTED });
  const url = portalUrl.replace(/^https?:\/\//, "");
  page.drawText(url, { x: W - M - f.medium.widthOfTextAtSize(url, 8), y: 26, size: 8, font: f.medium, color: MUTED });
  return { page, y: after - 10 };
}

export async function buildWelcomeGuide(input: WelcomeGuideInput) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [f, logos] = await Promise.all([loadFonts(pdf), loadLogos(pdf)]);
  const newPage = (n: number, eyebrow: string, title: string) => contentPage(pdf, f, logos, input.portalUrl, n, eyebrow, title);
  const first = input.contactName?.split(/\s+/)[0] || null;
  const dateText = input.preparedOn.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const inner = W - M * 2;

  /* ---------- 1. Cover ---------- */
  {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: INK });
    logo(page, logos.dark, M, H - 52, 132);
    page.drawText(`Welcome guide  ·  ${dateText}`, { x: M, y: H - 110, size: 10, font: f.medium, color: COVER_MUTED });

    let y = H - 250;
    page.drawText("Welcome to UnBusy,", { x: M, y, size: 44, font: f.display, color: CANVAS });
    y -= 50;
    const nameLines = wrap(input.companyName, f.display, 44, inner - 20);
    nameLines.forEach((line, i) => {
      page.drawText(line, { x: M, y, size: 44, font: f.display, color: CANVAS });
      // The full stop is the brand's one blue mark on the cover.
      if (i === nameLines.length - 1) page.drawText(".", { x: M + f.display.widthOfTextAtSize(line, 44), y, size: 44, font: f.display, color: BLUE });
      y -= 48;
    });
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
    page.drawLine({ start: { x: M, y: roadY }, end: { x: W - M, y: roadY }, thickness: 1.2, color: COVER_RULE });
    stops.forEach((s, i) => {
      const x = M + (inner * i) / (stops.length - 1);
      page.drawCircle({ x, y: roadY, size: i === 0 ? 7 : 5, color: i === 0 ? BLUE : i === stops.length - 1 ? CANVAS : COVER_MUTED });
      const w = f.medium.widthOfTextAtSize(s, 9);
      const lx = Math.min(Math.max(x - w / 2, M - 4), W - M - w + 4);
      page.drawText(s, { x: lx, y: roadY - 24, size: 9, font: f.medium, color: i === 0 ? CANVAS : COVER_MUTED });
    });

    page.drawText(first ? `Prepared for ${input.contactName}` : `Prepared for ${input.companyName}`, { x: M, y: 70, size: 10, font: f.medium, color: CANVAS });
    page.drawText(input.projectName, { x: M, y: 55, size: 10, font: f.sans, color: COVER_MUTED });
  }

  /* ---------- 2. The project ---------- */
  {
    const { page, y: top } = newPage(2, "01  ·  The project", `${first ? `${first}, here's` : "Here's"} what we're building together.`);
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
      page.drawText(fact.k, { x: x + 14, y: y - 22, size: 9, font: f.medium, color: MUTED });
      para(page, fact.v, { x: x + 14, y: y - 44, width: bw - 28, font: f.semibold, size: 12, color: INK, leading: 15, maxLines: 2 });
    });
    y -= 96;

    const quote = input.recap || input.goal;
    if (quote) {
      const lines = wrap(quote, f.sans, 16, inner - 64).slice(0, 9);
      const h = 64 + lines.length * 23;
      box(page, M, y, inner, h, { fill: SKY });
      page.drawText(input.recap ? "What we heard on our call" : "Your goal, in your words", {
        x: M + 24,
        y: y - 28,
        size: 10,
        font: f.medium,
        color: MUTED,
      });
      let qy = y - 54;
      for (const l of lines) {
        page.drawText(l, { x: M + 24, y: qy, size: 16, font: f.sans, color: INK });
        qy -= 23;
      }
      y -= h + 28;
    }

    page.drawText("How we work", { x: M, y, size: 10, font: f.medium, color: MUTED });
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
      page.drawText(`0${i + 1}`, { x: x + 16, y: by - 24, size: 11, font: f.display, color: BLUE });
      page.drawText(p.t, { x: x + 16, y: by - 42, size: 13, font: f.semibold, color: INK });
      para(page, p.d, { x: x + 16, y: by - 60, width: pw - 32, font: f.sans, size: 10, color: MUTED, leading: 13, maxLines: 2 });
    });
  }

  /* ---------- 3. The path ---------- */
  {
    const { page, y: top } = newPage(3, "02  ·  How we'll work together", "From yes to launch, step by step.");
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
      page.drawCircle({ x: railX, y: cy, size: 14, color: i === 0 ? BLUE : PAPER, borderColor: i === 0 ? BLUE : INK, borderWidth: 1.2 });
      const num = String(i + 1);
      page.drawText(num, { x: railX - f.semibold.widthOfTextAtSize(num, 11) / 2, y: cy - 4, size: 11, font: f.semibold, color: i === 0 ? PAPER : INK });
      page.drawText(s.when, { x: M + 50, y: y - 4, size: 10, font: f.medium, color: MUTED });
      page.drawText(s.t, { x: M + 50, y: y - 24, size: 16, font: f.display, color: INK });
      para(page, s.d, { x: M + 50, y: y - 44, width: inner - 60, font: f.sans, size: 10.5, color: MUTED, leading: 15, maxLines: 3 });
      y -= stepH;
    });
  }

  /* ---------- 4. The portal ---------- */
  {
    const { page, y: top } = newPage(4, "03  ·  Your portal", "One link for everything. Here's what's inside.");
    let y = top - 4;
    const signinH = 70;
    box(page, M, y, inner, signinH, { fill: INK });
    page.drawText("How to sign in", { x: M + 20, y: y - 24, size: 10, font: f.medium, color: COVER_MUTED });
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
      page.drawCircle({ x: x + 20, y: by - 24, size: 4, color: BLUE });
      page.drawText(tab.t, { x: x + 32, y: by - 28, size: 13, font: f.semibold, color: INK });
      para(page, tab.d, { x: x + 20, y: by - 48, width: cw - 40, font: f.sans, size: 10, color: MUTED, leading: 13.5, maxLines: 3 });
    });
  }

  /* ---------- 5. Your checklist ---------- */
  {
    const { page, y: top } = newPage(5, "04  ·  Your checklist", "What we need from you, and what you can count on from us.");
    let y = top - 6;
    const rowH = 44;
    box(page, M, y, inner, input.checklist.length * rowH + 20, { fill: PAPER, border: LINE });
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
      const status = item.done ? "Done" : item.note ?? "";
      if (status) {
        const w = f.medium.widthOfTextAtSize(status, 9);
        page.drawText(status, { x: W - M - 20 - w, y: cy + 1, size: 9, font: f.medium, color: item.done ? MUTED : INK });
      }
    });
    y -= input.checklist.length * rowH + 44;

    box(page, M, y, inner, 150, { fill: SKY });
    page.drawText("One promise about security", { x: M + 24, y: y - 30, size: 10, font: f.medium, color: MUTED });
    page.drawText("We will never ask for your passwords.", { x: M + 24, y: y - 60, size: 20, font: f.display, color: INK });
    para(
      page,
      `When we need access to an account (your domain, email, payments, analytics), invite ${SUPPORT_EMAIL} as a user or admin. You stay in control and can remove us any time. Not sure how? Tell us in the portal and we'll set it up together at kickoff.`,
      { x: M + 24, y: y - 86, width: inner - 48, font: f.sans, size: 11, color: INK, leading: 16, maxLines: 4 },
    );
  }

  /* ---------- 6. Questions ---------- */
  {
    const { page, y: top } = newPage(6, "05  ·  We're here", "Questions? Just ask.");
    let y = top - 4;
    box(page, M, y, inner, input.schedulingUrl ? 128 : 108, { fill: INK });
    page.drawText("Your team at UnBusy", { x: M + 24, y: y - 28, size: 10, font: f.medium, color: COVER_MUTED });
    page.drawText(input.teamIntro || "The UnBusy founders", { x: M + 24, y: y - 56, size: 20, font: f.display, color: CANVAS });
    page.drawText(SUPPORT_EMAIL, { x: M + 24, y: y - 80, size: 12, font: f.medium, color: CANVAS });
    page.drawText(input.portalUrl.replace(/^https?:\/\//, ""), { x: M + 24, y: y - 96, size: 10, font: f.sans, color: COVER_MUTED });
    if (input.schedulingUrl) {
      page.drawText(`Book time: ${input.schedulingUrl.replace(/^https?:\/\//, "")}`, { x: M + 24, y: y - 112, size: 10, font: f.sans, color: CANVAS });
    }
    y -= (input.schedulingUrl ? 128 : 108) + 30;

    const faqs = [
      { q: "How do I ask for a change?", a: "Open Requests in your portal, describe what you need, and follow it until it's done. You'll get an email when we reply." },
      { q: "Can my colleagues join?", a: "Yes. Invite them from Your team on the Overview page, and choose whether they can just view or also approve, sign and pay." },
      { q: "Where do I find my agreement and files?", a: "Documents holds your agreement and signed copies. Files holds everything you and we share, privately." },
      { q: "What if I'm not sure how to answer something?", a: "Answer what you can and choose \"Do this later\". Anything saved for later becomes a simple to-do, and we'll cover it at kickoff." },
      { q: "What's the fastest way to reach you?", a: `Reply to any email from us, or write to ${SUPPORT_EMAIL}. A founder reads every message.` },
    ];
    for (const item of faqs) {
      page.drawText(item.q, { x: M, y, size: 13, font: f.semibold, color: INK });
      y = para(page, item.a, { x: M, y: y - 18, width: inner, font: f.sans, size: 10.5, color: MUTED, leading: 15, maxLines: 3 });
      y -= 16;
    }

    logo(page, logos.light, M, 96, 120);
  }

  pdf.setTitle(`Welcome to UnBusy: ${input.companyName}`);
  pdf.setAuthor("UnBusy");
  pdf.setSubject(`Welcome guide for ${input.projectName}`);
  pdf.setProducer("UnBusy Client Portal");
  pdf.setCreationDate(input.preparedOn);
  return pdf.save();
}
