import test from "node:test";
import assert from "node:assert/strict";
import { filterClientDirectory } from "./client-directory.ts";

const entries = [
  { client: { name: "Harbor Dental" }, projects: [
    { name: "Booking portal", status: "building" },
    { name: "Practice website", status: "launched" },
  ], health: 85 },
  { client: { name: "North Studio" }, projects: [{ name: "Booking site", status: "review" }], health: 70 },
  { client: { name: "New client" }, projects: [], health: 100 },
];

test("All includes clients without projects and does not mutate the source", () => {
  assert.deepEqual(filterClientDirectory(entries, "", "all"), entries);
  filterClientDirectory(entries, "portal", "building");
  assert.equal(entries[0].projects.length, 2);
});

test("client names match without case or surrounding whitespace, retaining all their projects", () => {
  assert.deepEqual(filterClientDirectory(entries, "  HARBOR  ", "all"), [entries[0]]);
});

test("project searches return only matching projects across clients", () => {
  const result = filterClientDirectory(entries, "booking", "all");
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].projects, [entries[0].projects[0]]);
  assert.equal(result[0].health, 85);
});

test("status and search combine and exclude clients without a matching project", () => {
  assert.deepEqual(filterClientDirectory(entries, "booking", "review"), [entries[1]]);
  assert.deepEqual(filterClientDirectory(entries, "harbor", "paused"), []);
  assert.deepEqual(filterClientDirectory(entries, "", "launched")[0].projects, [entries[0].projects[1]]);
});

test("empty clients remain searchable and unmatched queries give an empty result", () => {
  assert.deepEqual(filterClientDirectory(entries, "new", "all"), [entries[2]]);
  assert.deepEqual(filterClientDirectory(entries, "missing", "all"), []);
});
