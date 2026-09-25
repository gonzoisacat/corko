import type { MarkDesign, MarkState } from "./types";

/* ------------------------------------------------------------------ *
 *  THE PINBOARD DESIGNER'S MODEL (owner, 2026-09-04 -- "a hidden
 *  pinboard designer"): the mark in the corner as a 6x6 grid of pins a
 *  person can rearrange and recolor. A DESIGN is the grid as six rows
 *  of `#` (pin) and `.` (board), a board color, a default pin color, and
 *  any per-pin colors keyed "x,y". The project's MARK STATE is an
 *  optional OVERRIDE (the logo is this, always) and a POOL (arrangements
 *  the mark's click may land on, beside the built-in looks). Lives in
 *  the project doc, since he called it the logo "for the project" --
 *  optional and absent-reads-as-today, so an ordinary deploy.
 *
 *  Pure: what a design IS and how it is checked, no rendering.
 * ------------------------------------------------------------------ */

export const MARK_SPAN = 6;
export const MARK_MIN = 5;
export const MARK_MAX = 8;
/* THE LEGAL SIZES: 5x5 through 8x8, and 1x1 -- one pin, the whole
 * mark (owner, 2026-09-06: "add a 1x1 mode (not anything in between
 * 5x5 and that)"). Anything under 5 reads as 1; anything over 8 as 8. */
export const MARK_SIZES: readonly number[] = [1, 5, 6, 7, 8];
export function legalSize(n: number): number {
  const r = Math.round(n);
  if (!Number.isFinite(r) || r < MARK_MIN) return 1;
  return Math.min(MARK_MAX, r);
}
export const sizeOf = (d: MarkDesign): number => legalSize(d.size ?? d.cells.length ?? MARK_SPAN);
export const MAX_POOL = 24;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const cellKey = (x: number, y: number): string => `${x},${y}`;

/* Every pin in a design, in reading order, at cell coordinates. */
export function designPins(d: MarkDesign): { x: number; y: number }[] {
  const n = sizeOf(d);
  const out: { x: number; y: number }[] = [];
  d.cells.slice(0, n).forEach((row, y) => {
    for (let x = 0; x < n; x++) if (row[x] === "#") out.push({ x, y });
  });
  return out;
}

/* The same arrangement on a bigger or smaller grid: anchored top-left,
 * rows padded with board or cut, pins past the new edge gone. */
export function resizeDesign(d: MarkDesign, size: number): MarkDesign {
  const n = legalSize(size);
  const cells: string[] = [];
  for (let y = 0; y < n; y++) {
    const row = d.cells[y] ?? "";
    let out = "";
    for (let x = 0; x < n; x++) out += row[x] === "#" ? "#" : ".";
    cells.push(out);
  }
  const pins: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.pins ?? {})) {
    const [x, y] = k.split(",").map(Number);
    if (x < n && y < n && cells[y][x] === "#") pins[k] = v;
  }
  return { ...d, size: n, cells, pins };
}

export const pinColor = (d: MarkDesign, x: number, y: number): string => d.pins?.[cellKey(x, y)] ?? d.pin;

export function toggleCell(d: MarkDesign, x: number, y: number): MarkDesign {
  const cells = d.cells.map((row, yy) =>
    yy === y ? row.slice(0, x) + (row[x] === "#" ? "." : "#") + row.slice(x + 1) : row,
  );
  const pins = { ...(d.pins ?? {}) };
  if (cells[y][x] === ".") delete pins[cellKey(x, y)];
  return { ...d, cells, pins };
}

export function setPinColor(d: MarkDesign, x: number, y: number, color: string): MarkDesign {
  return { ...d, pins: { ...(d.pins ?? {}), [cellKey(x, y)]: color } };
}

export const sameDesign = (a: MarkDesign | null | undefined, b: MarkDesign | null | undefined): boolean =>
  !!a && !!b && JSON.stringify(sanitizeDesign(a)) === JSON.stringify(sanitizeDesign(b));

/* A design from anything: six rows of six, every row padded or cut,
 * colors that are real hex or dropped. Null when there is no grid. */
export function sanitizeDesign(raw: unknown): MarkDesign | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.cells)) return null;
  /* A stored size wins, made legal. Without one, a row count that is a
   * legal size is taken as the size (a file from a build that had none),
   * and anything else is the C's six. */
  const fromCells = MARK_SIZES.includes(r.cells.length) ? r.cells.length : MARK_SPAN;
  const n = legalSize(typeof r.size === "number" && Number.isFinite(r.size) ? r.size : fromCells);
  const cells: string[] = [];
  for (let y = 0; y < n; y++) {
    const row = typeof r.cells[y] === "string" ? (r.cells[y] as string) : "";
    let out = "";
    for (let x = 0; x < n; x++) out += row[x] === "#" ? "#" : ".";
    cells.push(out);
  }
  const hex = (v: unknown, fallback: string): string => (typeof v === "string" && HEX.test(v) ? v : fallback);
  const d: MarkDesign = { size: n, cells, board: hex(r.board, "#1d2027"), pin: hex(r.pin, "#9ec5ff") };
  if (typeof r.pins === "object" && r.pins !== null) {
    const pins: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.pins as Record<string, unknown>)) {
      const m = /^([0-7]),([0-7])$/.exec(k);
      if (!m || typeof v !== "string" || !HEX.test(v)) continue;
      const x = Number(m[1]);
      const y = Number(m[2]);
      if (x >= n || y >= n || cells[y][x] !== "#") continue; // a color on bare board is noise
      pins[k] = v;
    }
    if (Object.keys(pins).length) d.pins = pins;
  }
  return d;
}

export function sanitizeMark(raw: unknown): MarkState | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out: MarkState = {};
  const override = sanitizeDesign(r.override);
  if (override) out.override = override;
  if (Array.isArray(r.pool)) {
    const pool = r.pool.map(sanitizeDesign).filter((d): d is MarkDesign => d !== null);
    if (pool.length) out.pool = pool.slice(0, MAX_POOL);
  }
  return out.override || out.pool ? out : undefined;
}

/* WHAT THE BOOT SPLASH LANDS ON (owner, 2026-09-04: "if it's added to
 * the fun pool it can take over, if it's the override, it always
 * wins"). An override is the answer, always. Otherwise, with Fun on,
 * every pool design is one more ticket in the same draw as the built-in
 * pairings -- `pairings` is how many of those there are -- and null
 * means a pairing won. Without Fun the pool sits out and null it is. */
export function pickSplashDesign(
  state: { override?: MarkDesign; pool?: MarkDesign[] },
  fun: boolean,
  pairings: number,
  rnd: () => number = Math.random,
): MarkDesign | null {
  if (state.override) return state.override;
  const pool = fun ? (state.pool ?? []) : [];
  if (!pool.length) return null;
  const i = Math.floor(rnd() * (pairings + pool.length));
  return i < pairings ? null : pool[i - pairings];
}
