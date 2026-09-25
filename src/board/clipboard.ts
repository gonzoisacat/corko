import { useSyncExternalStore } from "react";
import { ops } from "../state/useBoard";
import type { Node } from "../state/types";

/* ------------------------------------------------------------------ *
 *  Cut/paste clipboard (spec Sec 4). LOCAL per browser -- cut removes the
 *  nodes from the shared doc and holds snapshots here; paste re-inserts
 *  fresh-id clones. Type-checked: a clip carries its tier depth and only
 *  pastes into a matching tier (beats into a beat row, scenes into a scene
 *  row, ...).
 *
 *  The clip is mirrored to localStorage: a cut is DESTRUCTIVE in the
 *  shared doc (that's what cut means), so if the tab closed before the
 *  paste the content used to be gone for everyone. Persisting the clip
 *  keeps it pasteable after a reload or crash.
 * ------------------------------------------------------------------ */

interface Clip {
  nodes: Node[];
  depth: number;
  /* role height (distance above the source board's leaf) -- what a
   * cross-ladder paste matches on; depth only means the same thing
   * between same-length ladders */
  height: number;
}

const KEY = "corko-clipboard";

/* Minimal shape check on the restored clip -- localStorage is writable by
 * anything on the origin, and paste feeds these straight into the doc. */
function isNode(v: unknown): v is Node {
  if (typeof v !== "object" || v === null) return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.title === "string" &&
    Array.isArray(n.children) &&
    n.children.every(isNode)
  );
}

function load(): Clip | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Clip>;
    // height is required: a pre-height clip (older build) is invalidated
    // rather than guessed at
    if (
      typeof c.depth !== "number" ||
      typeof c.height !== "number" ||
      !Array.isArray(c.nodes) ||
      !c.nodes.every(isNode)
    )
      return null;
    return { nodes: c.nodes, depth: c.depth, height: c.height };
  } catch {
    return null;
  }
}

function persist(c: Clip | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage full/unavailable -- the in-memory clip still works */
  }
}

let clip: Clip | null = load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/* One place the clip is replaced, so cut and copy cannot diverge on the
 * persist/notify half either. An empty result is ignored rather than
 * clearing what is already held -- a gesture that found nothing should
 * not throw away a clip you were about to paste. */
function take(res: Clip | null) {
  if (!res || !res.nodes.length) return;
  clip = res;
  persist(clip);
  emit();
}

/* WHETHER A CLIP PASTES AT A ROW of this role height. With children,
 * only at the SAME height: the height is what says the subtree's rungs
 * exist under the target row, and pasting a Day-with-Scenes into a
 * Day-over-Beats board would put scenes where beats go. Without
 * children there is no subtree to protect, so a lone card pastes onto
 * whatever row you asked for (owner-reported 2026-09-08: a day card
 * copied without children would not paste on another day board -- its
 * Day sat at a different height above the leaf there). Pure; pinned. */
export function pasteFits(clip: { nodes: Node[]; height: number } | null, targetHeight: number): boolean {
  if (!clip || !clip.nodes.length) return false;
  if (clip.height === targetHeight) return true;
  return clip.nodes.every((n) => !n.children.length);
}

export const clipboard = {
  cut(ids: string[]) {
    take(ops.extractNodes(ids, true));
  },
  /* COPY: the same clip without emptying the board (2026-08-26). The
   * clipboard was cut-only until then, which is why the header above
   * talks about a cut surviving a tab close -- a copy has no such
   * hazard, it just needs somewhere to live.
   *
   * It shares `extractNodes`' collection pass rather than walking the
   * doc itself: the tier rule, the trailing hidden stacks and the plain
   * projection are fiddly enough that a second implementation would
   * drift, and a copy that quietly disagreed with a cut about WHAT it
   * took would be a nasty thing to debug. */
  copy(ids: string[], withChildren = true) {
    const res = ops.extractNodes(ids, false);
    /* NO CHILDREN (owner, 2026-09-08: "Copy card (with children)" and
     * "Copy card (no children)"): the same cards, their subtrees left
     * behind. The clip's role height is unchanged -- a scene without its
     * beats is still a scene -- so it pastes where the full copy would. */
    take(withChildren || !res ? res : { ...res, nodes: res.nodes.map((n) => ({ ...n, children: [] })) });
  },
  depth: (): number | null => (clip ? clip.depth : null),
  /* The role height the clip pastes at, for a caller deciding whether a
   * paste is even possible before trying it (the keyboard's Cmd-V). The
   * hook `usePasteCount` is the React way to ask; this is the plain one. */
  height: (): number | null => (clip ? clip.height : null),
  /* `rootBoardId` names the destination board for root-tier pastes
   * (parentId null). Works across boards -- paste is fresh-id clones,
   * gated on ROLE height so a 4-tier scene pastes into a 3-tier board's
   * scene row and never into its beat row. */
  paste(parentId: string | null, index: number, targetHeight: number, rootBoardId?: string) {
    if (!pasteFits(clip, targetHeight)) return;
    ops.insertNodes(parentId, index, clip!.nodes, rootBoardId);
  },
  /* the plain form of usePasteCount, for the keyboard's Cmd-V */
  fitsAt: (targetHeight: number): boolean => pasteFits(clip, targetHeight),
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/* How many clipboard nodes can paste at role height `targetHeight` (0 =
 * nothing to paste there). Drives the "Paste (N)" affordances. */
export function usePasteCount(targetHeight: number): number {
  return useSyncExternalStore(
    clipboard.subscribe,
    () => (pasteFits(clip, targetHeight) ? clip!.nodes.length : 0),
    () => 0,
  );
}
