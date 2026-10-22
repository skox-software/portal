/**
 * The prompt Reiss copies from a lead's panel and pastes into his own AI
 * (Claude Code) to build that lead's preview site. It is the master prompt
 * (skox repo, scripts/lead-scan/preview-prompt.md) cut down to a static page
 * with SKOX's publishing rules: one folder in skox-software/prospect-previews,
 * live at previews.skoxsoftware.com/<slug>. Pure, so it can be tested alone.
 */

export const PREVIEWS_HOST = "https://previews.skoxsoftware.com";
const REPO = "skox-software/prospect-previews";
const BOOK_URL = "https://www.skoxsoftware.com/#scope";

/** The lead's folder and link name: the company in kebab case plus the deal id's first 4 characters, so a rebuild or edit lands in the same place. */
export function previewSlug(company: string, dealId: string) {
  const base = company
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${base || "preview"}-${dealId.replace(/-/g, "").slice(0, 4).toLowerCase()}`;
}

export function previewLinkFor(company: string, dealId: string) {
  return `${PREVIEWS_HOST}/${previewSlug(company, dealId)}`;
}

/** A link saved on the lead must be on the previews site, in its own folder. */
export function isPreviewLink(url: string) {
  return /^https:\/\/previews\.skoxsoftware\.com\/[a-z0-9][a-z0-9-]{0,80}\/?$/.test(url.trim());
}

export type PreviewPromptLead = {
  id: string;
  company: string;
  contactName?: string | null;
  phone?: string | null;
  website?: string | null;
  industry?: string | null;
  location?: string | null;
  notes?: string | null;
  callBrief?: { tag?: string; why?: string; upgradeAngle?: string; askFor?: string; outlook?: string } | null;
};

const line = (label: string, value: string | null | undefined) => `${label.padEnd(16)}${value?.trim() || "unknown"}`;

export function buildPreviewPrompt(lead: PreviewPromptLead) {
  const slug = previewSlug(lead.company, lead.id);
  const link = `${PREVIEWS_HOST}/${slug}`;
  const b = lead.callBrief ?? {};
  return `You are building a private preview website for a local business that asked Reiss at SKOX for one on a cold call. SKOX (skoxsoftware.com) builds custom websites and web apps for local businesses at a fixed price and date. The preview's job: make the owner feel seen in 10 seconds and make a 15-minute call with Reiss feel obvious.

## INPUT
${line("business:", lead.company)}
${line("current_site:", lead.website || "NONE")}
${line("phone:", lead.phone)}
${line("location:", lead.location)}
${line("industry:", lead.industry)}
${line("contact:", lead.contactName)}
${line("problem seen:", [b.tag, b.why].filter(Boolean).join(": "))}
${line("upgrade idea:", b.upgradeAngle)}
${line("call notes:", lead.notes)}
${line("folder:", slug)}
${line("link:", link)}
${line("deal id:", lead.id)}

If this folder already exists in the repo, this is an EDIT: change only what Reiss asks for, keep everything else, and publish the same way. The link stays the same.

## RULES (no exceptions)
1. Nothing on the page that you can't source. Every fact (years, licences, reviews, prices, names, hours, service area) comes from their own site or public profiles (Google, Facebook, Yelp, chamber, BBB). Keep a facts ledger (claim, exact wording, source URL, date) in research/${slug}/ledger.md. No source, leave it out. Never invent reviews, awards, team members, prices or numbers.
2. Their own logo, photos and words first. Stock photos only for backgrounds. Never an AI image of their work.
3. One upgrade actually works, built from their real published data (a quote estimator, booking request, order form, availability check). Everything else is a labelled "in the build" card. Never fake a button.
4. It must never pass for their live site: a sticky bar at the top reading "Concept built by SKOX for ${lead.company}. Not live.", with a "Book 15 min with Reiss" button to ${BOOK_URL} and an "Ask a question" button.
5. No SKOX price anywhere. Say "Fixed price and date on a 15-minute call."
6. Never contact the business: no forms submitted on their site, no calls, emails or reviews.
7. Their brand, never SKOX's, and never a template.

## DESIGN: you are a master UX/UI and web designer
Every preview must look and feel like it was designed from scratch for this one business by a top agency. No two previews may look alike. Design from the context, not from habit.

1. Read the context first: what they sell, who buys it, where (a Maine harbour inn is not a Jacksonville law firm), how old and how loved the business is, the words their customers use in reviews, and the colours, logo and photos they already have.
2. Before writing code, write research/${slug}/design.md:
   - the customer in one sentence, and the one thing they come to the site to do;
   - three words for the feeling (for example "salty, unhurried, family" or "exact, calm, senior");
   - a design direction that follows from those words: layout concept, type pairing (two Google Fonts chosen for this business, with why), colour palette from their brand (exact hex values, checked for 4.5:1 contrast), photography treatment, texture and motion;
   - the signature moment: the one interaction or visual that makes this preview memorable and is specific to them.
3. Be different in every way. Before designing, open three other folders in public/ and note their hero, layout, fonts and colours. Then choose a different hero structure, grid, navigation, type pairing, colour world and section rhythm. Never reuse another preview's CSS or HTML.
4. Let the context drive the form. For example: an editorial magazine layout for a historic inn, a calm document-like page for a law firm, a bold card-and-photo layout for a contractor, a menu-first page for a restaurant, a map-and-availability page for a rental company. These are starting points, not templates.
5. UX before decoration. The main task (book, get a quote, call, order) is one tap from the top on a phone, and the button sits where a thumb reaches. Clear hierarchy: one idea per section, scannable headings in their customers' words, short paragraphs. Body text 16px or larger, visible focus states, labelled form fields with errors, respects reduced motion.
6. Craft: deliberate spacing scale, consistent image crops, real photo grading, no layout shift, fast on a phone (no heavy libraries, images sized).
7. Banned: gradient blobs, emoji icons, three identical icon cards in a row, rounded cards floating on white, stock handshakes, "Welcome to our website", "Elevate", "Unlock", "Seamless", "Look no further", exclamation marks, fake counters, placeholder testimonials, lorem ipsum.
8. Before publishing, look at it at phone and desktop width and ask: would the owner say "that's us, only better"? Would it pass for another preview in the repo? Fix it until the answers are yes and no.

## HOW TO BUILD IT
- Plain static files only: HTML, CSS and a little JavaScript. No framework, no build step, no npm.
- Everything lives in public/${slug}/ (index.html, style.css, script.js, assets/). Research notes live in research/${slug}/ (ledger.md, brief.md). Never put research inside public/; everything in public/ is on the internet.
- Use absolute paths for every file: /${slug}/style.css, /${slug}/assets/logo.png. Relative paths break.
- In <head>: <meta name="robots" content="noindex, nofollow, noarchive">, a title with their business name, and a mobile viewport tag.
- Mobile first. Check it at phone width before anything else.
- Images: their own, compressed (under 300 KB each), with alt text.

## FORMS
Every form (the working upgrade and "Ask a question") sends to SKOX, never to them:

    fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, company: "${lead.company.replace(/"/g, '\\"')}", broken: "<what they asked or chose, in one readable paragraph>", timeline: "preview:${slug}" }) })

name, email and broken are required. On success show "Sent. Reiss will get back to you shortly." On failure show "Didn't send. Email reiss@skoxsoftware.com instead."

## OPEN TRACKING (paste exactly, before </body>)

    <script>
    (function () {
      try {
        var q = new URLSearchParams(location.search);
        if (q.has("team")) localStorage.setItem("skox_team", "1");
        if (localStorage.getItem("skox_team") === "1") return;
        if (sessionStorage.getItem("open:${slug}")) return;
        sessionStorage.setItem("open:${slug}", "1");
      } catch (e) {}
      fetch("/portal/api/lead-previews/open", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: "${lead.id}", device: innerWidth < 768 ? "phone" : "desktop" }), keepalive: true }).catch(function () {});
    })();
    </script>

This is how Reiss gets "they just opened it" alerts. Add nothing else that tracks people.

## PUBLISH
1. Clone ${REPO} (or git pull if you already have it).
2. Add or change only public/${slug}/ and research/${slug}/. Never touch vercel.json, package.json, previews.zip or any other folder.
3. Commit ("Preview: ${lead.company}") and push to main. It goes live by itself in about a minute.
4. Open ${link} on a phone-sized window and check: it loads, images show, the concept bar is visible, a test form submission says Sent (use your own name and email, and write "test" in the message).
5. Reply with: the link, the working upgrade, anything you left out because you couldn't source it, and the ledger row count.

Then paste ${link} into "Preview link" on the lead in the SKOX portal and press Save. It's marked Ready to send.
`;
}
