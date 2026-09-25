/* ------------------------------------------------------------------ *
 *  Where a tag's tab sits on a card (ADR 0002).
 *
 *  `pos` is 0..1: the fraction of the way CLOCKWISE around the card's
 *  edge, starting at top-center. Distance, not angle -- a ray swept from
 *  the center crawls along a rectangle's long sides and races round its
 *  corners, which makes the placement slider feel broken. Walking the
 *  perimeter moves the tab at one speed the whole way.
 *
 *  The tab straddles the edge (half in, half out) and lies along it, so
 *  it reads as a sticky note stuck to the card. A rectangle laid along an
 *  edge needs no rotation: the long axis just follows the edge.
 * ------------------------------------------------------------------ */

export type TabEdge = "top" | "right" | "bottom" | "left";

export interface TabRect {
  left: number;
  top: number;
  width: number;
  height: number;
  edge: TabEdge;
}

/* Card w x h. `span` runs along the edge, `reach` sticks out across it, and
 * `offset` slides the whole tab along the outward normal: 0 straddles the
 * border half-and-half, positive pushes it clear of the card, negative pulls
 * it inside. */
export function tabRect(
  pos: number,
  w: number,
  h: number,
  span: number,
  reach: number,
  offset = 0,
): TabRect {
  // out = how far the tab's near face sits OUTSIDE the edge. At offset 0
  // that's half its reach, i.e. it straddles the border.
  const out = reach / 2 + offset;
  const p = ((pos % 1) + 1) % 1; // wraps: it's a loop
  let d = p * 2 * (w + h);

  // top edge, center -> right corner
  if (d < w / 2)
    return { left: w / 2 + d - span / 2, top: -out, width: span, height: reach, edge: "top" };
  d -= w / 2;
  // down the right edge
  if (d < h)
    return { left: w - reach + out, top: d - span / 2, width: reach, height: span, edge: "right" };
  d -= h;
  // right to left along the bottom
  if (d < w)
    return { left: w - d - span / 2, top: h - reach + out, width: span, height: reach, edge: "bottom" };
  d -= w;
  // up the left edge
  if (d < h)
    return { left: -out, top: h - d - span / 2, width: reach, height: span, edge: "left" };
  d -= h;
  // top edge again, left corner -> back to center
  return { left: d - span / 2, top: -out, width: span, height: reach, edge: "top" };
}
