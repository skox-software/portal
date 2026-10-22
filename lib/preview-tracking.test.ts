import assert from "node:assert/strict";
import test from "node:test";
import { afterSending, deviceLabel, linksPreview, openKind, sentOnEmail } from "./preview-tracking.ts";

const URL = "https://previews.skoxsoftware.com/bass-harbor-cottages";

test("an email carrying the preview link is recognised however it's written", () => {
  assert.equal(linksPreview(`Have a look:\n${URL}\n\nCheers`, URL), true);
  assert.equal(linksPreview(`Here it is (${URL}/).`, URL), true);
  assert.equal(linksPreview("See previews.skoxsoftware.com/bass-harbor-cottages, it's private.", URL), true);
  assert.equal(linksPreview(`${URL}?team=1`, URL), true);
});

test("other links, other previews and no preview don't count", () => {
  assert.equal(linksPreview("https://previews.skoxsoftware.com/bass-harbor-cottages-2", URL), false);
  assert.equal(linksPreview("https://www.skoxsoftware.com", URL), false);
  assert.equal(linksPreview(URL, null), false);
  assert.equal(linksPreview("no links here", URL), false);
});

test("only a ready or building preview becomes sent", () => {
  assert.equal(sentOnEmail("ready"), true);
  assert.equal(sentOnEmail("building"), true);
  assert.equal(sentOnEmail("sent"), false);
  assert.equal(sentOnEmail("awaiting_approval"), false);
});

test("views count only once the preview was sent, and alert once", () => {
  assert.equal(openKind("ready", null), "ignore");
  assert.equal(openKind("building", null), "ignore");
  assert.equal(openKind("archived", null), "ignore");
  assert.equal(openKind("sent", null), "first");
  assert.equal(openKind("sent", new Date()), "repeat");
  assert.equal(openKind("opened", new Date()), "repeat");
});

test("device and time since sending read plainly", () => {
  assert.equal(deviceLabel("phone", null), "phone");
  assert.equal(deviceLabel(undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), "phone");
  assert.equal(deviceLabel("tv", "Mozilla/5.0 (Macintosh)"), "desktop");
  const sent = new Date("2026-10-22T14:00:00Z");
  assert.equal(afterSending(sent, new Date("2026-10-22T14:01:00Z")), "1 minute");
  assert.equal(afterSending(sent, new Date("2026-10-22T16:10:00Z")), "2 hours");
  assert.equal(afterSending(sent, new Date("2026-10-25T14:00:00Z")), "3 days");
  assert.equal(afterSending(null, sent), null);
});
