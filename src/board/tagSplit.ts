import type { CSSProperties } from "react";
import type { SplitAxis, TagDef } from "../state/types";

/* ------------------------------------------------------------------ *
 *  SPLIT TAGS: a tag that takes a share of the card's color instead of
 *  sitting on top of it as a mark (docs/adr/0005-split-tags.md).
 *
 *  The point is a second dimension you can read at a glance -- a beat
 *  that is both B-roll AND a character's turning point -- without the
 *  card's own fill stopping meaning what it means.
 *
 *  N + 1, NOT N. The fill keeps the first share, always. One split tag
 *  gives half fill / half tag, two gives thirds, three quarters. That is
 *  what keeps a split ADDITIVE: take the whole card and a single split
 *  tag would simply have recolored it, which is the color override we
 *  deliberately did not merge this into.
 *
 *  VERTICAL BY DEFAULT, and the default is the safe one. In the Overview
 *  a beat cell is ~26px, so four vertical stripes are ~6px each -- about
 *  the width of an existing tag mark, which is the proof they stay
 *  legible; a diagonal blurs sooner at that size, and card tilt
 *  compounds it. And a vertical cut crosses the title uniformly, where
 *  horizontal bands put ONE band entirely behind the line of text and
 *  leave the others clear. Horizontal and diagonal are offered anyway
 *  (owner's call): which reads best depends on the board, and the cost
 *  of the other two is legibility at extreme zoom rather than breakage.
 * ------------------------------------------------------------------ */

/* THE ORDER IS THE LEGEND'S, READ FORWARD -- topmost legend entry is the
 * LEFTMOST region.
 *
 * Note this is the OPPOSITE direction to TagTabs' sort, and both are
 * correct. Tabs can overlap, so they paint as siblings in DOM order and
 * the first legend entry has to be drawn LAST to end up on top --
 * reversed. Split regions never overlap, so there is no paint order to
 * invert: position IS the order. Two opposite readings of one legend,
 * kept deliberately apart rather than sharing a comparator, because a
 * shared one would have to be right in two directions at once.
 *
 * Only VISIBLE tags take a share. An invisible tag stays applied and
 * stays highlightable from the legend -- that is its whole purpose -- so
 * it must not silently shrink everything else. */
export function splitColors(ids: string[] | undefined, tags: TagDef[]): string[] {
  if (!ids?.length || !tags.length) return [];
  const mine = new Set(ids);
  return tags.filter((t) => t.kind === "split" && t.visible && mine.has(t.id)).map((t) => t.color);
}

/* The card's fill plus its split regions, as ONE background.
 *
 * A gradient with hard stops rather than positioned child elements, and
 * that is not a shortcut -- it is the only version that needs nothing
 * else to be true. A background paints below every child automatically,
 * so no z-index has to be invented for the title and the card never has
 * to become a stacking context (which would trap the tabs and pins that
 * deliberately overhang it). It is clipped by the card's own
 * border-radius for free, so rounded corners need no wrapper. And it
 * works unchanged on the Overview's plain `.ov-cell`, which is a bare
 * span rather than a scaled card: percentages need no miniature scale.
 *
 * Longhands, not the `background` shorthand: this file has been bitten
 * three times by a shorthand resetting a longhand set elsewhere, and a
 * caller spreading these over a `background:` would silently drop the
 * image. Spread this INSTEAD of setting background.
 *
 * THE DIRECTION IS A CSS VARIABLE, NOT A PARAMETER, and that is what
 * keeps the axis free. It is project-level, so every card would otherwise
 * have to be told it -- and the Overview is not virtualized, so "tell
 * every card" means either thousands of store subscriptions or threading
 * one more prop through every proxy (the mistake `tags` and `noteDots`
 * are threaded to avoid). As a variable it is set ONCE on `.app` and the
 * browser re-resolves every gradient on the board for free. The fallback
 * keeps a card correct even outside that scope.
 */
export function splitFill(fill: string, colors: string[]): CSSProperties {
  if (!colors.length) return { background: fill };
  const share = 100 / (colors.length + 1);
  /* The fill's own share is a TRANSPARENT first stop rather than a
   * repeat of the color: the fill is already the background-color
   * underneath, so letting it show through keeps one source of truth --
   * and means a card whose tier default changes updates its own slice
   * without the gradient being rebuilt. It is also what pins the fill to
   * position 0, so a card's own color never moves however many splits
   * it carries. */
  const stops = colors.map((c, i) => {
    const from = (i + 1) * share;
    const to = (i + 2) * share;
    return `${c} ${round(from)}% ${round(to)}%`;
  });
  return {
    backgroundColor: fill,
    backgroundImage: `linear-gradient(var(--split-axis, to right), transparent 0 ${round(share)}%, ${stops.join(", ")})`,
  };
}

/* Trim the float so identical cards produce identical style strings --
 * React diffs these as text, and 33.33333333333333% vs 33.333333333333336%
 * would be a needless style write on every render. */
const round = (n: number): string => String(Math.round(n * 1000) / 1000);

/* Both halves at once, for the six places that paint a card face. */
export function cardFill(
  fill: string,
  ids: string[] | undefined,
  tags: TagDef[] | undefined,
): CSSProperties {
  return splitFill(fill, splitColors(ids, tags ?? []));
}

/* The gradient direction each axis means. A gradient's color bands run
 * PERPENDICULAR to its line, so `to bottom right` -- the line from the
 * top-left corner to the bottom-right -- cuts the card from the lower
 * left to the top right, which is the diagonal that was asked for. The
 * fill lands in the top-left corner and the splits run toward the bottom
 * right, so the first-to-last reading order is the same in all three.
 *
 * Corner keywords rather than a fixed angle on purpose: they track the
 * card's aspect, so the cut always meets the corners whether it is drawn
 * on a 1.85 beat or a full-width band. */
export const SPLIT_AXIS_CSS: Record<SplitAxis, string> = {
  vertical: "to right",
  horizontal: "to bottom",
  diagonal: "to bottom right",
};
