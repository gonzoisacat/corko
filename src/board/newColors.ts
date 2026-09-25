import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ *
 *  COLOR OVERRIDES MADE IN THIS SESSION, so "+ Add" visibly adds one.
 *
 *  The same store, for the same reason, as board/newTags.ts: overrides
 *  are project-level now (ADR 0006) and the legend row shows only the
 *  ones this board's cards wear, so a brand-new one -- worn by nothing
 *  -- would fall straight into the "elsewhere in this project" menu and
 *  the row would not change. A color you just made is pinned into the
 *  row until a card wears it. Session-scoped, not synced, copy-on-write
 *  (useSyncExternalStore compares references).
 *
 *  PER BOARD (owner-reported 2026-09-11: "when i add a color to a
 *  nested board, it's populating in my color overrides in my beat
 *  map's legend, weirdly"). The set used to be one for the session, so
 *  a color added on ANY board pinned itself into EVERY board's row --
 *  the palette is the project's, but "the one you just made here" is
 *  a fact about the board you were on. Keyed by board id now; the
 *  board that made a color is the only one that shows it unworn.
 * ------------------------------------------------------------------ */

const EMPTY: ReadonlySet<string> = new Set<string>();
let made: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const newColors = {
  add(boardId: string, id: string) {
    const set = made.get(boardId) ?? EMPTY;
    if (set.has(id)) return;
    made = new Map(made).set(boardId, new Set(set).add(id));
    emit();
  },
  has: (boardId: string, id: string): boolean => (made.get(boardId) ?? EMPTY).has(id),
  /* forgotten everywhere: the entry is gone from the project, whichever
     board made it */
  forget(id: string) {
    let next: Map<string, ReadonlySet<string>> | null = null;
    for (const [boardId, set] of made) {
      if (!set.has(id)) continue;
      next ??= new Map(made);
      const rest = new Set(set);
      rest.delete(id);
      if (rest.size) next.set(boardId, rest);
      else next.delete(boardId);
    }
    if (!next) return;
    made = next;
    emit();
  },
  ids: (boardId: string): ReadonlySet<string> => made.get(boardId) ?? EMPTY,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useNewColors(boardId: string): ReadonlySet<string> {
  return useSyncExternalStore(newColors.subscribe, () => newColors.ids(boardId));
}
