import { describe, expect, it } from "vitest";
import type { LevelDef } from "../state/types";
import { NO_STRIP, tierStrip } from "./cardSizing";

const bare = { gap: 0, center: false };

const lvl = (extra: Partial<LevelDef>): LevelDef => ({
  id: "t",
  name: "T",
  variant: "reel",
  fields: { color: true, notes: true },
  ...extra,
});

// a scene card at the shipped defaults
const W = 167;
const H = 90;

describe("tierStrip", () => {
  it("is nothing without a side, whatever the size says", () => {
    expect(tierStrip(undefined, W, H)).toEqual(NO_STRIP);
    expect(tierStrip(lvl({}), W, H)).toEqual(NO_STRIP);
    expect(tierStrip(lvl({ imageRoom: 1.2 }), W, H)).toEqual(NO_STRIP);
  });

  it("holds one card's worth of space at the default scale", () => {
    expect(tierStrip(lvl({ imageEdge: "left" }), W, H)).toEqual({ edge: "left", w: 167, h: 90, ...bare });
    expect(tierStrip(lvl({ imageEdge: "right" }), W, H)).toEqual({ edge: "right", w: 167, h: 90, ...bare });
  });

  /* THE DIAL IS A HEIGHT (his unit): the picture stands `scale` times the
   * card's height, and the strip takes the same multiple of its width, so
   * the reserve stays in proportion and needs no picture measured. */
  it("scales height and strip together, so the reserve stays proportional", () => {
    expect(tierStrip(lvl({ imageEdge: "left", imageRoom: 0.5 }), W, H)).toEqual({ edge: "left", w: 84, h: 45, ...bare });
    expect(tierStrip(lvl({ imageEdge: "left", imageRoom: 1.2 }), W, H)).toEqual({ edge: "left", w: 200, h: 108, ...bare });
  });

  it("clamps a stored scale to his ceiling, which is what bounds the divergence", () => {
    // 1.2x of the card's height, and never more (owner, 2026-09-09)
    expect(tierStrip(lvl({ imageEdge: "left", imageRoom: 99 }), 100, 50)).toEqual({ edge: "left", w: 120, h: 60, ...bare });
    expect(tierStrip(lvl({ imageEdge: "left", imageRoom: 0 }), 100, 50)).toEqual({ edge: "left", w: 40, h: 20, ...bare });
  });
});

describe("the gap", () => {
  /* IT EXTENDS THE STRIP rather than eating into it, so widening the air
   * never shrinks the picture and the tier's cards still match. */
  it("adds to the strip and is reported for the padding", () => {
    const s = tierStrip(lvl({ imageEdge: "left", imageGap: 12 }), W, H);
    expect(s).toEqual({ edge: "left", w: 179, h: 90, gap: 12, center: false });
  });
  it("clamps to the range and stores nothing at zero", () => {
    expect(tierStrip(lvl({ imageEdge: "left", imageGap: 99 }), W, H).gap).toBe(20);
    expect(tierStrip(lvl({ imageEdge: "left", imageGap: -5 }), W, H).gap).toBe(0);
  });
  it("carries the centering through", () => {
    expect(tierStrip(lvl({ imageEdge: "left", imageCenter: true }), W, H).center).toBe(true);
    expect(tierStrip(lvl({ imageEdge: "left" }), W, H).center).toBe(false);
  });
});

describe("the images switch", () => {
  /* OFF collapses the strip rather than leaving it standing empty: the
   * switch says "no pictures on this board right now", and a reserved
   * band with nothing in it says the opposite (owner-reported
   * 2026-09-09). */
  it("holds the strip only while the pictures stand beside the cards", () => {
    const lit = lvl({ imageEdge: "left", imageRoom: 1.2, imageGap: 12 });
    expect(tierStrip(lit, W, H, "on").w).toBe(212);
    // OFF hides them; ONLY turns them INTO the cards. Neither leaves
    // anything standing in the strip, so the space goes back.
    expect(tierStrip(lit, W, H, "off")).toEqual(NO_STRIP);
    expect(tierStrip(lit, W, H, "only")).toEqual(NO_STRIP);
  });
});
