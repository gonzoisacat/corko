import { useSyncExternalStore } from "react";
import type { Board, Node } from "./types";

/* ------------------------------------------------------------------ *
 *  Fold state -- which lanes are collapsed -- LOCAL per browser, like
 *  settings.ts and the selection. It used to live on the shared doc
 *  (Node.collapsed), which meant one person furling the board furled it
 *  for every collaborator mid-edit, and a foldTo wrote O(n) map entries
 *  into the doc (a large broadcast, a giant undo step). As pure view
 *  state it belongs with the other per-user view prefs.
 *
 *  Node.collapsed stays in the data model for board-file compatibility
 *  but is no longer read by the render path.
 * ------------------------------------------------------------------ */

const KEY = "corko-fold";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return new Set(arr.filter((v): v is string => typeof v === "string"));
    }
  } catch {
    /* ignore malformed / unavailable storage */
  }
  return new Set();
}

let collapsed = load();
let version = 0; // bumps on every change; memo key for flatten
const listeners = new Set<() => void>();

function commit() {
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify([...collapsed]));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const fold = {
  /* Stable function identity -- safe to hand to flattenBoard directly. */
  isCollapsed: (id: string): boolean => collapsed.has(id),

  toggle(id: string) {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    commit();
  },

  /* Fold the whole board to a tier: a lane node is collapsed iff its
   * depth >= level. foldTo(0) collapses everything (only the top tier
   * shows); foldTo(leaf) expands everything (leaves have no children).
   * Replaces the fold set wholesale so it also EXPANDS shallower lanes. */
  foldToTier(board: Board, level: number) {
    const leaf = board.levels.length - 1;
    const next = new Set<string>();
    const walk = (n: Node, depth: number) => {
      if (depth >= leaf || n.children.length === 0) return;
      if (depth >= level) next.add(n.id);
      for (const c of n.children) walk(c, depth + 1);
    };
    for (const r of board.roots) walk(r, 0);
    collapsed = next;
    commit();
  },

  /* Unfold everything in ONE board, leaving every other board's fold
   * state alone. foldToTier can't serve: it replaces the whole set, so
   * unfurling board A would drop the folds you'd set up in board B. */
  unfurlBoard(board: Board) {
    let changed = false;
    const walk = (n: Node) => {
      if (collapsed.delete(n.id)) changed = true;
      n.children.forEach(walk);
    };
    board.roots.forEach(walk);
    if (changed) commit();
  },

  /* Expand every ancestor of `id` so its row exists in the flatten --
   * backs the Overview -> detail jump into a folded region. */
  reveal(board: Board, id: string) {
    const path: string[] = [];
    const walk = (n: Node): boolean => {
      if (n.id === id) return true;
      for (const c of n.children) {
        if (walk(c)) {
          path.push(n.id);
          return true;
        }
      }
      return false;
    };
    board.roots.some((r) => walk(r));
    let changed = false;
    for (const p of path) if (collapsed.delete(p)) changed = true;
    if (changed) commit();
  },

  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/* Whether one lane is folded (chevrons, peek cues). */
export function useFolded(id: string): boolean {
  return useSyncExternalStore(fold.subscribe, () => collapsed.has(id), () => false);
}

/* Change counter for anything that derives from the whole fold set
 * (BoardView's flatten memo). */
export function useFoldVersion(): number {
  return useSyncExternalStore(fold.subscribe, () => version, () => 0);
}
