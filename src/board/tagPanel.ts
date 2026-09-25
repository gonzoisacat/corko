import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  Which tag's settings panel is open, and where it sits.
 *
 *  Module state (same pattern as cardMenu.ts) because the panel is
 *  reachable from two places -- the legend's gear, and right-clicking a
 *  tab on any card -- and is rendered once above the panes so it can
 *  float anywhere on screen.
 *
 *  `nodeId` is the card you opened it FROM, when you opened it from a
 *  card. That's what lets the panel offer "remove from this card": the
 *  same panel then serves both jobs, instead of a separate menu for
 *  detaching a tag.
 * ------------------------------------------------------------------ */

export interface TagPanelState {
  tagId: string;
  x: number;
  y: number;
  nodeId?: string;
  /* Whose card proportions and spacing the preview should show. Tags are
   * project-level but card geometry is per BOARD, so the opener says which
   * board it's speaking for; the panel falls back to the first. */
  boardId?: string;
}

let state: TagPanelState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const tagPanel = {
  open(tagId: string, x: number, y: number, nodeId?: string, boardId?: string) {
    state = { tagId, x, y, nodeId, boardId };
    emit();
  },
  /* Dragging the panel by its header. */
  moveTo(x: number, y: number) {
    if (!state) return;
    state = { ...state, x, y };
    emit();
  },
  close() {
    if (!state) return;
    state = null;
    emit();
  },
};

export function useTagPanel(): TagPanelState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}
