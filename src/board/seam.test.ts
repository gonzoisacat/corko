import { describe, expect, it } from "vitest";
import { headSeam, isBoardHead, seamBelow, type SeamRow, type SeamSpec } from "./seam";

/* ------------------------------------------------------------------ *
 *  The seam's arithmetic, pinned (see seam.ts for the model).
 *
 *  `drops` -- the closes-here chain -- is every published drag address
 *  the seam must DRAW (drift = a published target with no preview, the
 *  exact bug family the drag suite exists for). The disc addresses
 *  double as insertTierAt's inputs, so a drift here writes cards into
 *  the wrong place on a shared board. Nothing stands at rest (owner:
 *  "no plusses visible until you hover"), so there is no promotion
 *  projection any more -- seam.ts's header says how to re-derive one.
 * ------------------------------------------------------------------ */

/* A scene on a Reel > Day > Scene > Beat ladder: depth 2, inside Day 1
 * (above[1]) inside Reel 1 (above[0]). Overrides say which part of the
 * chain closes. */
const scene = (over: Partial<SeamRow> = {}): SeamSpec =>
  seamBelow({
    kind: "cards-lane",
    nodeId: "scene-b",
    parentId: "day-1",
    index: 1,
    depth: 2,
    folded: false,
    last: false,
    siblingCount: 3,
    above: [
      { parentId: null, index: 0, depth: 0, last: false },
      { parentId: "reel-1", index: 0, depth: 1, last: false },
    ],
    ...over,
  });

const band = (over: Partial<SeamRow> = {}): SeamSpec =>
  seamBelow({
    kind: "lane",
    nodeId: "day-1",
    parentId: "reel-1",
    index: 1,
    depth: 1,
    folded: false,
    last: false,
    siblingCount: 4,
    childCount: 3,
    above: [{ parentId: null, index: 0, depth: 0, last: false }],
    ...over,
  });

const tiersOf = (s: SeamSpec) => s.discs.map((d) => d.tier);

describe("seamBelow -- discs", () => {
  it("a scene's seam is AFTER ME: every tier up the ladder at (parent, index + 1)", () => {
    const s = scene();
    expect(tiersOf(s)).toEqual([0, 1, 2]);
    for (const d of s.discs) {
      expect(d.parentId).toBe("day-1");
      expect(d.index).toBe(2);
      expect(d.own).toBe(2);
    }
  });

  it("an unfolded band's seam is INTO ME AT THE TOP, child tier only", () => {
    const s = band();
    expect(s.discs).toEqual([{ tier: 2, parentId: "day-1", index: 0, own: 2 }]);
  });

  it("a FOLDED band's seam is the after-me form -- its subtree is out of sight", () => {
    const s = band({ folded: true });
    expect(tiersOf(s)).toEqual([0, 1]);
    for (const d of s.discs) {
      expect(d.parentId).toBe("reel-1");
      expect(d.index).toBe(2);
    }
  });

  it("an EMPTY band's below-gap is also the gap before its next sibling", () => {
    // after-me discs AND the into-me child disc, each at its own address
    const s = band({ childCount: 0 });
    expect(tiersOf(s)).toEqual([0, 1, 2]);
    const child = s.discs.find((d) => d.tier === 2)!;
    expect(child).toMatchObject({ parentId: "day-1", index: 0, own: 2 });
    const day = s.discs.find((d) => d.tier === 1)!;
    expect(day).toMatchObject({ parentId: "reel-1", index: 2, own: 1 });
  });

  it("a LAST row's own disc appends at the doc count, past any trailing stack", () => {
    // the old chip's semantics: last rendered with 2 hidden siblings
    // stacked behind -> the click lands after them, not before
    const s = scene({ index: 2, last: true, siblingCount: 5 });
    expect(s.discs[2]).toMatchObject({ index: 5 });
  });

  it("a five-tier ladder walks the whole staircase, shallowest first", () => {
    const s = seamBelow({
      kind: "cards-lane",
      nodeId: "x",
      parentId: "p",
      index: 3,
      depth: 4,
      folded: false,
      last: false,
      siblingCount: 5,
      above: [0, 1, 2, 3].map((d) => ({ parentId: `p${d}`, index: 0, depth: d, last: false })),
    });
    expect(tiersOf(s)).toEqual([0, 1, 2, 3, 4]);
  });

  it("no disc ever pins an ancestor tier at index 0 (the first-child rule)", () => {
    const specs = [
      scene(),
      scene({ last: true, above: [
        { parentId: null, index: 0, depth: 0, last: true },
        { parentId: "reel-1", index: 0, depth: 1, last: true },
      ] }),
      band(),
      band({ folded: true }),
      band({ childCount: 0 }),
      headSeam(),
    ];
    for (const s of specs)
      for (const d of s.discs) if (d.tier < d.own) expect(d.index).toBeGreaterThan(0);
  });
});

describe("seamBelow -- drops (every published address gets a drawer)", () => {
  it("a mid-lane scene draws only its own after-form", () => {
    expect(scene().drops).toEqual([{ parentId: "day-1", index: 2 }]);
  });

  it("a LAST row draws the enclosing lanes' after-forms while the chain closes", () => {
    // last scene of Day 1 (Day 2 follows): "after Day 1" is published by
    // the laneAbove branch while dragging a Day over these scenes, and
    // its physical home is this gap -- drawn here even though not
    // promoted. The chain stops at Day 1 (not last), so no reel form.
    const s = scene({
      index: 2,
      last: true,
      above: [
        { parentId: null, index: 0, depth: 0, last: false },
        { parentId: "reel-1", index: 0, depth: 1, last: false },
      ],
    });
    expect(s.drops).toEqual([
      { parentId: "day-1", index: 3 },
      { parentId: "reel-1", index: 1 },
    ]);
    // ...and the board foot draws all three
    const foot = scene({
      index: 2,
      last: true,
      above: [
        { parentId: null, index: 1, depth: 0, last: true },
        { parentId: "reel-2", index: 2, depth: 1, last: true },
      ],
    });
    expect(foot.drops).toEqual([
      { parentId: "day-1", index: 3 },
      { parentId: "reel-2", index: 3 },
      { parentId: null, index: 2 },
    ]);
  });

  it("a trailing hidden stack adds the append form beside the visible one", () => {
    const s = scene({ index: 2, last: true, siblingCount: 5 });
    expect(s.drops).toContainEqual({ parentId: "day-1", index: 3 });
    expect(s.drops).toContainEqual({ parentId: "day-1", index: 5 });
  });

  it("bands draw their come-inside target, folded or not", () => {
    // planRow's come-inside branch publishes (self, 0) for a folded band
    // too; before seams nothing drew that preview at all
    expect(band().drops).toEqual([{ parentId: "day-1", index: 0 }]);
    expect(band({ folded: true }).drops).toContainEqual({ parentId: "day-1", index: 0 });
  });

  it("an EMPTY band draws come-inside AND its own after-forms", () => {
    const s = band({ childCount: 0 });
    expect(s.drops).toContainEqual({ parentId: "day-1", index: 0 });
    expect(s.drops).toContainEqual({ parentId: "reel-1", index: 2 });
  });
});

describe("headSeam", () => {
  it("is the board's top: before the first root, tier 0 only", () => {
    const h = headSeam();
    expect(h.discs).toEqual([{ tier: 0, parentId: null, index: 0, own: 0 }]);
    expect(h.drops).toEqual([{ parentId: null, index: 0 }]);
  });

  it("only the true first root renders it, searching or not", () => {
    expect(isBoardHead(null, 0)).toBe(true);
    expect(isBoardHead(null, 1)).toBe(false);
    expect(isBoardHead("reel-1", 0)).toBe(false); // a first CHILD is the parent's seam
  });
});
