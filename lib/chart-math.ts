/**
 * Layout math for the hand-drawn SVG charts. Pure, so it can be tested alone:
 * components/charts/* only turn these numbers into elements.
 *
 * Coordinates are SVG user units. y grows downward, so a bar's `y` is its top.
 */

export type Pad = { top: number; right: number; bottom: number; left: number };
export type Frame = { w: number; h: number; pad: Pad };

/** A round axis maximum at or above `value`: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(value: number) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

/**
 * A round axis range that holds every value and zero: the max from niceMax,
 * and for negatives a min that is a round step below zero.
 */
export function niceExtent(values: number[]) {
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  if (lo === 0) return { lo: 0, hi: niceMax(hi) };
  if (hi === 0) return { lo: -niceMax(-lo), hi: 0 };
  const span = niceMax(hi - lo);
  const step = span / 4;
  return { lo: -Math.ceil(-lo / step) * step, hi: Math.ceil(hi / step) * step };
}

function plot(frame: Frame) {
  const { w, h, pad } = frame;
  return { x0: pad.left, y0: pad.top, width: Math.max(0, w - pad.left - pad.right), height: Math.max(0, h - pad.top - pad.bottom) };
}

/** Four gridlines from zero to the max, with their y positions. */
function ticks(max: number, frame: Frame) {
  const p = plot(frame);
  return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: max * f, y: p.y0 + p.height * (1 - f) }));
}

/** The slot for bar `i` of `n`: bars fill 70% of their slot, centred. */
function slot(i: number, n: number, frame: Frame) {
  const p = plot(frame);
  const step = n > 0 ? p.width / n : 0;
  const width = step * 0.7;
  return { x: p.x0 + step * i + (step - width) / 2, width, center: p.x0 + step * i + step / 2 };
}

/** y for a value on a 0..max axis, clamped to the plot so negatives sit on the baseline. */
export function yFor(value: number, max: number, frame: Frame) {
  const p = plot(frame);
  const f = Math.min(1, Math.max(0, value / (max || 1)));
  return p.y0 + p.height * (1 - f);
}

export type BarDatum = { key: string; label: string; value: number };

export function barLayout(series: BarDatum[], frame: Frame) {
  const max = niceMax(Math.max(0, ...series.map((d) => d.value)));
  const baseline = plot(frame).y0 + plot(frame).height;
  const bars = series.map((d, i) => {
    const s = slot(i, series.length, frame);
    const y = yFor(d.value, max, frame);
    return { ...d, x: s.x, width: s.width, center: s.center, y, height: baseline - y };
  });
  return { max, bars, ticks: ticks(max, frame), baseline };
}

export type StackDatum = { key: string; label: string; parts: number[] };

/**
 * Bars made of stacked parts (negative parts count as zero), bottom part first.
 * `atLeast` raises the axis so a line drawn over the bars (Stripe net) fits too.
 */
export function stackedLayout(series: StackDatum[], frame: Frame, atLeast = 0) {
  const totals = series.map((d) => d.parts.reduce((s, v) => s + Math.max(0, v), 0));
  const max = niceMax(Math.max(atLeast, ...totals));
  const baseline = plot(frame).y0 + plot(frame).height;
  const bars = series.map((d, i) => {
    const s = slot(i, series.length, frame);
    let running = 0;
    const segments = d.parts.map((v, index) => {
      const value = Math.max(0, v);
      const bottom = yFor(running, max, frame);
      running += value;
      const top = yFor(running, max, frame);
      return { index, value, x: s.x, width: s.width, y: top, height: bottom - top };
    });
    return { key: d.key, label: d.label, total: totals[i], x: s.x, width: s.width, center: s.center, segments };
  });
  return { max, bars, ticks: ticks(max, frame), baseline };
}

/**
 * Arcs for a donut drawn as stroked circles: each part is a dash of its share
 * of the circumference, offset by the parts before it. Starts at 12 o'clock
 * when the circle is rotated -90deg.
 */
export function donutSegments(parts: number[], r: number, stroke: number) {
  const circumference = 2 * Math.PI * r;
  const total = parts.reduce((s, v) => s + Math.max(0, v), 0);
  let before = 0;
  return parts.map((v, index) => {
    const value = Math.max(0, v);
    const fraction = total > 0 ? value / total : 0;
    const length = fraction * circumference;
    const seg = { index, value, fraction, r, stroke, dasharray: `${round(length)} ${round(circumference - length)}`, dashoffset: round(-before) || 0 };
    before += length;
    return seg;
  });
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

/** Points as an SVG `points` attribute, to one decimal. */
export function polyline(points: [number, number][]) {
  return points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
}

/**
 * Five shades for a heat map: 0 for nothing, then 1–4 by quartile of the
 * days that had something, so one huge day doesn't wash the rest out.
 */
export function heatScale(values: number[]) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (f: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * f))] : 0);
  const thresholds = [q(0.25), q(0.5), q(0.75)];
  const level = (v: number) => (v <= 0 ? 0 : v <= thresholds[0] ? 1 : v <= thresholds[1] ? 2 : v <= thresholds[2] ? 3 : 4);
  return { thresholds, level, max: sorted.at(-1) ?? 0 };
}

export type CalendarCell = { date: string | null; week: number; dow: number };

const DAY_MS = 86_400_000;
const isoPlus = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * A GitHub-style calendar: one column per week, Sunday at the top, covering
 * `startIso`..`endIso` (calendar dates, already in the sales time zone).
 * Cells before the start or after the end have no date. A year is at most
 * 53 columns. `months` gives the column where each month's first day falls.
 */
export function calendarGrid(startIso: string, endIso: string) {
  const startDow = new Date(`${startIso}T12:00:00Z`).getUTCDay();
  const first = isoPlus(startIso, -startDow);
  const span = Math.round((Date.parse(`${endIso}T12:00:00Z`) - Date.parse(`${first}T12:00:00Z`)) / DAY_MS) + 1;
  const weeks = Math.max(1, Math.ceil(span / 7));
  const cells: CalendarCell[] = [];
  const months: { week: number; label: string; key: string }[] = [];
  for (let week = 0; week < weeks; week++) {
    for (let dow = 0; dow < 7; dow++) {
      const iso = isoPlus(first, week * 7 + dow);
      const inside = iso >= startIso && iso <= endIso;
      cells.push({ date: inside ? iso : null, week, dow });
      if (inside && (iso.endsWith("-01") || iso === startIso)) {
        const label = new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
        months.push({ week, label, key: iso.slice(0, 7) });
      }
    }
  }
  // A partial first month shares its column with the next: keep only the real month start.
  const clean = months.filter((m, i) => !(i === 0 && months[1] && months[1].week - m.week < 2 && !startIso.endsWith("-01")));
  return { weeks, cells, months: clean };
}
