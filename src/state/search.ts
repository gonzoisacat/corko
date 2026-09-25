import type { Board, Node } from "./types";
import { readingOrder } from "./gridBoard";
import { hit } from "./counts";
import { searchTitle, type NestInfo } from "./nesting";

/* ------------------------------------------------------------------ *
 *  What the search bar's MATCH SET is, and what bulk actions act on.
 *
 *  A card matches on its OWN title. That is the Overview's rule -- what
 *  lights up while you preview -- and it is deliberately not the detail
 *  view's, which shows any lane with a matching LEAF somewhere under it
 *  (flatten.ts `hasLeafMatch`). The two disagree today and closing that
 *  is its own job (NEXT UP); until then the count and the bulk actions
 *  use this one, because it is the only rule where the number you are
 *  shown is the number of cards that will be changed.
 *
 *  Matches come back in CUT ORDER (document order, depth-first), not by
 *  tier and not by relevance: you work a cut top to bottom, so prev/next
 *  should walk it the way you would watch it -- the same reasoning as the
 *  notes feed (ADR 0004).
 *
 *  ACROSS TIERS on purpose. In a real board "Ariel" is 26 beats, 15
 *  scenes and a shoot day; a selection could hold at most one of those,
 *  because board/selection.ts is single-tier by design (drag, range and
 *  stack all need that). Tagging doesn't, and `ops.setNodeTag` has never
 *  cared about depth -- so the match set is its own thing and never goes
 *  near the selection store.
 * ------------------------------------------------------------------ */

export interface Match {
  id: string;
  title: string;
  depth: number;
  tier: string; // the tier's display name, for the preview's little label
  /* A NESTING CARD HAS NO TITLE OF ITS OWN. It matched on its target
   * board's name, so find-and-replace must leave it alone -- rewriting
   * `node.title` would edit the name the card hides, which is neither
   * what the preview showed nor what anyone asked for. Renaming the
   * board is a separate, deliberate act (the card menu's "Rename
   * board..."). Tags and metadata values are unaffected: those work on
   * any node. */
  nested?: boolean;
}

export function collectMatches(
  board: Board | null,
  q: string,
  matchCase = false,
  /* A nesting card matches the name it DRAWS (state/nesting.ts
   * `searchTitle`) -- its target board's, not the `title` it keeps
   * written and unread. Trailing and optional, `hit`'s own idiom. */
  nests?: Map<string, NestInfo>,
): Match[] {
  const out: Match[] = [];
  if (!board || !q) return out;
  const walk = (nodes: Node[], depth: number) => {
    for (const n of nodes) {
      const shown = searchTitle(n, nests);
      if (hit(shown, q, matchCase)) {
        /* The match carries the SHOWN title too, so the search menu and
         * the find-and-replace preview name the card the way the board
         * does. */
        out.push({
          id: n.id,
          title: shown,
          depth,
          tier: board.levels[depth]?.name ?? "",
          nested: !!n.boardRef,
        });
      }
      walk(n.children, depth + 1);
    }
  };
  /* Reading order, which is document order everywhere except a FREE
   * GRID -- a wall has no sequence, and its document order is stacking
   * order, so stepping matches used to change with the paint order. */
  walk(readingOrder(board), 0);
  return out;
}

/* How many times `q` occurs in one title -- the preview reports OCCURRENCES
 * as well as titles, because a beat called "Ariel + Stephen, Ariel leads"
 * changes twice and a count of cards would quietly under-report it. */
export function countOccurrences(title: string, q: string, matchCase = false): number {
  if (!q) return 0;
  const hay = matchCase ? title : title.toLowerCase();
  const needle = matchCase ? q : q.toLowerCase();
  let n = 0;
  let at = hay.indexOf(needle);
  while (at >= 0) {
    n++;
    at = hay.indexOf(needle, at + needle.length);
  }
  return n;
}

/* Replace every occurrence, honouring case-sensitivity. Case-INsensitive
 * find writes the replacement literally, so "ariel" and "Ariel" both
 * become exactly what you typed -- stated here because the alternative
 * (trying to preserve the original's capitalisation) guesses, and a guess
 * that is wrong 1 time in 40 across a 3000-card board is worse than a
 * rule you can predict. */
export function replaceAll(title: string, q: string, to: string, matchCase = false): string {
  if (!q) return title;
  if (matchCase) return title.split(q).join(to);
  let out = "";
  let rest = title;
  const needle = q.toLowerCase();
  for (;;) {
    const at = rest.toLowerCase().indexOf(needle);
    if (at < 0) return out + rest;
    out += rest.slice(0, at) + to;
    rest = rest.slice(at + q.length);
  }
}

/* Every span of `q` inside a title, for marking ALL of them rather than
 * just the first (ui/highlight's renderHighlight marks one, which is fine
 * on a card and dishonest in a replace preview). */
export function matchSpans(title: string, q: string, matchCase = false): [number, number][] {
  const spans: [number, number][] = [];
  if (!q) return spans;
  const hay = matchCase ? title : title.toLowerCase();
  const needle = matchCase ? q : q.toLowerCase();
  let at = hay.indexOf(needle);
  while (at >= 0) {
    spans.push([at, at + needle.length]);
    at = hay.indexOf(needle, at + needle.length);
  }
  return spans;
}
