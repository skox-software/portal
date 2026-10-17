import assert from "node:assert/strict";
import { test } from "node:test";
import { isDigit, odometerColumns } from "./odometer.ts";

test("digits become rolling columns, everything else stays put", () => {
  const cols = odometerColumns("$1,250");
  assert.equal(cols.length, 6);
  assert.deepEqual(cols.filter(isDigit).map((c) => c.digit), [1, 2, 5, 0]);
  assert.deepEqual(cols.filter((c) => !isDigit(c)).map((c) => ("char" in c ? c.char : "")), ["$", ","]);
});

test("columns are keyed from the right, so the ones digit keeps its key as the number grows", () => {
  const before = odometerColumns("$950");
  const after = odometerColumns("$1,020");
  assert.equal(before.at(-1)!.key, "d0");
  assert.equal(after.at(-1)!.key, "d0");
  assert.equal(before.at(-3)!.key, after.at(-3)!.key); // hundreds
  assert.equal(after[1].key, "d3");
});

test("cents and signs survive", () => {
  const cols = odometerColumns("-$12.05");
  assert.equal(cols.map((c) => ("digit" in c ? String(c.digit) : c.char)).join(""), "-$12.05");
  assert.equal(new Set(cols.map((c) => c.key)).size, cols.length);
});

test("empty text has no columns", () => {
  assert.deepEqual(odometerColumns(""), []);
});
