/**
 * Splits a formatted figure ("$12,480.50") into columns for the ticker's
 * rolling digits. Pure, so it can be tested alone.
 *
 * Columns are keyed from the right (ones, tens, …), so when a value gains a
 * digit the existing ones keep their identity and roll instead of jumping.
 */

export type OdometerColumn = { key: string; digit: number } | { key: string; char: string };

export function odometerColumns(text: string): OdometerColumn[] {
  const chars = [...text];
  let place = 0;
  let other = 0;
  const out: OdometerColumn[] = [];
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i];
    if (c >= "0" && c <= "9") out.push({ key: `d${place++}`, digit: Number(c) });
    else out.push({ key: `s${other++}:${c}`, char: c });
  }
  return out.reverse();
}

export function isDigit(col: OdometerColumn): col is { key: string; digit: number } {
  return "digit" in col;
}
