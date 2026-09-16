import assert from "node:assert/strict";
import { test } from "node:test";
import { billingDestination } from "./sign-in-destination.ts";
const path = "/projects/12345678-1234-1234-1234-123456789abc/billing/pay/12345678-1234-1234-1234-123456789abc";
test("invoice links survive sign-in without repeating the base path", () => {
  assert.equal(billingDestination(path), path);
  assert.equal(billingDestination(`/portal${path}`), path);
});
test("sign-in cannot be used to redirect outside billing", () => {
  for (const value of [undefined, "https://evil.test", "//evil.test", "/\\evil.test", "/admin", path + "/../../../../../../sign-in", "/portal/sign-in", path + "\n"]) {
    assert.equal(billingDestination(value), "/");
  }
});
