import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  Tiny menu for the beat-strip insert controls (the "+" add points and
 *  the "-" row-break markers). Right-clicking one opens this instead of
 *  acting immediately: "Add <leaf>" plus create/remove row break. One
 *  open at a time, module state (same pattern as cardMenu.ts).
 * ------------------------------------------------------------------ */

export interface InsertMenuState {
  x: number;
  y: number;
  parentId: string; // scene whose strip we're inserting into
  index: number; // where "Add <leaf>" inserts
  childName: string; // leaf tier name, for the label
  breakId: string | null; // beat whose breakAfter to toggle (null = no break option)
  broken: boolean; // label create vs remove
}

let state: InsertMenuState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const insertMenu = {
  open(s: InsertMenuState) {
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

export function useInsertMenu(): InsertMenuState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}
