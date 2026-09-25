import { describe, expect, it } from "vitest";
import { board4, node } from "../test/fixtures";
import type { Board, Node } from "../state/types";
import type { NestInfo } from "../state/nesting";
import { searchTitle } from "../state/nesting";
import { matchesSearch, showsWholeSubtree, flattenBoard } from "./flatten";
import { navRows } from "./keyNav";
import { collectMatches } from "../state/search";
import { nestFace } from "./NestedFace";

/* ------------------------------------------------------------------ *
 *  A NESTING CARD IS SEARCHED BY THE NAME IT SHOWS.
 *
 *  It draws its TARGET board's live title and keeps its own written but
 *  unread, so before this it was findable by a name appearing nowhere on
 *  it and NOT findable by the name it displays (owner-reported
 *  2026-08-26: "it should all be searchable").
 *
 *  The point of this file is the LAST BLOCK: the app has five separate
 *  statements of "does this card match" -- the detail filter, the
 *  Overview's dimming, the keyboard walk, the match count and the
 *  board-level any-match -- and every drift between them has been a bug
 *  (the "fish and fowl" pass, the matchCase omission this same change
 *  found). They are asserted to agree rather than trusted to.
 * ------------------------------------------------------------------ */

const NESTS: Map<string, NestInfo> = new Map([
  ["bd2", { title: "Reel 3 -- Grief", type: undefined }],
]);

/* board4 is Reel > Section > Scene > Beat. Scene s1 becomes a nesting
 * card whose HIDDEN title says "hidden" and whose SHOWN title is the
 * target board's, "Reel 3 -- Grief". */
function boardWithNest(): Board {
  const b = board4();
  const s1: Node = { ...node("s1"), title: "hidden", boardRef: "bd2", children: [] };
  b.roots[0].children[0].children[0] = s1;
  return b;
}
const nested = () => boardWithNest().roots[0].children[0].children[0];

describe("searchTitle: the name a search tests", () => {
  it("an ordinary card is its own title", () => {
    expect(searchTitle(node("b1"), NESTS)).toBe("b1");
  });

  it("a nesting card is its TARGET's title, not the one it hides", () => {
    expect(searchTitle(nested(), NESTS)).toBe("Reel 3 -- Grief");
  });

  it("...and it is the same string the card is LABELLED with", () => {
    /* If these two ever diverge, a card is findable by one name and
     * labelled with another -- the bug, wearing a different hat. */
    expect(searchTitle(nested(), NESTS)).toBe(nestFace(nested(), NESTS)!.title);
  });

  it("a DANGLING ref falls back to the tombstone, which is what it draws", () => {
    const gone: Node = { ...nested(), boardRefTitle: "Reel 3 -- Grief" };
    expect(searchTitle(gone, new Map())).toBe("Reel 3 -- Grief");
    expect(searchTitle(gone, new Map())).toBe(nestFace(gone, new Map())!.title);
  });

  it("with no index it degrades to node.title rather than breaking", () => {
    expect(searchTitle(nested())).toBe("hidden");
  });
});

describe("every statement of 'does this card match' agrees", () => {
  const b = boardWithNest();
  const n = nested();
  const leaf = b.levels.length - 1;

  /* The five predicates, each as the app calls it. */
  const ways = (q: string) => ({
    detail: matchesSearch(n, 2, leaf, q, false, NESTS),
    whole: showsWholeSubtree(n, q, false, NESTS),
    overview: !!searchTitle(n, NESTS).toLowerCase().includes(q.toLowerCase()),
    count: collectMatches(b, q, false, NESTS).some((m) => m.id === "s1"),
    keyboard: navRows(b, () => false, q, false, NESTS).flat().some((c) => c.id === "s1"),
  });

  it("all five FIND it by the name it shows", () => {
    const w = ways("Grief");
    expect(w).toEqual({ detail: true, whole: true, overview: true, count: true, keyboard: true });
  });

  it("all five MISS it by the name it hides", () => {
    const w = ways("hidden");
    expect(w).toEqual({
      detail: false,
      whole: false,
      overview: false,
      count: false,
      keyboard: false,
    });
  });

  it("the detail view draws it for the shown name and not the hidden one", () => {
    const drawn = (q: string) =>
      flattenBoard(b, q, () => false, false, NESTS).some(
        (r) => "node" in r && r.node.id === "s1",
      );
    expect(drawn("Grief")).toBe(true);
    expect(drawn("hidden")).toBe(false);
  });

  it("the match carries the SHOWN title, so the menu names it as the board does", () => {
    const m = collectMatches(b, "Grief", false, NESTS).find((x) => x.id === "s1")!;
    expect(m.title).toBe("Reel 3 -- Grief");
    /* ...and is flagged, because find-and-replace must leave it alone:
     * rewriting `title` would edit the name the card hides. */
    expect(m.nested).toBe(true);
  });

  it("an ordinary card is not flagged nested", () => {
    /* b4, not b1: b1 lived under the scene this fixture replaced. */
    expect(collectMatches(b, "b4", false, NESTS).find((x) => x.id === "b4")!.nested).toBe(false);
  });
});
