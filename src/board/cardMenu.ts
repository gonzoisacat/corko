import { useSyncExternalStore } from "react";
import type { Node } from "../state/types";

/* ------------------------------------------------------------------ *
 *  Node context-menu state (spec Sec 7). One menu open at a time, held in
 *  module state (same external-store pattern as board/drag.ts). Works for
 *  any tier -- beats and scene cards both open it -- carrying the target's
 *  location (board, parentId/index/depth) so cut/paste can act, plus
 *  whether the tier is colorable and any cards stacked behind it. The menu
 *  itself renders once above the panes, so it can't read a pane's board
 *  from context -- the opener passes it in.
 * ------------------------------------------------------------------ */

export interface CardMenuState {
  node: Node;
  x: number;
  y: number;
  boardId: string; // the board the target lives in (legend, paste target)
  parentId: string | null;
  index: number;
  depth: number; // the node's tier
  colorable: boolean;
  stackedIds: string[]; // cards tucked behind this one (if a stack lead)
  /* Opened from the KEYBOARD (keyNav's Space), so the menu should show
   * its focus ring from the first frame. Chrome's :focus-visible is a
   * heuristic about the last input device, and "programmatic focus right
   * after a keydown" is exactly the case it can be shy about -- but here
   * we know, so we say so rather than hoping. */
  keyed?: boolean;
}

export interface CardMenuOpts {
  boardId: string;
  parentId: string | null;
  index: number;
  depth: number;
  colorable: boolean;
  stackedIds?: string[];
  keyed?: boolean;
}

let state: CardMenuState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const cardMenu = {
  open(node: Node, x: number, y: number, opts: CardMenuOpts) {
    state = { node, x, y, stackedIds: [], ...opts };
    emit();
  },
  close() {
    if (state) {
      state = null;
      emit();
    }
  },
};

export function useCardMenu(): CardMenuState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}
