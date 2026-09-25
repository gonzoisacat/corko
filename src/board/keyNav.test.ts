import { describe, expect, it } from "vitest";
import { board4 } from "../test/fixtures";
import { deleteSurvivor, keyTarget, locateCell, navRows, rowEnd } from "./keyNav";

/* ------------------------------------------------------------------ *
 *  The keyboard cursor's map (keyNav.ts): a spreadsheet of cells over
 *  the board's VISUAL lines. Left/Right walk a line and wrap at its
 *  ends; Up/Down move one line keeping the column -- straight down when
 *  a cell sits there, leftward to the nearest one when the line below is
 *  shorter. A scene's beat strip contributes one line per WRAPPED row
 *  (maxRowBeats + manual breaks), exactly as the board draws it.
 *
 *  board4 (cap 8, nothing wrapped):
 *    [r1]  [d1]  [s1 b1 b2 b3]  [s2 b4]
 * ------------------------------------------------------------------ */

const ids = (rows: { id: string }[][]) => rows.map((r) => r.map((c) => c.id));

describe("navRows", () => {
  it("flattens the board into visual lines with columns", () => {
    const rows = navRows(board4());
    expect(ids(rows)).toEqual([["r1"], ["d1"], ["s1", "b1", "b2", "b3"], ["s2", "b4"]]);
    // the scene is column 0; its beats count from 1
    expect(rows[2].map((c) => c.col)).toEqual([0, 1, 2, 3]);
  });

  it("wraps a beat strip at maxRowBeats, beats-only lines aligned to column 1", () => {
    const b = board4();
    b.maxRowBeats = 2;
    const rows = navRows(b);
    expect(ids(rows)).toEqual([["r1"], ["d1"], ["s1", "b1", "b2"], ["b3"], ["s2", "b4"]]);
    expect(rows[3].map((c) => c.col)).toEqual([1]); // b3 sits under b1
  });

  it("wraps after a manual row break", () => {
    const b = board4();
    b.roots[0].children[0].children[0].children[0].breakAfter = true; // b1
    expect(ids(navRows(b))).toEqual([["r1"], ["d1"], ["s1", "b1"], ["b2", "b3"], ["s2", "b4"]]);
  });

  it("hidden (stacked-away) beats are not cells", () => {
    const b = board4();
    b.roots[0].children[0].children[0].children[1].hidden = true; // b2
    const rows = navRows(b);
    expect(ids(rows)[2]).toEqual(["s1", "b1", "b3"]);
    expect(rows[2].map((c) => c.col)).toEqual([0, 1, 2]); // b3 moves up a column
  });

  it("a folded scene collapses to its head; a folded header swallows its subtree", () => {
    expect(ids(navRows(board4(), (id) => id === "s1"))).toEqual([["r1"], ["d1"], ["s1"], ["s2", "b4"]]);
    expect(ids(navRows(board4(), (id) => id === "d1"))).toEqual([["r1"], ["d1"]]);
  });
});

describe("keyTarget", () => {
  const b = board4();

  it("starts at the first cell when nothing is selected (or the id is foreign)", () => {
    expect(keyTarget(b, null, "down")).toBe("r1");
    expect(keyTarget(b, "someone-elses-card", "left")).toBe("r1");
  });

  it("Down keeps the column: beat to the beat below, clamping leftward", () => {
    const w = board4();
    w.maxRowBeats = 2; // lines: [s1 b1 b2] [b3] [s2 b4]
    expect(keyTarget(w, "b1", "down")).toBe("b3"); // straight down (col 1)
    expect(keyTarget(w, "b2", "down")).toBe("b3"); // shorter line: travel left
    expect(keyTarget(w, "b3", "down")).toBe("b4"); // col 1 -> col 1 of the next scene's line
    expect(keyTarget(w, "s1", "down")).toBe("b3"); // scene: leftmost of its wrapped line
  });

  it("Up mirrors it", () => {
    const w = board4();
    w.maxRowBeats = 2;
    expect(keyTarget(w, "b3", "up")).toBe("b1"); // straight up
    expect(keyTarget(w, "b4", "up")).toBe("b3");
    expect(keyTarget(w, "s2", "up")).toBe("b3"); // col 0: nearest is the line's leftmost
    expect(keyTarget(w, "b1", "up")).toBe("d1"); // header line has one cell
  });

  it("Down from a scene goes to the next line, never into a same-line beat", () => {
    expect(keyTarget(b, "s1", "down")).toBe("s2"); // unwrapped: next line is the next scene
    expect(keyTarget(b, "b2", "down")).toBe("b4"); // col 2 clamps left to b4 (col 1)
    expect(keyTarget(b, "s2", "down")).toBeNull(); // bottom edge stays put
    expect(keyTarget(b, "r1", "up")).toBeNull();
  });

  it("Right walks the line -- scene into its first beat -- and wraps to the next line", () => {
    expect(keyTarget(b, "s1", "right")).toBe("b1");
    expect(keyTarget(b, "b3", "right")).toBe("s2"); // end of line -> next line
    expect(keyTarget(b, "d1", "right")).toBe("s1");
    expect(keyTarget(b, "b4", "right")).toBeNull(); // end of the last line
    const w = board4();
    w.maxRowBeats = 2;
    expect(keyTarget(w, "b2", "right")).toBe("b3"); // wrapped rows read in order
  });

  it("Left mirrors it, wrapping to the previous line's end", () => {
    expect(keyTarget(b, "b1", "left")).toBe("s1");
    expect(keyTarget(b, "s2", "left")).toBe("b3");
    expect(keyTarget(b, "r1", "left")).toBeNull();
  });

  it("navigation skips inside folded rows", () => {
    const folded = (id: string) => id === "s1";
    expect(keyTarget(b, "s1", "right", folded)).toBe("s2");
    expect(keyTarget(b, "s2", "left", folded)).toBe("s1");
  });
});

describe("rowEnd", () => {
  const b = board4(); // [r1] [d1] [s1 b1 b2 b3] [s2 b4]

  it("goes to the ends of the cursor's own line", () => {
    expect(rowEnd(b, "b2", "start")).toBe("s1"); // the scene heads its line
    expect(rowEnd(b, "s1", "end")).toBe("b3");
  });

  it("stays put when the cursor is already there, or is off the board", () => {
    expect(rowEnd(b, "b3", "end")).toBeNull();
    expect(rowEnd(b, "r1", "start")).toBeNull(); // a one-cell line
    expect(rowEnd(b, null, "end")).toBeNull();
    expect(rowEnd(b, "nope", "end")).toBeNull();
  });

  it("ends the WRAPPED row, not the whole strip", () => {
    const w = board4();
    w.maxRowBeats = 2; // [s1 b1 b2] [b3] [s2 b4]
    expect(rowEnd(w, "b1", "end")).toBe("b2");
    expect(rowEnd(w, "b3", "start")).toBeNull(); // its line holds only b3
  });
});

describe("deleteSurvivor", () => {
  const b = board4(); // [r1] [d1] [s1 b1 b2 b3] [s2 b4]

  it("lands on the next cell after the selection, in reading order", () => {
    expect(deleteSurvivor(b, ["b1"])).toBe("b2");
    expect(deleteSurvivor(b, ["b1", "b2"])).toBe("b3");
  });

  it("falls back to the cell before when nothing follows", () => {
    expect(deleteSurvivor(b, ["b4"])).toBe("s2");
    expect(deleteSurvivor(b, ["s2"])).toBe("b3"); // s2's subtree dies with it
  });

  it("never lands inside a deleted subtree", () => {
    // s1's beats sit AFTER s1 in reading order but die with it
    expect(deleteSurvivor(b, ["s1"])).toBe("s2");
    expect(deleteSurvivor(b, ["r1"])).toBeNull(); // the whole board dies
  });

  it("returns null for an empty or unknown selection", () => {
    expect(deleteSurvivor(b, [])).toBeNull();
    expect(deleteSurvivor(b, ["nope"])).toBeNull();
  });
});

/* What the keyboard has to re-derive that a renderer is handed: opening
 * the card menu (Space) needs the target's whole address, not just its
 * tier -- the same address Card/LaneHeader/ProxyNode pass to cardMenu. */
describe("locateCell", () => {
  const b = board4(); // r1 > d1 > s1 [b1 b2 b3], s2 [b4]

  it("finds a node's parent, index and tier", () => {
    expect(locateCell(b, "b2")).toMatchObject({ parentId: "s1", index: 1, depth: 3 });
    expect(locateCell(b, "s2")).toMatchObject({ parentId: "d1", index: 1, depth: 2 });
    expect(locateCell(b, "r1")).toMatchObject({ parentId: null, index: 0, depth: 0 });
    expect(locateCell(b, "nope")).toBeNull();
  });

  it("collects the hidden run stacked behind a card, and no further", () => {
    const w = board4();
    const beats = w.roots[0].children[0].children[0].children; // b1 b2 b3
    beats[1].hidden = true;
    beats[2].hidden = true;
    expect(locateCell(w, "b1")!.stacked).toEqual(["b2", "b3"]);
    expect(locateCell(w, "b2")!.stacked).toEqual(["b3"]); // a stacked card's own run
    expect(locateCell(b, "b1")!.stacked).toEqual([]); // nothing hidden: no stack
  });
});

/* ------------------------------------------------------------------ *
 *  With a search live, the board draws only what matches (flatten.ts)
 *  -- and the cursor has to walk exactly that. It used to walk the whole
 *  tree, so Down travelled to cards that weren't on screen, which reads
 *  as the arrows being broken.
 * ------------------------------------------------------------------ */
describe("navRows while searching", () => {
  it("keeps only matching beats, and only lanes that still hold one", () => {
    // board4: [r1] [d1] [s1 b1 b2 b3] [s2 b4]
    expect(ids(navRows(board4(), undefined, "b1"))).toEqual([["r1"], ["d1"], ["s1", "b1"]]);
    expect(ids(navRows(board4(), undefined, "b4"))).toEqual([["r1"], ["d1"], ["s2", "b4"]]);
  });

  it("renumbers the columns over the cards that survive", () => {
    const rows = navRows(board4(), undefined, "b3");
    expect(rows[2].map((c) => c.col)).toEqual([0, 1]); // b3 leads the strip now
  });

  it("IGNORES fold while searching, exactly as flatten does", () => {
    const folded = (id: string) => id === "s1" || id === "d1";
    expect(ids(navRows(board4(), folded, "b2"))).toEqual([["r1"], ["d1"], ["s1", "b2"]]);
  });

  it("an unmatched board has nowhere to go", () => {
    expect(navRows(board4(), undefined, "zzz")).toEqual([]);
    expect(keyTarget(board4(), "b1", "down", undefined, "zzz")).toBeNull();
  });

  it("the arrows travel only between visible cards", () => {
    const b = board4();
    expect(keyTarget(b, "s1", "right", undefined, "b3")).toBe("b3"); // skips b1, b2
    // ...and stop at the end of what's left: s2 holds no match, so it
    // isn't in the grid at all
    expect(keyTarget(b, "b3", "right", undefined, "b3")).toBeNull();
    // two scenes DO survive a query that matches in both
    expect(ids(navRows(b, undefined, "b"))).toEqual([
      ["r1"],
      ["d1"],
      ["s1", "b1", "b2", "b3"],
      ["s2", "b4"],
    ]);
  });

  /* s2 isn't in the filtered grid at all (no beat of its matches), so
   * the survivor is the card BEFORE -- the scene b3 was sitting in. */
  it("a delete lands on a card that is still on screen", () => {
    expect(deleteSurvivor(board4(), ["b3"], undefined, "b3")).toBe("s1");
  });
});
