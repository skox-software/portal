import assert from "node:assert/strict";
import { test } from "node:test";
import { canCheckout, isStripeSandbox } from "./billing-access.ts";

test("only explicit test keys enable staff sandbox checkout", () => {
  for (const key of ["sk_test_example", "rk_test_example"]) assert.equal(isStripeSandbox(key), true);
  for (const key of [undefined, "", "sk_live_example", "rk_live_example", "invalid_test_key"]) {
    assert.equal(isStripeSandbox(key), false);
  }
  assert.equal(canCheckout({ isStaff: true, clientRole: null }, true), true);
  assert.equal(canCheckout({ isStaff: true, clientRole: null }, false), false);
});

test("view-only clients cannot start payments in either mode", () => {
  for (const sandbox of [true, false]) {
    assert.equal(canCheckout({ isStaff: false, clientRole: "client_member" }, sandbox), false);
    assert.equal(canCheckout({ isStaff: false, clientRole: null }, sandbox), false);
    assert.equal(canCheckout({ isStaff: false, clientRole: "client_approver" }, sandbox), true);
  }
});
