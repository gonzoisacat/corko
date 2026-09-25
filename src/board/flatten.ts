import type { Board, LevelDef, Node } from "../state/types";
import { hit, leafDescendants } from "../state/counts";
import { searchTitle, type NestInfo } from "../state/nesting";
import { isNested } from "../state/nesting";

/* ------------------------------------------------------------------ *
 *  Flatten the visible tier tree into a linear row list for vertical
 *  virtualization (spec Sec 3; ADR 0001). Collapse and search are
 *  resolved here so the virtualizer only mounts on-screen rows.
 *
 *  Row shapes follow the card-vs-lane rule:
 *   - a node whose children are the leaf tier -> "cards-lane" (a sticky
 *     label + horizontal card strip),
 *   - a node whose children are containers    -> "lane" (a swimlane
 *     header), then its children recurse.
 *
 *  Every row carries the parentId + sibling index its tier's drag drops
 *  need. During search, drag is disabled, so indices need only be
 *  correct in the non-search path (they are -- taken from the original
 *  children arrays).
 * ------------------------------------------------------------------ */

/* One lane ABOVE a row, with everything a drop needs to reorder it.
 *
 * A row carries its whole ancestor chain because in detail a lane's own
 * RowDrop is only its HEADER BAR -- ~44px -- while the section it heads
 * can be hundreds of pixels tall once unfurled. So "after this Day" was
 * only expressible in the bottom half of that bar, and the slot vanished
 * the moment you moved down into the Day's own scenes (owner-reported
 * 2026-08-05, for T3 and T4 alike).
 *
 * The Overview never had this because it measures `.ov-block` -- the
 * whole node -- rather than the 5px band heading it (rule 2). Detail
 * cannot do that: its rows are flat and virtualized, so a section is not
 * one element. Handing each row its ancestors gets the same answer with
 * no geometry at all, which also means nothing here depends on virtua's
 * wrapper structure or on the section being fully mounted. */
export interface LaneAbove {
  id: string;
  parentId: string | null;
  index: number;
  depth: number;
  /* No later sibling of this lane will emit a row (the rest are hidden,
   * stacked, or filtered out) -- the seam's closes-here chain reads this
   * to know which containers END at a row's below-gap (board/seam.ts). */
  last: boolean;
}

export type Row =
  | {
      kind: "lane";
      key: string;
      node: Node;
      depth: number;
      level: LevelDef;
      parentId: string | null;
      index: number;
      childName: string;
      leafName: string;
      childCount: number;
      leafCount: number;
      stack?: string[]; // hidden siblings stacked behind this one
      above: LaneAbove[]; // lanes this row sits inside, outermost first
      last: boolean; // no later sibling emits a row (seam closes-here)
      siblingCount: number; // parent's DOC child count (append index)
    }
  | {
      kind: "cards-lane";
      key: string;
      node: Node;
      depth: number;
      level: LevelDef;
      leafLevel: LevelDef;
      parentId: string | null;
      index: number;
      cards: Node[]; // search-filtered leaf children
      leafCount: number; // unfiltered, for the count chip
      stack?: string[]; // hidden siblings stacked behind this one
      above: LaneAbove[];
      last: boolean; // no later sibling emits a row (seam closes-here)
      siblingCount: number; // parent's DOC child count (append index)
    }
  /* A card standing in for another board (types.ts `boardRef`). Its own
   * row kind rather than a flag on the two above, because at every tier
   * it is the SAME thing: a card. A band's whole visual promise is that
   * a lane hangs below it, and this one never will -- it cannot take
   * children at all -- so drawing one here would be a promise the row
   * cannot keep. At the LEAF tier a nesting card needs none of this: it
   * is already inside its parent's strip, and Card draws it there. */
  | {
      kind: "nested";
      key: string;
      node: Node;
      depth: number;
      level: LevelDef;
      parentId: string | null;
      index: number;
      stack?: string[];
      above: LaneAbove[];
      last: boolean;
      siblingCount: number;
    }
  | { kind: "add-root"; key: string; count: number; name: string };

/* Whether a node survives the search filter: its OWN title matches, or
 * any leaf under it does.
 *
 * The own-title half arrived 2026-08-03 (owner: the old behavior "feels
 * unintuitive"). It only ever tested the LEAF tier, so a scene called
 * "Ariel and Jay's Room" was invisible to a detail search for Ariel
 * unless one of its beats happened to say it too -- on the real board
 * that hid 10 scenes and a shoot day out of 42 matching cards. The
 * Overview had always matched on own titles, so the two views disagreed
 * about what "matching" meant.
 *
 * What did NOT change, and is the reason this isn't just "make detail
 * work like the Overview": detail still FILTERS rather than dimming.
 * Dimming is only affordable in the Overview because it isn't
 * virtualized; in a 30-hour cut you would be scrolling thousands of
 * dimmed rows hunting for the lit ones. Collapsing the board to the
 * branches that matter is what detail search is FOR, and it keeps the
 * ancestor chain above each hit so you can see where in the cut it sits.
 *
 * EXPORTED because the keyboard has to walk the same set the board draws
 * -- arrows used to land on cards the filter had removed. */
export function matchesSearch(
  node: Node,
  depth: number,
  leaf: number,
  q: string,
  matchCase = false,
  /* A NESTING CARD IS SEARCHED BY THE NAME IT SHOWS (state/nesting.ts
   * `searchTitle`), which is its target board's, not the `title` it
   * keeps written and unread. Optional and trailing, `hit`'s own idiom,
   * so the pure tests and any caller without a board index still
   * compile and simply see ordinary titles. */
  nests?: Map<string, NestInfo>,
): boolean {
  if (hit(searchTitle(node, nests), q, matchCase)) return true;
  if (depth >= leaf) return false;
  return node.children.some((c) => matchesSearch(c, depth + 1, leaf, q, matchCase, nests));
}

/* A node that matched by its OWN name shows its WHOLE subtree, unfiltered.
 * You asked for that scene, and a scene IS its beats -- drawing it as an
 * empty strip, or with only the beats that happen to repeat the word,
 * would be answering a question nobody asked. Shared with keyNav so the
 * keyboard walks exactly the cards the board drew. */
export const showsWholeSubtree = (
  node: Node,
  q: string,
  matchCase = false,
  nests?: Map<string, NestInfo>,
): boolean => hit(searchTitle(node, nests), q, matchCase);

interface Ctx {
  levels: LevelDef[];
  leaf: number;
  q: string;
  matchCase: boolean;
  searching: boolean;
  folded: (id: string) => boolean; // local per-user fold state (state/fold.ts)
  /* The pane's board index, so a nesting card is filtered by the name it
   * DRAWS rather than the one it hides (state/nesting.ts searchTitle). */
  nests?: Map<string, NestInfo>;
  rows: Row[];
}

// Attach a hidden node to the stack of the preceding sibling's row (a
// "stacked" scene/section tucked behind its lead). Returns whether it stuck.
function stackOnto(rows: Row[], rowIndex: number, id: string): boolean {
  const r = rows[rowIndex];
  if (r && (r.kind === "lane" || r.kind === "cards-lane" || r.kind === "nested")) {
    (r.stack ??= []).push(id);
    return true;
  }
  return false;
}

/* No sibling AFTER index i will emit a row of its own: the rest are
 * hidden (they stack onto an earlier row) or filtered out by the search.
 * This is what makes a row's below-seam the TRAILING insertion point of
 * its container -- and, chained through LaneAbove.last, of every
 * container closing at the same gap (board/seam.ts). */
function lastRendered(siblings: Node[], i: number, ctx: Ctx): boolean {
  /* NEVER while searching. The flag makes a seam address the APPEND slot
   * (`siblingCount`) rather than `index + 1`, which is right when the
   * siblings after this row are HIDDEN -- they are stacked behind it, so
   * "after me" really is after them -- and wrong when they are merely
   * FILTERED OUT: you would point at the gap under the last visible card
   * and the new card would land at the end of a parent you cannot see,
   * quite possibly filtered out itself. During search a seam means the
   * literal gap it sits in, nothing cleverer. Drag is disabled while
   * searching, so the `drops` half of this flag has no work either. */
  if (ctx.searching) return false;
  for (let j = i + 1; j < siblings.length; j++) if (!siblings[j].hidden) return false;
  return true;
}

// Walk a list of siblings, skipping hidden ones onto the previous row's
// stack (orphans with no lead render normally).
function walkSiblings(
  children: Node[],
  depth: number,
  parentId: string | null,
  ctx: Ctx,
  /* An ancestor matched by NAME, so everything under it is shown without
   * being filtered again. */
  whole = false,
  above: LaneAbove[] = [],
) {
  const { leaf, q, matchCase, searching } = ctx;
  let lastRow = -1;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const closing = lastRendered(children, i, ctx);
    if (searching && !whole) {
      if (!matchesSearch(child, depth, leaf, q, matchCase, ctx.nests)) continue;
      lastRow = walk(child, depth, parentId, i, ctx, false, above, closing, children.length);
      continue;
    }
    if (child.hidden && lastRow >= 0 && stackOnto(ctx.rows, lastRow, child.id)) continue;
    lastRow = walk(child, depth, parentId, i, ctx, whole, above, closing, children.length);
  }
}

/* Emit rows for `node` and its subtree; returns the index of the node's own
 * row (or -1 if it produced none, e.g. filtered out during search). */
function walk(
  node: Node,
  depth: number,
  parentId: string | null,
  index: number,
  ctx: Ctx,
  whole = false,
  above: LaneAbove[] = [],
  last = false,
  siblingCount = 0,
): number {
  const { levels, leaf, q, matchCase, searching, rows } = ctx;
  if (searching && !whole && !matchesSearch(node, depth, leaf, q, matchCase, ctx.nests)) return -1;
  // once a node matches by its own name, its subtree is shown entire
  const wholeNow = whole || (searching && showsWholeSubtree(node, q, matchCase, ctx.nests));

  /* Before either branch below: a nesting card is a card at every tier,
   * and it has nothing under it to recurse into. */
  if (isNested(node) && depth < leaf) {
    rows.push({
      kind: "nested",
      key: node.id,
      node,
      depth,
      level: levels[depth],
      parentId,
      index,
      above,
      last,
      siblingCount,
    });
    return rows.length - 1;
  }

  // leaf-parent: render label + card strip in one row
  if (depth === leaf - 1) {
    const cards =
      !searching || wholeNow
        ? node.children
        : node.children.filter((c) => hit(searchTitle(c, ctx.nests), q, matchCase));
    rows.push({
      kind: "cards-lane",
      key: node.id,
      node,
      depth,
      level: levels[depth],
      leafLevel: levels[leaf],
      parentId,
      index,
      cards,
      leafCount: node.children.length,
      above,
      last,
      siblingCount,
    });
    return rows.length - 1;
  }

  // deeper swimlane
  rows.push({
    kind: "lane",
    key: node.id,
    node,
    depth,
    level: levels[depth],
    parentId,
    index,
    childName: levels[depth + 1].name,
    leafName: levels[leaf].name,
    childCount: node.children.length,
    leafCount: leafDescendants(node, depth, leaf),
    above,
    last,
    siblingCount,
  });
  const own = rows.length - 1;

  if (ctx.folded(node.id) && !searching) return own;

  // a node's own tag (e.g. a section's "DAY 06") becomes the day for its
  // descendant scenes; otherwise inherit from above
  const inside: LaneAbove[] = [...above, { id: node.id, parentId, index, depth, last }];
  walkSiblings(node.children, depth + 1, node.id, ctx, wholeNow, inside);

  /* No add-child row any more ("yes replace the chips", owner
   * 2026-08-07): the container's trailing insert is its last child's
   * PROMOTED seam disc, and an empty container's is its own band's --
   * board/seam.ts. The append DROP zones the chip doubled as were
   * already redundant: the last row's lower half and the band's
   * come-inside tier publish the same targets. */
  return own;
}

export function flattenBoard(
  board: Board,
  q: string,
  folded: (id: string) => boolean = () => false,
  matchCase = false,
  nests?: Map<string, NestInfo>,
): Row[] {
  const leaf = board.levels.length - 1;
  const searching = q.length > 0;
  const ctx: Ctx = { levels: board.levels, leaf, q, matchCase, searching, folded, nests, rows: [] };

  for (let i = 0; i < board.roots.length; i++) {
    const root = board.roots[i];
    if (searching && !matchesSearch(root, 0, leaf, q, matchCase, nests)) continue;
    /* Roots never stack (this loop has no hidden-handling), so a root is
     * last iff nothing after it survives the filter. */
    const last = !searching && i === board.roots.length - 1;
    walk(root, 0, null, i, ctx, false, [], last, board.roots.length);
  }

  /* An EMPTY board keeps the one labeled chip: with no rows there are no
   * seams, so nothing else could offer the first card -- and its drop
   * zone is how a cross-board drag lands in a brand-new board. Every
   * other add-row is retired; the trailing inserts are promoted seam
   * discs now (board/seam.ts). */
  if (!searching && board.roots.length === 0) {
    ctx.rows.push({
      kind: "add-root",
      key: "add-root",
      count: 0,
      name: board.levels[0]?.name ?? "item",
    });
  }

  return ctx.rows;
}
