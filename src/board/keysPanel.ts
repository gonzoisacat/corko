import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  The keyboard-shortcut legend's open state. A module store like the
 *  card panels' (cardPanels.ts), but a TOGGLE with a remembered position
 *  rather than a per-card open: the panel is reference material you park
 *  somewhere and leave up, and `?` flips it from anywhere (keyNav.ts).
 * ------------------------------------------------------------------ */

/* Wide enough that every entry is one line (two for Enter, which does a
 * different thing in each board view). The list is short -- the panel can
 * afford the width, and a wrapped shortcut reads badly. Raised 386 -> 430
 * on 2026-08-27 for "Cmd/Ctrl + C / X / V" and "Zoom, centered on the
 * pointer", the longest pair. */
export const KEYS_W = 430;

export interface KeysPanelState {
  x: number;
  y: number;
}

let state: KeysPanelState | null = null;
/* where it was last parked, so a re-toggle brings it back there */
let parked: KeysPanelState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const keysPanel = {
  toggle() {
    state = state
      ? null
      : (parked ?? { x: Math.max(8, window.innerWidth - KEYS_W - 24), y: 64 });
    emit();
  },
  close() {
    if (!state) return;
    state = null;
    emit();
  },
  moveTo(x: number, y: number) {
    if (!state) return;
    state = { x, y };
    parked = state;
    emit();
  },
  get: (): KeysPanelState | null => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const NONE = () => null;
export const useKeysPanel = (): KeysPanelState | null =>
  useSyncExternalStore(keysPanel.subscribe, keysPanel.get, NONE);
