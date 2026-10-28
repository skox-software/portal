import type { RepStatus } from "@/lib/rep-status";

const STOPS = [
  { key: "working", label: "Working" },
  { key: "booked", label: "Call booked" },
  { key: "with_skox", label: "With UnBusy" },
  { key: "won", label: "Won" },
] as const;

/**
 * Where a lead stands, as four stops. Reps see the deal move without ever
 * seeing UnBusy's internal stages or prices.
 */
export function RepTrack({ status, mini = false }: { status: RepStatus; mini?: boolean }) {
  const at = status === "lost" ? -1 : STOPS.findIndex((s) => s.key === status);
  return (
    <ol
      className={`rp-track${mini ? " rp-track-mini" : ""}`}
      data-lost={status === "lost" ? "" : undefined}
      data-won={status === "won" ? "" : undefined}
      aria-label={status === "lost" ? "Closed, not moving forward" : `Status: ${STOPS[at]?.label}`}
    >
      {STOPS.map((s, i) => (
        <li key={s.key} data-done={i < at ? "" : undefined} data-now={i === at && status !== "won" ? "" : undefined} aria-current={i === at ? "step" : undefined}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}
