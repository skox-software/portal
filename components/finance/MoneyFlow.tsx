import { ChartTip } from "@/components/charts/ChartTip";
import { formatMoney } from "@/lib/format";
import { moneyFlow, sankeyLayout, spreadLabels, type MoneyFlowInput } from "@/lib/sankey-math";

/** SVG units: x stretches to the panel, y is pixels (the height), so labels can be HTML and never shrink. */
const W = 1000;
const NODE = 10;

const KIND: Record<string, string> = { fees: "fees", refunds: "refunds", kept: "kept" };
const kindOf = (id: string) => KIND[id] ?? (id.startsWith("share:") ? "share" : "chain");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : "—");

/**
 * The money-flow hero: how the open pipeline, deals won, invoices and
 * payments in the period relate, and where the paid money went. Server SVG;
 * every band and node has a tooltip. On a phone the labels move to a list
 * under the drawing.
 */
export function MoneyFlow({ input, periodLabel, height: H = 340 }: { input: MoneyFlowInput; periodLabel: string; height?: number }) {
  const flow = moneyFlow(input);
  const { nodes, links, columns } = sankeyLayout(flow.nodes, flow.links, { w: W, h: H, nodeWidth: NODE, gap: 14 });
  if (!nodes.length) {
    return <p className="small muted">The flow from pipeline to paid draws here once there&apos;s an open deal, a won deal, an invoice or a payment in {periodLabel.toLowerCase()}.</p>;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const last = Math.max(...nodes.map((n) => n.column));
  const tail = nodes.filter((n) => n.column === last && last > 0);
  const tailY = spreadLabels(tail.map((n) => n.y + n.height / 2), 22, H);

  return (
    <div className="fflow">
      <p className="small muted">Shares are earned amounts, not payouts or bank balances. Stripe fees ({formatMoney(input.feesCents)}), refunds ({formatMoney(input.refundsCents)}) and business expenses are tracked separately. Expenses do not reduce deal ownership.</p>
      <ChartTip>
        <div className="fflow-plot" style={{ height: H }}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Money flow for ${periodLabel.toLowerCase()}: ${nodes.map((n) => `${n.label} ${formatMoney(n.value)}`).join(", ")}`}>
            {links.map((l, i) => {
              const from = byId.get(l.source)!;
              const to = byId.get(l.target)!;
              const tip = `${from.label} → ${to.label}: ${formatMoney(l.value)} · ${pct(l.value, from.value)} of ${from.label}`;
              return (
                <path key={`${l.source}-${l.target}`} d={l.path} className="fflow-band" data-kind={kindOf(l.target)} data-tip={tip} style={{ ["--i" as string]: from.column + i * 0.02 }}>
                  <title>{tip}</title>
                </path>
              );
            })}
            {nodes.map((n) => (
              <rect key={n.id} x={n.x} y={n.y} width={n.width} height={Math.max(n.height, 1.5)} rx={2} className="fflow-node" data-kind={kindOf(n.id)} data-tip={`${n.label}: ${formatMoney(n.value)}`}>
                <title>{`${n.label}: ${formatMoney(n.value)}`}</title>
              </rect>
            ))}
          </svg>
          <div className="fflow-labels" aria-hidden="true">
            {nodes.map((n) => {
              if (n.column === last && last > 0) {
                const y = tailY[tail.indexOf(n)];
                return (
                  <span key={n.id} className="fflow-label fflow-label-end" style={{ right: `calc(${(1 - n.x / W) * 100}% + 12px)`, top: y }}>
                    {n.label} <b>{formatMoney(n.value)}</b>
                  </span>
                );
              }
              return (
                <span key={n.id} className="fflow-label" style={{ left: `calc(${((n.x + n.width) / W) * 100}% + 12px)`, top: Math.max(0, n.y) }}>
                  {n.label}
                  <b>{formatMoney(n.value)}</b>
                </span>
              );
            })}
          </div>
        </div>
      </ChartTip>
      <dl className="fflow-list" data-columns={columns}>
        {nodes.map((n) => (
          <div key={n.id} data-kind={kindOf(n.id)}>
            <dt><i />{n.label}</dt>
            <dd>{formatMoney(n.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
