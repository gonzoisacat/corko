import { describe, expect, it } from "vitest";
import { level, node } from "../test/fixtures";
import type { Board, Node } from "./types";
import {
  CELL,
  DEFAULT_SPAN,
  SPAN_MAX,
  SPAN_MIN,
  PIN_INSET,
  clampCell,
  readingOrder,
  DEFAULT_YARN_WIDTH,
  YARN_WIDTHS,
  cardsOverlap,
  nearestYarnWidth,
  clampSpan,
  edgeBetween,
  overlappedBy,
  gridCards,
  gridExtent,
  landCells,
  gridBounds,
  viewOrigin,
  liveEdges,
  pinOf,
  placedCell,
  spanOf,
  yarnWidth,
} from "./gridBoard";

const at = (id: string, x: number, y: number, w?: number, h?: number): Node => ({
  ...node(id),
  cell: { x, y },
  ...(w && h ? { span: { w, h } } : {}),
});

const board = (roots: Node[], edges?: Board["edges"]): Board => ({
  id: "bd1",
  title: "Grid",
  type: "grid",
  levels: [level("card", "Card")],
  legend: [],
  roots,
  ...(edges ? { edges } : {}),
});

describe("free grid: the lattice", () => {
  it("a cell is whole and never negative -- a card cannot be dragged off the board", () => {
    expect(clampCell({ x: 3.4, y: 7.6 })).toEqual({ x: 3, y: 8 });
    expect(clampCell({ x: -5, y: -0.2 })).toEqual({ x: 0, y: 0 });
  });

  it("a span is whole and bounded, which is what keeps 'wide variance' on the grid", () => {
    expect(clampSpan({ w: 1, h: 999 })).toEqual({ w: SPAN_MIN, h: SPAN_MAX });
    expect(clampSpan({ w: 6.4, h: 4.5 })).toEqual({ w: 6, h: 5 });
    // the range the owner asked for: roughly 3x a detail card's ~180px
    expect(SPAN_MAX * CELL).toBeGreaterThan(560);
    expect(SPAN_MIN * CELL).toBeLessThan(60);
  });

  it("an unplaced card is PARKED in document order, not dropped", () => {
    // no `cell` at all -- what every card looks like the moment it is added
    expect(placedCell(node("a"), 0, 3)).toEqual({ x: 0, y: 0 });
    expect(placedCell(node("b"), 1, 3)).toEqual({ x: DEFAULT_SPAN.w + 1, y: 0 });
    expect(placedCell(node("d"), 3, 3)).toEqual({ x: 0, y: DEFAULT_SPAN.h + 1 });
  });

  it("...and a placed card ignores its index entirely", () => {
    expect(placedCell(at("a", 9, 2), 5, 3)).toEqual({ x: 9, y: 2 });
  });

  it("spanOf falls back to the default rather than to nothing", () => {
    expect(spanOf(node("a"))).toEqual(DEFAULT_SPAN);
    expect(spanOf(at("a", 0, 0, 10, 3))).toEqual({ w: 10, h: 3 });
  });

  it("gridCards keeps document order -- which IS paint order, so overlap stacks", () => {
    const cards = gridCards(board([at("a", 0, 0), at("b", 0, 0)]));
    expect(cards.map((c) => c.node.id)).toEqual(["a", "b"]);
    // the two deliberately occupy the same cell: overlapping is allowed
    expect(cards[0].cell).toEqual(cards[1].cell);
  });

  it("the surface is always bigger than its content, so there is room to drag into", () => {
    const ext = gridExtent(gridCards(board([at("a", 4, 3, 6, 4)])));
    expect(ext.w).toBeGreaterThan(4 + 6);
    expect(ext.h).toBeGreaterThan(3 + 4);
  });

  /* THE POINT THE YARN TIES TO IS THE POINT THE PIN IS DRAWN AT, and
   * this is the assertion rather than a coordinate: they were 14px apart
   * once (the pin sat on the card's top EDGE while the string met the
   * cork a half-cell down) and a string that misses its own pin reads as
   * broken. PIN_INSET is the one number, shared with the CSS. */
  it("a pin is horizontally centered, and vertically at PIN_INSET", () => {
    const p = pinOf({ node: node("a"), index: 0, cell: { x: 4, y: 2 }, span: { w: 6, h: 4 } });
    expect(p.x).toBe(7); // 4 + 6/2
    expect(p.y).toBeCloseTo(2 + PIN_INSET / CELL, 6);
    // ...and that inset is INSIDE the card, near its top edge -- the
    // same place `.beat::before` puts a pushpin on every other surface
    expect(PIN_INSET).toBeGreaterThan(0);
    expect(PIN_INSET).toBeLessThan(CELL / 2);
  });
});

describe("free grid: yarn", () => {
  const two = [at("a", 0, 0), at("b", 10, 0)];

  it("drops a string whose endpoint is not on the board", () => {
    const b = board(two, [
      { id: "y1", from: "a", to: "b", color: "#c0392b" },
      { id: "y2", from: "a", to: "ghost", color: "#c0392b" },
    ]);
    expect(liveEdges(b).map((e) => e.id)).toEqual(["y1"]);
  });

  it("answers empty for a board with no yarn at all", () => {
    expect(liveEdges(board(two))).toEqual([]);
  });

  /* Undirected for "are these joined", because two cards strung twice is
   * a mistake rather than a stronger connection -- while the stored edge
   * keeps its from/to so the drawing has a direction to sag along. */
  it("edgeBetween is undirected", () => {
    const edges = [{ id: "y1", from: "a", to: "b", color: "#000" }];
    expect(edgeBetween(edges, "a", "b")?.id).toBe("y1");
    expect(edgeBetween(edges, "b", "a")?.id).toBe("y1");
    expect(edgeBetween(edges, "a", "c")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 *  STACKING. Paint order is document order, so all of this is ordinary
 *  reordering -- these pin the RULES that decide when to reorder, which
 *  is the part with judgement in it.
 * ------------------------------------------------------------------ */

/* A PLACED card: the node carries its cell, as every card somebody has
 * put down does (an unplaced one has none and is merely parked). */
const card = (id: string, x: number, y: number, w = 6, h = 4) => ({
  node: { ...node(id), cell: { x, y } },
  index: 0,
  cell: { x, y },
  span: { w, h },
});

describe("cardsOverlap", () => {
  it("cards covering the same cork overlap", () => {
    expect(cardsOverlap(card("a", 0, 0), card("b", 3, 2))).toBe(true);
  });

  it("cards far apart do not", () => {
    expect(cardsOverlap(card("a", 0, 0), card("b", 20, 20))).toBe(false);
  });

  it("TOUCHING EDGES DO NOT COUNT, and that is the point", () => {
    /* Cards sit flush on a lattice all the time. If abutting counted, a
     * drag that merely parked a card next to another would reorder the
     * document -- exactly the churn the overlap rule exists to avoid. */
    expect(cardsOverlap(card("a", 0, 0, 6, 4), card("b", 6, 0, 6, 4))).toBe(false);
    expect(cardsOverlap(card("a", 0, 0, 6, 4), card("b", 0, 4, 6, 4))).toBe(false);
    // one cell of genuine cover does
    expect(cardsOverlap(card("a", 0, 0, 6, 4), card("b", 5, 0, 6, 4))).toBe(true);
  });

  it("a card fully inside another overlaps it", () => {
    expect(cardsOverlap(card("a", 0, 0, 12, 10), card("b", 3, 3, 2, 2))).toBe(true);
  });
});

describe("overlappedBy: did this drag earn a reorder?", () => {
  const wall = [card("a", 0, 0), card("b", 20, 0), card("c", 3, 2)];

  it("names the cards the moved one now covers", () => {
    expect(overlappedBy(wall, new Set(["a"])).map((c) => c.node.id)).toEqual(["c"]);
  });

  it("is empty when it landed on bare cork -- so the order is left alone", () => {
    expect(overlappedBy(wall, new Set(["b"]))).toEqual([]);
  });

  it("never counts the moved cards against each other", () => {
    /* Dragging a selection, the cards keep their own arrangement and may
     * well overlap one another; that is not landing on something. */
    expect(overlappedBy(wall, new Set(["a", "c"]))).toEqual([]);
  });
});



describe("yarnWidth: how thick a string draws", () => {
  it("an edge with no width is the default -- which is every edge that predates this", () => {
    expect(yarnWidth({})).toBe(DEFAULT_YARN_WIDTH);
    expect(yarnWidth({ width: undefined })).toBe(DEFAULT_YARN_WIDTH);
  });

  it("an offered width is used as given", () => {
    for (const w of YARN_WIDTHS) expect(yarnWidth({ width: w })).toBe(w);
  });

  it("A WIDTH NOTHING OFFERS SNAPS TO THE NEAREST, keeping the intent", () => {
    /* It used to fall back to the DEFAULT, and that was wrong in the case
     * that actually happened: the range was 2-7.5 for an hour, and a live
     * string somebody had deliberately made fat went quietly back to
     * normal when the presets narrowed. Nearest keeps what they meant. */
    expect(yarnWidth({ width: 7.5 })).toBe(5); // a retired fat preset -> the fattest
    expect(yarnWidth({ width: 2 })).toBe(2.5); // a retired thin one -> the thinnest
    expect(yarnWidth({ width: 99 })).toBe(5);
    expect(yarnWidth({ width: 0 })).toBe(2.5);
    expect(yarnWidth({ width: -3 })).toBe(2.5);
  });

  it("...but nonsense that is not a number is the default, not a guess", () => {
    expect(yarnWidth({ width: NaN })).toBe(DEFAULT_YARN_WIDTH);
    expect(nearestYarnWidth(Infinity)).toBe(DEFAULT_YARN_WIDTH);
  });

  it("nearestYarnWidth returns an OFFERED width, always", () => {
    for (const n of [-5, 0, 2, 2.6, 3.9, 4.4, 6, 100]) {
      expect(YARN_WIDTHS).toContain(nearestYarnWidth(n));
    }
  });

  it("the range runs from the pre-thickening weight to the old second step", () => {
    expect(YARN_WIDTHS[0]).toBe(2.5); // what the yarn shipped at
    expect(YARN_WIDTHS[YARN_WIDTHS.length - 1]).toBe(5);
    expect(YARN_WIDTHS).toHaveLength(4);
    // strictly increasing, or the row would read as a jumble
    for (let i = 1; i < YARN_WIDTHS.length; i++) {
      expect(YARN_WIDTHS[i]).toBeGreaterThan(YARN_WIDTHS[i - 1]);
    }
  });

  it("the default is one of the offered widths, so the row can show it as active", () => {
    expect(YARN_WIDTHS).toContain(DEFAULT_YARN_WIDTH);
  });
});

describe("landCells: the board expands in any direction by re-anchoring", () => {
  const wall = [card("a", 0, 0), card("b", 10, 6), card("c", 4, 2)];

  it("a drag that stays on the board writes ONLY the moved cards, no shift", () => {
    const { cells, shift } = landCells(wall, new Map([["c", { x: 7, y: 3 }]]));
    expect(shift).toEqual({ x: 0, y: 0 });
    expect(Object.keys(cells)).toEqual(["c"]);
    expect(cells.c).toEqual({ x: 7, y: 3 });
  });

  it("a re-anchor leaves a PARKED card parked rather than pinning it", () => {
    const parked = {
      node: { id: "p", title: "", collapsed: false, children: [] },
      index: 3,
      cell: { x: 0, y: 0 },
      span: { w: 6, h: 3 },
    };
    const { cells, shift } = landCells([...wall, parked], new Map([["a", { x: -1, y: 0 }]]));
    expect(shift).toEqual({ x: 1, y: 0 });
    expect(cells.b).toEqual({ x: 11, y: 6 });
    expect(cells.p).toBeUndefined();
  });

  it("a release past the top-left shifts EVERY card so the newcomer lands at zero", () => {
    const { cells, shift } = landCells(wall, new Map([["a", { x: -3, y: -2 }]]));
    expect(shift).toEqual({ x: 3, y: 2 });
    expect(cells.a).toEqual({ x: 0, y: 0 });
    // the others keep their RELATIVE positions -- the origin moved, not them
    expect(cells.b).toEqual({ x: 13, y: 8 });
    expect(cells.c).toEqual({ x: 7, y: 4 });
  });

  it("cells stay non-negative whatever comes in -- the doc invariant holds", () => {
    const { cells } = landCells(wall, new Map([["a", { x: -3, y: -2 }], ["c", { x: -1, y: 5 }]]));
    for (const c of Object.values(cells)) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("works for ids not yet on the board -- the option-drag's copies", () => {
    const { cells, shift } = landCells(wall, new Map([["minted", { x: -2, y: 1 }]]));
    expect(shift).toEqual({ x: 2, y: 0 });
    expect(cells.minted).toEqual({ x: 0, y: 1 });
    expect(cells.a).toEqual({ x: 2, y: 0 }); // originals ride the shift
  });

  it("rounds fractional targets to the lattice", () => {
    const { cells } = landCells(wall, new Map([["c", { x: 6.6, y: 2.4 }]]));
    expect(cells.c).toEqual({ x: 7, y: 2 });
  });
});

describe("readingOrder: a wall reads top down, then left to right", () => {
  /* `board()` is already a grid; this is the same shape as any other
   * type, to prove the helper is a no-op off the free grid. */
  const cutBoard = (nodes: Node[]): Board => ({ ...board(nodes), type: "cut" });
  const titles = (b: Board) => readingOrder(b).map((n) => n.title);

  it("sorts by y first, then x", () => {
    /* Deliberately built in an order no sort could produce by accident. */
    const b = board([at("c", 9, 9), at("a", 0, 0), at("d", 2, 9), at("b", 7, 0)]);
    b.roots.forEach((n, i) => (n.title = ["c", "a", "d", "b"][i]));
    expect(titles(b)).toEqual(["a", "b", "d", "c"]);
  });

  it("LEAVES ROOTS ALONE -- paint order, and so stacking, is untouched", () => {
    const b = board([at("c", 9, 9), at("a", 0, 0)]);
    const before = b.roots.map((n) => n.id);
    readingOrder(b);
    expect(b.roots.map((n) => n.id)).toEqual(before);
  });

  it("is UNCHANGED by a restack, which is the bug it exists to fix", () => {
    const b = board([at("a", 0, 0), at("b", 5, 0)]);
    b.roots.forEach((n, i) => (n.title = ["a", "b"][i]));
    const first = titles(b);
    /* What dragging a card on top of another does: move it to the end
     * of roots so it paints last. Position has not changed. */
    b.roots.push(b.roots.shift()!);
    expect(titles(b)).toEqual(first);
  });

  it("places an UNPLACED card where it is parked, not as a blank", () => {
    const placed = at("p", 0, 40);
    /* `node()` builds a card with no `cell` -- which IS an unplaced
     * card, the state every card is in the moment it is added. */
    const bare: Node = { ...node("u"), title: "u" };
    const b = board([bare, placed]);
    placed.title = "p";
    /* The unplaced card parks at the origin, so it reads before a card
     * sitting forty cells down -- the same answer the renderer draws. */
    expect(titles(b)).toEqual(["u", "p"]);
  });

  it("returns document order untouched for every other board type", () => {
    const b = cutBoard([at("c", 9, 9), at("a", 0, 0)]);
    expect(readingOrder(b).map((n) => n.id)).toEqual(b.roots.map((n) => n.id));
  });
});

describe("the view's window starts at the content", () => {
  it("bounds are the cards' box, and the origin backs off by the margin", () => {
    const wall = [card("a", 40, 30), card("b", 60, 50, 6, 4)];
    expect(gridBounds(wall)).toEqual({ minX: 40, minY: 30, maxX: 66, maxY: 54 });
    expect(viewOrigin(gridBounds(wall))).toEqual({ x: 32, y: 24 });
    expect(gridBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  /* THE MARGIN EXISTS BEFORE CELL ZERO TOO (owner, 2026-09-11). It used
   * to clamp there, so a board whose content began in the corner sat
   * flush against the pane on two sides. A negative origin is the sheet
   * offset into the window by the margin; cards still never go negative. */
  it("backs off past zero, so content in the corner still gets its margin", () => {
    expect(viewOrigin(gridBounds([card("a", 3, 2)]))).toEqual({ x: 3 - 8, y: 2 - 6 });
    expect(viewOrigin(gridBounds([card("a", 0, 0)]))).toEqual({ x: -8, y: -6 });
    expect(viewOrigin(gridBounds([card("a", 0, 0)]), { w: 0, h: 0 })).toEqual({ x: 0, y: 0 }); // framed: no slack
  });
});
