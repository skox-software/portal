import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreviewPrompt, isPreviewLink, previewLinkFor, previewSlug } from "./preview-build-prompt.ts";

const id = "e036fe1e-401d-4d7b-b5f2-8a6e0bce0057";

test("the slug is the company in kebab case plus the deal id's first 4 characters", () => {
  assert.equal(previewSlug("Acorn Properties, Management & Realty", id), "acorn-properties-management-and-realty-e036");
  assert.equal(previewSlug("Café Olé", id), "cafe-ole-e036");
  assert.equal(previewSlug("!!!", id), "preview-e036");
  assert.ok(previewSlug("A".repeat(80), id).length <= 45);
  assert.equal(previewLinkFor("Foster Rentals", id), "https://previews.skoxsoftware.com/foster-rentals-e036");
});

test("only a previews-site link can be saved on a lead", () => {
  assert.ok(isPreviewLink("https://previews.skoxsoftware.com/foster-rentals-e036"));
  assert.ok(isPreviewLink("https://previews.skoxsoftware.com/foster-rentals-e036/"));
  assert.ok(!isPreviewLink("http://previews.skoxsoftware.com/foster-rentals-e036"));
  assert.ok(!isPreviewLink("https://skox-acorn-properties-a.vercel.app"));
  assert.ok(!isPreviewLink("https://previews.skoxsoftware.com/"));
  assert.ok(!isPreviewLink("https://previews.skoxsoftware.com/a/b"));
  assert.ok(!isPreviewLink("https://previews.skoxsoftware.com.evil.com/x"));
});

test("the prompt carries the lead, its folder, the deal id for open tracking and the rules", () => {
  const p = buildPreviewPrompt({ id, company: 'Joe "Big" Roofing', phone: "555-0100", website: null, callBrief: { tag: "NOT MOBILE", upgradeAngle: "Quote estimator" } });
  assert.match(p, /business:\s+Joe "Big" Roofing/);
  assert.match(p, /current_site:\s+NONE/);
  assert.match(p, /problem seen:\s+NOT MOBILE/);
  assert.match(p, /public\/joe-big-roofing-e036\//);
  assert.match(p, new RegExp(`dealId: "${id}"`));
  assert.match(p, /company: "Joe \\"Big\\" Roofing"/);
  assert.match(p, /No SKOX price anywhere/);
  assert.match(p, /master UX\/UI and web designer/);
});

test("the prompt works the same in Claude Code and Codex, and the agent's own checks never fire the open alert", () => {
  const p = buildPreviewPrompt({ id, company: "Foster Rentals", website: "https://fosterrentals.com" });
  assert.match(p, /Claude Code, Codex or similar/);
  assert.match(p, /curl -sIL --max-time 15 https:\/\/fosterrentals\.com/);
  assert.match(p, /git ls-remote https:\/\/github\.com\/skox-software\/prospect-previews/);
  assert.match(p, /web\.archive\.org/);
  assert.match(p, /playwright@1 screenshot .*localhost:4173\/foster-rentals-e036\//);
  for (const line of p.split("\n").filter((l) => /(curl|screenshot) .*previews\.skoxsoftware\.com/.test(l))) {
    assert.match(line, /foster-rentals-e036\?team"/);
  }
  assert.doesNotMatch(p, /\(Claude Code\) to build/);
});
