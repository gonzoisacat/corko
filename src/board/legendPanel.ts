import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  Which legend chip's settings panel is open, and where it sits.
 *
 *  Module state for the same reason tagPanel.ts is (which this mirrors):
 *  the panel is rendered ONCE above the panes so it can float anywhere on
 *  screen and survive the legend re-rendering underneath it.
 *
 *  Two kinds, because the legend's two color rows mean different things:
 *
 *   - "tier"  -- a Default Tier Colors swatch. The swatch IS that tier's
 *     fill, so its settings are the tier's whole look (board/TierSettings),
 *     the same set the Options menu's per-tier gear shows.
 *   - "entry" -- a Tier Color Overrides swatch: one free legend entry, so
 *     just its name, its color, and removing it.
 *
 *  Tags are the third row and already had this: their gear opens
 *  tagPanel.ts. That panel is what this pattern was copied FROM -- the
 *  owner's ask was to mirror the tag row's behavior onto the other two.
 *
 *  A tier is addressed by its LEVEL ID rather than its index: adding a
 *  parent tier shifts every index down, and an open panel must not
 *  silently start editing the tier below the one you opened.
 * ------------------------------------------------------------------ */

export type LegendPanelState = { boardId: string; x: number; y: number } & (
  | { kind: "tier"; levelId: string }
  | { kind: "entry"; entryId: string }
);

let state: LegendPanelState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const legendPanel = {
  openTier(boardId: string, levelId: string, x: number, y: number) {
    state = { kind: "tier", boardId, levelId, x, y };
    emit();
  },
  openEntry(boardId: string, entryId: string, x: number, y: number) {
    state = { kind: "entry", boardId, entryId, x, y };
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

export function useLegendPanel(): LegendPanelState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => null,
  );
}
