import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEmailDraft, greetingName, mailtoHref, mainProblem, proposedBuild } from "./email-draft.ts";

test("greets the contact by name, or 'there' when we only know 'the owner'", () => {
  assert.equal(greetingName("Dr. Anthony Oswick or Dr. Maria Kashlak"), "Dr. Oswick");
  assert.equal(greetingName("Barry Davis, President"), "Barry");
  assert.equal(greetingName("Captain Charlie Smith"), "Captain Smith");
  assert.equal(greetingName("the owner"), null);
  assert.equal(greetingName(null), null);
});

test("pulls the main problem and the build out of the brief", () => {
  assert.equal(mainProblem("The site doesn't fit a phone screen (no mobile layout); the footer still says © 2007."), "the site doesn't fit a phone screen");
  assert.equal(
    proposedBuild("Staton Law focuses on closings. Upgrades: a closing intake portal where agents upload the contract. It's a GoDaddy site."),
    "a new site with a closing intake portal where agents upload the contract",
  );
  assert.equal(proposedBuild("Nothing to read. If so, the pitch is a roofing site with an estimate form; confirm they're operating."), "a roofing site with an estimate form");
  assert.equal(proposedBuild("Just a description."), null);
});

test("a full draft: problem in the subject, four or five sentences, Reiss's signature", () => {
  const { subject, body } = buildEmailDraft({
    company: "Staton Law Firm",
    contactName: null,
    website: "https://www.statonlawfirm.com/",
    brief: {
      tag: "NOT MOBILE",
      askFor: "Whitney Staton",
      why: "The site doesn't fit a phone screen (no mobile layout); it was made with Starfield Technologies.",
      upgradeAngle: "Real estate closings. Upgrades: a closing intake portal for agents and lenders. It doesn't fit a phone.",
      askThem: "When a new contract comes in from an agent, how does it reach you?",
      preview: "https://preview.example.com/staton",
    },
  });
  assert.equal(subject, "Staton Law Firm's website on phones");
  assert.match(body, /^Hi Whitney,/);
  assert.match(body, /statonlawfirm\.com and noticed the site doesn't fit a phone screen\./);
  assert.match(body, /a closing intake portal for agents and lenders, at a fixed price agreed before we start\./);
  assert.match(body, /preview\.example\.com\/staton/);
  assert.match(body, /how does it reach you\?/);
  assert.match(body, /Reiss Skeen\nCo-founder, UnBusy \(formerly SKOX Software\)\ngounbusy\.com/);
  const paragraph = body.split("\n\n")[1];
  const sentences = paragraph.split(/(?<=[.?])\s+(?=[A-Z])/).length;
  assert.ok(sentences >= 4 && sentences <= 5, `${sentences} sentences`);
});

test("no site and no brief still make a sensible email", () => {
  assert.equal(buildEmailDraft({ company: "Acme", brief: { tag: "SITE DOWN" } }).subject, "Acme's website isn't loading");
  assert.match(buildEmailDraft({ company: "Acme", brief: { tag: "NO WEBSITE" } }).body, /couldn't find a website/);
  const bare = buildEmailDraft({ company: "Acme", brief: null });
  assert.equal(bare.subject, "Acme's website");
  assert.match(bare.body, /^Hi there,/);
});

test("mailto carries the subject and body, encoded", () => {
  const href = mailtoHref("pat@acme.com", { subject: "A & B", body: "Line 1\nLine 2" });
  assert.equal(href, "mailto:pat@acme.com?subject=A%20%26%20B&body=Line%201%0ALine%202");
  assert.match(mailtoHref(null, { subject: "x", body: "y" }), /^mailto:\?subject=x/);
});
