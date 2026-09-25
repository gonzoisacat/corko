import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  RIGHT-CLICKING THE FRAME OR THE WALL (owner, 2026-09-04): one popup
 *  for everything about them -- the frame's material (or none), the
 *  wall's color, the wall's picture. Opened from the band, from the cork
 *  margin inside it, and from the wall outside it; the bare cork of the
 *  board itself keeps its own menu (board/grid/canvasMenu.ts).
 * ------------------------------------------------------------------ */

export interface FrameMenuState {
  boardId: string;
  x: number;
  y: number;
}

let state: FrameMenuState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const frameMenu = {
  open(s: FrameMenuState) {
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

export function useFrameMenu(): FrameMenuState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
