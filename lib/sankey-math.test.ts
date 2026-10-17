import assert from "node:assert/strict";
import { test } from "node:test";
import { moneyFlow, sankeyLayout, spreadLabels, type SankeyLink, type SankeyNode } from "./sankey-math.ts";

const opts = { w: 1000, h: 400, nodeWidth: 12, gap: 16 };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

const nodes: SankeyNode[] = [
  { id: "paid", label: "Paid", column: 0 },
  { id: "fees", label: "Fees", column: 1 },
  { id: "share", label: "Share", column: 1 },
  { id: "bank", label: "Business account", column: 1 },
];
const links: SankeyLink[] = [
  { source: "paid", target: "fees", value: 30 },
  { source: "paid", target: "share", value: 470 },
  { source: "paid", target: "bank", value: 500 },
];

test("band widths out of a node add up to its height", () => {
  const { nodes: laid, links: bands } = sankeyLayout(nodes, links, opts);
  const paid = laid.find((n) => n.id === "paid")!;
  close(bands.reduce((s, l) => s + l.width, 0), paid.height);
  // One shared scale: each band is its value times it.
  for (const b of bands) close(b.width / b.value, paid.height / 1000);
});

test("nodes in a column never overlap and fit the height", () => {
  const { nodes: laid } = sankeyLayout(nodes, links, opts);
  const col = laid.filter((n) => n.column === 1).sort((a, b) => a.y - b.y);
  for (let i = 1; i < col.length; i++) assert.ok(col[i].y >= col[i - 1].y + col[i - 1].height + opts.gap - 1e-6);
  const last = col.at(-1)!;
  assert.ok(last.y + last.height <= opts.h + 1e-6);
  assert.ok(col[0].y >= 0);
});

test("bands leaving a node stack without overlapping", () => {
  const { links: bands } = sankeyLayout(nodes, links, opts);
  const sorted = [...bands].sort((a, b) => a.sy - b.sy);
  for (let i = 1; i < sorted.length; i++) close(sorted[i].sy, sorted[i - 1].sy + sorted[i - 1].width);
});

test("columns sit edge to edge across the width", () => {
  const { nodes: laid, links: bands } = sankeyLayout(nodes, links, opts);
  assert.equal(laid.find((n) => n.id === "paid")!.x, 0);
  assert.equal(laid.find((n) => n.id === "bank")!.x, opts.w - opts.nodeWidth);
  assert.equal(bands[0].x0, opts.nodeWidth);
  assert.match(bands[0].path, /^M12,[\d.]+ C/);
  assert.ok(bands[0].path.endsWith("Z"));
});

test("zero links drop, empty nodes and empty columns collapse", () => {
  const { nodes: laid, columns } = sankeyLayout(
    [
      { id: "a", label: "A", column: 0, value: 100 },
      { id: "empty", label: "Nothing", column: 1 },
      { id: "c", label: "C", column: 2 },
      { id: "d", label: "D", column: 2 },
    ],
    [
      { source: "a", target: "c", value: 60 },
      { source: "a", target: "d", value: 0 },
    ],
    opts,
  );
  assert.deepEqual(laid.map((n) => n.id).sort(), ["a", "c"]);
  assert.equal(columns, 2);
  assert.equal(laid.find((n) => n.id === "c")!.column, 1);
});

test("a node can be taller than what flows through it", () => {
  const { nodes: laid, links: bands } = sankeyLayout(
    [
      { id: "pipe", label: "Pipeline", column: 0, value: 400 },
      { id: "won", label: "Won", column: 1, value: 100 },
    ],
    [{ source: "pipe", target: "won", value: 100 }],
    opts,
  );
  const pipe = laid.find((n) => n.id === "pipe")!;
  close(pipe.height, bands[0].width * 4);
  close(pipe.height, opts.h); // the tallest column fills the height
});

test("nothing to draw lays out as nothing", () => {
  const out = sankeyLayout([{ id: "a", label: "A", column: 0 }], [], opts);
  assert.deepEqual(out.nodes, []);
  assert.deepEqual(out.links, []);
});

test("paid gross shows earned shares and unallocated gross", () => {
  const { links, keptCents } = moneyFlow({
    pipelineCents: 2_000_000,
    wonCents: 1_500_000,
    invoicedCents: 1_200_000,
    paidCents: 1_000_000,
    feesCents: 29_300,
    refundsCents: 50_000,
    shares: [{ id: "r", name: "Reiss", cents: 400_000 }, { id: "x", name: "Nobody", cents: 0 }],
  });
  assert.equal(keptCents, 1_000_000 - 400_000);
  const fromPaid = links.filter((l) => l.source === "paid");
  assert.equal(fromPaid.reduce((s, l) => s + l.value, 0), 1_000_000);
  assert.equal(links.find((l) => l.source === "won")!.value, 1_200_000);
  assert.ok(!links.some((l) => l.target === "share:x"));
});

test("fees and refunds are separate cash measures, not ownership bands", () => {
  const { links, keptCents } = moneyFlow({ pipelineCents: 0, wonCents: 0, invoicedCents: 0, paidCents: 1000, feesCents: 500, refundsCents: 1500, shares: [] });
  assert.equal(keptCents, 1000);
  assert.ok(!links.some(l => ["fees", "refunds"].includes(l.target)));
});

test("labels too close together are spread apart, in order, inside the chart", () => {
  const ys = spreadLabels([100, 102, 104, 300], 20, 320);
  assert.deepEqual(ys, [100, 120, 140, 300]);
  const bottom = spreadLabels([310, 312, 315], 20, 320);
  assert.deepEqual(bottom, [270, 290, 310]);
  assert.deepEqual(spreadLabels([50, 10], 20, 320), [50, 10]);
});

test("fees and business spending do not scale down earned founder shares", () => {
  const { links } = moneyFlow({ pipelineCents: 0, wonCents: 125000, invoicedCents: 125000, paidCents: 125000, feesCents: 30000, refundsCents: 0, shares: [{ id: "reiss", name: "Reiss", cents: 125000 }] });
  assert.equal(links.find(l => l.target === "share:reiss")?.value, 125000);
});
