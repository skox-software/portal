import assert from "node:assert/strict";
import { test } from "node:test";
import { inlineKind, isSalesPath, kindLabel, safeUploadName, salesPrefix, salesTitle, singleByteRange } from "./sales-files.ts";

const WS = "3f1c2b6e-1111-4c4c-8d8d-000000000001";
const OTHER = "3f1c2b6e-2222-4c4c-8d8d-000000000002";

test("sales files stay inside their own workspace's folder", () => {
  assert.equal(salesPrefix(WS), `sales/${WS}/`);
  assert.equal(isSalesPath(`sales/${WS}/demo.mp4`, WS), true);
  assert.equal(isSalesPath(`sales/${OTHER}/demo.mp4`, WS), false, "another workspace's folder");
  assert.equal(isSalesPath(`projects/${WS}/file/demo.mp4`, WS), false, "a project folder");
  assert.equal(isSalesPath(`sales/${WS}/../${OTHER}/demo.mp4`, WS), false, "climbing out");
  assert.equal(isSalesPath(`sales/${WS}/`, WS), false, "no file name");
});

test("only types a browser shows without running anything play inline", () => {
  assert.equal(inlineKind("video/mp4"), "video");
  assert.equal(inlineKind("video/quicktime"), "video");
  assert.equal(inlineKind("Video/MP4; codecs=avc1"), "video");
  assert.equal(inlineKind("image/png"), "image");
  assert.equal(inlineKind("application/pdf"), "pdf");
  assert.equal(inlineKind("image/svg+xml"), null, "SVG can carry script");
  assert.equal(inlineKind("text/html"), null);
  assert.equal(inlineKind(null), null);
});

test("labels and titles read like the team would write them", () => {
  assert.equal(kindLabel("video/mp4", "a.mp4"), "Video");
  assert.equal(kindLabel("application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx"), "PPTX");
  assert.equal(kindLabel(null, "README"), "File");
  assert.equal(salesTitle("  Job paperwork   demo ", "x.mp4"), "Job paperwork demo");
  assert.equal(salesTitle("", "unbusy-job-paperwork-demo-16x9.mp4"), "unbusy job paperwork demo 16x9");
  assert.equal(salesTitle(null, ".mp4"), "Untitled");
});

test("upload names are safe for a storage path", () => {
  assert.equal(safeUploadName("Demo (final)/v2.mp4"), "Demo _final_v2.mp4");
  assert.equal(safeUploadName("✨"), "_");
  assert.equal(safeUploadName(""), "file");
});

test("only a single, well-formed byte range is passed on", () => {
  assert.equal(singleByteRange("bytes=0-"), "bytes=0-");
  assert.equal(singleByteRange("bytes=100-199"), "bytes=100-199");
  assert.equal(singleByteRange("bytes=-500"), "bytes=-500");
  assert.equal(singleByteRange("bytes=0-1,5-9"), null, "multiple ranges");
  assert.equal(singleByteRange("bytes=9-1"), null, "backwards");
  assert.equal(singleByteRange("bytes=-"), null);
  assert.equal(singleByteRange(null), null);
});
