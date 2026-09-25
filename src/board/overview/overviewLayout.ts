import type { Node } from "../../state/types";

/* Overview layout helpers. The Overview draws the whole board as color
 * proxies, one column per node at a chosen tier ("1 Column per: {tier}").
 * A node's tier is its depth in board.levels. */

export interface Placed {
  node: Node;
  parentId: string | null; // for the right-click menu / drag ops
  index: number; // index within its parent's children
}

/* The nodes at `columnDepth` become the columns (walk roots down that far),
 * each carrying its parent id + sibling index. columnDepth 0 = the top tier;
 * deeper = more columns, less grouping. */
export function collectColumns(roots: Node[], columnDepth: number): Placed[] {
  let level: Placed[] = roots.map((node, index) => ({ node, parentId: null, index }));
  for (let d = 0; d < columnDepth; d++) {
    level = level.flatMap(({ node }) =>
      node.children.map((child, index) => ({ node: child, parentId: node.id, index })),
    );
  }
  return level;
}

/* ------------------------------------------------------------------ *
 *  The row the Overview actually draws (2026-08-02, owner's ask).
 *
 *  Columning by a deeper tier used to DROP everything above it: pick
 *  "1 column per Scene" and the Reels and Days the scenes belong to
 *  simply weren't on screen, so a wall of scene columns had no visible
 *  structure. They come back as SPINES -- the detail view's full-width
 *  band turned 90 degrees, a thin vertical bar with its title reading
 *  down the page like the spine of a book, standing between the columns
 *  wherever that ancestor begins.
 *
 *  One spine per ancestor tier entered, outermost first, which is what
 *  makes a boundary legible: a new Day inside the same Reel puts up one
 *  bar; a new Reel puts up two (the Reel, then its first Day). It falls
 *  straight out of a depth-first walk -- emit on the way IN.
 * ------------------------------------------------------------------ */

export interface SpineItem extends Placed {
  kind: "spine";
  depth: number; // its tier, so the proxy can resolve color + geometry
}
export interface ColumnItem extends Placed {
  kind: "column";
}
export type OverviewItem = SpineItem | ColumnItem;

export function collectItems(roots: Node[], columnDepth: number): OverviewItem[] {
  const items: OverviewItem[] = [];
  const walk = (nodes: Node[], depth: number, parentId: string | null) => {
    nodes.forEach((node, index) => {
      if (depth >= columnDepth) {
        items.push({ kind: "column", node, parentId, index });
        return;
      }
      items.push({ kind: "spine", node, parentId, index, depth });
      walk(node.children, depth + 1, node.id);
    });
  };
  walk(roots, 0, null);
  return items;
}
