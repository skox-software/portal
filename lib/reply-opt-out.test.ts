import { test } from "node:test";
import assert from "node:assert/strict";
import { isOptOutReply } from "./reply-opt-out.ts";

test("explicit unsubscribe and refusal replies suppress", () => {
  for (const text of ["Remove me", "Stop", "Unsubscribe", "Please unsubscribe me.", "No thanks", "No thank you!", "Not interested", "Please remove me from your list", "Take me off your mailing list", "Stop emailing me", "Don't contact me again", "I would like to opt out"]) {
    assert.ok(isOptOutReply("Re: Website concept", text), text);
  }
  assert.ok(isOptOutReply("Re: Unsubscribe", ""));
});
test("quoted marketing footers never opt out an interested or empty reply", () => {
  const footer = "Not interested? Reply 'no thanks' or use this link: unsubscribe";
  for (const quote of ["> " + footer, "On Mon, Oct 19 Reiss\nSkeen <r@example.com> wrote:\n" + footer, "From: Reiss\nSent: Monday\n" + footer, "-----Original Message-----\n" + footer, "--\n" + footer]) {
    assert.equal(isOptOutReply("Re: Preview", "Sounds good, let's talk.\n\n" + quote), false, quote);
    assert.equal(isOptOutReply("Re: Preview", quote), false, quote);
    assert.equal(isOptOutReply("Re: Preview", "No thanks\n" + quote), true, quote);
  }
});
test("discussion about unsubscribing and explicit negation are not opt-outs", () => {
  for (const text of ["Do not unsubscribe me", "Please don't remove me from the list", "Where is your unsubscribe link?", "Thanks, can you send pricing?"]) assert.equal(isOptOutReply("Re: Preview", text), false, text);
});
