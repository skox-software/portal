import assert from "node:assert/strict";
import { test } from "node:test";
import { previewServiceAuthorized, serviceTransition } from "./preview-service.ts";

const req = (auth?: string) => new Request("https://example.test/api/lead-previews/queue", { headers: auth ? { authorization: auth } : {} });

test("the builder's API is closed without the secret, and checks it exactly", () => {
  delete process.env.PREVIEW_SERVICE_SECRET;
  assert.equal(previewServiceAuthorized(req("Bearer ")), false);
  process.env.PREVIEW_SERVICE_SECRET = "s3cret-value";
  assert.equal(previewServiceAuthorized(req("Bearer s3cret-value")), true);
  assert.equal(previewServiceAuthorized(req("Bearer s3cret-valuX")), false);
  assert.equal(previewServiceAuthorized(req()), false);
  delete process.env.PREVIEW_SERVICE_SECRET;
});

test("the builder can't skip Gate A or revive an archived preview", () => {
  assert.deepEqual(serviceTransition("requested", null, { status: "researching" }), { ok: true, status: "researching" });
  assert.equal(serviceTransition("awaiting_approval", null, { status: "building" }).ok, false);
  assert.deepEqual(serviceTransition("awaiting_approval", { decision: "go" }, { status: "building" }), { ok: true, status: "building" });
  assert.equal(serviceTransition("awaiting_approval", { decision: "no_go" }, { status: "building" }).ok, false);
  assert.equal(serviceTransition("archived", null, { status: "ready" }).ok, false);
  assert.equal(serviceTransition("none", null, { status: "researching" }).ok, false);
});

test("a send or a first open moves the status on when none is given", () => {
  assert.deepEqual(serviceTransition("ready", null, { sentAt: "2026-10-21T15:00:00Z" }), { ok: true, status: "sent" });
  assert.deepEqual(serviceTransition("sent", null, { firstOpenAt: "2026-10-21T16:00:00Z" }), { ok: true, status: "opened" });
  // An explicit status wins.
  assert.deepEqual(serviceTransition("ready", null, { sentAt: "2026-10-21T15:00:00Z", status: "ready" }), { ok: true, status: "ready" });
});
