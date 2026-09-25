import { describe, expect, it } from "vitest";
import { board4, node } from "../test/fixtures";
import { BAND_PITCH, GUTTER, gridFromBoard, HEAD_SPAN, LEAF_SPAN } from "./gridFrom";
import { GRID_LEVELS } from "./boardTypes";
import type { Board } from "./types";

/* board4: r1 > d1 > [ s1: b1 b2 b3, s2: b4 ]  (reel, section, scene, beat)
 * The Overview's shape, which is the grid's: a scene is a ROW -- its
 * card, then its beats to the RIGHT, wrapping at maxRowBeats -- and the
 * tiers above the scene stack down their column. */
const at = (b: Board, id: string) => b.roots.find((n) => n.id === id)!;
const LEAF_PITCH = LEAF_SPAN.w + GUTTER;
const BEATS_X = HEAD_SPAN.w + GUTTER; // where a scene's beats begin, from its card

describe("gridFromBoard", () => {
  it("is a new grid board, and never the source", () => {
    const src = board4();
    const g = gridFromBoard(src, { columnDepth: 2, detailDepth: 3 });
    expect(g.type).toBe("grid");
    expect(g.levels).toBe(GRID_LEVELS);
    expect(g.id).not.toBe(src.id);
    expect(g.title).toBe("Test board (Free Grid)");
    expect(src.roots[0].children.length).toBe(1); // the source is untouched
  });

  /* His decision, and the reason it is a copy: the grid's strings are
   * the ones you tie. */
  it("brings no yarn, ever", () => {
    expect(gridFromBoard(board4(), { columnDepth: 2, detailDepth: 3 }).edges).toEqual([]);
  });

  it("lays every shown card flat, with no children", () => {
    const g = gridFromBoard(board4(), { columnDepth: 2, detailDepth: 3 });
    expect(g.roots.map((n) => n.id).sort()).toEqual(["b1", "b2", "b3", "b4", "d1", "r1", "s1", "s2"]);
    expect(g.roots.every((n) => n.children.length === 0)).toBe(true);
    expect(g.roots.every((n) => n.cell && n.span)).toBe(true);
  });

  /* THE ROW: a scene's beats run to its RIGHT, on its own line. */
  it("a scene is a row: its card, then its beats to the right", () => {
    const g = gridFromBoard(board4(), { columnDepth: 2, detailDepth: 3 });
    const y = 2 * BAND_PITCH; // under the two bands
    expect(at(g, "s1").cell).toEqual({ x: 0, y });
    expect(at(g, "b1").cell).toEqual({ x: BEATS_X, y });
    expect(at(g, "b2").cell).toEqual({ x: BEATS_X + LEAF_PITCH, y });
    expect(at(g, "b3").cell).toEqual({ x: BEATS_X + 2 * LEAF_PITCH, y });
    expect(at(g, "s1").span).toEqual(HEAD_SPAN);
    expect(at(g, "b1").span).toEqual(LEAF_SPAN);
  });

  /* Columned by scene, each scene row is its own column, side by side --
   * and a column is as wide as its row, so the next starts after it. */
  it("one column per node at the column tier, as wide as its row", () => {
    const g = gridFromBoard(board4(), { columnDepth: 2, detailDepth: 3 });
    const s1W = BEATS_X + 3 * LEAF_PITCH - GUTTER; // card + three beats
    expect(at(g, "s2").cell).toEqual({ x: s1W + GUTTER, y: 2 * BAND_PITCH });
    expect(at(g, "b4").cell!.x).toBe(s1W + GUTTER + BEATS_X);
  });

  /* THE BOARD'S OWN WRAP: beats wrap where maxRowBeats says, and the row
   * grows to hold them, so the grid IS the Overview's shape. */
  it("wraps a scene's beats at the board's maxRowBeats", () => {
    const src = { ...board4(), maxRowBeats: 2 };
    const g = gridFromBoard(src, { columnDepth: 2, detailDepth: 3 });
    const y = 2 * BAND_PITCH;
    expect(at(g, "b1").cell).toEqual({ x: BEATS_X, y });
    expect(at(g, "b2").cell).toEqual({ x: BEATS_X + LEAF_PITCH, y });
    expect(at(g, "b3").cell).toEqual({ x: BEATS_X, y: y + LEAF_SPAN.h + GUTTER }); // second row
  });

  it("the Beat Map's manual row break still breaks the row", () => {
    const src = board4();
    src.roots[0].children[0].children[0].children[0].breakAfter = true; // b1
    const g = gridFromBoard(src, { columnDepth: 2, detailDepth: 3 });
    expect(at(g, "b2").cell!.x).toBe(BEATS_X);
    expect(at(g, "b2").cell!.y).toBe(at(g, "b1").cell!.y + LEAF_SPAN.h + GUTTER);
    expect(at(g, "b2").breakAfter).toBeUndefined(); // the break itself does not travel
  });

  /* Columned by a higher tier, the scene ROWS stack down the column
   * under that tier's head, and the column is as wide as its widest row. */
  it("columned by section: the section's head, then scene rows stacked beneath", () => {
    const g = gridFromBoard(board4(), { columnDepth: 1, detailDepth: 3 });
    expect(at(g, "d1").cell).toEqual({ x: 0, y: BAND_PITCH });
    const s1y = BAND_PITCH + HEAD_SPAN.h + GUTTER;
    expect(at(g, "s1").cell).toEqual({ x: 0, y: s1y });
    expect(at(g, "b1").cell).toEqual({ x: BEATS_X, y: s1y });
    const s2y = s1y + HEAD_SPAN.h + GUTTER; // one beat row is shorter than the card, so the card's height
    expect(at(g, "s2").cell).toEqual({ x: 0, y: s2y });
    expect(at(g, "b4").cell).toEqual({ x: BEATS_X, y: s2y });
  });

  it("a wrapped scene row is as tall as its beat rows", () => {
    const src = { ...board4(), maxRowBeats: 1 }; // s1's three beats become three rows
    const g = gridFromBoard(src, { columnDepth: 1, detailDepth: 3 });
    const s1y = at(g, "s1").cell!.y;
    const rowH = 3 * (LEAF_SPAN.h + GUTTER) - GUTTER; // taller than the 4-cell card
    expect(at(g, "s2").cell!.y).toBe(s1y + rowH + GUTTER);
  });

  /* The Overview's spines, laid down: a band at the head of its run,
   * outermost at the top, spanning the columns it covers. */
  it("lays the tiers above the columns as bands at the head of their run", () => {
    const g = gridFromBoard(board4(), { columnDepth: 2, detailDepth: 3 });
    expect(at(g, "r1").cell).toEqual({ x: 0, y: 0 });
    expect(at(g, "d1").cell).toEqual({ x: 0, y: BAND_PITCH });
    const s1W = BEATS_X + 3 * LEAF_PITCH - GUTTER;
    const s2W = BEATS_X + 1 * LEAF_PITCH - GUTTER;
    expect(at(g, "r1").span!.w).toBe(Math.min(22, s1W + GUTTER + s2W));
  });

  /* WYSIWYG: what the Overview's Detail level hides does not come. */
  it("brings nothing deeper than the detail level", () => {
    const g = gridFromBoard(board4(), { columnDepth: 2, detailDepth: 2 });
    expect(g.roots.map((n) => n.id).sort()).toEqual(["d1", "r1", "s1", "s2"]);
    expect(at(g, "s1").span).toEqual(HEAD_SPAN);
  });

  /* The Overview's black band across a column: a full-width tier at the
   * column's head spans the column, and is shorter -- a label for what is
   * under it. */
  it("a full-width tier at the column head is a band as wide as its column", () => {
    const src = board4();
    src.levels[1] = { ...src.levels[1], fullWidth: true }; // sections are bands
    const g = gridFromBoard(src, { columnDepth: 1, detailDepth: 3 });
    const d1 = at(g, "d1");
    const widest = BEATS_X + 3 * LEAF_PITCH - GUTTER; // s1's row
    expect(d1.span).toEqual({ w: Math.min(22, widest), h: 3 });
    expect(at(g, "s1").cell!.y).toBe(BAND_PITCH + 3 + GUTTER); // under a 3-tall band, not a 4-tall card
  });

  it("never columns by the leaf tier: a beat is always inside its scene's row", () => {
    const g = gridFromBoard(board4(), { columnDepth: 3, detailDepth: 3 });
    // clamped to the scene tier, so this is the column-per-scene layout
    expect(at(g, "b1").cell).toEqual({ x: BEATS_X, y: 2 * BAND_PITCH });
  });

  /* THE COLOR STEP a plain copy lacks: a card that took its tier's color
   * now carries it, because the tier is not there to inherit from. */
  it("gives an uncolored card its tier's color as an override", () => {
    const g = gridFromBoard(board4(), { columnDepth: 2, detailDepth: 3 });
    const s1 = at(g, "s1");
    expect(s1.color).toBeDefined();
    const entry = g.legend.find((e) => e.id === s1.color)!;
    expect(entry).toBeDefined();
    expect(entry.tier).toBeUndefined(); // an OPTION, so the palette hoist lifts it
    expect(entry.label).toBe("Scene");
    expect(at(g, "b1").color).toBe(at(g, "b4").color);
    expect(at(g, "b1").color).not.toBe(s1.color);
  });

  it("keeps a card's own color", () => {
    const src = board4();
    src.roots[0].children[0].children[0].children[1].color = "opt-red"; // b2
    const g = gridFromBoard(src, { columnDepth: 2, detailDepth: 3 });
    expect(at(g, "b2").color).toBe("opt-red");
  });

  it("reuses a palette option that already has that fill, rather than minting a twin", () => {
    const src = board4();
    const scene = src.legend.find((e) => e.tier === "scene") ?? { id: "tier:scene", label: "Scene", bg: "#abcdef", border: "#000", tier: "scene" };
    src.legend = [scene, { id: "opt-same", label: "Already", bg: scene.bg, border: scene.border }];
    const g = gridFromBoard(src, { columnDepth: 2, detailDepth: 3 });
    expect(at(g, "s1").color).toBe("opt-same");
  });

  /* Beat Map facts that mean nothing on a grid stay behind. */
  it("strips fold and hide", () => {
    const src: Board = { ...board4(), roots: [node("solo")] };
    src.roots[0].collapsed = true;
    src.roots[0].hidden = true;
    const g = gridFromBoard(src, { columnDepth: 0, detailDepth: 0 });
    const c = at(g, "solo");
    expect(c.collapsed).toBe(false);
    expect(c.hidden).toBeUndefined();
  });

  it("keeps the folder, so the copy files beside its source", () => {
    const src = { ...board4(), folder: ["Cuts"] };
    expect(gridFromBoard(src, { columnDepth: 2, detailDepth: 3 }).folder).toEqual(["Cuts"]);
  });

  /* HIS SIMPLEST ANSWER to side-by-side on a grid: "translate side by
   * side pictures into a picture and a card". Two cards, pinned beside
   * each other, and the beats begin after both. */
  describe("a side-by-side card becomes a picture card and a text card", () => {
    const withSide = (edge?: "left" | "right"): Board => {
      const src = board4();
      const s1 = src.roots[0].children[0].children[0]; // scene s1
      s1.image = "data:,";
      s1.imageFit = "side";
      s1.textColor = "#fff";
      s1.textShadow = true;
      if (edge) src.levels[2] = { ...src.levels[2], imageEdge: edge };
      return src;
    };
    const picOf = (g: Board) => g.roots.find((n) => n.image === "data:," && n.id !== "s1")!;

    it("makes two cards: the picture as fill with no words, and the words with no picture", () => {
      const g = gridFromBoard(withSide(), { columnDepth: 2, detailDepth: 3 });
      const pic = picOf(g);
      expect(pic).toBeDefined();
      expect(pic.title).toBe("");
      expect(pic.imageFit).toBe("fill");
      expect(at(g, "s1").image).toBeUndefined();
      expect(at(g, "s1").imageFit).toBeUndefined();
    });

    it("stands the picture on the tier's edge, and the beats begin after both", () => {
      const left = gridFromBoard(withSide("left"), { columnDepth: 2, detailDepth: 3 });
      expect(picOf(left).cell!.x).toBe(0);
      expect(at(left, "s1").cell!.x).toBe(HEAD_SPAN.w + GUTTER);
      expect(at(left, "b1").cell!.x).toBe(2 * (HEAD_SPAN.w + GUTTER));
      expect(picOf(left).cell!.y).toBe(at(left, "s1").cell!.y);

      const right = gridFromBoard(withSide("right"), { columnDepth: 2, detailDepth: 3 });
      expect(at(right, "s1").cell!.x).toBe(0);
      expect(picOf(right).cell!.x).toBe(HEAD_SPAN.w + GUTTER);
      expect(at(right, "b1").cell!.x).toBe(2 * (HEAD_SPAN.w + GUTTER));
    });

    /* The words were on paper on the Beat Map too (plainText), so the
     * overrides written for type over a photo do not come across. */
    it("drops the text overrides that were written for the photo", () => {
      const g = gridFromBoard(withSide(), { columnDepth: 2, detailDepth: 3 });
      expect(at(g, "s1").textColor).toBeUndefined();
      expect(at(g, "s1").textShadow).toBeUndefined();
    });

    it("both halves wear the tier's color", () => {
      const g = gridFromBoard(withSide(), { columnDepth: 2, detailDepth: 3 });
      expect(picOf(g).color).toBe(at(g, "s1").color);
    });

    it("a side sit with no picture behind it just becomes a plain card", () => {
      const src = board4();
      src.roots[0].children[0].children[0].imageFit = "side"; // no image
      const g = gridFromBoard(src, { columnDepth: 2, detailDepth: 3 });
      expect(at(g, "s1").imageFit).toBeUndefined();
      expect(g.roots.filter((n) => n.title === "").length).toBe(0);
    });
  });
});
