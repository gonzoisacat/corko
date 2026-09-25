import { useSyncExternalStore } from "react";
import type { Cell, Span } from "../../state/types";

/* ------------------------------------------------------------------ *
 *  DRAGGING ON THE FREE GRID -- and why it is POINTER events here when
 *  every other surface in this app uses HTML5 drag-and-drop.
 *
 *  The rest of Corko drags a card BETWEEN two others: the whole system
 *  is about publishing an insertion point and drawing it (dropTarget,
 *  dropPlan, the seam). A grid has no insertion points. What it has is a
 *  position, and the thing you want while choosing one is to see the
 *  card actually move -- which HTML5 DnD cannot do, since it hands the
 *  browser a static drag image and hides the source.
 *
 *  So this type owns its own gesture layer. Three gestures, one store:
 *
 *    move    -- the card follows the pointer and lands on a cell
 *    resize  -- the corner handle, in whole cells
 *    yarn    -- pulled out of a card's PIN to another card's pin
 *
 *  LIVE STATE LIVES HERE, NOT IN THE DOC. A pointermove fires at screen
 *  rate, and a doc write per move would be a sync broadcast per move --
 *  the mistake DraftInput exists to avoid for typing. The doc is written
 *  ONCE, on release, so a drag is also one undo step.
 * ------------------------------------------------------------------ */

/* WHICH COLUMN OWNS THE GESTURE. The store is one per app, but a board
 * can be open in both columns of a split, and each column has its own
 * pointer listeners and its own zoom: without this, column B read
 * column A's drag, re-derived its cells from B's coordinates, and even
 * wrote the release (owner, 2026-09-04: "the right side thinks I'm
 * trying to drag the card from its perspective"). Every reader takes the
 * asking column's slot and sees nothing that is not its own. */
export type GestureOwner = string;

export interface GridMove {
  kind: "move";
  owner: GestureOwner;
  ids: string[]; // a selection moves together
  /* Where the pointer sits relative to the grabbed card's origin, in
   * cells (fractional) -- so the card does not jump to center itself
   * under the cursor the moment you touch it. */
  offX: number;
  offY: number;
  cell: Cell; // live position of the GRABBED card
  from: Cell; // where it started, so the others can move by the delta
  moved: boolean; // passed the threshold; a click that never moves selects
  /* OPTION HELD: the release will leave the originals where they are and
   * drop COPIES at the new cells. Read live from the pointer events and
   * again at the release, which is the last word -- the same rule the
   * Beat Map's option-drag follows (board/drag.ts), so the modifier can
   * be pressed or let go mid-gesture. */
  dup: boolean;
}

export interface GridResize {
  kind: "resize";
  owner: GestureOwner;
  id: string;
  span: Span; // live
}

export interface GridYarn {
  kind: "yarn";
  owner: GestureOwner;
  from: string;
  x: number; // live pointer, in cells (fractional)
  y: number;
  over: string | null; // the card under the pointer, if any
}

export type GridGesture = GridMove | GridResize | GridYarn;

let live: GridGesture | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/* The copy cursor while Option is held, as ONE root attribute rather
 * than a subscription per card -- the same hook `board/drag.ts` sets for
 * the Beat Map's option-drag, so both types share one CSS rule and this
 * board is not re-rendered on a modifier press. */
function markDup(on: boolean) {
  if (typeof document === "undefined") return; // headless tests
  const app = document.querySelector(".app");
  if (on) app?.setAttribute("data-drag-dup", "on");
  else app?.removeAttribute("data-drag-dup");
}

export const gridDrag = {
  start(g: GridGesture) {
    live = g;
    markDup(g.kind === "move" && g.dup);
    emit();
  },
  /* Patch the live gesture. Returns the updated one so a pointermove
   * handler can act on it without a second read. */
  update(patch: Partial<GridMove> & Partial<GridResize> & Partial<GridYarn>) {
    if (!live) return null;
    live = { ...live, ...patch } as GridGesture;
    markDup(live.kind === "move" && live.dup);
    emit();
    return live;
  },
  end() {
    markDup(false);
    if (!live) return null;
    const was = live;
    live = null;
    emit();
    return was;
  },
  get: (): GridGesture | null => live,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/* The live gesture, if this column owns it. */
export const ownGesture = (owner: GestureOwner): GridGesture | null =>
  live && live.owner === owner ? live : null;

export function useGridDrag(owner: GestureOwner): GridGesture | null {
  return useSyncExternalStore(gridDrag.subscribe, () => ownGesture(owner), () => null);
}

/* The MOVE gesture, read by one card. Its own hook so a pointermove
 * re-renders the cards being dragged and nothing else -- this surface is
 * not virtualized, and a board of a hundred photos should not repaint on
 * every frame of one drag. */
export function useGridOffset(id: string, owner: GestureOwner): Cell | null {
  return useSyncExternalStore(
    gridDrag.subscribe,
    () => {
      const g = ownGesture(owner);
      if (!g || g.kind !== "move" || !g.ids.includes(id)) return null;
      return offsetFor(g, id);
    },
    () => null,
  );
}

/* THE RESIZE GESTURE, read by the one card being resized -- so the card
 * grows under the cursor instead of jumping to its new size on release.
 *
 * No caching needed, unlike `offsetFor`: `update({ span })` is only
 * called when the span actually CHANGED, so `g.span` is the same object
 * on every read between emits, which is what useSyncExternalStore
 * requires. */
export function useGridSpan(id: string, owner: GestureOwner): Span | null {
  return useSyncExternalStore(
    gridDrag.subscribe,
    () => {
      const g = ownGesture(owner);
      if (!g || g.kind !== "resize" || g.id !== id) return null;
      return g.span;
    },
    () => null,
  );
}

/* Where a card in the moving set sits right now: the grabbed one is at
 * the live cell, everything else follows by the same delta. Cached per
 * gesture object so useSyncExternalStore sees a stable value between
 * emits -- returning a fresh {x,y} each read would loop it forever. */
const offsets = new WeakMap<GridGesture, Map<string, Cell>>();
function offsetFor(g: GridMove, id: string): Cell {
  let m = offsets.get(g);
  if (!m) {
    m = new Map();
    offsets.set(g, m);
  }
  const hit = m.get(id);
  if (hit) return hit;
  const c = { x: g.cell.x - g.from.x, y: g.cell.y - g.from.y };
  m.set(id, c);
  return c;
}
