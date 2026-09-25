import type { Board } from "../state/types";
import { readingCards } from "./notesFeed";

/* ------------------------------------------------------------------ *
 *  STEPPING FROM ONE CARD'S PANEL TO THE NEXT (owner, 2026-09-10):
 *  chevron discs either side of the metadata panel's card label, one per
 *  tier you can reach, that open the same panel on the previous or next
 *  card at that tier.
 *
 *  IN CUT ORDER, which is the board read top to bottom -- the same order
 *  the notes feed walks (notesFeed.readingCards, reused rather than
 *  restated, since "what order is this board in" has exactly one right
 *  answer and two copies of it would drift).
 *
 *  NEXT AT A TIER MEANS the first card at that tier standing after this
 *  one in the read, and previous the last one before it. Stated against
 *  the WHOLE read rather than against a list of that tier's cards,
 *  because the card you are on usually is not at the tier you clicked --
 *  from a beat, "next scene" is the scene the read reaches next, which
 *  is the one whose beats you are about to be looking at. A list of
 *  scenes could not answer that without knowing where the beat sat.
 *
 *  SAME TIER, PLUS OR MINUS ONE, and no further (his call: "lets just
 *  make it same tier +/- 1 tier. so 3 buttons max (and only two if
 *  you're at the top or bottom tier)"). The ends of the ladder simply
 *  have fewer -- there is no tier above the top one to step through.
 *
 *  FOLD STATE IS NOT CONSULTED, deliberately. This walks the board, not
 *  the rows on screen: a collapsed scene's beats are still in the cut,
 *  and skipping them would make the same button do different things
 *  depending on chevrons the panel cannot see.
 * ------------------------------------------------------------------ */

export interface TierHop {
  /* The tier this disc steps through -- its index in board.levels, which
   * is also its depth, and what colors the disc. */
  tier: number;
  /* The card each chevron opens, or null when the read has no card at
   * that tier on that side. A null still DRAWS, disabled: the discs are
   * a row you learn the shape of, and one vanishing at the first card of
   * a board would move the others under the pointer. */
  prev: string | null;
  next: string | null;
}

/* WHAT TIER A CARD SITS AT, or null when the board does not hold it.
 * Beside the hops because it reads the same walk, and because a caller
 * that has an id and needs its depth is asking the question this file
 * already answers for three tiers at once. */
export function depthOf(board: Board | null, nodeId: string): number | null {
  if (!board) return null;
  return readingCards(board).get(nodeId)?.depth ?? null;
}

/* The tiers a card can step through: its own, and one either side of it
 * that the ladder actually has. */
export function hopTiers(depth: number, tierCount: number): number[] {
  const tiers: number[] = [];
  for (let t = depth - 1; t <= depth + 1; t++) {
    if (t >= 0 && t < tierCount) tiers.push(t);
  }
  return tiers;
}

export function tierHops(board: Board | null, nodeId: string): TierHop[] {
  if (!board) return [];
  const cards = readingCards(board);
  const me = cards.get(nodeId);
  if (!me) return [];
  const byOrder = [...cards.values()].sort((a, b) => a.order - b.order);

  return hopTiers(me.depth, board.levels.length).map((tier) => {
    let prev: string | null = null;
    let next: string | null = null;
    for (const c of byOrder) {
      if (c.depth !== tier || c.nodeId === nodeId) continue;
      if (c.order < me.order) prev = c.nodeId; // the LAST one before -- keep overwriting
      else if (next === null) next = c.nodeId; // the FIRST one after
    }
    return { tier, prev, next };
  });
}
