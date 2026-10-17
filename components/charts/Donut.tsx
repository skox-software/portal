import { donutSegments } from "@/lib/chart-math";
import { ChartTip } from "./ChartTip";

export type DonutPart = { label: string; value: number; color: string; tip: string };

/** A ring split into parts, with a figure in the middle. Server-rendered SVG. */
export function Donut({ parts, center, caption, size = 160 }: { parts: DonutPart[]; center: string; caption: string; size?: number }) {
  const stroke = 18;
  const r = (size - stroke) / 2;
  const segs = donutSegments(parts.map((p) => p.value), r, stroke);
  const mid = size / 2;
  return (
    <div className="fdonut">
      <ChartTip>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${caption}: ${parts.map((p) => p.tip).join(", ")}`}>
          <circle cx={mid} cy={mid} r={r} fill="none" stroke="var(--line-soft)" strokeWidth={stroke} />
          {segs.map((s, i) => s.fraction > 0 && (
            <circle
              key={i}
              cx={mid}
              cy={mid}
              r={r}
              fill="none"
              stroke={parts[i].color}
              strokeWidth={stroke}
              strokeDasharray={s.dasharray}
              strokeDashoffset={s.dashoffset}
              transform={`rotate(-90 ${mid} ${mid})`}
              data-tip={parts[i].tip}
            >
              <title>{parts[i].tip}</title>
            </circle>
          ))}
          <text x="50%" y="47%" textAnchor="middle" dominantBaseline="central" className="fdonut-value">{center}</text>
          <text x="50%" y="62%" textAnchor="middle" dominantBaseline="central" className="fdonut-caption">{caption}</text>
        </svg>
      </ChartTip>
      <ul className="fchart-legend fchart-legend-col">
        {parts.map((p) => <li key={p.label}><i style={{ background: p.color }} />{p.tip}</li>)}
      </ul>
    </div>
  );
}
