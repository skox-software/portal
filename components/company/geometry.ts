import { DEPARTMENTS, SEATS, seatByKey, seatsIn } from "@/lib/company";

/**
 * Where every seat sits on the tree's 1200 × 800 canvas, and the paths that
 * connect them. Josh on top, Claude under him, the advisory board beside
 * Claude, departments in a row, each department's seats stacked on a spine.
 */
export const W = 1200;
export const H = 800;
export type Box = { x: number; y: number; w: number; h: number };

const TOP: Box = { x: 600, y: 58, w: 220, h: 72 };
const CEO: Box = { x: 600, y: 188, w: 230, h: 70 };
const ADVISORY: Box = { x: 935, y: 188, w: 200, h: 58 };
const DEPT_Y = 330;
const SEAT_Y0 = 432;
const SEAT_STEP = 74;
const deptX = (i: number) => 125 + i * 237.5;

export const BOXES = new Map<string, Box>();
BOXES.set("josh", TOP);
BOXES.set("claude", CEO);
BOXES.set("advisory", ADVISORY);
DEPARTMENTS.forEach((d, i) => {
  const x = deptX(i);
  BOXES.set(d.key, { x, y: DEPT_Y, w: 196, h: 58 });
  seatsIn(d.key).forEach((s, j) => BOXES.set(s.key, { x: x + 12, y: SEAT_Y0 + j * SEAT_STEP, w: 180, h: 60 }));
});

const top = (b: Box) => b.y - b.h / 2;
const bottom = (b: Box) => b.y + b.h / 2;
const spineX = (dept: Box) => dept.x - dept.w / 2 + 8;

/** The line that draws a seat's link to its parent, top-down. */
export function edgePath(key: string): string | null {
  const seat = seatByKey.get(key);
  if (!seat?.parent) return null;
  const b = BOXES.get(key)!;
  const p = BOXES.get(seat.parent)!;
  if (key === "advisory") return `M ${p.x + p.w / 2} ${p.y} H ${b.x - b.w / 2}`;
  if (seat.parent === "claude" || seat.parent === "josh") {
    const mid = (bottom(p) + top(b)) / 2;
    return `M ${p.x} ${bottom(p)} C ${p.x} ${mid}, ${b.x} ${mid}, ${b.x} ${top(b)}`;
  }
  // A seat on its department's spine.
  return `M ${spineX(p)} ${bottom(p)} V ${b.y} H ${b.x - b.w / 2}`;
}

/** The route a card takes from a seat up to Josh, as one continuous path. */
export function routeUp(key: string): string {
  const b = BOXES.get(key);
  const seat = seatByKey.get(key);
  if (!b || !seat) return "";
  const ceo = CEO;
  const toOwner = `L ${ceo.x} ${top(ceo)} L ${TOP.x} ${bottom(TOP)}`;
  if (key === "claude") return `M ${ceo.x} ${top(ceo)} L ${TOP.x} ${bottom(TOP)}`;
  if (key === "advisory") return `M ${b.x - b.w / 2} ${b.y} H ${ceo.x + ceo.w / 2} L ${ceo.x} ${ceo.y} ${toOwner}`;
  const deptKey = seat.parent === "claude" ? key : seat.parent!;
  const d = BOXES.get(deptKey)!;
  const mid = (bottom(ceo) + top(d)) / 2;
  const deptToCeo = `L ${d.x} ${top(d)} C ${d.x} ${mid}, ${ceo.x} ${mid}, ${ceo.x} ${bottom(ceo)} ${toOwner}`;
  if (deptKey === key) return `M ${d.x} ${top(d)} C ${d.x} ${mid}, ${ceo.x} ${mid}, ${ceo.x} ${bottom(ceo)} ${toOwner}`;
  return `M ${b.x - b.w / 2} ${b.y} H ${spineX(d)} V ${bottom(d)} L ${d.x} ${d.y} ${deptToCeo}`;
}

export const ALL_KEYS = SEATS.map((s) => s.key);
