import assert from "node:assert/strict";
import { test } from "node:test";
import { barLayout, calendarGrid, donutSegments, heatScale, niceExtent, niceMax, polyline, stackedLayout, yFor, type Frame } from "./chart-math.ts";

const frame: Frame = { w: 120, h: 110, pad: { top: 10, right: 10, bottom: 0, left: 10 } };

test("axis maxima round up to 1, 2, 2.5 or 5 times a power of ten", () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(-5), 1);
  assert.equal(niceMax(7), 10);
  assert.equal(niceMax(180), 200);
  assert.equal(niceMax(2_100), 2_500);
  assert.equal(niceMax(4_999_00), 5_000_00);
  assert.equal(niceMax(1_000), 1_000);
});

test("bars share the width and grow up from the baseline", () => {
  const { max, bars, baseline, ticks } = barLayout([
    { key: "a", label: "A", value: 50 },
    { key: "b", label: "B", value: 100 },
  ], frame);
  assert.equal(max, 100);
  assert.equal(baseline, 110);
  assert.equal(bars[0].height, 50);
  assert.equal(bars[1].y, 10);
  assert.equal(bars[0].width, 35); // 70% of a 50-unit slot
  assert.equal(bars[0].x, 17.5);
  assert.equal(ticks.length, 5);
  assert.equal(ticks[4].y, 10);
});

test("an all-zero series still lays out without dividing by zero", () => {
  const { max, bars } = barLayout([{ key: "a", label: "A", value: 0 }], frame);
  assert.equal(max, 1);
  assert.equal(bars[0].height, 0);
});

test("stacked parts sit on top of each other and negatives count as zero", () => {
  const { max, bars } = stackedLayout([{ key: "a", label: "A", parts: [60, 40, -5] }], frame);
  assert.equal(max, 100);
  const [first, second, third] = bars[0].segments;
  assert.equal(first.y + first.height, 110);
  assert.equal(second.y + second.height, first.y);
  assert.equal(second.y, 10);
  assert.equal(third.height, 0);
  assert.equal(bars[0].total, 100);
});

test("values above the max or below zero clamp to the plot", () => {
  assert.equal(yFor(-10, 100, frame), 110);
  assert.equal(yFor(500, 100, frame), 10);
});

test("donut arcs split the circumference and follow one another", () => {
  const segs = donutSegments([3, 1], 10, 4);
  const c = 2 * Math.PI * 10;
  assert.equal(segs[0].fraction, 0.75);
  assert.equal(segs[0].dashoffset, 0);
  assert.equal(segs[1].dashoffset, -Math.round(c * 0.75 * 10) / 10);
  assert.deepEqual(donutSegments([0, 0], 10, 4).map((s) => s.fraction), [0, 0]);
});

test("polyline points print to one decimal", () => {
  assert.equal(polyline([[0, 1.234], [10.05, 2]]), "0,1.2 10.1,2");
});

test("a stacked axis can be raised to fit an overlaid line", () => {
  const { max, bars } = stackedLayout([{ key: "a", label: "A", parts: [50] }], frame, 180);
  assert.equal(max, 200);
  assert.equal(bars[0].segments[0].height, 25);
});

test("an axis range holds negatives and zero on round steps", () => {
  assert.deepEqual(niceExtent([120, 900]), { lo: 0, hi: 1_000 });
  assert.deepEqual(niceExtent([-300, -20]), { lo: -500, hi: 0 });
  const both = niceExtent([-1_500, 8_000]);
  assert.ok(both.lo <= -1_500 && both.hi >= 8_000);
  assert.equal((both.hi - both.lo) % 2_500, 0);
  assert.deepEqual(niceExtent([]), { lo: 0, hi: 1 });
});

test("heat shades split the busy days into quartiles; empty days are level 0", () => {
  const { level, thresholds, max } = heatScale([0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(thresholds, [2, 4, 6]);
  assert.equal(max, 8);
  assert.deepEqual([0, 1, 2, 3, 5, 7, 8].map(level), [0, 1, 1, 2, 3, 4, 4]);
  assert.equal(heatScale([]).level(5), 4);
  assert.equal(heatScale([0, 0]).level(0), 0);
});

test("a calendar year is 53 Sunday-first weeks, blank outside the range", () => {
  // 2025-10-18 is a Saturday; 2026-10-17 is a Saturday.
  const { weeks, cells, months } = calendarGrid("2025-10-18", "2026-10-17");
  assert.equal(weeks, 53);
  assert.equal(cells.length, 53 * 7);
  assert.deepEqual(cells[0], { date: null, week: 0, dow: 0 });
  assert.deepEqual(cells[6], { date: "2025-10-18", week: 0, dow: 6 });
  assert.equal(cells.at(-1)!.date, "2026-10-17");
  assert.equal(cells.filter((c) => c.date).length, 365);
  // Sunday first: the second column starts on a Sunday.
  assert.equal(new Date(`${cells[7].date}T12:00:00Z`).getUTCDay(), 0);
  assert.equal(months.at(-1)!.label, "Oct");
  assert.equal(months.find((m) => m.key === "2026-01")!.week, 11);
});

test("a range that starts on a Sunday has no blank lead-in", () => {
  const { cells, weeks } = calendarGrid("2026-10-04", "2026-10-17");
  assert.equal(weeks, 2);
  assert.equal(cells[0].date, "2026-10-04");
});
