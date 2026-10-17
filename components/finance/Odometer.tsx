import { odometerColumns } from "@/lib/odometer";

const STRIP = "0123456789".split("");

/**
 * A figure whose digits roll to their new value. Each digit is a column of
 * 0–9 moved with a CSS transform, so a change never reflows the line. Screen
 * readers get the plain text once.
 */
export function Odometer({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`odo${className ? ` ${className}` : ""}`}>
      <span className="sr-only">{text}</span>
      {odometerColumns(text).map((col) =>
        "digit" in col ? (
          <span key={col.key} className="odo-col" aria-hidden="true">
            <span className="odo-strip" style={{ transform: `translateY(${-col.digit * 10}%)` }}>
              {STRIP.map((d) => <span key={d}>{d}</span>)}
            </span>
          </span>
        ) : (
          <span key={col.key} className="odo-char" aria-hidden="true">{col.char}</span>
        ),
      )}
    </span>
  );
}
