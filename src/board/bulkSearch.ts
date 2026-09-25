import { useSyncExternalStore } from "react";
import type { Match } from "../state/search";

/* ------------------------------------------------------------------ *
 *  The popovers the search menu opens, as module stores -- same pattern
 *  as cardPanels.ts / cardMenu.ts, and for the same reason: they render
 *  once above the panes, so they can't read a pane's context and the
 *  opener has to hand them everything (which board, which cards).
 *
 *  Each carries the MATCH SET it was opened with, snapshotted. If the
 *  board changes underneath (a collaborator edits a title), the popover
 *  keeps acting on what it told you it would act on -- the alternative is
 *  a preview that says 18 and a button that changes 19.
 * ------------------------------------------------------------------ */

export interface BulkTarget {
  boardId: string;
  matches: Match[];
  query: string; // what found them, so the popover can say so
  matchCase: boolean;
  x: number;
  y: number;
}

function store<T>() {
  let state: T | null = null;
  const listeners = new Set<() => void>();
  return {
    open(next: T) {
      state = next;
      listeners.forEach((l) => l());
    },
    close() {
      if (!state) return;
      state = null;
      listeners.forEach((l) => l());
    },
    get: () => state,
    use(): T | null {
      return useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        () => state,
        () => null,
      );
    },
  };
}

export const findReplace = store<BulkTarget>();
/* One store for both tag directions -- the panel is the same list of tags
 * with a different verb, and two stores would mean two ways to be open. */
export const bulkTag = store<BulkTarget & { mode: "apply" | "remove" }>();

export const useFindReplace = () => findReplace.use();
export const useBulkTag = () => bulkTag.use();
