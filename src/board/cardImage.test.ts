import { describe, expect, it } from "vitest";
import { board4, node } from "../test/fixtures";
import type { Board } from "../state/types";
import { ALIGNS, DEFAULT_ALIGN, alignOf, canShowImage, tierCardIds } from "./cardImage";
import type { Node } from "../state/types";

/* ------------------------------------------------------------------ *
 *  WHERE A PICTURE CAN GO.
 *
 *  Pinned because this predicate is the ONE definition two layers guard
 *  on -- the surface that OFFERS an image and the renderers that DRAW
 *  one -- and they drifted apart once already, silently and in the
 *  expensive direction: a picture put on a band was written to the
 *  shared doc, synced to everyone, and painted nowhere.
 *
 *  IT ADMITS EVERY SHAPE NOW, BANDS INCLUDED (owner, 2026-08-27), so
 *  these cases all assert `true`. That reads like a test of nothing and
 *  is not: what it pins is that the CLOSED cases stayed closed. The bug
 *  above was a renderer drawing LESS than the offer, and the fix for
 *  this change was to make every renderer draw one -- so the way to
 *  reintroduce it is for some shape to quietly start saying no again.
 *  A band is the case that actually moved and is called out below.
 * ------------------------------------------------------------------ */

/* board4 is Reel > Section > Scene > Beat, so leaf depth is 3:
 *   0 reel      LaneHeader   -- card or band, per the tier
 *   1 section   LaneHeader   -- card or band, per the tier
 *   2 scene     CardsLane    -- always a scene LABEL
 *   3 beat      Card         -- always a card                       */
const band = (b: Board, depth: number): Board => {
  b.levels[depth] = { ...b.levels[depth], fullWidth: true };
  return b;
};

describe("canShowImage: the card shapes an image can fill", () => {
  it("a leaf card and a scene label always take one", () => {
    const b = board4();
    expect(canShowImage(b, node("b1"), 3)).toBe(true);
    expect(canShowImage(b, node("s1"), 2)).toBe(true);
  });

  it("a header tier takes one in CARD form", () => {
    const b = board4(); // nothing is fullWidth by default
    expect(canShowImage(b, node("r1"), 0)).toBe(true);
    expect(canShowImage(b, node("d1"), 1)).toBe(true);
  });

  it("...AND as a full-width band, which is the case that changed", () => {
    /* It returned false here until 2026-08-27. The exclusion existed
     * because a picture turned the title into a bottom CAPTION and a
     * pane-spanning bar has no known aspect to design one for -- but the
     * caption was cut 104 minutes later the same day, and a centered
     * white title with a drop shadow has no opinion about aspect. The
     * rule outlived its reason by a day; the owner's call removed it.
     * LaneHeader draws the picture in band form to match. */
    const b = band(board4(), 0);
    expect(canShowImage(b, node("r1"), 0)).toBe(true);
    expect(canShowImage(b, node("d1"), 1)).toBe(true);
  });

  it("fullWidth on a scene or leaf tier is ignored -- neither renderer reads it", () => {
    /* CardsLane and Card never consult the flag, so the predicate must
     * not either, or the menu would hide an entry over a drawn picture. */
    const b = band(band(board4(), 2), 3);
    expect(canShowImage(b, node("s1"), 2)).toBe(true);
    expect(canShowImage(b, node("b1"), 3)).toBe(true);
  });

  it("a NESTING card takes one at every tier, band or not", () => {
    /* It is drawn by Card at every rung (flatten's "nested" row kind),
     * so it is never a band whatever its tier says. */
    const b = band(board4(), 0);
    expect(canShowImage(b, { ...node("r1"), boardRef: "bd2" }, 0)).toBe(true);
  });

  it("every rung of a typed board takes one -- those renderers ignore fullWidth", () => {
    const grid: Board = { ...board4(), type: "grid", levels: [board4().levels[3]] };
    expect(canShowImage(grid, node("c1"), 0)).toBe(true);
    const cols = band({ ...board4(), type: "kanban" }, 0);
    expect(canShowImage(cols, node("col"), 0)).toBe(true); // the column HEAD
    expect(canShowImage(cols, node("c1"), 1)).toBe(true);
  });

  it("a two-rung ladder is all card shapes -- there is no band tier to find", () => {
    const b = board4();
    b.levels = b.levels.slice(2); // Scene > Beat
    expect(canShowImage(band({ ...b }, 0), node("s1"), 0)).toBe(true);
    expect(canShowImage(b, node("b1"), 1)).toBe(true);
  });

  it("a missing board is not a refusal either", () => {
    /* It used to answer false here, on the reasoning that a shape rule
     * cannot be applied to a board you cannot see. There is no shape
     * rule left to apply, so the guard would now only mean "no images
     * during the pre-sync window", which is a statement about SYNC
     * wearing an image predicate. The one caller that can be handed a
     * null board (board/imageDrop.ts) guards on it itself, one line
     * earlier, where that concern actually belongs. */
    expect(canShowImage(null, node("b1"), 3)).toBe(true);
  });
});

describe("alignOf: which part of a crop survives", () => {
  it("no anchor is the centre -- what every crop did before these existed", () => {
    expect(alignOf({})).toBe(DEFAULT_ALIGN);
    expect(alignOf({ imageAlign: undefined })).toBe(DEFAULT_ALIGN);
  });

  it("an offered anchor is used as given", () => {
    for (const a of ALIGNS) expect(alignOf({ imageAlign: a })).toBe(a);
  });

  it("anything else falls back rather than being handed to CSS", () => {
    /* A hand-edited file could carry any object-position; the picker only
     * offers nine, so a card must never end up with a crop it cannot set
     * back. */
    expect(alignOf({ imageAlign: "17% 4px" })).toBe(DEFAULT_ALIGN);
    expect(alignOf({ imageAlign: "" })).toBe(DEFAULT_ALIGN);
    expect(alignOf({ imageAlign: "top left" })).toBe(DEFAULT_ALIGN); // wrong order
  });

  it("the default is one of the nine, so the picker can show it lit", () => {
    expect(ALIGNS).toContain(DEFAULT_ALIGN);
  });
});

/* ------------------------------------------------------------------ *
 *  WHICH CARDS "apply image settings to every card in this tier"
 *  REACHES (2026-09-09).
 * ------------------------------------------------------------------ */

const pic = (id: string, extra: Partial<Node> = {}): Node =>
  ({ id, title: id, children: [], ...extra }) as Node;

// reel > act > scene > beat, with pictures scattered about
const shelf = [
  pic("reel", {
    children: [
      pic("act", {
        children: [
          pic("s1", { image: "data:1", children: [pic("b1", { image: "data:1" })] }),
          pic("s2", { still: "key", children: [pic("b2")] }),
          pic("s3", { children: [] }), // no picture
        ],
      }),
    ],
  }),
];

describe("tierCardIds: the whole rung", () => {
  /* EVERY card at the depth, pictured or not: the button says "N total
   * scenes" and applies to all of them (owner, 2026-09-09). */
  it("takes every card at one depth and nothing from another", () => {
    expect(tierCardIds(shelf, 2)).toEqual(["s1", "s2", "s3"]);
    expect(tierCardIds(shelf, 3)).toEqual(["b1", "b2"]);
  });
  it("includes the bare ones, so the count is the tier's real size", () => {
    expect(tierCardIds(shelf, 2)).toContain("s3"); // no picture
    expect(tierCardIds(shelf, 3)).toContain("b2"); // no picture
  });
  it("walks the ladder rather than the tree's leaves", () => {
    expect(tierCardIds(shelf, 0)).toEqual(["reel"]);
    expect(tierCardIds(shelf, 1)).toEqual(["act"]);
    expect(tierCardIds([], 2)).toEqual([]);
  });
});
