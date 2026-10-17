import assert from "node:assert/strict";
import { test } from "node:test";
import { areaCode, isCallable, leadClock, localTime, stateOf, zoneFor, zoneShort } from "./local-time.ts";

test("the state comes from however the location was typed", () => {
  assert.equal(stateOf("Rockford, Il"), "IL");
  assert.equal(stateOf("Little Rock, Arkansas"), "AR");
  assert.equal(stateOf("Iowa"), "IA");
  assert.equal(stateOf("Golden, CO 80401"), "CO");
  assert.equal(stateOf("Somewhere"), null);
  assert.equal(stateOf(null), null);
});

test("each lead gets its own zone", () => {
  assert.equal(zoneFor({ location: "Orlando, FL", phone: "(407) 876-0290" }), "America/New_York");
  assert.equal(zoneFor({ location: "Rockford, Il" }), "America/Chicago");
  assert.equal(zoneFor({ location: "Golden, CO" }), "America/Denver");
  assert.equal(zoneFor({ location: "Phoenix, AZ" }), "America/Phoenix");
  assert.equal(zoneFor({ location: "Medford, OR" }), "America/Los_Angeles");
});

test("split states use the area code", () => {
  assert.equal(zoneFor({ location: "Pensacola, FL", phone: "850-555-0100" }), "America/Chicago");
  assert.equal(zoneFor({ location: "Knoxville, TN", phone: "(865) 555-0100" }), "America/New_York");
  assert.equal(zoneFor({ location: "Nashville, TN", phone: "(615) 555-0100" }), "America/Chicago");
  assert.equal(zoneFor({ location: "Paducah, KY", phone: "270 555 0100" }), "America/Chicago");
  assert.equal(zoneFor({ location: "El Paso, TX", phone: "+1 915 555 0100" }), "America/Denver");
});

test("no location falls back to the area code; nothing to go on gives null", () => {
  assert.equal(areaCode("+1 (303) 279-8100"), "303");
  assert.equal(areaCode("555-0100"), null);
  assert.equal(zoneFor({ phone: "(303) 279-8100" }), "America/Denver");
  assert.equal(zoneFor({ phone: "(212) 555-0100" }), "America/New_York");
  assert.equal(zoneFor({ location: "", phone: "" }), null);
});

test("their local time and whether it's business hours there", () => {
  // Friday 2026-10-16, 13:42 UTC = 9:42 am in New York (EDT), 6:42 am in LA (PDT).
  const now = new Date("2026-10-16T13:42:00Z");
  assert.equal(localTime("America/New_York", now), "9:42 am");
  assert.equal(localTime("America/Los_Angeles", now), "6:42 am");
  assert.equal(isCallable("America/New_York", now), true);
  assert.equal(isCallable("America/Los_Angeles", now), false);
  // 8:29 is too early, 8:30 is fine, 5:00 pm is done.
  assert.equal(isCallable("America/Chicago", new Date("2026-10-16T13:29:00Z")), false);
  assert.equal(isCallable("America/Chicago", new Date("2026-10-16T13:30:00Z")), true);
  assert.equal(isCallable("America/Chicago", new Date("2026-10-16T22:00:00Z")), false);
  // Saturday morning isn't a call time anywhere.
  assert.equal(isCallable("America/New_York", new Date("2026-10-17T14:00:00Z")), false);
  assert.equal(isCallable(null, now), false);
  // Arizona has no daylight saving: in October it's on Pacific time.
  assert.equal(localTime("America/Phoenix", now), "6:42 am");
  assert.equal(localTime("America/New_York", new Date("2026-10-16T16:05:00Z")), "12:05 pm");
});

test("the label reads like a clock with the zone", () => {
  assert.equal(zoneShort("America/Chicago"), "CT");
  assert.equal(zoneShort("America/Phoenix"), "MT");
  assert.deepEqual(leadClock({ location: "Rockford, IL" }, new Date("2026-10-16T14:42:00Z")), { zone: "America/Chicago", label: "9:42 am CT", callable: true });
  assert.equal(leadClock({ location: "Nowhere" }, new Date()), null);
});
