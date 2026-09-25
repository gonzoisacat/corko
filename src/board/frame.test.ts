import { describe, expect, it } from "vitest";
import { MIN_FRAME_MARGIN, frameMargin, smallestGridCardH } from "./frame";
import { CELL, DEFAULT_SPAN } from "../state/gridBoard";
import type { Board, Node } from "../state/types";

const node = (id: string, span?: { w: number; h: number }): Node =>
  ({ id, title: id, children: [], ...(span ? { span } : {}) }) as unknown as Node;
const board = (roots: Node[]): Board => ({ id: "g", title: "g", type: "grid", levels: [], roots }) as unknown as Board;

/* The owner's rule: half the smallest card, down to a floor. */
describe("frameMargin", () => {
  it("is half the smallest card's height", () => {
    expect(frameMargin(112)).toBe(56);
    expect(frameMargin(103)).toBe(52);
  });
  it("never goes below the floor", () => {
    expect(frameMargin(30)).toBe(MIN_FRAME_MARGIN);
    expect(frameMargin(0)).toBe(MIN_FRAME_MARGIN);
  });
});

describe("smallestGridCardH", () => {
  it("reads the shortest span on the board", () => {
    const b = board([node("a", { w: 6, h: 4 }), node("b", { w: 4, h: 2 })]);
    expect(smallestGridCardH(b)).toBe(2 * CELL);
  });
  it("is the default span on an empty board", () => {
    expect(smallestGridCardH(board([]))).toBe(DEFAULT_SPAN.h * CELL);
  });
});
