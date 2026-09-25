import { beforeEach, describe, expect, it } from "vitest";
import { board4, level } from "../test/fixtures";
import type { Board } from "./types";
import { fold } from "./fold";

/* localStorage doesn't exist in the node runner; fold degrades to
 * in-memory (its persistence is wrapped in try/catch), which is exactly
 * what these tests need. */

beforeEach(() => {
  fold.foldToTier(board4(), 99); // deeper than any tier = expand all
});

describe("fold store", () => {
  it("toggle flips a single lane", () => {
    expect(fold.isCollapsed("d1")).toBe(false);
    fold.toggle("d1");
    expect(fold.isCollapsed("d1")).toBe(true);
    fold.toggle("d1");
    expect(fold.isCollapsed("d1")).toBe(false);
  });

  it("foldToTier(0) collapses every lane; foldToTier(leaf) expands all", () => {
    const board = board4();
    fold.foldToTier(board, 0);
    // r1 (depth 0), d1 (1), s1/s2 (2) are lanes with children; beats are not
    for (const id of ["r1", "d1", "s1", "s2"]) expect(fold.isCollapsed(id)).toBe(true);
    expect(fold.isCollapsed("b1")).toBe(false);

    fold.foldToTier(board, 3); // leaf tier = fully unfurled
    for (const id of ["r1", "d1", "s1", "s2"]) expect(fold.isCollapsed(id)).toBe(false);
  });

  it("foldToTier(mid) shows down to that tier, collapsed", () => {
    const board = board4();
    fold.foldToTier(board, 1); // sections visible but furled
    expect(fold.isCollapsed("r1")).toBe(false);
    expect(fold.isCollapsed("d1")).toBe(true);
    expect(fold.isCollapsed("s1")).toBe(true);
  });

  it("reveal expands exactly the target's ancestors", () => {
    const board = board4();
    fold.foldToTier(board, 0); // everything furled
    fold.reveal(board, "b4"); // b4 lives in r1 > d1 > s2
    expect(fold.isCollapsed("r1")).toBe(false);
    expect(fold.isCollapsed("d1")).toBe(false);
    expect(fold.isCollapsed("s2")).toBe(false);
    expect(fold.isCollapsed("s1")).toBe(true); // sibling stays furled
  });
});

/* ------------------------------------------------------------------ *
 *  unfurlBoard: open ONE board up without touching another's folds.
 *  foldToTier can't serve here -- it replaces the whole set, so
 *  unfurling board A would drop the folds you set up in board B.
 * ------------------------------------------------------------------ */
describe("unfurlBoard", () => {
  const boardWith = (ids: string[]): Board => ({
    id: "bd",
    title: "b",
    levels: [level("lane"), level("card")],
    legend: [],
    roots: [
      {
        id: ids[0],
        title: "lane",
        collapsed: false,
        children: ids.slice(1).map((id) => ({ id, title: "c", collapsed: false, children: [] })),
      },
    ],
  });

  it("clears this board's folds and leaves every other id alone", () => {
    fold.toggle("a-lane");
    fold.toggle("a-kid");
    fold.toggle("b-lane"); // a different board's fold
    fold.unfurlBoard(boardWith(["a-lane", "a-kid"]));
    expect(fold.isCollapsed("a-lane")).toBe(false);
    expect(fold.isCollapsed("a-kid")).toBe(false);
    expect(fold.isCollapsed("b-lane")).toBe(true); // untouched
  });

  it("is a no-op on a board that was never folded", () => {
    fold.toggle("other");
    fold.unfurlBoard(boardWith(["fresh-lane", "fresh-kid"]));
    expect(fold.isCollapsed("other")).toBe(true);
  });
});
