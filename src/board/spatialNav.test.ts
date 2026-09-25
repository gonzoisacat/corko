import { describe, expect, it } from "vitest";
import { pickSpatial, type NavRect } from "./spatialNav";

/* ------------------------------------------------------------------ *
 *  A synthetic Overview: a spine, then two columns, each a scene card
 *  with a wrapped strip of beats beside it. Coordinates are the real
 *  shape -- scene cards at the column's left edge, beats running right,
 *  wrapped rows stacked below.
 *
 *      x:  0    30      90   130  170     230    290  330  370
 *  y 0     |sp| [scene1] [b1][b2][b3]     [scene3][b7][b8]
 *  y 40    |sp|          [b4][b5][b6]             [b9]
 *  y 90    |sp| [scene2] [c1][c2]
 * ------------------------------------------------------------------ */

const r = (id: string, x: number, y: number, w = 36, h = 30): NavRect => ({ id, x, y, w, h });

const CELLS: NavRect[] = [
  r("spine", 0, 0, 20, 130),
  r("scene1", 30, 0, 50, 30),
  r("b1", 90, 0),
  r("b2", 130, 0),
  r("b3", 170, 0),
  r("b4", 90, 40),
  r("b5", 130, 40),
  r("b6", 170, 40),
  r("scene2", 30, 90, 50, 30),
  r("c1", 90, 90),
  r("c2", 130, 90),
  r("scene3", 230, 0, 50, 30),
  r("b7", 290, 0),
  r("b8", 330, 0),
  r("b9", 290, 40),
];
const at = (id: string) => CELLS.find((c) => c.id === id)!;
const go = (id: string, dir: Parameters<typeof pickSpatial>[0]) =>
  pickSpatial(dir, at(id), CELLS);

describe("pickSpatial", () => {
  it("Right steps along a beat row", () => {
    expect(go("b1", "right")).toBe("b2");
    expect(go("b2", "right")).toBe("b3");
  });

  it("a scene's Right is its own first beat", () => {
    expect(go("scene1", "right")).toBe("b1");
    expect(go("scene2", "right")).toBe("c1");
  });

  /* The whole point of the change: the row model wrapped the END of a
   * row onto the START of the next line, which in the Overview means
   * flying from the bottom of one column to the top of the next. On a
   * surface, right of the last beat is the NEXT COLUMN. */
  it("Right off the end of a row crosses to the next column, not down a line", () => {
    expect(go("b3", "right")).toBe("scene3");
    expect(go("b8", "right")).toBeNull(); // nothing further right: stay put
  });

  it("a scene's Left is the column beside it", () => {
    expect(go("scene3", "left")).toBe("b3"); // nearest card in the column to its left
    expect(go("scene1", "left")).toBe("spine"); // ...and the spine bounds the first
    expect(go("spine", "left")).toBeNull();
  });

  it("Down is the row below, in the same place across", () => {
    expect(go("b1", "down")).toBe("b4");
    expect(go("b2", "down")).toBe("b5");
    expect(go("b5", "down")).toBe("c2"); // next scene's strip, same column
  });

  it("Up mirrors it", () => {
    expect(go("b4", "up")).toBe("b1");
    expect(go("c1", "up")).toBe("b4");
    expect(go("b1", "up")).toBeNull();
  });

  it("prefers a card in your own band over a nearer one off to the side", () => {
    // b7 is level with b3's band; scene3 starts closer in x but so does b7
    expect(go("b3", "right")).toBe("scene3");
    // from b6 (second row), the aligned neighbour is b9, not scene3 above it
    expect(go("b6", "right")).toBe("b9");
  });

  /* A SPINE is a 300px bar beside 30px cards. Center-based gates put its
   * middle halfway down the column, so Right from it landed mid-column
   * and Down from the last scene climbed back into it. */
  it("treats a tall spine as the long thing it is", () => {
    expect(go("spine", "right")).toBe("scene1"); // the TOP of the column, not its middle
    expect(go("scene2", "down")).toBeNull(); // the spine reaches lower, but starts above
  });

  it("never returns the cell you're on, and copes with an empty surface", () => {
    for (const dir of ["left", "right", "up", "down"] as const) {
      expect(go("b5", dir)).not.toBe("b5");
      expect(pickSpatial(dir, at("b5"), [])).toBeNull();
    }
  });

  it("a lone cell has nowhere to go in any direction", () => {
    const only = [r("solo", 0, 0)];
    for (const dir of ["left", "right", "up", "down"] as const) {
      expect(pickSpatial(dir, only[0], only)).toBeNull();
    }
  });
});
