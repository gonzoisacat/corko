import { describe, expect, it } from "vitest";
import { board4, level } from "../test/fixtures";
import type { Board, Node } from "./types";
import { hit } from "./counts";
import { collectMatches, countOccurrences, matchSpans, replaceAll } from "./search";

/* ------------------------------------------------------------------ *
 *  The search's MATCH SET and the string rules behind find-and-replace.
 *
 *  This is what every bulk action acts on, so the things pinned here are
 *  the ones that would silently corrupt a real board:
 *
 *   - matches come back ACROSS TIERS (a selection couldn't hold them) and
 *     in CUT ORDER (prev/next walks the cut, not the tiers);
 *   - the count the preview shows is the count the op will change --
 *     including a title that matches TWICE;
 *   - case-insensitive find writes the replacement literally, so the rule
 *     is predictable rather than guessed.
 * ------------------------------------------------------------------ */

/* A board where the same word appears at three different tiers, which is
 * the real case: "Ariel" on a working board is beats, scenes AND a day. */
function crossTier(): Board {
  const beat = (id: string, title: string): Node => ({ id, title, collapsed: false, children: [] });
  return {
    id: "b",
    title: "t",
    levels: [level("reel", "Reel"), level("day", "Day"), level("scene", "Scene"), level("beat", "Beat")],
    legend: [],
    roots: [
      {
        id: "r1",
        title: "Reel 1",
        collapsed: false,
        children: [
          {
            id: "d1",
            title: "Ariel day",
            collapsed: false,
            children: [
              {
                id: "s1",
                title: "Ariel enters",
                collapsed: false,
                children: [beat("b1", "Ariel + Stephen, Ariel leads"), beat("b2", "no one here")],
              },
              { id: "s2", title: "quiet", collapsed: false, children: [beat("b3", "ariel lowercase")] },
            ],
          },
        ],
      },
    ],
  };
}

describe("collectMatches", () => {
  it("crosses tiers -- the whole reason this doesn't go through selection", () => {
    const m = collectMatches(crossTier(), "ariel");
    expect(m.map((x) => x.id)).toEqual(["d1", "s1", "b1", "b3"]);
    expect([...new Set(m.map((x) => x.tier))].sort()).toEqual(["Beat", "Day", "Scene"]);
  });

  it("returns them in CUT ORDER, not grouped by tier", () => {
    // d1 (a Day) comes before s1 (its Scene) before b1 (its Beat)
    expect(collectMatches(crossTier(), "ariel").map((x) => x.depth)).toEqual([1, 2, 3, 3]);
  });

  it("honours match case", () => {
    expect(collectMatches(crossTier(), "Ariel", true).map((x) => x.id)).toEqual(["d1", "s1", "b1"]);
    expect(collectMatches(crossTier(), "ariel", true).map((x) => x.id)).toEqual(["b3"]);
  });

  it("is empty for an empty query, not everything", () => {
    expect(collectMatches(crossTier(), "")).toEqual([]);
    expect(collectMatches(null, "ariel")).toEqual([]);
  });

  it("matches a node's OWN title -- a lane is not carried by its children", () => {
    // b4's parent scene s2 doesn't contain the word, so only b4 comes back
    expect(collectMatches(board4(), "b4").map((x) => x.id)).toEqual(["b4"]);
  });
});

describe("countOccurrences", () => {
  it("counts every occurrence, so a twice-matching title isn't under-reported", () => {
    expect(countOccurrences("Ariel + Stephen, Ariel leads", "ariel")).toBe(2);
    expect(countOccurrences("Ariel + Stephen, Ariel leads", "Ariel", true)).toBe(2);
    expect(countOccurrences("Ariel + Stephen, ariel leads", "Ariel", true)).toBe(1);
  });

  it("doesn't loop forever or double-count overlaps", () => {
    expect(countOccurrences("aaaa", "aa")).toBe(2); // non-overlapping
    expect(countOccurrences("abc", "")).toBe(0);
  });
});

describe("replaceAll", () => {
  it("replaces every occurrence in a title", () => {
    expect(replaceAll("Ariel + Stephen, Ariel leads", "Ariel", "Ari")).toBe("Ari + Stephen, Ari leads");
  });

  it("case-insensitive find writes the replacement LITERALLY", () => {
    // the predictable rule: we don't guess at preserving the original case
    expect(replaceAll("ariel and Ariel", "ariel", "Ari")).toBe("Ari and Ari");
  });

  it("match case leaves the other casing alone", () => {
    expect(replaceAll("ariel and Ariel", "Ariel", "Ari", true)).toBe("ariel and Ari");
  });

  it("an empty replacement deletes the term", () => {
    expect(replaceAll("Ariel enters", "Ariel ", "")).toBe("enters");
  });

  it("an empty find is a no-op rather than an explosion", () => {
    expect(replaceAll("anything", "", "x")).toBe("anything");
  });
});

describe("matchSpans", () => {
  it("finds every span, which is what lets the preview mark all of them", () => {
    expect(matchSpans("Ariel + Ariel", "ariel")).toEqual([
      [0, 5],
      [8, 13],
    ]);
  });
});

describe("hit stays the one matcher", () => {
  it("is case-insensitive by default, and tolerates an already-lowercased query", () => {
    expect(hit("Ariel enters", "ariel")).toBe(true);
    expect(hit("Ariel enters", "ARIEL")).toBe(true);
    expect(hit("Ariel enters", "Ariel", true)).toBe(true);
    expect(hit("Ariel enters", "ariel", true)).toBe(false);
  });

  it("an empty query matches nothing", () => {
    expect(hit("anything", "")).toBe(false);
  });
});
