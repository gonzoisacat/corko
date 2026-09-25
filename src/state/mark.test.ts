import { describe, expect, it } from "vitest";
import {
  designPins,
  pickSplashDesign,
  pinColor,
  resizeDesign,
  sizeOf,
  sameDesign,
  sanitizeDesign,
  sanitizeMark,
  setPinColor,
  toggleCell,
} from "./mark";

/* The pinboard designer's model: what a design is and how it is checked. */
const c = { cells: [".####.", "##...#", "##....", "##....", "##...#", ".####."], board: "#1d2027", pin: "#9ec5ff" };

describe("a mark design", () => {
  it("lists its pins in reading order and toggles cells, dropping a pulled pin's color", () => {
    expect(designPins(c)).toHaveLength(18);
    expect(designPins(c)[0]).toEqual({ x: 1, y: 0 });
    let d = toggleCell(c, 0, 0);
    expect(d.cells[0]).toBe("#####.");
    d = setPinColor(d, 0, 0, "#ff0000");
    expect(pinColor(d, 0, 0)).toBe("#ff0000");
    expect(pinColor(d, 1, 0)).toBe("#9ec5ff");
    d = toggleCell(d, 0, 0);
    expect(d.cells[0]).toBe(".####.");
    expect(d.pins).toEqual({});
  });

  it("sanitizes anything into six rows of six with real colors, or nothing", () => {
    expect(sanitizeDesign(null)).toBeNull();
    expect(sanitizeDesign({ cells: "nope" })).toBeNull();
    const d = sanitizeDesign({
      cells: ["#", "..........#", 7, "######"],
      board: "red",
      pin: "#ABCDEF",
      pins: { "0,0": "#ff0000", "5,5": "#00ff00", "1,3": "#0000ff", junk: "#123456" },
    })!;
    expect(d.cells).toEqual(["#.....", "......", "......", "######", "......", "......"]);
    expect(d.board).toBe("#1d2027");
    expect(d.pin).toBe("#ABCDEF");
    expect(d.pins).toEqual({ "0,0": "#ff0000", "1,3": "#0000ff" }); // 5,5 is bare board
  });

  it("compares by content", () => {
    expect(sameDesign(c, { ...c, pins: {} })).toBe(true);
    expect(sameDesign(c, toggleCell(c, 0, 0))).toBe(false);
    expect(sameDesign(c, null)).toBe(false);
  });

  it("the project's mark state keeps an override and a bounded pool, or is absent", () => {
    expect(sanitizeMark(undefined)).toBeUndefined();
    expect(sanitizeMark({ override: null, pool: [] })).toBeUndefined();
    const m = sanitizeMark({ override: c, pool: [c, { cells: [] }, "x"] })!;
    expect(m.override?.cells).toEqual(c.cells);
    expect(m.pool).toHaveLength(2); // the empty grid survives as all-board; "x" does not
  });
});

describe("what the splash lands on", () => {
  const a = { ...c, pin: "#ff0000" };
  const b = { ...c, pin: "#00ff00" };

  it("an override always wins, Fun or not", () => {
    expect(pickSplashDesign({ override: a, pool: [b] }, false, 12)).toBe(a);
    expect(pickSplashDesign({ override: a }, true, 12, () => 0.99)).toBe(a);
  });

  it("without Fun the pool sits out; with Fun each design is one ticket beside the pairings", () => {
    expect(pickSplashDesign({ pool: [a, b] }, false, 12)).toBeNull();
    // 12 pairings + 2 designs = 14 tickets: the first 12 are pairings
    expect(pickSplashDesign({ pool: [a, b] }, true, 12, () => 0)).toBeNull();
    expect(pickSplashDesign({ pool: [a, b] }, true, 12, () => 11.9 / 14)).toBeNull();
    expect(pickSplashDesign({ pool: [a, b] }, true, 12, () => 12.1 / 14)).toBe(a);
    expect(pickSplashDesign({ pool: [a, b] }, true, 12, () => 13.5 / 14)).toBe(b);
    expect(pickSplashDesign({}, true, 12)).toBeNull();
  });
});

describe("a design's grid size", () => {
  it("defaults to the C's six, reads 5..8, and resizes anchored top-left", () => {
    expect(sizeOf(c)).toBe(6);
    const big = resizeDesign({ ...c, pins: { "5,0": "#ff0000" } }, 8);
    expect(sizeOf(big)).toBe(8);
    expect(big.cells).toHaveLength(8);
    expect(big.cells[0]).toBe(".####...");
    expect(big.pins).toEqual({}); // "5,0" is bare board in the C (row 0 = .####.)
    const small = resizeDesign({ ...c, pins: { "1,0": "#ff0000", "5,4": "#00ff00" } }, 5);
    expect(small.cells).toEqual([".####", "##...", "##...", "##...", "##..."]);
    expect(small.pins).toEqual({ "1,0": "#ff0000" }); // 5,4 fell off the edge
    expect(sizeOf(resizeDesign(c, 2))).toBe(1); // nothing between 1 and 5
    expect(sizeOf(resizeDesign(c, 20))).toBe(8);
    const one = resizeDesign({ ...c, pins: { "0,0": "#ff0000", "1,1": "#00ff00" } }, 1);
    expect(sizeOf(one)).toBe(1);
    expect(one.cells).toEqual([c.cells[0][0] === "#" ? "#" : "."]);
    expect(Object.keys(one.pins ?? {})).toEqual(c.cells[0][0] === "#" ? ["0,0"] : []);
  });

  it("sanitize honors a stored size and clamps a wild one", () => {
    const d = sanitizeDesign({ size: 7, cells: ["#"], board: "#000000", pin: "#ffffff", pins: { "6,0": "#ff0000", "0,0": "#00ff00" } })!;
    expect(d.size).toBe(7);
    expect(d.cells).toHaveLength(7);
    expect(d.cells[0]).toBe("#......");
    expect(d.pins).toEqual({ "0,0": "#00ff00" });
    expect(sanitizeDesign({ size: 99, cells: [] })!.size).toBe(8);
  });
});
