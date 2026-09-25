import { useSyncExternalStore } from "react";
import { getSnapshot } from "../state/ydoc";

/* ------------------------------------------------------------------ *
 *  Multi-select state (spec Sec 4). LOCAL and ephemeral -- never written
 *  to the Yjs doc, so one person's selection is private. Same external-
 *  store pattern as board/drag.ts.
 *
 *  A selection is always a single tier: `select` resolves a node's
 *  siblings + depth from the snapshot, and picking a node at a different
 *  depth resets the selection. This lets the same store back beat AND
 *  scene selection (and stacking/cut of either).
 * ------------------------------------------------------------------ */

let selected = new Set<string>();
/* The same ids as a STABLE array, refreshed only when the set changes --
 * `ids()` mints a new array per call, which useSyncExternalStore would
 * read as a change every render and loop on. */
let selectedArr: string[] = [];
let anchor: string | null = null;
let depth: number | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  selectedArr = [...selected];
  listeners.forEach((l) => l());
};

export const selection = {
  anchor: (): string | null => anchor,
  depth: (): number | null => depth,
  has: (id: string): boolean => selected.has(id),
  ids: (): string[] => [...selected],
  size: (): number => selected.size,

  set(ids: string[], anchorId: string | null, d: number | null) {
    selected = new Set(ids);
    anchor = anchorId;
    depth = ids.length ? d : null;
    emit();
  },
  clear() {
    if (selected.size === 0 && anchor === null) return;
    selected = new Set();
    anchor = null;
    depth = null;
    emit();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/* The ordered sibling ids (and tier depth) of a node, from the snapshot.
 * Node ids are unique doc-wide, so searching every board is safe. */
function siblings(id: string): { ids: string[]; depth: number } | null {
  let found: { ids: string[]; depth: number } | null = null;
  const walk = (nodes: { id: string; children: unknown[] }[], d: number): boolean => {
    if (nodes.some((n) => n.id === id)) {
      found = { ids: nodes.map((n) => n.id), depth: d };
      return true;
    }
    for (const n of nodes) if (walk(n.children as typeof nodes, d + 1)) return true;
    return false;
  };
  for (const board of getSnapshot().boards) {
    if (walk(board.roots as { id: string; children: unknown[] }[], 0)) break;
  }
  return found;
}

/* Click a card to select it: "single" replaces, "toggle" adds/removes one,
 * "range" extends a contiguous run from the anchor along sibling order.
 * Selecting a different tier resets the selection first. */
export function select(id: string, mode: "single" | "toggle" | "range") {
  const sib = siblings(id);
  if (!sib) return;
  const { ids, depth: d } = sib;
  const sameTier = selection.depth() === d;

  if (mode === "toggle") {
    if (!sameTier) {
      selection.set([id], id, d);
      return;
    }
    const next = new Set(selection.ids());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.set([...next], id, d);
    return;
  }
  if (mode === "range" && sameTier && anchor && ids.includes(anchor)) {
    const a = ids.indexOf(anchor);
    const b = ids.indexOf(id);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    selection.set(ids.slice(lo, hi + 1), anchor, d);
    return;
  }
  selection.set([id], id, d);
}

export function useIsSelected(id: string): boolean {
  return useSyncExternalStore(
    selection.subscribe,
    () => selected.has(id),
    () => false,
  );
}

export function useSelectionCount(): number {
  return useSyncExternalStore(selection.subscribe, () => selected.size, () => 0);
}

/* The whole selection, for the surfaces that read it as a SET rather
 * than asking card by card -- the Free Grid's connections mode wants
 * "everything joined to any of these". Snapshot-stable between emits. */
const NO_IDS: string[] = [];
export function useSelectionIds(): string[] {
  return useSyncExternalStore(selection.subscribe, () => selectedArr, () => NO_IDS);
}
