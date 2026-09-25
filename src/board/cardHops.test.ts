import { describe, expect, it } from "vitest";
import { depthOf, hopTiers, tierHops } from "./cardHops";
import { board4, node } from "../test/fixtures";
import type { Board } from "../state/types";

/* board4 in cut order, with depths:
 *   r1(0) d1(1) s1(2) b1(3) b2(3) b3(3) s2(2) b4(3)          */

describe("hopTiers", () => {
  it("is the card's own tier and one either side", () => {
    expect(hopTiers(1, 4)).toEqual([0, 1, 2]);
  });

  /* His rule: "only two if you're at the top or bottom tier". */
  it("the top tier has nothing above it", () => {
    expect(hopTiers(0, 4)).toEqual([0, 1]);
  });

  it("the bottom tier has nothing below it", () => {
    expect(hopTiers(3, 4)).toEqual([2, 3]);
  });

  it("a one-tier ladder is just itself", () => {
    expect(hopTiers(0, 1)).toEqual([0]);
  });
});

describe("tierHops", () => {
  const b = board4();

  it("steps through the card's own tier in cut order", () => {
    const same = tierHops(b, "b2").find((h) => h.tier === 3);
    expect(same).toMatchObject({ prev: "b1", next: "b3" });
  });

  /* The heart of it: from a BEAT, "next scene" is the scene the read
   * reaches next -- the one whose beats you are about to be looking at --
   * which a list of scenes alone could not answer. */
  it("a beat's scene hop leaves its own scene for the following one", () => {
    const up = tierHops(b, "b2").find((h) => h.tier === 2);
    expect(up).toMatchObject({ prev: "s1", next: "s2" });
  });

  it("a scene's beat hop reaches into its own children", () => {
    const down = tierHops(b, "s1").find((h) => h.tier === 3);
    expect(down).toMatchObject({ prev: null, next: "b1" });
  });

  /* The card you are standing on is never a place to step to. */
  it("never offers the card itself", () => {
    for (const h of tierHops(b, "s1")) {
      expect(h.prev).not.toBe("s1");
      expect(h.next).not.toBe("s1");
    }
  });

  it("the first card of a tier has no previous, the last no next", () => {
    expect(tierHops(b, "b1").find((h) => h.tier === 3)).toMatchObject({ prev: null, next: "b2" });
    expect(tierHops(b, "b4").find((h) => h.tier === 3)).toMatchObject({ prev: "b3", next: null });
  });

  it("offers three tiers in the middle of the ladder and two at the ends", () => {
    expect(tierHops(b, "d1").map((h) => h.tier)).toEqual([0, 1, 2]);
    expect(tierHops(b, "r1").map((h) => h.tier)).toEqual([0, 1]);
    expect(tierHops(b, "b1").map((h) => h.tier)).toEqual([2, 3]);
  });

  /* A collapsed scene's beats are still in the cut, so the same button
   * must not do different things depending on chevrons this cannot see. */
  it("walks the board, not the rows on screen", () => {
    const folded: Board = { ...b, roots: structuredClone(b.roots) };
    folded.roots[0].children[0].children[0].collapsed = true;
    expect(tierHops(folded, "s2").find((h) => h.tier === 3)).toMatchObject({ prev: "b3", next: "b4" });
  });

  it("an unknown card has nowhere to go", () => {
    expect(tierHops(b, "nope")).toEqual([]);
    expect(tierHops(null, "b1")).toEqual([]);
  });

  it("a tier with no cards at all draws nothing on either side", () => {
    const empty: Board = { ...b, roots: [node("solo")] };
    const hops = tierHops(empty, "solo");
    expect(hops.map((h) => h.tier)).toEqual([0, 1]);
    expect(hops.every((h) => h.prev === null && h.next === null)).toBe(true);
  });
});

/* Used by the PINNED panel to re-open on whatever card you select: the
 * selection carries an id and nothing else, so the depth has to be
 * looked up, and a card on another board must answer null rather than a
 * number the panel would then mislabel. */
describe("depthOf", () => {
  const b = board4();

  it("gives a card's tier", () => {
    expect(depthOf(b, "r1")).toBe(0);
    expect(depthOf(b, "s1")).toBe(2);
    expect(depthOf(b, "b4")).toBe(3);
  });

  it("is null for a card this board does not hold", () => {
    expect(depthOf(b, "bB1")).toBe(null);
    expect(depthOf(b, "nope")).toBe(null);
    expect(depthOf(null, "r1")).toBe(null);
  });
});
