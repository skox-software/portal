/**
 * Layout for the money-flow (Sankey) chart. Pure, so it can be tested alone:
 * components/finance/MoneyFlow.tsx only turns these numbers into SVG.
 *
 * Nodes sit in columns left to right; a node is as tall as the larger of its
 * own value, what flows in and what flows out, on one scale shared by every
 * column so heights compare across the chart. Links are bands whose width is
 * their value on that scale, drawn as cubic Béziers. Zero links are dropped,
 * nodes left with nothing collapse, and so do columns left empty.
 */

export type SankeyNode = { id: string; label: string; column: number; value?: number };
export type SankeyLink = { source: string; target: string; value: number };
export type SankeyOptions = { w: number; h: number; nodeWidth: number; gap: number };

export type LaidNode = SankeyNode & { value: number; column: number; x: number; y: number; width: number; height: number };
export type LaidLink = SankeyLink & {
  width: number;
  /** Top of the band where it leaves the source and where it enters the target. */
  sy: number;
  ty: number;
  x0: number;
  x1: number;
  /** Closed ribbon outline, for fill. */
  path: string;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function sankeyLayout(nodes: SankeyNode[], links: SankeyLink[], opts: SankeyOptions) {
  const ids = new Set(nodes.map((n) => n.id));
  const live = links.filter((l) => l.value > 0 && ids.has(l.source) && ids.has(l.target));
  const inSum = new Map<string, number>();
  const outSum = new Map<string, number>();
  for (const l of live) {
    outSum.set(l.source, (outSum.get(l.source) ?? 0) + l.value);
    inSum.set(l.target, (inSum.get(l.target) ?? 0) + l.value);
  }
  const valued = nodes
    .map((n) => ({ ...n, value: Math.max(n.value ?? 0, inSum.get(n.id) ?? 0, outSum.get(n.id) ?? 0) }))
    .filter((n) => n.value > 0);

  // Renumber columns so an empty one leaves no gap.
  const columns = [...new Set(valued.map((n) => n.column))].sort((a, b) => a - b);
  const colOf = new Map(columns.map((c, i) => [c, i]));
  const byCol = columns.map((c) => valued.filter((n) => n.column === c));

  const { w, h, nodeWidth, gap } = opts;
  const scale = byCol.length
    ? Math.min(...byCol.map((col) => Math.max(0, h - gap * (col.length - 1)) / col.reduce((s, n) => s + n.value, 0)))
    : 0;
  const step = byCol.length > 1 ? (w - nodeWidth) / (byCol.length - 1) : 0;

  const laid = new Map<string, LaidNode>();
  byCol.forEach((col, ci) => {
    const used = col.reduce((s, n) => s + n.value * scale, 0) + gap * (col.length - 1);
    let y = Math.max(0, (h - used) / 2);
    for (const n of col) {
      const height = n.value * scale;
      laid.set(n.id, { ...n, column: colOf.get(n.column)!, x: ci * step, y, width: nodeWidth, height });
      y += height + gap;
    }
  });

  // Stack each node's bands in the order of the node at the other end, so they don't cross needlessly.
  const kept = live.filter((l) => laid.has(l.source) && laid.has(l.target));
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  const bySource = [...kept].sort((a, b) => laid.get(a.target)!.y - laid.get(b.target)!.y);
  const sy = new Map<SankeyLink, number>();
  for (const l of bySource) {
    const s = laid.get(l.source)!;
    const off = out.get(l.source) ?? 0;
    sy.set(l, s.y + off);
    out.set(l.source, off + l.value * scale);
  }
  const byTarget = [...kept].sort((a, b) => laid.get(a.source)!.y - laid.get(b.source)!.y);
  const ty = new Map<SankeyLink, number>();
  for (const l of byTarget) {
    const t = laid.get(l.target)!;
    const off = into.get(l.target) ?? 0;
    ty.set(l, t.y + off);
    into.set(l.target, off + l.value * scale);
  }

  const laidLinks: LaidLink[] = kept.map((l) => {
    const s = laid.get(l.source)!;
    const t = laid.get(l.target)!;
    const width = l.value * scale;
    const x0 = s.x + s.width;
    const x1 = t.x;
    const a = sy.get(l)!;
    const b = ty.get(l)!;
    const mid = (x0 + x1) / 2;
    const path =
      `M${r1(x0)},${r1(a)} C${r1(mid)},${r1(a)} ${r1(mid)},${r1(b)} ${r1(x1)},${r1(b)} ` +
      `L${r1(x1)},${r1(b + width)} C${r1(mid)},${r1(b + width)} ${r1(mid)},${r1(a + width)} ${r1(x0)},${r1(a + width)} Z`;
    return { ...l, width, sy: a, ty: b, x0, x1, path };
  });

  return { nodes: [...laid.values()], links: laidLinks, scale, columns: byCol.length };
}

export type MoneyFlowInput = {
  /** Open deals weighted by stage, right now. */
  pipelineCents: number;
  wonCents: number;
  invoicedCents: number;
  paidCents: number;
  feesCents: number;
  refundsCents: number;
  /** Commission earned in the period, per person (Reiss's partner share, reps). */
  shares: { id: string; name: string; cents: number }[];
};

/**
 * The finance hero: pipeline → won → invoiced → paid → where the paid money
 * went. The first three steps are different measures of the same period,
 * not one pot of money moving, so each band carries what the two stages
 * share (the smaller of the two) and each node keeps its own full height.
 * From Paid on it is a true split: fees, refunds and shares come out, and
 * whatever is left lands in the business account.
 */
export function moneyFlow(v: MoneyFlowInput) {
  const shares = v.shares.filter((s) => s.cents > 0);
  const out = v.feesCents + v.refundsCents + shares.reduce((s, x) => s + x.cents, 0);
  // Fees and refunds can belong to money collected before the period: never let the split exceed Paid.
  const outScale = out > v.paidCents && out > 0 ? v.paidCents / out : 1;
  const part = (c: number) => Math.max(0, Math.round(c * outScale));
  const fees = part(v.feesCents);
  const refunds = part(v.refundsCents);
  const shareParts = shares.map((s) => ({ ...s, cents: part(s.cents) }));
  const kept = Math.max(0, v.paidCents - fees - refunds - shareParts.reduce((s, x) => s + x.cents, 0));

  const nodes: SankeyNode[] = [
    { id: "pipeline", label: "Open pipeline", column: 0, value: v.pipelineCents },
    { id: "won", label: "Won", column: 1, value: v.wonCents },
    { id: "invoiced", label: "Invoiced", column: 2, value: v.invoicedCents },
    { id: "paid", label: "Paid", column: 3, value: v.paidCents },
    { id: "fees", label: "Stripe fees", column: 4 },
    { id: "refunds", label: "Refunds", column: 4 },
    ...shareParts.map((s) => ({ id: `share:${s.id}`, label: `${s.name} share`, column: 4 })),
    { id: "kept", label: "Business account", column: 4 },
  ];
  const links: SankeyLink[] = [
    { source: "pipeline", target: "won", value: Math.min(v.pipelineCents, v.wonCents) },
    { source: "won", target: "invoiced", value: Math.min(v.wonCents, v.invoicedCents) },
    { source: "invoiced", target: "paid", value: Math.min(v.invoicedCents, v.paidCents) },
    { source: "paid", target: "fees", value: fees },
    { source: "paid", target: "refunds", value: refunds },
    ...shareParts.map((s) => ({ source: "paid", target: `share:${s.id}`, value: s.cents })),
    { source: "paid", target: "kept", value: kept },
  ];
  return { nodes, links, keptCents: kept };
}

/**
 * Nudges label centres apart so none sit closer than `minGap`, keeping them
 * inside 0..h and as near their nodes as possible. Input order is kept.
 */
export function spreadLabels(ys: number[], minGap: number, h: number) {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => o.y);
  for (let k = 0; k < placed.length; k++) placed[k] = Math.max(placed[k], k ? placed[k - 1] + minGap : minGap / 2);
  // Pushed off the bottom: walk back up.
  for (let k = placed.length - 1; k >= 0; k--) {
    const limit = k === placed.length - 1 ? h - minGap / 2 : placed[k + 1] - minGap;
    placed[k] = Math.min(placed[k], limit);
  }
  const out: number[] = [];
  order.forEach((o, k) => (out[o.i] = placed[k]));
  return out;
}
