import { useMemo } from "react";
import type { Board, Node } from "../state/types";

/* ------------------------------------------------------------------ *
 *  Which of the PROJECT's vocabulary a given board actually uses.
 *
 *  Tags and metadata categories are project-level (ADR 0002 / 0003) so a
 *  card keeps its meaning when it moves between boards. The cost is that
 *  every board's legend and every card's panel shows the union of
 *  everything anyone has ever defined -- load the Die Hard example and its
 *  "Structure" tag turns up on a documentary board that has nothing to do
 *  with it.
 *
 *  This is the cheap half of the fix: leave the data model alone and stop
 *  SHOWING a board things it doesn't use. Derived from the cards, never
 *  stored, so it cannot drift out of step with reality.
 *
 *  The two surfaces then treat it differently, deliberately:
 *
 *   - the LEGEND is a scanning surface, so unused tags are simply absent;
 *     reaching them is a menu on the add button.
 *   - the metadata PANEL is an editing surface, so nothing is hidden --
 *     it just groups this board's categories above the rest.
 * ------------------------------------------------------------------ */

export interface BoardVocab {
  tagIds: Set<string>;
  fieldIds: Set<string>;
  /* the color overrides its cards NAME (ADR 0006: overrides are
   * project-level now, so the legend row shows a board only these) */
  colorIds: Set<string>;
}

export function collectVocab(board: Board | null): BoardVocab {
  const tagIds = new Set<string>();
  const fieldIds = new Set<string>();
  const colorIds = new Set<string>();
  if (!board) return { tagIds, fieldIds, colorIds };
  const walk = (n: Node) => {
    if (n.color) colorIds.add(n.color);
    n.tags?.forEach((t) => tagIds.add(t));
    if (n.values) for (const k of Object.keys(n.values)) fieldIds.add(k);
    // a category placed in a slot counts even with no value yet -- the card
    // is laid out for it, so the board plainly means to use it
    if (n.slots) for (const v of Object.values(n.slots)) if (v) fieldIds.add(v);
    n.children.forEach(walk);
  };
  board.roots.forEach(walk);
  return { tagIds, fieldIds, colorIds };
}

/* Memoized on the board SNAPSHOT's identity. Structural sharing means that
 * object only changes when the board actually changes, so this walk runs on
 * a real edit and not on every render -- which matters because the Overview
 * isn't virtualized and this feeds surfaces it renders. */
export function useBoardVocab(board: Board | null): BoardVocab {
  return useMemo(() => collectVocab(board), [board]);
}

/* HOW MANY CARDS ARE PAINTED WITH A LEGEND ENTRY, by name rather than by
 * inheritance: an override is only ever worn by a card that NAMES it
 * (`Node.color`), which is exactly what makes this a simple count. Tier
 * defaults and the nesting fill are reached without naming, so this is
 * not the right question to ask about those -- and it is never asked,
 * since neither offers a Remove.
 *
 * Walked on demand (opening a panel, pressing Remove) rather than
 * memoized: it answers a question about one entry at the moment someone
 * asks it, which is not often enough to keep a cache honest for. */
export function countColorUses(board: Board | null, entryId: string): number {
  if (!board || !entryId) return 0;
  let n = 0;
  const walk = (node: Node) => {
    if (node.color === entryId) n++;
    node.children.forEach(walk);
  };
  board.roots.forEach(walk);
  return n;
}

/* HOW MANY CARDS CARRY A TAG -- countColorUses' twin (owner asked for
 * the same only-ask-when-something-is-lost rule on tag deletion,
 * 2026-08-29), with the one difference the model dictates: tags are
 * PROJECT-level (ADR 0002), so an unused-on-this-board tag can still be
 * worn three boards over, and the walk covers every board. Same
 * on-demand discipline: it answers a question about one tag at the
 * moment someone presses Delete. */
export function countTagUses(boards: readonly Board[], tagId: string): number {
  if (!tagId) return 0;
  let n = 0;
  const walk = (node: Node) => {
    if (node.tags?.includes(tagId)) n++;
    node.children.forEach(walk);
  };
  for (const b of boards) b.roots.forEach(walk);
  return n;
}
