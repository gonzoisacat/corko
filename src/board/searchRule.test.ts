import { describe, expect, it } from "vitest";
import { level } from "../test/fixtures";
import type { Board, Node } from "../state/types";
import { flattenBoard, matchesSearch, showsWholeSubtree } from "./flatten";
import { navRows } from "./keyNav";

/* ------------------------------------------------------------------ *
 *  What DETAIL search shows (2026-08-03).
 *
 *  It used to test only LEAF titles, so a scene named "Ariel and Jay's
 *  Room" was invisible to a search for Ariel unless one of its beats
 *  happened to repeat the word -- on the real board that hid 10 scenes
 *  and a shoot day out of 42 matching cards, which is what the owner
 *  reported as unintuitive.
 *
 *  What is pinned here is BOTH halves of the fix and, just as
 *  importantly, the half that did NOT change: detail still FILTERS. It
 *  did not become the Overview, which dims -- dimming is only affordable
 *  there because it isn't virtualized.
 * ------------------------------------------------------------------ */

const beat = (id: string, title: string): Node => ({ id, title, collapsed: false, children: [] });
const lane = (id: string, title: string, children: Node[]): Node => ({
  id,
  title,
  collapsed: false,
  children,
});

/*  r1 "Reel 1"
 *    d1 "Ariel day"        <- matches by NAME
 *      s1 "Ariel enters"   <- matches by NAME
 *        b1 "Ariel leads", b2 "quiet"
 *      s2 "Rehearsal"
 *        b3 "Ariel sits", b4 "nothing"
 *    d2 "Other day"
 *      s3 "Kitchen"
 *        b5 "nothing here" */
function board(): Board {
  return {
    id: "bd",
    title: "t",
    levels: [level("reel", "Reel"), level("day", "Day"), level("scene", "Scene"), level("beat", "Beat")],
    legend: [],
    roots: [
      lane("r1", "Reel 1", [
        lane("d1", "Ariel day", [
          lane("s1", "Ariel enters", [beat("b1", "Ariel leads"), beat("b2", "quiet")]),
          lane("s2", "Rehearsal", [beat("b3", "Ariel sits"), beat("b4", "nothing")]),
        ]),
        lane("d2", "Other day", [lane("s3", "Kitchen", [beat("b5", "nothing here")])]),
      ]),
    ],
  };
}

/* Everything the detail view actually draws, as ids: lane/cards-lane rows
 * plus the cards inside a strip. */
function shown(b: Board, q: string, matchCase = false): string[] {
  const out: string[] = [];
  for (const r of flattenBoard(b, q, () => false, matchCase)) {
    if (r.kind === "lane") out.push(r.node.id);
    if (r.kind === "cards-lane") {
      out.push(r.node.id);
      out.push(...r.cards.map((c) => c.id));
    }
  }
  return out;
}

describe("a lane matching by its OWN name", () => {
  it("shows -- the whole point of the change", () => {
    // s1 "Ariel enters" holds one matching beat and one that doesn't
    expect(shown(board(), "enters")).toContain("s1");
  });

  it("brings its WHOLE subtree, not just the children that repeat the word", () => {
    // "enters" appears only in s1's title; b2 "quiet" must still show,
    // because you asked for that scene and a scene IS its beats
    expect(shown(board(), "enters")).toEqual(["r1", "d1", "s1", "b1", "b2"]);
  });

  it("applies at any tier -- a matching DAY brings everything under it", () => {
    expect(shown(board(), "ariel day")).toEqual(["r1", "d1", "s1", "b1", "b2", "s2", "b3", "b4"]);
  });

  it("still draws the ancestor chain, so you see where in the cut it sits", () => {
    // r1 and d1 don't contain "rehearsal"; they're context for s2
    expect(shown(board(), "rehearsal").slice(0, 3)).toEqual(["r1", "d1", "s2"]);
  });
});

describe("it still FILTERS -- it did not become the Overview", () => {
  it("drops everything with no match anywhere under it", () => {
    const ids = shown(board(), "ariel");
    expect(ids).not.toContain("d2"); // a whole day with nothing in it
    expect(ids).not.toContain("s3");
    expect(ids).not.toContain("b5");
  });

  it("keeps filtering the beats of a lane that only matched THROUGH a child", () => {
    // s2 "Rehearsal" shows because b3 "Ariel sits" matches; b4 "nothing"
    // must not come along. Uses "sits" rather than "ariel" precisely
    // because no ANCESTOR contains it -- see the nesting test below.
    const ids = shown(board(), "sits");
    expect(ids).toEqual(["r1", "d1", "s2", "b3"]);
  });

  /* The one genuinely surprising consequence, so it is stated rather than
   * discovered: the whole-subtree rule NESTS. Searching "ariel" matches
   * the Day by name, so its scenes and beats all come -- including b4
   * "nothing", which contains nothing of the sort.
   *
   * Measured on the real board before accepting this: 16 lanes match
   * "Ariel" by name and pull in 85 cards between them, the largest single
   * one being 15. So it reads as a result, not a flood. If a top-tier
   * name ever did swamp a search, the fix is to stop `whole` cascading
   * past one tier -- but that trades a predictable rule for a fiddly one,
   * so it should wait for a real complaint. */
  it("the whole-subtree rule NESTS -- a matching Day carries its scenes' beats", () => {
    const ids = shown(board(), "ariel");
    expect(ids).toContain("b4"); // "nothing", under "Rehearsal", under "Ariel day"
    expect(ids).not.toContain("b5"); // ...but the OTHER day is still gone
  });

  it("a query matching nothing shows nothing", () => {
    expect(shown(board(), "zzz")).toEqual([]);
  });
});

describe("match case", () => {
  it("is honoured by the lane rule too", () => {
    expect(shown(board(), "Ariel enters", true)).toContain("s1");
    expect(shown(board(), "ariel enters", true)).not.toContain("s1");
  });
});

describe("the keyboard walks exactly what the board drew", () => {
  /* The bug this guards: arrows landing on a card the filter removed.
   * navRows imports flatten's predicates rather than restating them, so
   * this asserts the two agree on every query that behaves differently. */
  for (const q of ["ariel", "enters", "ariel day", "rehearsal", "nothing", "zzz"]) {
    it(`agrees with flatten for "${q}"`, () => {
      const b = board();
      const cells = navRows(b, () => false, q).flat().map((c) => c.id);
      expect([...cells].sort()).toEqual([...new Set(shown(b, q))].sort());
    });
  }
});

describe("the predicates themselves", () => {
  it("matchesSearch takes the own title OR any leaf below", () => {
    const b = board();
    const leaf = b.levels.length - 1;
    const d1 = b.roots[0].children[0];
    expect(matchesSearch(d1, 1, leaf, "ariel day")).toBe(true); // own name
    expect(matchesSearch(d1, 1, leaf, "sits")).toBe(true); // a leaf under it
    expect(matchesSearch(d1, 1, leaf, "kitchen")).toBe(false);
  });

  it("showsWholeSubtree is the own-name test, and nothing else", () => {
    const s2 = board().roots[0].children[0].children[1]; // "Rehearsal"
    expect(showsWholeSubtree(s2, "rehearsal")).toBe(true);
    expect(showsWholeSubtree(s2, "ariel")).toBe(false); // matches only through a beat
  });
});

/* ------------------------------------------------------------------ *
 *  THE "NO CARDS MATCH" GUARD AND THE FILTER ARE ONE QUESTION
 *  (owner-reported 2026-09-10: searching a real cut, the box counted a
 *  hit and the Overview drew it while the detail view said there were
 *  none). BoardPane used to ask with its own walk that tested only LEAF
 *  cards; it asks `matchesSearch` now, and these say why that has to
 *  hold for every tier.
 * ------------------------------------------------------------------ */
describe("a match at any tier is a match", () => {
  const b = board();
  const leafDepth = b.levels.length - 1;
  const anyMatch = (q: string) => b.roots.some((r) => matchesSearch(r, 0, leafDepth, q, false));

  it("finds a hit on a LEAF, which always worked", () => {
    expect(anyMatch("sits")).toBe(true);
  });
  /* The bug: a name that exists only ABOVE the leaf. The board can draw
   * it -- a matched node shows its whole subtree -- so the guard must
   * not refuse to let it try. */
  it("finds a hit on a tier ABOVE the leaf, which did not", () => {
    expect(anyMatch("ariel day")).toBe(true); // a Day
    expect(anyMatch("rehearsal")).toBe(true); // a Scene
    expect(anyMatch("reel 1")).toBe(true); // the Reel itself
  });
  it("still says no when nothing anywhere matches", () => {
    expect(anyMatch("hollywood")).toBe(false);
  });
  /* The guard and the filter must never disagree: whatever the guard
   * lets through, the view has to have something to draw, and whatever
   * it refuses must genuinely draw nothing. */
  it("agrees with what the board draws, at every tier", () => {
    for (const q of ["sits", "ariel day", "rehearsal", "reel 1", "kitchen", "hollywood"]) {
      expect([q, anyMatch(q)]).toEqual([q, shown(b, q).length > 0]);
    }
  });
});
