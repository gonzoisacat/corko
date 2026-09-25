import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  Which PANEL the keyboard is driving (2026-08-02).
 *
 *  There is one keyboard and one cursor, so in the split view something
 *  has to say which pane an arrow key moves in. Focus FOLLOWS THE MOUSE
 *  DOWN rather than being a thing you tab into: you were already going to
 *  click the card you want to start from, and a click is how you pick a
 *  cursor position anyway -- so the same gesture picks the panel. No new
 *  idiom, and nothing to discover.
 *
 *  Deliberately NOT the DOM's own focus: cards aren't focusable (a card is
 *  a div you drag, and making every one of thousands of proxies tabbable
 *  would hand the Tab key a job nobody asked for), and the keyboard
 *  handler is a window listener, so document.activeElement tells us
 *  nothing about which board the user means.
 *
 *  Module state like drag.ts / selection.ts, and just as ephemeral: which
 *  panel had the keyboard last is not worth persisting -- a fresh load
 *  starts on pane A, which is the only pane a single-panel window has.
 * ------------------------------------------------------------------ */

export type PaneSlot = "a" | "b";

let slot: PaneSlot = "a";
const listeners = new Set<() => void>();

export const paneFocus = {
  get: (): PaneSlot => slot,
  set(next: PaneSlot) {
    if (slot === next) return;
    slot = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const A = () => "a" as const;
export const usePaneFocus = (): PaneSlot =>
  useSyncExternalStore(paneFocus.subscribe, paneFocus.get, A);
