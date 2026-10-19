import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { blocksEmail, EMAIL_STATUS_LABEL, latestStatus, readStatusEvent } from "./resend-events.ts";
import { verifySvix } from "./svix.ts";

const key = Buffer.from("test-signing-key-for-delivery-reports");
const secret = `whsec_${key.toString("base64")}`;
const now = 1_790_000_000;
const sign = (id: string, ts: number, body: string, k = key) => `v1,${createHmac("sha256", k).update(`${id}.${ts}.${body}`).digest("base64")}`;
const body = JSON.stringify({ type: "email.delivered", created_at: "2026-10-19T12:31:00.000Z", data: { email_id: "re_123" } });

test("a correctly signed report verifies", () => {
  assert.equal(verifySvix(body, { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) }, secret, now), true);
  // Svix sends several signatures while a secret rotates; any one may match.
  assert.equal(verifySvix(body, { id: "msg_1", timestamp: String(now), signature: `v1,AAAA ${sign("msg_1", now, body)}` }, secret, now), true);
});

test("a forged, altered, replayed or unsigned report is refused", () => {
  const sig = sign("msg_1", now, body);
  const headers = { id: "msg_1", timestamp: String(now), signature: sig };
  assert.equal(verifySvix(body.replace("delivered", "bounced"), headers, secret, now), false, "body changed");
  assert.equal(verifySvix(body, { ...headers, id: "msg_2" }, secret, now), false, "id changed");
  assert.equal(verifySvix(body, { ...headers, signature: sign("msg_1", now, body, Buffer.from("other key")) }, secret, now), false, "wrong key");
  assert.equal(verifySvix(body, headers, secret, now + 6 * 60), false, "too old");
  assert.equal(verifySvix(body, headers, secret, now - 6 * 60), false, "from the future");
  assert.equal(verifySvix(body, { ...headers, signature: sig.replace("v1,", "v2,") }, secret, now), false, "unknown version");
  assert.equal(verifySvix(body, { ...headers, signature: null }, secret, now), false, "no signature");
  assert.equal(verifySvix(body, { ...headers, timestamp: "soon" }, secret, now), false, "bad timestamp");
  assert.equal(verifySvix(body, headers, "", now), false, "no secret");
});

test("each Resend event type maps to a status", () => {
  const cases: [string, keyof typeof EMAIL_STATUS_LABEL, string][] = [
    ["email.delivered", "delivered", "Delivered"],
    ["email.delivery_delayed", "delayed", "Delayed"],
    ["email.opened", "opened", "Opened"],
    ["email.clicked", "clicked", "Clicked"],
    ["email.bounced", "bounced", "Bounced"],
    ["email.complained", "complained", "Marked spam"],
  ];
  for (const [type, status, label] of cases) {
    const r = readStatusEvent({ type, created_at: "2026-10-19T12:31:00Z", data: { email_id: "re_1" } });
    assert.equal(r?.status, status, type);
    assert.equal(r?.emailId, "re_1");
    assert.equal(r?.at, "2026-10-19T12:31:00.000Z");
    assert.equal(EMAIL_STATUS_LABEL[status], label);
  }
  assert.equal(readStatusEvent({ type: "email.sent", data: { email_id: "re_1" } }), null, "sent is not a delivery report");
  assert.equal(readStatusEvent({ type: "email.received", data: { email_id: "re_1" } }), null);
  assert.equal(readStatusEvent({ type: "email.delivered", data: {} }), null, "no email id");
  assert.equal(readStatusEvent(null), null);
});

test("a bounce keeps its reason and a click its link", () => {
  const bounce = readStatusEvent({ type: "email.bounced", created_at: "2026-10-19T12:31:00Z", data: { email_id: "re_1", bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 The email account does not exist." } } });
  assert.equal(bounce?.reason, "Permanent / General: 550 5.1.1 The email account does not exist.");
  const click = readStatusEvent({ type: "email.clicked", data: { email_id: "re_1", click: { link: "https://www.skoxsoftware.com" } } });
  assert.equal(click?.link, "https://www.skoxsoftware.com");
  assert.ok(click?.at, "a missing time falls back to now");
});

test("only bounces and spam complaints block email", () => {
  assert.deepEqual((["delayed", "delivered", "opened", "clicked", "bounced", "complained"] as const).filter(blocksEmail), ["bounced", "complained"]);
});

test("the lead shows its furthest status, whatever order reports arrive in", () => {
  const at = (m: number) => `2026-10-19T12:${String(m).padStart(2, "0")}:00.000Z`;
  assert.equal(latestStatus([]), null);
  assert.equal(latestStatus([{ status: "opened", at: at(5) }, { status: "delivered", at: at(9) }])?.status, "opened", "a late delivered report doesn't hide an open");
  assert.equal(latestStatus([{ status: "delayed", at: at(1) }, { status: "delivered", at: at(2) }])?.status, "delivered");
  assert.equal(latestStatus([{ status: "clicked", at: at(3) }, { status: "complained", at: at(4) }])?.status, "complained", "spam outranks a click");
  assert.equal(latestStatus([{ status: "opened", at: at(3) }, { status: "opened", at: at(7) }])?.at, at(7), "newest of the same status");
  assert.equal(latestStatus([{ status: "bounced", at: at(1), reason: "no mailbox" }])?.reason, "no mailbox");
});
