
/* ------------------------------------------------------------------ *
 *  THE SEAM: every row owns exactly one insertion point -- the point
 *  directly BELOW its card. What that point MEANS follows from what is
 *  rendered below it:
 *
 *   - a cards-lane row (scene): the next sibling comes below, so the
 *     seam is "after me" -- and pinning a shallower tier there splits
 *     ancestors per the corkboard rule (ops.insertTierAt).
 *   - an unfolded lane (band): its own first child comes below, so the
 *     seam is "into me, at the top" -- (self, 0). Only the child tier:
 *     pinning an ancestor above a container's first child would take
 *     every child and leave the container empty, which is the
 *     first-child rule insertTierAt also enforces. An EMPTY band's
 *     below-gap is simultaneously the gap before its next sibling, so
 *     it carries the after-me discs too.
 *   - a FOLDED lane: its subtree is hidden, so the point below its card
 *     is after the whole subtree -- the after-me form.
 *
 *  Anchoring below the card is what deleted the measured gap pass
 *  (2026-08-07, owner's call: "live below the cards, consistently") --
 *  see RowSeam.tsx for the element and CLAUDE.md for the history.
 *
 *  THE CLOSES-HERE CHAIN. A row's below-gap can be the trailing point
 *  of several containers at once (the last scene of the last day of the
 *  last reel closes all three), and flatten hands every row its
 *  ancestors (LaneAbove) plus whether each is the LAST rendered of its
 *  siblings. Walking that chain innermost-out while it stays closed
 *  yields `drops`: every published drag address this seam must DRAW --
 *  the drag system publishes after-forms per tier (dropPlan.ts's
 *  laneAbove branch), and the drawer for all of them is this one
 *  physical gap.
 *
 *  NOTHING STANDS AT REST (owner, 2026-08-07: "no plusses visible until
 *  you hover"). The first cut of the chip replacement PROMOTED a disc
 *  wherever its container closes -- the add-chips' own placement rule
 *  -- and the owner saw it built and quieted it the same day: every
 *  disc is hover-revealed, uniformly. If a resting marker ever returns,
 *  derive it from this same chain (the promotion projection was: tier t
 *  stands where t's container closes; own tier iff `last`, ancestors
 *  while the chain holds, an empty band's child disc always).
 *
 *  Every disc carries its own click address because they genuinely
 *  differ in one case: an empty band's child disc pins at (self, 0)
 *  while its after-me discs pin at (parent, index + 1) -- and
 *  insertTierAt refuses ancestor tiers at index 0, so collapsing them
 *  onto one address is not just untidy but wrong.
 *
 *  Pinned by seam.test.ts.
 * ------------------------------------------------------------------ */

export interface SeamAddr {
  parentId: string | null;
  index: number;
}

export interface SeamDisc {
  /* the tier this disc pins */
  tier: number;
  /* insertTierAt's terms: the gap's address at its OWN tier */
  parentId: string | null;
  index: number;
  /* the gap's own tier at that address -- what a shallower pin absorbs
   * down to, and what insertTierAt mints parents between */
  own: number;
}

export interface SeamSpec {
  /* ascending tier -- also the render order, left to right across the
   * indent staircase */
  discs: SeamDisc[];
  /* every published drop address this seam draws the preview for */
  drops: SeamAddr[];
}

export interface SeamAboveLane {
  parentId: string | null;
  index: number;
  depth: number;
  /* no later sibling of this lane emitted a row (flatten.lastRendered) */
  last: boolean;
}

export interface SeamRow {
  /* "nested" is a card standing in for another board (types.ts
   * `boardRef`). It falls through to the after-me forms at the foot of
   * seamBelow -- exactly like a cards-lane row -- because it CANNOT take
   * children, so it has no come-inside address to offer at any tier. */
  kind: "lane" | "cards-lane" | "nested";
  nodeId: string;
  parentId: string | null;
  index: number;
  depth: number;
  /* EFFECTIVE fold -- collapsed AND not searching, the render rule */
  folded: boolean;
  /* no later sibling emits a row: this seam is its container's trailing
   * insertion point */
  last: boolean;
  /* the parent's DOC child count -- the append index, which differs from
   * index + 1 exactly when hidden siblings are stacked behind this row */
  siblingCount: number;
  /* lane rows: own child count (an empty band's seam is also after-me) */
  childCount?: number;
  /* the lanes this row sits inside, outermost first (flatten.LaneAbove) */
  above: SeamAboveLane[];
}

export function seamBelow(row: SeamRow): SeamSpec {
  const afterIdx = row.last ? row.siblingCount : row.index + 1;

  /* The after-form discs: every tier up the ladder, one address. */
  const afterDiscs = (): SeamDisc[] =>
    Array.from({ length: row.depth + 1 }, (_, t) => ({
      tier: t,
      parentId: row.parentId,
      index: afterIdx,
      own: row.depth,
    }));

  /* The published addresses those discs' gap draws: the own-tier
   * after-forms, then one per enclosing lane while the chain stays
   * closed (dropPlan's laneAbove branch publishes exactly these). */
  const afterDrops = (): SeamAddr[] => {
    const drops: SeamAddr[] = [{ parentId: row.parentId, index: row.index + 1 }];
    if (row.last && row.siblingCount !== row.index + 1)
      drops.push({ parentId: row.parentId, index: row.siblingCount });
    let closing = row.last;
    for (let i = row.above.length - 1; i >= 0 && closing; i--) {
      const lane = row.above[i];
      drops.push({ parentId: lane.parentId, index: lane.index + 1 });
      closing = lane.last;
    }
    return drops;
  };

  if (row.kind === "lane" && !row.folded) {
    const empty = (row.childCount ?? 0) === 0;
    const into: SeamDisc = {
      tier: row.depth + 1,
      parentId: row.nodeId,
      index: 0,
      own: row.depth + 1,
    };
    if (!empty) return { discs: [into], drops: [{ parentId: row.nodeId, index: 0 }] };
    /* An empty band's below-gap is ALSO the gap before its next sibling,
     * so it behaves like a leaf row for the after-forms -- this is what
     * gives the empty-container drop preview somewhere to draw. */
    return {
      discs: [...afterDiscs(), into],
      drops: [{ parentId: row.nodeId, index: 0 }, ...afterDrops()],
    };
  }

  if (row.kind === "lane") {
    /* Folded: after-me. The (self, 0) DROP rides along because planRow's
     * come-inside branch publishes it for a folded band too, and before
     * seams nothing drew that preview at all. No (self, 0) DISC: opening
     * a folded band's interior from outside stays un-offered, as the old
     * cluster had it. */
    return { discs: afterDiscs(), drops: [{ parentId: row.nodeId, index: 0 }, ...afterDrops()] };
  }

  return { discs: afterDiscs(), drops: afterDrops() };
}

/* Identity-stable spec per flatten row: flatten re-runs on any board,
 * query or fold change, so the row object's identity already captures
 * everything the spec depends on -- and a stable spec is what keeps
 * CardsLane's memo skipping unrelated re-renders (a keystroke on one
 * title must not re-render every mounted lane). */
const specCache = new WeakMap<object, SeamSpec>();
export function seamFor(key: object, row: SeamRow): SeamSpec {
  let s = specCache.get(key);
  if (!s) {
    s = seamBelow(row);
    specCache.set(key, s);
  }
  return s;
}

/* The board's head -- the only gap the below-ownership rule leaves
 * unowned (no row above the first root). Rendered by the first root's
 * row, above its card. A singleton for the same memo reason as
 * seamFor. */
const HEAD: SeamSpec = {
  discs: [{ tier: 0, parentId: null, index: 0, own: 0 }],
  drops: [{ parentId: null, index: 0 }],
};
export function headSeam(): SeamSpec {
  return HEAD;
}

/* Whether this row renders the head seam: it is the true first root,
 * searching or not -- the exact condition the old above-cluster used. */
export const isBoardHead = (parentId: string | null, index: number): boolean =>
  parentId === null && index === 0;

/* `mintedAt` lived here -- which tiers a pin would MINT, mirroring
 * ops.insertTierAt's loop, so the hover preview could draw one shape per
 * new node. The owner cut those shapes 2026-08-07 ("intuitive enough now
 * that we don't need those") and it went with them rather than sit here
 * untested-in-anger: insertTierAt owns that rule, with ten tests on it. */
