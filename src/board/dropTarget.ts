import { useSyncExternalStore } from "react";
import { gapSelector, type GapScope } from "./dropPlan";

/* ------------------------------------------------------------------ *
 *  THE one place a drop would land, as an insertion point rather than as
 *  "whichever card you happen to be beside" (owner, 2026-08-03).
 *
 *  The distinction is the whole fix. In a flat row list a Day is followed
 *  by its OWN scenes and then the next Day, so "after Day 1" and "before
 *  Day 2" are the same reorder -- but drawn locally they appear in two
 *  different places, and the first of them sits between a Day and its own
 *  scenes, which is somewhere a Day can never land. His words: there
 *  should just be one preview per actual reorder.
 *
 *  So the preview is keyed by (parent, index) and every row asks the same
 *  question: "is the live target immediately above ME?" A row hovering its
 *  own lower half publishes index + 1, which matches its NEXT SIBLING and
 *  draws there -- after the hovered row's entire subtree, which is exactly
 *  where the node would go. Nothing draws between a lane and its children.
 *
 *  Module state, not React state: it changes on every dragover, and the
 *  rows that care subscribe individually so a change repaints two rows
 *  rather than the whole list.
 * ------------------------------------------------------------------ */

export interface DropAt {
  boardId: string;
  parentId: string | null; // null = board roots
  index: number; // insert BEFORE the sibling at this index
  /* The node the gap attaches to, and which SIDE of it. Anchoring to the
   * card you are nearest rather than to "the next sibling" is what makes
   * the LAST slot in a run exist at all: after the final child there is
   * no next sibling to hang it on, so nothing painted -- and since a
   * missing slot now refuses the drop, you couldn't land there either.
   *
   * Redundant with parent+index in the detail view, which asks by those
   * -- but the OVERVIEW cannot ask: it isn't virtualized, so a
   * subscription per proxy is thousands of them (the mistake `tags` and
   * `noteDots` are threaded to avoid). It styles one element by id
   * through an injected rule instead, exactly as legendHighlight does. */
  beforeId: string | null;
  side: "before" | "after";
  /* Which way the room opens, which follows the tier's own layout: scenes
   * and bands stack down a column so they push DOWN; beat cells and
   * spines sit in a row so they push SIDEWAYS. */
  axis: "x" | "y";
  /* WHAT moves aside. At the "1 Column per:" tier the whole column shifts
   * -- the gap reads as a new column opening up, not as a band above a
   * header -- so the rule targets the `.ov-column` wrapper rather than
   * the header node inside it. At the LEAF it is the cell itself, which
   * has no wrapper of its own. See gapSelector in board/dropPlan.ts. */
  scope: GapScope;
  /* How much room, in px. Half a column at the column tier (measured, so
   * it tracks whatever width the board's columns actually are), a fixed
   * slot everywhere else. */
  room: number;
  copy: boolean; // cross-board drop: clone rather than relocate
}

/* ONE injected rule, never a React pass. The Overview draws thousands of
 * proxies and is not virtualized, so a subscription per proxy -- or a
 * render pass on pointer movement -- would stutter. Same mechanism as
 * board/legendHighlight.ts, for the same reason: style one element by id
 * and let the browser do the matching.
 *
 * The detail view doesn't need this (it asks by parent+index through
 * useIsDropAt, and only ~20 rows are mounted), so this paints the
 * Overview alone. */
let sheet: HTMLStyleElement | null = null;
function paintOverviewGap(next: DropAt | null): void {
  if (typeof document === "undefined") return;
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.dataset.corko = "drop-gap";
    document.head.appendChild(sheet);
  }
  if (!next?.beforeId) {
    sheet.textContent = "";
    return;
  }
  /* Margin AND slot in the one injected rule. Splitting them (a static
   * ::before switched on by an attribute selector) does not work: the
   * margin arrives through a stylesheet, not an inline style, so there is
   * nothing on the element for a selector to match. */
  /* Which element makes the room, per scope -- built and pinned in
   * board/dropPlan.ts, because an unmatchable selector here paints
   * nothing and reports nothing. */
  const sel = gapSelector(next.scope, next.beforeId);
  const x = next.axis === "x";
  const after = next.side === "after";
  const room = `${Math.round(next.room)}px`;
  /* Which margin makes the room, and which side the slot fills. "after"
   * pushes the anchor's far edge out instead of its near one, which is
   * the only way to express the slot past the LAST child in a run. */
  const margin = x ? (after ? "margin-right" : "margin-left") : after ? "margin-bottom" : "margin-top";
  const place = x
    ? `top: 0; bottom: 0; ${after ? "right" : "left"}: calc(-1 * ${room} + 4px); width: calc(${room} - 8px);`
    : `left: 0; right: 0; ${after ? "bottom" : "top"}: calc(-1 * ${room} + 3px); height: calc(${room} - 6px);`;
  sheet.textContent =
    `${sel} { ${margin}: ${room}; position: relative; }\n` +
    `${sel}::before {` +
    `content: ""; position: absolute; pointer-events: none;` +
    `border-radius: 6px; border: 1.5px dashed var(--drop-mark, #2f6fdb);` +
    `background: color-mix(in srgb, var(--drop-mark, #2f6fdb) 16%, transparent);` +
    place +
    `}`;
}

let at: DropAt | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const same = (a: DropAt | null, b: DropAt | null): boolean =>
  a === b ||
  Boolean(
    a &&
      b &&
      a.boardId === b.boardId &&
      a.parentId === b.parentId &&
      a.index === b.index &&
      a.beforeId === b.beforeId &&
      a.side === b.side &&
      a.axis === b.axis &&
      a.scope === b.scope &&
      a.room === b.room &&
      a.copy === b.copy,
  );

/* Where the pointer was when the live target was published -- see
 * clearFrom, which will not let go until the pointer leaves this. */
let setAt: { x: number; y: number } | null = null;
/* Events that have already had a target published for them -- see set().
 * A WeakSet, so nothing needs clearing: the entry dies with the event. */
const published = new WeakSet<object>();

/* How far the preview DISPLACES what is under the pointer: `--seam-open`
 * in index.css, the padding a row grows to make the shelf. Keep the two
 * in step -- this number is not a taste, it is the size of the thing
 * that moves out from under you, and a smaller radius leaves exactly the
 * band of nudges that re-trigger the flip. */
const SHELF_PX = 28;

export const dropTarget = {
  get: (): DropAt | null => at,
  set(next: DropAt | null, from?: { clientX: number; clientY: number; type?: string }) {
    /* THE INNERMOST ZONE WINS, and this is what makes a tier-free drag
     * land where you aimed (2026-08-24). A dragover BUBBLES, so a beat
     * slot's zone runs, then its row's, then the lane's. That never
     * mattered while a zone accepted only its OWN tier -- exactly one of
     * them matched and published. A NESTING CARD is accepted by every
     * tier (board/drag.ts DragItem.nested), so they all publish for the
     * same event and the LAST one -- the outermost, a root reorder --
     * silently won. Measured: a card dropped in a scene's beat strip
     * landed at the board's roots instead.
     *
     * First publish per EVENT wins, which is the innermost by
     * construction. Keyed on the event object, so nothing has to be
     * cleaned up and no zone has to know about its neighbours (a
     * stopPropagation would break the zones that legitimately want to
     * see the event afterwards). */
    if (from?.type) {
      if (published.has(from)) return;
      published.add(from);
    }
    if (next && from) setAt = { x: from.clientX, y: from.clientY };
    if (!next) setAt = null;
    if (same(at, next)) return;
    at = next;
    paintOverviewGap(next);
    emit();
  },
  clear() {
    dropTarget.set(null);
  },
  /* CLEAR ONLY IF THE POINTER LEFT THE SLOT'S NEIGHBOURHOOD
   * (owner-reported 2026-08-14: a header dragged to the gap above the
   * next one made the shelf "oscillate between being opened and
   * closed").
   *
   * Measured with a recorder during the real gesture: the cursor was
   * STATIONARY at y=758 for the whole flip, and the element under it
   * alternated -- `reel-head` (publishes, shelf opens) then `.row`
   * (publishes nothing, shelf closes) then `reel-head` again. The
   * shelf's own padding pushes the header down out from under the
   * pointer, and closing brings it back: a layout-feedback loop, the
   * hit-testing cousin of the never-measure-while-open guard the
   * measured-gap era needed.
   *
   * WHY A RADIUS AND NOT "DID IT MOVE AT ALL". Exact equality fixed the
   * standing-still case and nothing else -- "if i nudge a pixel, it
   * repeats the animation". Of course it does: the shelf displaces the
   * thing under the cursor by SHELF_PX, so every position within that
   * distance is a position the shelf itself can take away from you. The
   * threshold has to be the size of the disturbance, not one pixel.
   *
   * So the published slot survives until the pointer genuinely leaves
   * its neighbourhood. Inside it, only a competing PUBLISH can replace
   * the target -- `set` always wins -- so this makes the preview sticky
   * exactly where stickiness is the honest answer (the gap it opened for
   * you) and nowhere else. */
  clearFrom(e: { clientX: number; clientY: number }) {
    if (at && setAt && Math.hypot(setAt.x - e.clientX, setAt.y - e.clientY) <= SHELF_PX) return;
    dropTarget.set(null);
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/* Whether the gap belongs immediately ABOVE this slot. Every row that can
 * host a sibling asks this; exactly one can answer yes. */
/* A drag ending ANYWHERE clears the preview -- a drop off-board, an
 * Escape, a cancelled gesture. Registered once at module load rather than
 * per row, since one stale gap would otherwise sit there until the next
 * dragover happened to move it. */
export function bindDropTargetTo(dragSubscribe: (l: () => void) => () => void, isDragging: () => boolean) {
  dragSubscribe(() => {
    if (!isDragging()) dropTarget.clear();
  });
}

export function useIsDropAt(boardId: string, parentId: string | null, index: number): "no" | "move" | "copy" {
  return useSyncExternalStore(
    dropTarget.subscribe,
    () => {
      const t = at;
      if (!t || t.boardId !== boardId || t.parentId !== parentId || t.index !== index) return "no";
      return t.copy ? "copy" : "move";
    },
    () => "no" as const,
  );
}

/* A SEAM can be the drawer for several published addresses at once: its
 * gap is the trailing point of every container that closes there (the
 * last scene of the last day of the last reel answers for all three
 * after-forms -- board/seam.ts computes the list). One subscription, one
 * primitive snapshot, however many addresses. */
export function useIsDropAtSeam(
  boardId: string,
  drops: { parentId: string | null; index: number }[],
): "no" | "move" | "copy" {
  return useSyncExternalStore(
    dropTarget.subscribe,
    () => {
      const t = at;
      if (!t || t.boardId !== boardId) return "no";
      for (const d of drops)
        if (t.parentId === d.parentId && t.index === d.index) return t.copy ? "copy" : "move";
      return "no";
    },
    () => "no" as const,
  );
}
