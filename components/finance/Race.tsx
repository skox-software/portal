import { ChartTip } from "@/components/charts/ChartTip";
import type { LeaderRow } from "@/lib/finance-data";
import { calendarProgress, paceToDate, rankChange } from "@/lib/forecast-math";
import { firstName, formatMoney } from "@/lib/format";

type Lane = { key: string; name: string; cash: number; won: number; tone: "a" | "b" | "rest" };

const nameOf = (r: LeaderRow) => (r.repMembershipId ? r.name : r.email ? firstName(r.email) : "Unassigned");

/** The two people with the most this year get their own lane; everyone else is Others. */
function lanes(rows: LeaderRow[], top: (string | null)[]): Lane[] {
  const out: Lane[] = top.map((email, i) => {
    const r = rows.find((x) => x.email === email);
    return { key: email ?? "none", name: r ? nameOf(r) : firstName(email), cash: r?.collectedCents ?? 0, won: r?.dealsWon ?? 0, tone: i === 0 ? "a" : "b" };
  });
  const rest = rows.filter((r) => !top.includes(r.email));
  if (rest.some((r) => r.collectedCents > 0 || r.dealsWon > 0)) {
    out.push({ key: "others", name: "Others", cash: rest.reduce((s, r) => s + r.collectedCents, 0), won: rest.reduce((s, r) => s + r.dealsWon, 0), tone: "rest" });
  }
  return out;
}

/**
 * Who's ahead: cash collected and deals won, month to date and year to
 * date, with a tick where each person lands at their current pace and how
 * many places they moved since last month. Bars grow in once on load.
 */
export function Race({ mtd, ytd, lastMonth, today }: { mtd: LeaderRow[]; ytd: LeaderRow[]; lastMonth: LeaderRow[]; today: string }) {
  const top = ytd
    .filter((r) => r.email && (r.collectedCents > 0 || r.dealsWon > 0))
    .sort((a, b) => b.collectedCents - a.collectedCents || b.dealsWon - a.dealsWon)
    .slice(0, 2)
    .map((r) => r.email);
  if (!top.length) {
    return <p className="small muted">The race starts with the first deal won or invoice paid this year. Each owner gets a lane for cash and deals, with a pace marker.</p>;
  }
  const p = calendarProgress(today);
  const moves = rankChange(
    lanes(mtd, top).filter((l) => l.tone !== "rest").map((l) => ({ key: l.key, values: [l.cash, l.won] })),
    lanes(lastMonth, top).filter((l) => l.tone !== "rest").map((l) => ({ key: l.key, values: [l.cash, l.won] })),
  );
  const blocks = [
    { title: "Month to date", lanes: lanes(mtd, top), day: p.dayOfMonth, days: p.daysInMonth, span: "this month", showMoves: true },
    { title: "Year to date", lanes: lanes(ytd, top), day: p.dayOfYear, days: p.daysInYear, span: "this year", showMoves: false },
  ];

  return (
    <ChartTip>
      <div className="frace">
        {blocks.map((b) => (
          <div key={b.title} className="frace-block">
            <h3 className="finance-subhead">{b.title}</h3>
            {(["cash", "won"] as const).map((metric) => {
              const paces = b.lanes.map((l) => paceToDate(l[metric], b.day, b.days));
              const max = Math.max(1, ...b.lanes.map((l) => l[metric]), ...paces);
              const fmt = (n: number) => (metric === "cash" ? formatMoney(n) : `${n} won`);
              return (
                <div key={metric} className="frace-metric">
                  <p className="frace-label">{metric === "cash" ? "Cash collected" : "Deals won"}</p>
                  <ol className="frace-lanes">
                    {b.lanes.map((l, i) => {
                      const move = b.showMoves && metric === "cash" ? moves.get(l.key) ?? 0 : 0;
                      const tip = `${l.name}: ${fmt(l[metric])} ${b.title.toLowerCase()} · on pace for ${fmt(paces[i])} ${b.span}`;
                      return (
                        <li key={l.key} data-tone={l.tone} data-tip={tip}>
                          <span className="frace-name">
                            {l.name}
                            {move !== 0 && <span className="frace-move" data-dir={move > 0 ? "up" : "down"} title={`${Math.abs(move)} place${Math.abs(move) === 1 ? "" : "s"} ${move > 0 ? "up" : "down"} on last month`}>{move > 0 ? "▲" : "▼"}<span className="sr-only">{move > 0 ? "up" : "down"} {Math.abs(move)} on last month</span></span>}
                          </span>
                          <span className="frace-track" aria-hidden="true">
                            <span className="frace-bar" style={{ width: `${(l[metric] / max) * 100}%`, animationDelay: `${i * 80}ms` }} />
                            {paces[i] > l[metric] && <span className="frace-pace" style={{ left: `${(paces[i] / max) * 100}%` }} />}
                          </span>
                          <span className="frace-value">{fmt(l[metric])}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
        ))}
        <p className="frace-key"><i aria-hidden="true" />Tick: where each lane ends up at its current pace. Arrows: places moved on cash since last month.</p>
      </div>
    </ChartTip>
  );
}
