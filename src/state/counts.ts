import type { Board, Node } from "./types";

export const leafDepth = (board: Board): number => board.levels.length - 1;

/* Number of leaf (card) nodes in this node's subtree. `depth` is the
 * node's own depth; `leaf` is the leaf-tier depth. */
export function leafDescendants(node: Node, depth: number, leaf: number): number {
  if (depth >= leaf) return 1;
  let n = 0;
  for (const c of node.children) n += leafDescendants(c, depth + 1, leaf);
  return n;
}

/* Total node count at each tier (index = depth). Drives the top-bar
 * roll-up: "N reels / M sections / ... / K beats". */
export function tierCounts(board: Board): number[] {
  const counts = new Array(board.levels.length).fill(0);
  const walk = (node: Node, depth: number) => {
    if (depth < counts.length) counts[depth]++;
    for (const c of node.children) walk(c, depth + 1);
  };
  board.roots.forEach((r) => walk(r, 0));
  return counts;
}

/* Substring test -- the ONE definition of "this card matches", used by the
 * detail filter, the Overview's dimming, the keyboard grid and the search
 * menu's count. Case-INSENSITIVE by default (the query used to arrive
 * pre-lowercased, and lowercasing twice is harmless, so old callers are
 * unaffected); `matchCase` is the per-pane toggle in the search bar.
 *
 * Deliberately a plain substring, not a word boundary and never a regex:
 * a regex typed into a shared board's find-and-replace is a foot-gun with
 * 3000 cards behind it. */
export const hit = (t: string, q: string, matchCase = false): boolean =>
  !!q && (matchCase ? t.includes(q) : t.toLowerCase().includes(q.toLowerCase()));
