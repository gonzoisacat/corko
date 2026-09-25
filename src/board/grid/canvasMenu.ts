import { useSyncExternalStore } from "react";
import type { Cell } from "../../state/types";

/* ------------------------------------------------------------------ *
 *  RIGHT-CLICKING THE BARE CORK -- how a card gets made on this board.
 *
 *  It replaces a hover GHOST: a dashed card-shaped outline with a `+` in
 *  it that followed the cursor around the lattice. That was built to
 *  answer a real complaint ("how do you make new cards?") and it did,
 *  but the owner cut it (2026-08-26: "I don't like the + signs being
 *  gridded out. I think it's a right click menu. anywhere on the blank
 *  canvas."). A card-sized object chasing the pointer is a lot of
 *  furniture for one action, and it was the only affordance in the app
 *  shaped that way.
 *
 *  THE IDIOM IS ALREADY HERE, which is why this is a move rather than an
 *  invention: the Beat Map's strip already right-clicks its insert
 *  points to a small menu (board/insertMenu.ts). The only change is WHAT
 *  you right-click -- the SPACE the card will occupy, rather than a
 *  control sitting in it. A grid has a position under every pixel, so
 *  the space can answer for itself.
 *
 *  DOUBLE-CLICK SURVIVES as the fast path (owner's call). The menu is
 *  the discoverable, fuller route; double-click is the quick one, and
 *  the empty board's invitation names both.
 *
 *  It carries the CELL as well as the screen point: the menu opens at
 *  the pointer, but what it does happens where you clicked, and by the
 *  time you pick an item the board may have scrolled under the menu.
 * ------------------------------------------------------------------ */

export interface CanvasMenuState {
  boardId: string;
  /* Where the card lands -- the cell under the right-click, already
   * offset so the card is CENTERED on the point rather than starting at
   * it, which is what the ghost did and what the eye expects. */
  cell: Cell;
  x: number; // screen point, for the popover
  y: number;
}

let state: CanvasMenuState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const canvasMenu = {
  open(s: CanvasMenuState) {
    state = s;
    emit();
  },
  close() {
    if (state) {
      state = null;
      emit();
    }
  },
};

export function useCanvasMenu(): CanvasMenuState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}

/* ------------------------------------------------------------------ *
 *  THE LAST POINT YOU RIGHT-CLICKED, per board.
 *
 *  Cmd-V on a grid pastes THERE (owner's call): on a spatial board a
 *  position is the only meaningful answer, and the right-click point is
 *  one you chose deliberately and can remember. Recorded for EVERY
 *  right-click on the sheet, not just the ones that open this menu --
 *  right-clicking a card is still you pointing at a spot.
 *
 *  Deliberately not persisted and deliberately per board: it is a thing
 *  about the gesture you just made, not about the document.
 * ------------------------------------------------------------------ */
let lastAt: { boardId: string; cell: Cell } | null = null;

export const rememberPoint = (boardId: string, cell: Cell) => {
  lastAt = { boardId, cell };
};

export const lastPoint = (boardId: string): Cell | null =>
  lastAt && lastAt.boardId === boardId ? lastAt.cell : null;
