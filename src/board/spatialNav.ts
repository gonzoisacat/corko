import type { NavDir } from "./keyNav";

/* ------------------------------------------------------------------ *
 *  Arrow keys on a 2D surface (owner's call, 2026-08-03).
 *
 *  keyNav's row model reads the board as LINES OF TEXT, which is right
 *  in the detail view -- scenes stack down, beats run right, and tree
 *  order and screen order agree. In the OVERVIEW they don't: columns put
 *  document-later content up and to the RIGHT, so walking the tree made
 *  Right jump from the bottom of one column to the top of the next. The
 *  Overview is one coherent surface with cards on it, and the cursor has
 *  to treat it as one.
 *
 *  So here the map is the screen literally: measured boxes, and an arrow
 *  goes to the nearest box in that direction. No tree involved, which is
 *  also why it copes with spines, wrapped beat rows and any "Detail
 *  level" without knowing about any of them.
 * ------------------------------------------------------------------ */

export interface NavRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/* How much a candidate is punished per pixel it sits off to the side of
 * the direction you pressed. High on purpose: from the middle of a beat
 * row, Right should take the beat beside you over a scene card that
 * starts nearer but a row up. */
const ASIDE_PENALTY = 8;
/* boxes that touch or overlap by a hair still count as "past" */
const EPS = 2;

/* The nearest cell in `dir`, or null at the edge of the surface.
 *
 * Gated on EDGES, not centers: a candidate qualifies when it begins at
 * or after the cursor's trailing edge. Centers seem equivalent and
 * aren't -- a SPINE is a 300px bar beside 30px cards, so its center sits
 * halfway down a column, and center tests had Right from the spine land
 * in the middle of the column it labels and Down from the last scene
 * climb back INTO the spine. Edges make a tall neighbour behave like the
 * long thing it is.
 *
 * Then: distance ALONG the direction, plus a penalty for the gap ACROSS
 * it (zero while the boxes share a band, so anything level with you
 * wins). */
export function pickSpatial(dir: NavDir, from: NavRect, cells: NavRect[]): string | null {
  const horizontal = dir === "left" || dir === "right";
  /* the cursor's near/far edges on the axis being travelled, and the
   * band it occupies on the other one */
  const [lead, bandLo, bandHi] = horizontal
    ? [dir === "right" ? from.x + from.w : from.x, from.y, from.y + from.h]
    : [dir === "down" ? from.y + from.h : from.y, from.x, from.x + from.w];

  let bestId: string | null = null;
  let bestScore = Infinity;

  for (const c of cells) {
    if (c.id === from.id) continue;
    const [near, far, lo, hi] = horizontal
      ? [c.x, c.x + c.w, c.y, c.y + c.h]
      : [c.y, c.y + c.h, c.x, c.x + c.w];

    // must lie that way: it starts at or past the edge we're leaving by
    const along = dir === "right" || dir === "down" ? near - lead : lead - far;
    if (along < -EPS) continue;

    // gap between the two bands on the other axis; 0 when they overlap
    const aside = Math.max(0, Math.max(bandLo, lo) - Math.min(bandHi, hi));

    const score = Math.max(0, along) + aside * ASIDE_PENALTY;
    if (score < bestScore) {
      bestScore = score;
      bestId = c.id;
    }
  }
  return bestId;
}

/* Every card on screen in one Overview viewport, in its own coordinates.
 *
 * Read in ONE pass with no writes between, so the browser lays out once
 * and the rest are cached reads -- interleaving a write here would make
 * this the quadratic thing that used to cost the Overview 108 seconds to
 * mount. Boxes come back scaled by the viewport's zoom transform, which
 * doesn't matter: every candidate is scaled the same, so the geometry
 * that decides "nearest" is unchanged. */
export function readCells(viewport: Element): NavRect[] {
  const out: NavRect[] = [];
  for (const el of viewport.querySelectorAll<HTMLElement>("[data-node]")) {
    const id = el.dataset.node;
    if (!id) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // not laid out
    out.push({ id, x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out;
}
