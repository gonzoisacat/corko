import { useSyncExternalStore } from "react";

/* The little menu behind a length of yarn: its color, and cutting it.
 * A string is not a Node, so it cannot use the card menu -- and it wants
 * far less anyway. Module state above the panes, like every other
 * overlay that outlives what opened it. */
export interface YarnMenuState {
  boardId: string;
  edgeId: string;
  x: number;
  y: number;
}

let state: YarnMenuState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const yarnMenu = {
  open(s: YarnMenuState) {
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

export function useYarnMenu(): YarnMenuState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}
