import Link from "next/link";
import { donutSegments } from "@/lib/chart-math";
import { calendarProgress, paceToDate } from "@/lib/forecast-math";
import { formatMoney } from "@/lib/format";

const SIZE = 200;
const STROKE = 14;

/**
 * This year's cash collected against the revenue target set in Settings,
 * as a ring, with the business account in the middle. A tick marks where
 * the ring should be by today; the line under it says where the year lands
 * at the current pace.
 */
export function GoalDial({
  ytdCents,
  goalCents,
  balanceCents,
  balanceLabel,
  today,
}: {
  ytdCents: number;
  goalCents: number | null;
  balanceCents: number | null;
  balanceLabel: string;
  today: string;
}) {
  const year = today.slice(0, 4);
  const p = calendarProgress(today);
  // Projections are estimates: whole dollars, never cents.
  const pace = Math.round(paceToDate(ytdCents, p.dayOfYear, p.daysInYear) / 100) * 100;
  const r = (SIZE - STROKE) / 2;
  const mid = SIZE / 2;
  const c = 2 * Math.PI * r;
  const done = goalCents ? Math.min(ytdCents, goalCents) : 0;
  const [seg] = donutSegments(goalCents ? [done, Math.max(0, goalCents - done)] : [0, 1], r, STROKE);
  const share = goalCents ? ytdCents / goalCents : 0;
  // Where the ring should be today if the year were even.
  const due = p.dayOfYear / p.daysInYear;
  const angle = due * 2 * Math.PI - Math.PI / 2;
  const tick = (k: number) => [mid + Math.cos(angle) * (r + k), mid + Math.sin(angle) * (r + k)];
  const [tx1, ty1] = tick(-STROKE / 2 - 3);
  const [tx2, ty2] = tick(STROKE / 2 + 3);
  const center = formatMoney(balanceCents ?? ytdCents);

  return (
    <div className="fgoal">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={goalCents ? `${formatMoney(ytdCents)} of the ${formatMoney(goalCents)} target for ${year}, ${Math.round(share * 100)}%` : `${formatMoney(ytdCents)} collected in ${year}; no target set`}>
        <circle cx={mid} cy={mid} r={r} fill="none" className="fgoal-track" strokeWidth={STROKE} />
        {goalCents && seg.fraction > 0 && (
          <circle
            cx={mid}
            cy={mid}
            r={r}
            fill="none"
            className="fgoal-arc"
            data-ahead={pace >= goalCents ? "" : undefined}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={seg.dasharray}
            transform={`rotate(-90 ${mid} ${mid})`}
            style={{ ["--c" as string]: c }}
          />
        )}
        {goalCents && <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} className="fgoal-tick"><title>{`Where an even year would be by today: ${formatMoney(Math.round(goalCents * due))}`}</title></line>}
        <text x="50%" y="44%" textAnchor="middle" dominantBaseline="central" className="fgoal-value" data-long={center.length > 9 ? "" : undefined}>{center}</text>
        <text x="50%" y="58%" textAnchor="middle" dominantBaseline="central" className="fgoal-caption">{balanceCents !== null ? balanceLabel : `collected in ${year}`}</text>
      </svg>
      <div className="fgoal-copy">
        {goalCents ? (
          <>
            <p className="fgoal-share"><b>{Math.round(share * 100)}%</b> of the {year} target</p>
            <p>{formatMoney(ytdCents)} collected of {formatMoney(goalCents)}</p>
            <p className={pace >= goalCents ? "fgoal-pace is-ahead" : "fgoal-pace"}>On track for {formatMoney(pace)}{pace >= goalCents ? `, ${formatMoney(pace - goalCents)} over` : `, ${formatMoney(goalCents - pace)} short`}</p>
          </>
        ) : (
          <>
            <p className="fgoal-share"><b>{formatMoney(ytdCents)}</b> collected in {year}</p>
            <p>On track for {formatMoney(pace)} this year.</p>
            <p><Link href="/admin/settings#ws-goal">Set a revenue target in Settings</Link> to see progress here.</p>
          </>
        )}
      </div>
    </div>
  );
}
