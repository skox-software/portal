import Link from "next/link";
import { PERIOD_CHIP, PERIODS, type PeriodKey } from "@/lib/finance-periods";

/** 30d / 90d / 12m / YTD as links, keeping every other query parameter. */
export function PeriodSwitcher({ path, current, params = {} }: { path: string; current: PeriodKey; params?: Record<string, string> }) {
  return (
    <nav className="period-chips" aria-label="Period">
      {PERIODS.map((key) => {
        const query = new URLSearchParams({ ...params, period: key });
        query.delete("fresh");
        return (
          <Link key={key} href={`${path}?${query}`} aria-current={key === current ? "page" : undefined}>
            {PERIOD_CHIP[key]}
          </Link>
        );
      })}
    </nav>
  );
}
