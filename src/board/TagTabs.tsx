import { memo, useEffect, useState } from "react";
import type { TagDef } from "../state/types";
import { tabRect } from "./tagPlacement";
import { tagPanel } from "./tagPanel";

/* ------------------------------------------------------------------ *
 *  The tabs on one card (ADR 0002). Every card carrying a tag draws it
 *  at the tag's own position and size, so the mark lands in the same
 *  spot board-wide -- that sameness is what makes a tag scannable.
 *
 *  Sizes are in DETAIL px. The Overview draws real detail-sized cards
 *  and scales them (overview/MiniCard.tsx), so tabs scale with the card
 *  and need no special case here.
 *
 *  An invisible tag draws nothing but stays applied: it still highlights
 *  from the legend, which is a real use (mark a dimension you want to
 *  query without adding a mark to every card).
 * ------------------------------------------------------------------ */

export const TagTabs = memo(function TagTabs({
  ids,
  tags,
  nodeId,
  boardId,
  w,
  h,
  scale = 1,
}: {
  ids: string[] | undefined;
  tags: TagDef[];
  nodeId?: string; // the card these tabs are on -- lets a right-click detach one
  boardId?: string; // ...and whose card proportions the panel's preview shows
  w: number; // card width, in whatever units `scale` implies
  h: number; // card height, same
  /* Detail cards and the Overview's miniatures both draw at DETAIL size and
   * let CSS scale them, so they leave this at 1. The Overview's plain beat
   * CELLS aren't scaled cards -- they're small boxes -- so they pass the
   * miniature scale and the tab shrinks to match. */
  scale?: number;
}) {
  if (!ids?.length || !tags.length) return null;
  /* Paint order comes from the PROJECT vocabulary, not from this card's
   * own `tags` array (2026-08-03). That array is the order the tags
   * happened to be APPLIED, so two cards carrying the same overlapping
   * pair could stack them differently -- which quietly broke ADR 0002's
   * whole premise, that a tag is the same mark in the same place on every
   * card. Ordering by the legend makes overlap consistent board-wide AND
   * controllable: dragging a swatch up the legend is how you say which
   * tag wins. Reversed because siblings paint in DOM order, so the FIRST
   * legend entry has to be drawn LAST to end up on top. */
  const rank = new Map(tags.map((t, i) => [t.id, i]));
  const drawn = ids
    .map((id) => tags.find((t) => t.id === id))
    /* EITHER a tab OR a split, never both (owner-reported 2026-08-05).
     * A split tag paints as a share of the card's fill (board/tagSplit.ts)
     * and has no placement at all, so drawing it here as well put a
     * second, meaningless mark on the card -- sitting whenever the tab
     * defaults happened to put it. The two kinds are two renderers and
     * each must decline the other's tags. */
    .filter((t): t is TagDef => !!t && t.visible && t.kind !== "split")
    .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0));
  if (!drawn.length) return null;

  return (
    <>
      {drawn.map((t) => {
        const r = tabRect(t.pos, w, h, t.span * scale, t.reach * scale, t.offset * scale);
        return (
          <span
            key={t.id}
            className={"tag-tab tag-tab-" + r.edge + (t.shape === "ribbon" ? " tag-tab-ribbon" : "")}
            data-tag={t.id}
            title={t.name ? `${t.name} -- right-click for settings` : "right-click for settings"}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation(); // this tag's panel, not the card menu
              tagPanel.open(t.id, e.clientX, e.clientY, nodeId, boardId);
            }}
            style={{
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              background: t.color,
            }}
          />
        );
      })}
    </>
  );
});

/* The attribute the legend's hover-highlight matches on. Kept as one
 * space-separated list so a CSS `~=` selector can find a card by tag
 * without React re-rendering the board (the Overview isn't virtualized;
 * a render pass per hover would stutter). */
export const tagAttr = (ids: string[] | undefined): string | undefined =>
  ids?.length ? ids.join(" ") : undefined;

/* A band (a `fullWidth` tier) has no fixed card size to place a tab
 * against -- it fills the row and grows to its content -- so its size has
 * to be measured. Cards skip this entirely: their geometry is known from
 * the tier. Pass `off` to keep the observer from being created at all. */
export function useBoxSize(
  ref: React.RefObject<HTMLElement | null>,
  off = false,
): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (off || !el) return;
    const measure = () => setBox({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, off]);
  return box;
}
