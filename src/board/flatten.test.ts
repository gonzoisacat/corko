import { describe, expect, it } from "vitest";
import { board4, find } from "../test/fixtures";
import { flattenBoard } from "./flatten";

describe("flattenBoard", () => {
  it("emits the lane / cards-lane rows in document order -- no add rows (trailing inserts are promoted seam discs)", () => {
    const rows = flattenBoard(board4(), "");
    expect(rows.map((r) => r.key)).toEqual([
      "r1", // lane
      "d1", // lane
      "s1", // cards-lane
      "s2", // cards-lane
    ]);
    const s1 = rows.find((r) => r.key === "s1");
    expect(s1?.kind).toBe("cards-lane");
    if (s1?.kind === "cards-lane") {
      expect(s1.cards.map((c) => c.id)).toEqual(["b1", "b2", "b3"]);
      expect(s1.leafCount).toBe(3);
    }
  });

  it("stamps the closes-here chain the seams read (last + siblingCount + LaneAbove.last)", () => {
    const rows = flattenBoard(board4(), "");
    const byKey = (k: string) => rows.find((r) => r.key === k);
    const s1 = byKey("s1"), s2 = byKey("s2");
    if (s1?.kind !== "cards-lane" || s2?.kind !== "cards-lane") throw new Error("expected cards-lanes");
    expect(s1.last).toBe(false);
    expect(s2.last).toBe(true);
    expect(s2.siblingCount).toBe(2);
    // s2 closes d1, which closes r1, which closes the board: the whole
    // chain reads last, which is what promotes the board-foot staircase
    expect(s2.above.map((a) => [a.id, a.last])).toEqual([
      ["r1", true],
      ["d1", true],
    ]);
  });

  it("never stamps `last` while SEARCHING -- a filtered gap means itself", () => {
    // s2 is the last child and stamps last when unfiltered; under a
    // search that hides nothing after it, `last` must still be false, or
    // its seam would address the parent's APPEND slot rather than the
    // gap the user pointed at (and the new card could land unfiltered
    // out of sight)
    const rows = flattenBoard(board4(), "b4");
    for (const r of rows) {
      if (r.kind === "lane" || r.kind === "cards-lane") {
        expect(r.last).toBe(false);
        expect(r.above.every((a) => !a.last)).toBe(true);
      }
    }
  });

  it("an EMPTY board keeps the one labeled add-root row", () => {
    const empty = board4();
    empty.roots = [];
    expect(flattenBoard(empty, "").map((r) => r.key)).toEqual(["add-root"]);
    // ...and a board WITH roots has no add rows at all
    expect(flattenBoard(board4(), "").some((r) => r.kind === "add-root")).toBe(false);
  });

  it("a folded lane stops recursion (its own row still renders)", () => {
    const folded = new Set(["d1"]);
    const keys = flattenBoard(board4(), "", (id) => folded.has(id)).map((r) => r.key);
    expect(keys).toEqual(["r1", "d1"]);
  });

  it("search keeps only paths to matching leaves and ignores folding", () => {
    const folded = new Set(["d1"]); // search overrides folding
    const rows = flattenBoard(board4(), "b4", (id) => folded.has(id));
    expect(rows.map((r) => r.key)).toEqual(["r1", "d1", "s2"]); // no add rows, no s1
    const s2 = rows[2];
    if (s2.kind === "cards-lane") {
      expect(s2.cards.map((c) => c.id)).toEqual(["b4"]);
      expect(s2.leafCount).toBe(1); // unfiltered count of s2's children
    } else {
      throw new Error("expected cards-lane");
    }
  });

  it("a hidden sibling stacks onto the previous row instead of rendering", () => {
    const board = board4();
    find(board, "s2")!.hidden = true;
    const rows = flattenBoard(board, "");
    expect(rows.map((r) => r.key)).not.toContain("s2");
    const s1 = rows.find((r) => r.key === "s1");
    if (s1 && (s1.kind === "lane" || s1.kind === "cards-lane")) {
      expect(s1.stack).toEqual(["s2"]);
    } else {
      throw new Error("expected s1 row");
    }
  });

  it("a hidden node with no preceding sibling renders normally (orphan)", () => {
    const board = board4();
    find(board, "s1")!.hidden = true; // first sibling: nothing to stack onto
    const keys = flattenBoard(board, "").map((r) => r.key);
    expect(keys).toContain("s1");
  });
});

describe("nesting cards in the row list", () => {
  /* A nesting card is a CARD at every tier, so above the leaf it gets its
   * own row kind rather than becoming a band -- a band's whole visual
   * promise is that a lane hangs below it, and this can never have one. */
  const withNest = (id: string) => {
    const b = board4();
    const walk = (nodes: import("../state/types").Node[]): boolean => {
      for (const n of nodes) {
        if (n.id === id) {
          n.boardRef = "bd2";
          n.boardRefTitle = "Reel 3 -- Grief";
          n.children = [];
          return true;
        }
        if (walk(n.children)) return true;
      }
      return false;
    };
    walk(b.roots);
    return b;
  };

  it("a nested lane-tier node becomes ONE nested row, not a band", () => {
    const rows = flattenBoard(withNest("d1"), "");
    expect(rows.map((r) => r.key)).toEqual(["r1", "d1"]);
    expect(rows[1].kind).toBe("nested");
  });

  it("a nested leaf-PARENT node is a nested row, not an empty cards-lane", () => {
    const rows = flattenBoard(withNest("s1"), "");
    expect(rows.map((r) => `${r.key}:${r.kind}`)).toEqual([
      "r1:lane",
      "d1:lane",
      "s1:nested",
      "s2:cards-lane",
    ]);
  });

  it("...and still carries the closes-here stamps its seam reads", () => {
    const rows = flattenBoard(withNest("s2"), "");
    const s2 = rows.find((r) => r.key === "s2");
    if (s2?.kind !== "nested") throw new Error("expected a nested row");
    expect(s2.last).toBe(true);
    expect(s2.siblingCount).toBe(2);
    expect(s2.above.map((a) => a.id)).toEqual(["r1", "d1"]);
  });

  /* At the LEAF tier there is no nested row: the card already lives in
   * its parent's strip, and Card draws the nesting face there. */
  it("a nested LEAF stays a card in its lane's strip", () => {
    const rows = flattenBoard(withNest("b2"), "");
    const s1 = rows.find((r) => r.key === "s1");
    if (s1?.kind !== "cards-lane") throw new Error("expected a cards-lane");
    expect(s1.cards.map((c) => c.id)).toEqual(["b1", "b2", "b3"]);
  });
});
