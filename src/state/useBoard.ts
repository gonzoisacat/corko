import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSnapshot, subscribe, undoManager, whenReady } from "./ydoc";

/* The LIVE project, for the few callers that must not read a render's
 * closure -- a handler firing in the same tick as an op has a snapshot
 * that predates it. */
export { getSnapshot };
import { DEFAULT_CARD_SPACING, DEFAULT_MAX_ROW_BEATS } from "./types";
import { boardIndex, type NestInfo } from "./nesting";
import type { Board, FieldDef, LegendEntry, Node, Project, TagDef, SplitAxis } from "./types";

export { ops } from "./ydoc";

/* Live, immutable project snapshot backed by the Yjs doc (the board
 * list, for the switcher). Structural sharing keeps untouched boards'
 * identities stable across snapshots. */
export function useProject(): Project {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* One board of the project, by id. Identity-stable while that board is
 * untouched, so a pane showing board A skips re-renders caused by edits
 * to board B. Null while the id doesn't resolve (pre-sync, deleted). */
export function useBoard(boardId: string | null): Board | null {
  return useSyncExternalStore(subscribe, () =>
    boardId ? getSnapshot().boards.find((b) => b.id === boardId) ?? null : null,
  );
}

const EMPTY_LEGEND: LegendEntry[] = [];
const EMPTY_TAGS: TagDef[] = [];
const EMPTY_FIELDS: FieldDef[] = [];

function findNode(nodes: Node[], id: string): Node | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children.length ? findNode(n.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

/* One node of a board, by id -- for the overlays that outlive the row
 * which opened them (the info panel floats above the panes, and a
 * virtualized row can scroll out from under it).
 *
 * The walk is O(n), but it only runs on a doc change and only while a
 * panel is open, and structural sharing means the node it returns keeps
 * its identity while untouched -- so this is a stable snapshot value, not
 * a fresh object per read. */
export function useNode(boardId: string | null, nodeId: string | null): Node | null {
  return useSyncExternalStore(subscribe, () => {
    if (!boardId || !nodeId) return null;
    const board = getSnapshot().boards.find((b) => b.id === boardId);
    return board ? findNode(board.roots, nodeId) : null;
  });
}

/* THE NODES OF A SET, for a panel about a SELECTION (board/groupEdit.ts,
 * 2026-09-12). Ids that no longer resolve (deleted under an open panel)
 * simply drop out. Identity-stable while the same nodes come back --
 * structural sharing keeps an untouched node's identity across snapshots,
 * and this keeps the ARRAY's, or useSyncExternalStore would read a fresh
 * array as a change on every render and loop. */
export function useNodes(boardId: string | null, ids: string[]): Node[] {
  const key = ids.join("\n");
  const cache = useRef<{ board: Board | undefined; key: string; nodes: Node[] } | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const board = boardId ? getSnapshot().boards.find((b) => b.id === boardId) : undefined;
    const c = cache.current;
    if (c && c.board === board && c.key === key) return c.nodes;
    const fresh = board ? ids.map((id) => findNode(board.roots, id)).filter((n): n is Node => n !== null) : [];
    const same = !!c && c.nodes.length === fresh.length && c.nodes.every((n, i) => n === fresh[i]);
    const nodes = same ? c.nodes : fresh;
    cache.current = { board, key, nodes };
    return nodes;
  });
}

/* Every board's title and type, by id -- what a pane hands its NESTING
 * cards so they can draw the board they stand in for. Its own selector,
 * like useTags: identity-stable until a board is actually added,
 * removed, renamed or re-typed (see state/nesting.ts `boardIndex`). */
export function useBoardIndex(): Map<string, NestInfo> {
  return useSyncExternalStore(subscribe, () => boardIndex(getSnapshot()));
}

/* The project's tag vocabulary (ADR 0002). Its own selector so the many
 * memoized cards subscribing to it don't re-render on unrelated edits. */
export function useTags(): TagDef[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().tags ?? EMPTY_TAGS);
}

/* Which way split tags cut the card (ADR 0005). Project-level, so App
 * publishes it as ONE CSS variable rather than handing it to every card
 * -- the Overview is not virtualized, and a subscription per card is
 * thousands of them. */
export function useSplitAxis(): SplitAxis {
  return useSyncExternalStore(subscribe, () => getSnapshot().splitAxis ?? "vertical");
}

/* The project's metadata categories (spec Sec 7 "scalar layers"). Its own
 * selector, like useTags: the snapshot caches the projected array, so this
 * is identity-stable until a category is actually added/renamed/removed. */
export function useFields(): FieldDef[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().fields ?? EMPTY_FIELDS);
}

/* Primitive per-board layout settings, as their own selectors so the many
 * memoized rows subscribing to them don't re-render on unrelated board
 * edits (a whole-board selector changes identity on every edit). */
export function useMaxRowBeats(boardId: string): number {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().boards.find((b) => b.id === boardId)?.maxRowBeats ?? DEFAULT_MAX_ROW_BEATS,
  );
}

export function useCardSpacing(boardId: string | null): number {
  return useSyncExternalStore(
    subscribe,
    () =>
      (boardId ? getSnapshot().boards.find((b) => b.id === boardId)?.cardSpacing : undefined) ??
      DEFAULT_CARD_SPACING,
  );
}

/* A board's color legend. Same snapshot backing as useBoard, so the ref
 * is stable until that board's legend actually changes. */
export function useLegend(boardId: string): LegendEntry[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().boards.find((b) => b.id === boardId)?.legend ?? EMPTY_LEGEND,
  );
}

/* Whether undo/redo are available, for the toolbar buttons. Recomputed when
 * the UndoManager's stacks change. */
export function useUndoRedo(): { canUndo: boolean; canRedo: boolean } {
  const [state, setState] = useState(() => ({
    canUndo: undoManager.undoStack.length > 0,
    canRedo: undoManager.redoStack.length > 0,
  }));
  useEffect(() => {
    const update = () =>
      setState({
        canUndo: undoManager.undoStack.length > 0,
        canRedo: undoManager.redoStack.length > 0,
      });
    undoManager.on("stack-item-added", update);
    undoManager.on("stack-item-popped", update);
    undoManager.on("stack-cleared", update);
    update();
    return () => {
      undoManager.off("stack-item-added", update);
      undoManager.off("stack-item-popped", update);
      undoManager.off("stack-cleared", update);
    };
  }, []);
  return state;
}

/* True once local IndexedDB persistence has loaded (and any legacy
 * single-board doc has been migrated). Lets the UI avoid an empty first
 * paint. */
export function useReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    whenReady.then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}
