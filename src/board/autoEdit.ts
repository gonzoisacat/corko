import { useSyncExternalStore } from "react";
import { ops } from "../state/useBoard";

/* ------------------------------------------------------------------ *
 *  "The card I just added" -- the one card that should open straight
 *  into edit mode. Module state (same pattern as drag.ts /
 *  selection.ts) rather than pane state, because the add can come from
 *  outside any pane: InsertMenuPopover and the card menus are rendered
 *  once at the app root, above the panes.
 *
 *  Any TIER, not just leaves, since the vertical insert chips add lanes
 *  the same way the strip's chips add beats -- every Editable takes the
 *  flag (Card, CardsLane's scene label, LaneHeader's band).
 * ------------------------------------------------------------------ */

let current: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const setAutoEdit = (id: string) => {
  if (!id || id === current) return;
  current = id;
  emit();
};

/* Append a card to `parentId` and open it for typing. */
export function addCard(parentId: string) {
  setAutoEdit(ops.addChild(parentId));
}

/* Insert a card at `index` in `parentId` and open it for typing. */
export function addCardAt(parentId: string, index: number) {
  setAutoEdit(ops.addChildAt(parentId, index));
}

/* The same, for a TOP-tier lane, which has no parent to hang off. */
export function addRootAt(boardId: string, index: number) {
  setAutoEdit(ops.addRootAt(boardId, index));
}

/* Open a node some OTHER op just minted -- the gap cluster's insert, which
 * chooses its own tier and does its own absorbing, so it can't go through
 * the two helpers above. Empty ids (a refused insert) are ignored. */
export function openNew(id: string) {
  if (id) setAutoEdit(id);
}

/* Open an EXISTING card's title for typing (keyboard nav's Enter). The
 * flag clears itself a beat later: it only exists to flip the mounted
 * card's Editable into edit mode, and left standing it would re-open the
 * edit every time that card REMOUNTS -- a virtualized row scrolling back
 * on screen, an Overview toggle -- long after the keypress it stood for. */
export function editCard(id: string) {
  setAutoEdit(id);
  window.setTimeout(() => {
    if (current === id) {
      current = null;
      emit();
    }
  }, 250);
}

/* Whether this card is the one just added (Card -> Editable autoEdit). */
export function useAutoEdit(id: string): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current === id,
    () => false,
  );
}
