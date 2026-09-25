/* Short, sortable-ish unique ids. Carried from the prototype:
 * prefix + base36 timestamp + a per-session random tag + a sequence
 * counter. The random tag matters in multiplayer: without it, two
 * browsers that create their Nth node in the same millisecond mint the
 * SAME id (both counters start at 0), and duplicate ids break locate(),
 * React keys, and selection. */
let _seq = 0;
const _tag = Math.random().toString(36).slice(2, 6);
export const uid = (p: string): string =>
  `${p}-${Date.now().toString(36)}${_tag}-${(_seq++).toString(36)}`;

/* WHEN an id was minted, in ms -- uid() puts Date.now() in base36 right
 * after the prefix, so anything it made can be dated with no extra field
 * and no migration. (CLAUDE.md leans on this to answer "what did I
 * actually change?"; the Boards menu uses it to sort chronologically.)
 *
 * It returns null rather than a guess for ids uid() did NOT make, and
 * that matters more than it looks: `board-legacy` -- the fixed id the
 * Phase 4 migration gives the pre-Phase-4 board -- parses as perfectly
 * valid base36 ("legacy" -> Jan 2011), so without a plausibility window
 * a caller would be handed a confident wrong date instead of "unknown".
 * Callers decide what an unknown age means; for boards it means oldest,
 * which for that one id is true by construction. */
const STAMP_MIN = Date.UTC(2024, 0, 1);
const STAMP_SLACK = 864e5; // a day, for clock skew between peers

export function idStamp(id: string): number | null {
  const dash = id.indexOf("-");
  if (dash < 0) return null;
  const t = parseInt(id.slice(dash + 1, dash + 9), 36);
  if (!Number.isFinite(t) || t < STAMP_MIN || t > Date.now() + STAMP_SLACK) return null;
  return t;
}
