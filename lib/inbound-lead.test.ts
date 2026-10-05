import assert from "node:assert/strict";
import { test } from "node:test";
import { adsTime, channel, companyFor, dealKind, googleAdsCsv, inboundLeadSchema, leadSourceLabel, notesFor } from "./inbound-lead.ts";

const parse = (o: Record<string, unknown>) => inboundLeadSchema.parse({ status: "submitted", email: "ana@harbor.test", ...o });

test("a Google Ads click is named with its campaign, and wins over the first touch", () => {
  const lead = parse({ gclid: "abc", visit: { gclid: "abc", utm_campaign: "Search US" }, firstTouch: { referrer: "https://www.google.com/" } });
  assert.equal(channel(lead), "Google Ads · Search US");
  assert.equal(leadSourceLabel(lead), "Website · Google Ads · Search US");
});

test("without tags, the referrer or the first touch names the channel", () => {
  assert.equal(channel(parse({ visit: { referrer: "https://www.google.com/" } })), "Google search");
  assert.equal(channel(parse({ firstTouch: { utm_source: "linkedin", utm_medium: "social" } })), "linkedin social");
  assert.equal(channel(parse({})), "Direct");
});

test("unfinished enquiries say so on the card", () => {
  assert.equal(leadSourceLabel(parse({ status: "unfinished" })), "Unfinished · Direct");
});

test("site build types map to portal kinds; the title falls back to person, then address", () => {
  assert.equal(dealKind("web-apps"), "web-app");
  assert.equal(dealKind("dashboards"), "dashboard");
  assert.equal(dealKind(undefined), "other");
  assert.equal(companyFor(parse({ name: "Ana" })), "Ana");
  assert.equal(companyFor(parse({ company: "Harbor", name: "Ana" })), "Harbor");
  assert.equal(companyFor(parse({})), "ana@harbor.test");
});

test("bad optional fields are dropped instead of rejecting the lead", () => {
  const lead = parse({ visits: -3, pages: "nope", visit: 7 });
  assert.equal(lead.visits, undefined);
  assert.equal(lead.pages, undefined);
  assert.equal(lead.visit, undefined);
  assert.throws(() => inboundLeadSchema.parse({ status: "submitted", email: "not-an-email" }));
});

test("notes lead with the enquiry and end with the recording tag", () => {
  const notes = notesFor(parse({ message: "A booking app", pages: ["/", "/web-apps"], leadEventId: "ev-1" }), new Date("2026-10-05T12:00:00Z"));
  assert.match(notes, /^Website enquiry, 2026-10-05\.\n\nA booking app/);
  assert.match(notes, /Pages: \/ → \/web-apps/);
  assert.match(notes, /lead_event_id = ev-1$/);
});

test("the Google Ads file keeps only won clicks from the last 90 days, at the fixed won time", () => {
  const now = new Date("2026-10-05T16:00:00Z");
  const { csv, count } = googleAdsCsv(
    [
      { gclid: "g1", createdAt: new Date("2026-09-01T00:00:00Z"), wonAt: new Date("2026-10-01T18:30:00Z"), stageChangedAt: now, valueCents: 1_250_000 },
      { gclid: "old", createdAt: new Date("2026-06-01T00:00:00Z"), wonAt: now, stageChangedAt: now, valueCents: null },
      { gclid: null, createdAt: now, wonAt: now, stageChangedAt: now, valueCents: null },
    ],
    now,
  );
  assert.equal(count, 1);
  assert.equal(
    csv,
    "Parameters:TimeZone=America/New_York\nGoogle Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency\ng1,Won deal,2026-10-01 14:30:00,12500.00,USD\n",
  );
  assert.equal(adsTime(new Date("2026-01-15T05:00:00Z")), "2026-01-15 00:00:00");
});
