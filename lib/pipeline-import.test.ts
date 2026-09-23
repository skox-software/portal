import assert from "node:assert/strict";
import { test } from "node:test";
import { companyKey, dedupeLeads, MAX_IMPORT_ROWS, parseLeadSources, parseLeads } from "./pipeline-import.ts";

test("rows without a header read as company, contact, email, phone, website, value", () => {
  const { drafts, skipped } = parseLeads('Lumen Physio, Sofia Reyes, sofia@lumen.test, 904-555-0101, lumen.test, "$12,000"\nTallgrass Farms');
  assert.equal(skipped.length, 0);
  assert.deepEqual(drafts[0], {
    company: "Lumen Physio",
    contactName: "Sofia Reyes",
    contactEmail: "sofia@lumen.test",
    phone: "904-555-0101",
    website: "https://lumen.test/",
    valueCents: 1_200_000,
    kind: "other",
    notes: null,
  });
  assert.equal(drafts[1].company, "Tallgrass Farms");
});

test("a spreadsheet paste (tabs) with a header maps columns by name", () => {
  const { drafts } = parseLeads("Company\tEmail\tType\tValue\nNorthline Freight\tmarcus@northline.test\tDashboard\t32k");
  assert.equal(drafts[0].kind, "dashboard");
  assert.equal(drafts[0].valueCents, 3_200_000);
  assert.equal(drafts[0].contactEmail, "marcus@northline.test");
});

test("the old scraper's export imports as-is, keeping extra columns in notes", () => {
  const csv = [
    "id,business_name,owner_name,phone,email,website,niche,pitch_angle",
    '6,Coastal Fish Charters,Owner,(407) 417-2132,coastalfishcapt@gmail.com.,http://coastalfish.net/?utm_source=gmb,fishing charter,REFERRAL_SYSTEM',
    '9,"Crescent Beach Fishing, LLC",Owner,(904) 910-8906,,crescentbeachfishing.net,fishing charter,"PORTAL, REFERRAL"',
  ].join("\n");
  const { drafts } = parseLeads(csv);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].contactName, null, "'Owner' is a placeholder");
  assert.equal(drafts[0].contactEmail, "coastalfishcapt@gmail.com", "trailing dot dropped");
  assert.equal(drafts[0].website, "http://coastalfish.net/", "tracking params dropped");
  assert.match(drafts[0].notes!, /niche: fishing charter/);
  assert.match(drafts[0].notes!, /pitch_angle: REFERRAL_SYSTEM/);
  assert.doesNotMatch(drafts[0].notes!, /^id:/m, "row ids from other tools are dropped");
  assert.equal(drafts[1].company, "Crescent Beach Fishing, LLC");
  assert.match(drafts[1].notes!, /pitch_angle: PORTAL, REFERRAL/);
});

test("rows without a company are reported, bad emails and sites are dropped", () => {
  const { drafts, skipped } = parseLeads("Company,Email,Website\n,a@b.test,\nAcme,not-an-email,nope");
  assert.deepEqual(skipped, [{ row: 2, reason: "no company name" }]);
  assert.equal(drafts[0].contactEmail, null);
  assert.equal(drafts[0].website, null);
});

test("large pastes stop at the row limit", () => {
  const text = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `Company ${i}`).join("\n");
  const { drafts, truncated } = parseLeads(text);
  assert.equal(drafts.length, MAX_IMPORT_ROWS);
  assert.equal(truncated, true);
});

test("duplicates are skipped against the pipeline and within the batch", () => {
  assert.equal(companyKey("Harbor Dental, LLC"), companyKey("harbor dental"));
  const { drafts } = parseLeads("Harbor Dental LLC\nNew Co,,x@new.test\nNew Co.\nOther,,taken@old.test");
  const { fresh, duplicates } = dedupeLeads(drafts, [
    { company: "Harbor Dental", email: null },
    { company: "Old", email: "taken@old.test" },
  ]);
  assert.deepEqual(fresh.map((d) => d.company), ["New Co"]);
  assert.deepEqual(duplicates, ["Harbor Dental LLC", "New Co.", "Other"]);
});

test("a file with a header and a headerless paste are read separately", () => {
  const { drafts, skipped } = parseLeadSources("id,business_name,email\n1,One MedSpa,team@one.test", "Lumen Physio, Sofia Reyes");
  assert.deepEqual(drafts.map((d) => d.company), ["One MedSpa", "Lumen Physio"]);
  assert.equal(skipped.length, 0);
});
