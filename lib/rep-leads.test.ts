import assert from "node:assert/strict";
import { test } from "node:test";
import { leadKeys, normCompany, normHost, normPhone, sameLead } from "./rep-leads.ts";

test("phones match however they're written", () => {
  assert.equal(normPhone("+1 (904) 555-0100"), "9045550100");
  assert.equal(normPhone("904.555.0100"), "9045550100");
  assert.equal(normPhone("555-0100"), null);
});

test("websites match on the bare host", () => {
  assert.equal(normHost("https://www.Acme.com/about"), "acme.com");
  assert.equal(normHost("acme.com"), "acme.com");
  assert.equal(normHost("not a site"), null);
});

test("company names ignore legal suffixes and punctuation", () => {
  assert.equal(normCompany("The Acme Group, LLC"), normCompany("Acme Inc."));
  assert.equal(normCompany("A&B"), "aandb");
  assert.equal(normCompany("Co"), null);
});

test("a business email's domain counts as a website, free mail doesn't", () => {
  const a = leadKeys({ company: "One", email: "pat@acme.com" });
  const b = leadKeys({ company: "Two", website: "https://acme.com" });
  assert.equal(sameLead(a, b), true);
  const c = leadKeys({ company: "Three", email: "pat@gmail.com" });
  const d = leadKeys({ company: "Four", email: "sam@gmail.com" });
  assert.equal(sameLead(c, d), false);
});

test("any shared key is a duplicate; nothing shared is not", () => {
  const a = leadKeys({ company: "Harbor Dental", phone: "904-555-0100" });
  assert.equal(sameLead(a, leadKeys({ company: "Other", phone: "(904) 555 0100" })), true);
  assert.equal(sameLead(a, leadKeys({ company: "Harbor Dental PA" })), true);
  assert.equal(sameLead(a, leadKeys({ company: "Bayside Dental", phone: "904-555-0199" })), false);
});
