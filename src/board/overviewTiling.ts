import type { Board, Node } from "../state/types";
import { dragStore, itemHeight } from "./drag";
import { dropTarget } from "./dropTarget";
import { pickSlot, SLOT_ROOM, type SlotBox } from "./dropPlan";

/* ------------------------------------------------------------------ *
 *  THE OVERVIEW'S WHOLE SURFACE IS A DROP ZONE (owner, 2026-08-03).
 *
 *  Publishing only from the proxy under the cursor leaves holes -- the
 *  space beside a column, the area under a day's beats, the background --
 *  and a hole means no slot, which now also means no drop. The surface is
 *  tiled instead: anywhere you are, the NEAREST insertion point at the
 *  dragged tier wins, so there is nothing to aim at and nothing to miss.
 *
 *  Tiled PER TIER, which is what makes it well-defined: drag a Day and
 *  the whole surface maps to Day slots, drag a scene and it maps to scene
 *  slots. The one exception is the slot the node already occupies, which
 *  publishes nothing -- a drop that changes nothing shouldn't advertise
 *  itself (and since a missing slot now refuses the drop, that refusal is
 *  real rather than cosmetic).
 *
 *  MEASURED ONCE PER DRAG. The Overview isn't virtualized, so a board can
 *  have thousands of proxies mounted; reading their rects on every
 *  dragover would be a full layout pass per pointer move. The board can't
 *  change mid-drag, so one pass at dragstart is enough -- the same
 *  single-pass discipline spatialNav.ts follows, and for the same reason.
 * ------------------------------------------------------------------ */

/* The slot shape and the arithmetic over it live in board/dropPlan.ts,
 * beside the detail view's statement of the same rule -- this file is the
 * measuring half. */
let slots: SlotBox[] = [];
let forDrag: string | null = null;

/* Nodes at `depth`, with where they sit, paired to their on-screen box. */
export function ensureTier(board: Board, viewport: Element | null, columnDepth: number): void {
  const item = dragStore.get();
  if (!item || !viewport || forDrag === item.id) return;
  /* Which rung of THIS board the dragged node belongs on -- its height
   * above the leaf, so a cross-board drag from a longer ladder still
   * lands at the matching role rather than the matching depth. */
  const h = itemHeight(item);
  const depth = board.levels.length - 1 - h;
  if (depth < 0 || depth > board.levels.length - 1) return;
  measureTier(board, depth, viewport, columnDepth);
}

function measureTier(board: Board, depth: number, viewport: Element, columnDepth: number): void {
  const item = dragStore.get();
  forDrag = item?.id ?? null;
  slots = [];
  const leaf = board.levels.length - 1;
  /* WHICH WAY THE ROOM OPENS follows how that tier is actually laid out,
   * which in the Overview depends on the "1 Column per:" setting rather
   * than on the tier alone (owner, 2026-08-03):
   *
   *   at or above the column tier -> laid out in a ROW (the columns
   *     themselves, and the spines bracketing them), so the gap is a
   *     vertical slot BETWEEN columns, not a band above a header;
   *   below it                    -> stacked down inside a column, so
   *     the gap pushes down;
   *   the leaf                    -> beats run left to right in a strip.
   *
   * Getting this from the tier alone was wrong: a Day is "vertical" when
   * you column by Reel and "horizontal" when you column by Day. */
  const axis: "x" | "y" = depth <= columnDepth || depth === leaf ? "x" : "y";
  // dragging the column tier itself: the gap IS a new column
  const asColumn = depth === columnDepth;
  /* The LEAF is the one tier whose node element is not a direct child of a
   * wrapper (owner-reported 2026-08-05: "no preview boxes whatsoever" for
   * beats in the Overview). A band sits in `.ov-block` and a scene card in
   * `.ov-scene`, but a beat cell sits in `.ov-cell-row` inside `.ov-cells`
   * inside `.ov-scene` -- so `closest(".ov-block, .ov-scene")` handed back
   * the whole SCENE for every beat in it. Every beat in a scene then
   * measured the identical box, which makes "nearest" a coin toss decided
   * by array order, and the paint selector (which wants a DIRECT child)
   * matched nothing at all. A beat's gap hangs on the cell itself. */
  const asCell = depth === leaf && !asColumn;
  const columnCount = viewport.querySelectorAll(".ov-column").length;

  const walk = (nodes: Node[], parentId: string | null, d: number) => {
    if (d === depth) {
      nodes.forEach((n, i) => {
        const el = viewport.querySelector(`[data-node="${CSS.escape(n.id)}"]`);
        if (!el) return;
        /* Measure the WRAPPER, not the header. `.ov-block` holds a Day's
         * band AND its scenes; `.ov-scene` holds a scene card and its
         * beats; `.ov-column` holds a whole column. Measuring the band
         * alone put the gap between a Day and its own children -- which
         * is never where another Day goes -- and made "nearest" judge
         * against a 5px bar instead of the 107px thing it heads. */
        const box = asColumn
          ? (el.closest(".ov-column") ?? el)
          : asCell
            ? el
            : (el.closest(".ov-block, .ov-scene") ?? el);
        const r = box.getBoundingClientRect();
        if (!r.width && !r.height) return;
        /* TWO COORDINATE SPACES, and mixing them was a real bug. The rect
         * is SCREEN px -- `.ov-content` carries `transform: scale(zoom)`,
         * so it is already scaled, which is right for hit-testing against
         * a cursor. But `room` becomes a CSS margin on the element, which
         * lands INSIDE that transform and so is layout px. Measured at
         * zoom 1.18: a column is 281.8 screen px but 239 layout px, so
         * half-the-rendered-width asked for 141px of a 239px column --
         * 18% too much, and proportionally worse the further from zoom 1
         * you go. `offsetWidth` is the layout width, so the gap is the
         * same fraction of a column at every zoom and the floor below
         * stops being what the size falls back to at low zoom. */
        const layoutW = (box as HTMLElement).offsetWidth || r.width;
        slots.push({
          parentId,
          index: i,
          id: n.id,
          x: r.left,
          y: r.top,
          w: r.width,
          h: r.height,
          axis,
          scope: asColumn ? "column" : asCell ? "cell" : "node",
          room: asColumn
            ? /* Half a column, floored. The floor is the owner's dial
               * (2026-08-05): 20px under five columns, 40 beyond. It
               * rarely binds now that the width is measured in the space
               * the margin is spent in. */
              Math.max(columnCount < 5 ? 20 : 40, layoutW / 2)
            : asCell
              ? /* A beat cell is ~26 layout px, so a 34px slot would be
                 * wider than the card it separates. Half a cell keeps the
                 * gap reading as a gap at any zoom. */
                Math.max(8, layoutW / 2)
              : SLOT_ROOM,
        });
      });
      return;
    }
    for (const n of nodes) walk(n.children, n.id, d + 1);
  };
  walk(board.roots, null, 0);
}

export function clearTier(): void {
  slots = [];
  forDrag = null;
}

// a drag ending drops the measurements with it
if (typeof window !== "undefined") {
  dragStore.subscribe(() => {
    if (!dragStore.get()) clearTier();
  });
}

/* Publish the nearest insertion point to (px, py), or nothing when the
 * only candidate is where the node already lives. The arithmetic is
 * pickSlot's (board/dropPlan.ts); this half owns the drag store and the
 * publish. */
export function publishNearest(boardId: string, px: number, py: number): void {
  const item = dragStore.get();
  if (!item || forDrag !== item.id || !slots.length) return;
  const sameBoard = item.boardId === boardId;

  const pick = pickSlot(slots, px, py, {
    isSelf: dragStore.isSelf,
    isSelfTarget: dragStore.isSelfTarget,
    isNoOp: (parentId, index) => dragStore.isNoOp(parentId, index, sameBoard),
  });
  /* "self" leaves whatever was showing alone -- every candidate is inside
   * the thing in your hand, so there is nothing to say, and blanking here
   * would flicker the slot off as the cursor crossed its own subtree. */
  if (pick.kind === "self") return;
  if (pick.kind === "noop") {
    dropTarget.clearFrom({ clientX: px, clientY: py });
    return;
  }
  // Option-drag clones too -- keep this in step with RowDrop and the
  // catcher's dropEffect, or the browser refuses the drop outright
  dropTarget.set({ boardId, ...pick.at, copy: !sameBoard || dragStore.dup() }, {
    clientX: px,
    clientY: py,
  });
}
