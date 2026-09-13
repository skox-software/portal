import assert from "node:assert/strict";
import { test } from "node:test";
import { googleBookingEmbedUrl, safeBookingUrl, meetingType } from "./meetings.ts";

const canonical = "https://calendar.google.com/calendar/appointments/schedules/AcZssZ-example_123";
test("only canonical Google appointment pages are embedded; query data is discarded", () => {
  assert.equal(googleBookingEmbedUrl(canonical + "?gv=true&email=private@example.com#fragment"), canonical + "?gv=true");
  assert.equal(googleBookingEmbedUrl("  " + canonical + "  "), canonical + "?gv=true");
  for (const value of [
    "http://calendar.google.com/calendar/appointments/schedules/abc",
    "https://calendar.google.com.evil.test/calendar/appointments/schedules/abc",
    "https://calendar.google.com@evil.test/calendar/appointments/schedules/abc",
    "https://evil.test@calendar.google.com/calendar/appointments/schedules/abc",
    "https://calendar.google.com:444/calendar/appointments/schedules/abc",
    "https://calendar.google.com/calendar/embed?src=private",
    "https://calendar.google.com/calendar/appointments/schedules/",
    "https://calendar.google.com/calendar/appointments/schedules/abc/extra",
    "https://calendar.app.google/shortlink",
    "https://cal.com/skox/kickoff",
    '<iframe src="' + canonical + '"></iframe>',
    "javascript:alert(1)", "data:text/html,hi", "", null,
  ]) assert.equal(googleBookingEmbedUrl(value), null, String(value));
});
test("legacy HTTPS booking URLs remain usable as external links", () => {
  assert.equal(safeBookingUrl("https://cal.com/skox/kickoff"), "https://cal.com/skox/kickoff");
  for (const value of ["javascript:alert(1)", "http://example.com", "https://user:pass@example.com", "not a url", null]) {
    assert.equal(safeBookingUrl(value), null);
  }
});
test("unknown or repeated meeting selections fall back to kickoff", () => {
  assert.equal(meetingType("review"), "review");
  assert.equal(meetingType("check-in"), "check-in");
  assert.equal(meetingType(undefined), "kickoff");
  assert.equal(meetingType("unknown"), "kickoff");
  assert.equal(meetingType(["review", "check-in"]), "kickoff");
});
