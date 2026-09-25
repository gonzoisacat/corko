import { useSyncExternalStore } from "react";
import { paneFocus, type PaneSlot } from "./paneFocus";

/* ------------------------------------------------------------------ *
 *  WHERE TO OPEN A NESTED BOARD.
 *
 *  Double-clicking a nesting card asks, every time (owner's call): the
 *  gesture is genuinely multivariate -- from Single there is one sensible
 *  answer, from Split there are two, from Notes there are two and one of
 *  them costs you the notes panel -- and a gesture that sometimes asks
 *  and sometimes does not is harder to learn than one that always does.
 *
 *  It records the panel that PRODUCED the gesture rather than looking up
 *  focus later, the same rule steerSibling follows: a double-click is
 *  preceded by its own mousedown, and `.pane`'s onMouseDownCapture has
 *  already handed that panel the keyboard by the time this runs. Reading
 *  `paneFocus` a render later can lag it.
 *
 *  App owns what the choices DO, because only App knows what both panels
 *  are showing -- this store carries the question, not the answer.
 * ------------------------------------------------------------------ */

export interface OpenNestedState {
  boardId: string; // the board to open
  from: PaneSlot; // the panel the gesture came from
  x: number;
  y: number;
}

let state: OpenNestedState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const openNested = {
  ask(boardId: string, x: number, y: number, from: PaneSlot = paneFocus.get()) {
    state = { boardId, from, x, y };
    emit();
  },
  close() {
    if (state) {
      state = null;
      emit();
    }
  },
};

export function useOpenNested(): OpenNestedState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}
