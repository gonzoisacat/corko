import { describe, expect, it } from "vitest";
import {
  gapSelector,
  pickSlot,
  planRow,
  SLOT_ROOM,
  type DragFacts,
  type Landing,
  type SlotBox,
} from "./dropPlan";

/* ------------------------------------------------------------------ *
 *  Drop-target resolution, pinned.
 *
 *  Three "the slot drew in the wrong place" bugs landed in one session,
 *  each the same rule stated differently, and twice as a SIDE EFFECT of
 *  fixing the other statement of it. Nothing was watching. These tests
 *  are what makes the next adjacent fix noisy instead of quiet.
 *
 *  They are written as the four rules from CLAUDE.md's drag section plus
 *  the invariant underneath them, and the last block cross-checks that
 *  one gesture resolves the same in both views.
 * ------------------------------------------------------------------ */

/* Default facts: a 3-tier board (T3 root / T2 lane / T1 leaf), nothing in
 * hand, nothing a no-op. Tests override the one thing they are about. */
const facts = (over: Partial<DragFacts> = {}): DragFacts => ({
  height: 1,
  ladder: 3,
  overtops: false,
  isSelf: () => false,
  isNoOp: () => false,
  ...over,
});

/* planRow answers with a KIND now (see RowPlan): "at" carries the
 * landing, "neutral" means this row is the tier in play and deliberately
 * offers nothing (the card's own origin), "none" means the row is not
 * involved. The two nulls used to be one, which is the bug the kinds fix
 * -- so the tests below say which they mean, every time. */
const landing = (ask: Parameters<typeof planRow>[0], drag: DragFacts): Landing | null => {
  const p = planRow(ask, drag);
  return p.kind === "at" ? p.at : null;
};
const kind = (ask: Parameters<typeof planRow>[0], drag: DragFacts) => planRow(ask, drag).kind;

/* ------------------------------------------------------------------ *
 *  DETAIL -- planRow
 * ------------------------------------------------------------------ */
describe("planRow", () => {
  /* A lane row at depth 1 of a 3-tier ladder: height 1, so a dragged
   * lane (height 1) reorders among its siblings and a dragged beat
   * (height 0) goes inside it. */
  const lane = { depth: 1, parentId: "r1", index: 2, childDepth: 2, nodeId: "s3" };

  it("the upper half lands before this row, the lower half after it", () => {
    expect(landing({ ...lane, lower: false }, facts())).toMatchObject({
      parentId: "r1",
      index: 2,
    });
    expect(landing({ ...lane, lower: true }, facts())).toMatchObject({
      parentId: "r1",
      index: 3,
    });
  });

  /* RULE 1, in the terms a row has. The lower half belongs to the NEXT
   * SIBLING -- so this row must NOT claim the gap by id, or the slot
   * draws between a lane and its own children (which is nowhere another
   * lane can go). Detail resolves that gap by index; the null is how it
   * declines to anchor. */
  it("the lower half anchors to nothing -- the gap is the next sibling's", () => {
    expect(landing({ ...lane, lower: false }, facts())?.beforeId).toBe("s3");
    expect(landing({ ...lane, lower: true }, facts())?.beforeId).toBeNull();
  });

  it("a lane also takes its CHILD's tier, inside itself at the top", () => {
    const p = landing({ ...lane, lower: false }, facts({ height: 0 }));
    expect(p).toMatchObject({ parentId: "s3", index: 0, beforeId: null });
  });

  /* An empty lane has no sibling beat to aim at, which is the whole
   * reason a row offers two tiers. Which half you are over is irrelevant
   * to a come-inside-me landing. */
  it("the come-inside landing ignores which half of the row you are in", () => {
    const a = landing({ ...lane, lower: false }, facts({ height: 0 }));
    const b = landing({ ...lane, lower: true }, facts({ height: 0 }));
    expect(a).toEqual(b);
  });

  it("a tier that is neither this row's nor its child's is refused", () => {
    expect(kind({ ...lane, lower: false }, facts({ height: 2 }))).toBe("none");
  });

  it("a row with no childDepth offers only its own tier", () => {
    const leafRow = { depth: 2, parentId: "s3", index: 0, nodeId: "b1", lower: false };
    expect(landing(leafRow, facts({ height: 0 }))).toMatchObject({ parentId: "s3", index: 0 });
    expect(kind(leafRow, facts({ height: 1 }))).toBe("none");
  });

  /* TWO SENTINELS, both -1. itemHeight() returns -1 when the drag's
   * source board is gone from the snapshot; `child` is -1 when a row has
   * no child tier. Left to collide they match, and a childless row
   * offers to take a node INSIDE a leaf. Unreachable through today's two
   * call sites -- the cards lane passes no nodeId, which that branch
   * also needs -- but drag.ts refuses this value outright and planRow
   * must not disagree. */
  it("refuses a drag whose source board has gone, rather than reading -1 as a tier", () => {
    const leafRow = { depth: 2, parentId: "s3", index: 0, nodeId: "b1", lower: false };
    expect(kind(leafRow, facts({ height: -1 }))).toBe("none");
    expect(kind({ ...lane, lower: false }, facts({ height: -1 }))).toBe("none");
  });

  /* Height above the leaf, not depth (drag.ts `sameRole`). The SAME
   * dragged node -- height 1, a lane -- meets a different rung on each
   * ladder, and the row that takes it moves down with the ladder's
   * length rather than staying at depth 1. */
  it("matches by ROLE, so which row takes it follows the ladder's length", () => {
    // 3-tier destination: depth 1 IS the lane tier -> reorder among siblings
    expect(landing({ ...lane, lower: false }, facts({ height: 1, ladder: 3 }))).toMatchObject({
      parentId: "r1",
      index: 2,
    });
    // 4-tier destination: depth 1 is a tier HIGHER, so the same node goes
    // inside it instead -- height 1 is that row's child tier
    expect(landing({ ...lane, lower: false }, facts({ height: 1, ladder: 4 }))).toMatchObject({
      parentId: "s3",
      index: 0,
    });
    // ...and it is depth 2 that reorders it there
    const deeper = { ...lane, depth: 2, childDepth: 3 };
    expect(landing({ ...deeper, lower: false }, facts({ height: 1, ladder: 4 }))).toMatchObject({
      parentId: "r1",
      index: 2,
    });
  });

  /* RULE 4. Both `index` and `index + 1` at the origin parent name the
   * same slot once the node is lifted out. Refused OUTRIGHT rather than
   * accepted-and-ignored, so the cursor shows no-drop -- and since a
   * missing slot genuinely refuses the drop now, that refusal is real. */
  it("refuses a drop that changes nothing, on both sides of the row", () => {
    // the dragged node sits at r1[2] -- this very row
    const atOrigin = (parentId: string | null, index: number) =>
      parentId === "r1" && (index === 2 || index === 3);
    expect(kind({ ...lane, lower: false }, facts({ isNoOp: atOrigin }))).toBe("neutral");
    expect(kind({ ...lane, lower: true }, facts({ isNoOp: atOrigin }))).toBe("neutral");
  });

  it("refuses a come-inside landing that changes nothing", () => {
    const first = (parentId: string | null) => parentId === "s3";
    expect(kind({ ...lane, lower: false }, facts({ height: 0, isNoOp: first }))).toBe("neutral");
  });

  /* The zones still lit up inside the thing being dragged, so dragging a
   * Day left a trail of candidate gaps in the very rows about to move. */
  it("never offers a landing inside the thing in your hand", () => {
    const self = (id: string | null | undefined) => id === "s3";
    expect(kind({ ...lane, lower: false }, facts({ isSelf: self }))).toBe("neutral");
    // ...nor into a row whose PARENT is being dragged
    const parentSelf = (id: string | null | undefined) => id === "r1";
    expect(kind({ ...lane, lower: false }, facts({ isSelf: parentSelf }))).toBe("neutral");
  });

  /* A node taller than the whole destination ladder can't match any rung;
   * the TOP-tier row takes it and the drop grows the ladder
   * (ops.extendBoardWithNode). Only at depth 0. */
  it("a node overtopping the board is taken by the top row only", () => {
    const root = { depth: 0, parentId: null, index: 1, childDepth: 1, nodeId: "r2" };
    const tall = facts({ height: 9, overtops: true });
    expect(landing({ ...root, lower: false }, tall)).toMatchObject({ parentId: null, index: 1 });
    expect(kind({ ...lane, lower: false }, tall)).toBe("none");
  });

  /* THE NEUTRAL/NONE SPLIT, which is the whole point of the three-way
   * answer (owner-reported 2026-08-05). Both used to be one null, so the
   * caller could only leave the last slot showing -- and the preview
   * froze on whichever side of its own origin you had approached from.
   *
   * They must stay distinguishable because the caller treats them
   * DIFFERENTLY: neutral clears unconditionally (a scene card's own zone
   * calls preventDefault without publishing, so asking the event gives
   * the wrong answer over exactly this spot), while none defers to a
   * descendant that may have published for the same event. */
  it("tells a deliberate blank apart from a row that isn't involved", () => {
    const atOrigin = (parentId: string | null, index: number) =>
      parentId === "r1" && (index === 2 || index === 3);
    // the tier IS in play, and the answer is deliberately nothing
    expect(kind({ ...lane, lower: false }, facts({ isNoOp: atOrigin }))).toBe("neutral");
    // a different tier entirely: not this row's business either way
    expect(kind({ ...lane, lower: false }, facts({ height: 2 }))).toBe("none");
  });

  /* The reported symptom, as an assertion: approaching the origin from
   * one side and leaving by the other must pass THROUGH neutral, and both
   * sides must still be reachable. If the middle ever answers "at" again,
   * the preview sticks. */
  it("crossing its own origin goes neutral and out the far side", () => {
    // the dragged lane sits at r1[2]; rows 1, 2 and 3 are its neighbours
    const atOrigin = (parentId: string | null, index: number) =>
      parentId === "r1" && (index === 2 || index === 3);
    const f = facts({ isNoOp: atOrigin });
    const at = (index: number, lower: boolean) =>
      planRow({ depth: 1, parentId: "r1", index, childDepth: 2, nodeId: `s${index}`, lower }, f);
    expect(at(1, false).kind).toBe("at"); // above it: a real slot
    expect(at(2, false).kind).toBe("neutral"); // its own row, upper half
    expect(at(2, true).kind).toBe("neutral"); // its own row, lower half
    expect(at(3, true).kind).toBe("at"); // below it: a real slot again
  });

  /* AN UNFURLED SECTION IS DROPPABLE ALL THE WAY DOWN (owner-reported
   * 2026-08-05, for T3 and T4 alike). A lane's own row is only its HEADER
   * BAR, so "after this Day" lived in the bottom ~22px of it and vanished
   * as soon as you moved into the Day's own scenes -- which for the LAST
   * lane in a parent is the only way to reach "after it" at all, hence
   * "no drop zone past the final element".
   *
   * A 4-tier ladder here (Reel / Day / Scene / Beat), because the report
   * was about the two tiers that have sections under them. */
  describe("inside an unfurled section", () => {
    const reel = { id: "r1", parentId: null, index: 1, depth: 0 };
    const day = { id: "d2", parentId: "r1", index: 2, depth: 1 };
    // a scene's strip, sitting inside Reel 1 > Day 2
    const sceneRow = { depth: 2, parentId: "d2", index: 0, nodeId: "s1", lower: false, above: [reel, day] };
    const four = (over: Partial<DragFacts> = {}) => facts({ ladder: 4, ...over });

    it("a Day dragged over a scene inside a Day lands AFTER that Day", () => {
      // height 2 on a 4-ladder is the Day tier
      expect(landing(sceneRow, four({ height: 2 }))).toMatchObject({
        parentId: "r1",
        index: 3, // after d2, which sits at index 2
        beforeId: null,
      });
    });

    it("a Reel dragged over that same scene lands after the REEL", () => {
      expect(landing(sceneRow, four({ height: 3 }))).toMatchObject({
        parentId: null,
        index: 2, // after r1, at index 1
      });
    });

    /* The chain is outermost-first and must be read from the END, or an
     * outer lane answers for an inner one the moment two ancestors share
     * a tier -- which they do the instant a ladder repeats a role. */
    it("the NEAREST enclosing lane at that tier wins", () => {
      const nested = { ...sceneRow, above: [reel, { id: "dOuter", parentId: "r1", index: 0, depth: 1 }, day] };
      expect(landing(nested, four({ height: 2 }))).toMatchObject({ parentId: "r1", index: 3 });
    });

    it("still lands nothing when the tier is nobody's", () => {
      // height 0 is a beat; a scene's strip takes those via its own tier,
      // not via the chain -- and this row is not that strip's own row
      const orphanTier = { ...sceneRow, depth: 9 };
      expect(kind(orphanTier, four({ height: 0 }))).toBe("none");
    });

    /* Being inside the very lane you are dragging is the neutral case,
     * not a landing -- you cannot drop a Day after itself, and the whole
     * section is its own body. */
    it("inside the dragged lane itself, the whole section is neutral", () => {
      const self = (id: string | null | undefined) => id === "d2";
      expect(kind(sceneRow, four({ height: 2, isSelf: self }))).toBe("neutral");
    });

    it("refuses when landing after that lane would change nothing", () => {
      // the dragged Day sits at r1[3] -- so "after d2" is its own slot
      const atOrigin = (parentId: string | null, index: number) => parentId === "r1" && index === 3;
      expect(kind(sceneRow, four({ height: 2, isNoOp: atOrigin }))).toBe("neutral");
    });

    /* The row's OWN tier still wins over the chain -- dragging a scene
     * over a scene's strip is a reorder among scenes, not an "after the
     * Day above". Ordering, stated so a later edit can't quietly swap it. */
    it("the row's own tier is answered before the chain is consulted", () => {
      expect(landing(sceneRow, four({ height: 1 }))).toMatchObject({ parentId: "d2", index: 0 });
    });
  });

  it("every detail landing is a plain downward slot", () => {
    const p = landing({ ...lane, lower: false }, facts());
    expect(p).toMatchObject({ axis: "y", scope: "node", side: "before", room: SLOT_ROOM });
  });
});

/* ------------------------------------------------------------------ *
 *  OVERVIEW -- pickSlot
 *
 *  A synthetic column of three Days stacked down the page, each 100 tall
 *  with a 20px gutter, plus a second column beside it. Coordinates are
 *  the real shape: the measured box is the WRAPPER (a Day plus its own
 *  scenes), never the 5px band that heads it.
 *
 *        x:  0                     200
 *    y   0   [ d1  100 tall ]      [ e1 ]
 *    y 120   [ d2           ]      [ e2 ]
 *    y 240   [ d3           ]
 * ------------------------------------------------------------------ */
describe("pickSlot", () => {
  const box = (
    id: string,
    index: number,
    x: number,
    y: number,
    over: Partial<SlotBox> = {},
  ): SlotBox => ({
    parentId: "board",
    index,
    id,
    x,
    y,
    w: 150,
    h: 100,
    axis: "y",
    scope: "node",
    room: SLOT_ROOM,
    ...over,
  });

  const DAYS: SlotBox[] = [box("d1", 0, 0, 0), box("d2", 1, 0, 120), box("d3", 2, 0, 240)];
  const free: Pick<DragFacts, "isSelf" | "isNoOp"> = { isSelf: () => false, isNoOp: () => false };
  const pick = (px: number, py: number, slots = DAYS, drag = free) =>
    pickSlot(slots, px, py, drag);

  it("the upper half of a card is the gap above it", () => {
    expect(pick(75, 140)).toEqual({
      kind: "at",
      at: {
        parentId: "board",
        index: 1,
        beforeId: "d2",
        side: "before",
        axis: "y",
        scope: "node",
        room: SLOT_ROOM,
      },
    });
  });

  /* RULE 1 -- THE ONE THAT BROKE TWICE. "After d1" and "before d2" are
   * the same reorder, so they must resolve to the SAME landing, drawn in
   * the one place. Anchoring to whichever card the cursor is nearest
   * painted a slot above AND below every header. */
  it("the lower half of a card and the upper half of the next are ONE slot", () => {
    const afterD1 = pick(75, 90); // bottom of d1
    const beforeD2 = pick(75, 140); // top of d2
    expect(afterD1).toEqual(beforeD2);
    expect(afterD1).toMatchObject({ kind: "at", at: { beforeId: "d2", side: "before" } });
  });

  /* ...and the same holds in the GUTTER between them, which belongs to
   * whichever box is nearer but must not produce a third answer. */
  it("the gutter between two cards resolves to that same one slot", () => {
    expect(pick(75, 110)).toEqual(pick(75, 140));
  });

  /* RULE 1's other half. Past the last card there is no next sibling to
   * hang the gap on -- so the "after" form exists there and ONLY there.
   * That slot had no way to draw at all before, which meant you couldn't
   * drop at the end of a run either. */
  it("the end of a run is the one place the after-form appears", () => {
    expect(pick(75, 330)).toMatchObject({
      kind: "at",
      at: { index: 3, beforeId: "d3", side: "after" },
    });
    // every other landing in the run is a "before"
    for (const y of [10, 90, 140, 250]) {
      expect(pick(75, y)).toMatchObject({ at: { side: "before" } });
    }
  });

  /* RULE 4. Both index and index+1 at the origin are the same slot once
   * the node is lifted out -- and unlike "no candidate", this CLEARS, so
   * a gap left over from a moment ago stops promising an edit. */
  it("a drop that changes nothing publishes nothing, and clears", () => {
    const atOrigin = (parentId: string | null, index: number) =>
      parentId === "board" && (index === 1 || index === 2);
    const drag = { ...free, isNoOp: atOrigin };
    expect(pick(75, 140, DAYS, drag)).toEqual({ kind: "noop" }); // before d2
    expect(pick(75, 190, DAYS, drag)).toEqual({ kind: "noop" }); // after d2
    expect(pick(75, 40, DAYS, drag)).toMatchObject({ kind: "at" }); // before d1 is real
  });

  /* The dragged box is not a distance candidate, so the answer is derived
   * from a NEIGHBOUR's geometry. At d2's own center that is the whole
   * difference: measured off d2 the cursor is past its midpoint (index
   * 2), measured off d1 it is not (index 1).
   *
   * The landing still NAMES d2 -- that is the canonical home rule, not a
   * leak: `beforeId` says where the gap draws, and the gap before d2 is a
   * real insertion point. (In the app isNoOp refuses both of these anyway
   * while d2 is in hand; this guard is the belt to that pair of braces.) */
  it("never measures against the thing in your hand", () => {
    const drag = { ...free, isSelf: (id: string | null | undefined) => id === "d2" };
    expect(pick(75, 170, DAYS, drag)).toMatchObject({ at: { index: 1, beforeId: "d2" } });
    expect(pick(75, 170, DAYS, free)).toMatchObject({ at: { index: 2, beforeId: "d3" } });
  });

  /* Distinct from "noop" on purpose: nothing to say, so leave whatever
   * slot is showing rather than blanking it as the cursor crosses its
   * own subtree. */
  it("reports self when every candidate is inside the dragged node", () => {
    expect(pick(75, 140, DAYS, { ...free, isSelf: () => true })).toEqual({ kind: "self" });
    expect(pick(75, 140, [], free)).toEqual({ kind: "self" });
  });

  /* Distance is to the BOX, not its center. A tall spine's center can sit
   * far from the cursor while the cursor is inside it; measuring centers
   * is what let a neighbour steal a drop you were plainly over. */
  it("the box you are inside beats a nearer-by-centre neighbour", () => {
    const spine = box("spine", 0, 0, 0, { w: 20, h: 400 });
    const card = box("card", 1, 30, 0, { w: 150, h: 40 });
    // (10, 380): inside the spine; the card's center is much closer
    expect(pickSlot([spine, card], 10, 380, free)).toMatchObject({ at: { beforeId: "card" } });
    expect(pickSlot([spine, card], 10, 380, free)).toMatchObject({ at: { index: 1 } });
  });

  /* RULE 3, as pickSlot sees it: the axis rides on the slot (measured
   * from the tier's actual layout) and decides which way the box is
   * halved. A row of columns halves left/right, a stack halves up/down. */
  it("an x-axis slot halves the box sideways, not vertically", () => {
    const cols = [
      box("c1", 0, 0, 0, { axis: "x", w: 100, h: 400 }),
      box("c2", 1, 120, 0, { axis: "x", w: 100, h: 400 }),
    ];
    // right half of c1 -> the gap before c2; y is irrelevant
    expect(pickSlot(cols, 90, 10, free)).toMatchObject({ at: { index: 1, beforeId: "c2" } });
    expect(pickSlot(cols, 90, 390, free)).toMatchObject({ at: { index: 1, beforeId: "c2" } });
    // left half of c1 -> the gap before c1
    expect(pickSlot(cols, 10, 200, free)).toMatchObject({ at: { index: 0, beforeId: "c1" } });
  });

  /* RULE 3's other half: WHAT moves aside. At the column tier the whole
   * column shifts by half its own measured width, so both ride through
   * from the slot rather than being re-derived at publish time. */
  it("scope and room carry through from the measured slot", () => {
    const cols = [
      box("c1", 0, 0, 0, { axis: "x", scope: "column", room: 90 }),
      box("c2", 1, 200, 0, { axis: "x", scope: "column", room: 90 }),
    ];
    expect(pickSlot(cols, 10, 10, free)).toMatchObject({
      at: { scope: "column", room: 90, axis: "x" },
    });
  });

  /* The canonical home is per PARENT: a slot at index 1 under one lane
   * must not be answered by the node at index 1 under another. */
  it("the next sibling is found within the same parent only", () => {
    const mixed: SlotBox[] = [
      box("a1", 0, 0, 0, { parentId: "A" }),
      box("b1", 0, 200, 0, { parentId: "B" }),
      box("b2", 1, 200, 120, { parentId: "B" }),
    ];
    // past the bottom of A's only child -> end of A's run, so "after"
    expect(pickSlot(mixed, 75, 90, free)).toMatchObject({
      at: { parentId: "A", index: 1, beforeId: "a1", side: "after" },
    });
  });
});

/* ------------------------------------------------------------------ *
 *  THE OVERVIEW'S GAP SELECTOR
 *
 *  This is logic that fails SILENTLY when it is wrong -- the class lands,
 *  the arithmetic is right, and nothing paints. It has now shipped broken
 *  twice (an orphaned `.look[data-shadow]` prefix in the detail view, and
 *  the leaf case below), so the shape of each selector is pinned.
 * ------------------------------------------------------------------ */
describe("gapSelector", () => {
  /* Rule 2: a gap hangs on the whole node, never on the 5px bar heading
   * it -- so a band's gap targets the WRAPPER that holds the Day together
   * with its scenes. `:has(>` and not `:has(` so it is that node's own
   * wrapper rather than some ancestor further up. */
  it("a band or scene card moves its wrapper, by direct child", () => {
    expect(gapSelector("node", "s3")).toBe(
      '.ov-viewport :is(.ov-block, .ov-scene):has(> [data-node="s3"])',
    );
  });

  it("the column tier moves the whole column", () => {
    expect(gapSelector("column", "r2")).toBe('.ov-viewport .ov-column:has([data-node="r2"])');
  });

  /* THE LEAF, which is why beats showed no preview at all. A beat cell is
   * nested `.ov-scene > .ov-cells > .ov-cell-row > [data-node]`, so it is
   * nobody's direct child and the wrapper form matches NOTHING. The cell
   * is the whole node; the gap hangs on it. */
  it("a beat cell IS the node, so it is targeted directly", () => {
    expect(gapSelector("cell", "b7")).toBe('.ov-viewport [data-node="b7"]');
  });

  it("no scope produces a selector needing a node inside itself", () => {
    for (const scope of ["node", "column", "cell"] as const) {
      const sel = gapSelector(scope, "x1");
      // the same compound twice down a descendant chain can never match
      const steps = sel.split(/\s+/).filter((s) => !/^[>+~]$/.test(s));
      expect(new Set(steps).size).toBe(steps.length);
    }
  });
});

/* ------------------------------------------------------------------ *
 *  THE TWO VIEWS AGREE
 *
 *  The bugs were never in one statement of the rule -- they were the two
 *  statements drifting apart. This is the check that notices.
 * ------------------------------------------------------------------ */
describe("detail and Overview resolve one gesture the same way", () => {
  const free: Pick<DragFacts, "isSelf" | "isNoOp"> = { isSelf: () => false, isNoOp: () => false };
  const boxes: SlotBox[] = [0, 1, 2].map((i) => ({
    parentId: "r1",
    index: i,
    id: `s${i + 1}`,
    x: 0,
    y: i * 120,
    w: 150,
    h: 100,
    axis: "y" as const,
    scope: "node" as const,
    room: SLOT_ROOM,
  }));
  const row = (index: number, lower: boolean) => {
    const p = planRow(
      { depth: 1, parentId: "r1", index, childDepth: 2, nodeId: `s${index + 1}`, lower },
      { height: 1, ladder: 3, overtops: false, ...free },
    );
    return p.kind === "at" ? p.at : null;
  };
  const over = (py: number) => {
    const p = pickSlot(boxes, 75, py, free);
    return p.kind === "at" ? p.at : null;
  };

  /* Same (parent, index) for the same gesture, in both directions:
   * hovering the bottom of s2 and the top of s3 are one insertion point,
   * and detail must reach it too. */
  it("the same insertion point comes out of both", () => {
    for (const [index, lower, py] of [
      [0, false, 40], // top of s1
      [1, false, 140], // top of s2
      [1, true, 190], // bottom of s2 == top of s3
      [2, false, 250], // top of s3
    ] as const) {
      expect(row(index, lower)).toMatchObject({ parentId: "r1", index: over(py)!.index });
    }
  });

  /* Where they legitimately DIFFER, and why: detail hands the gap to the
   * next sibling by index (beforeId null, because the row that draws it
   * is a different row); the Overview has no rows to hand it to, so it
   * names the id. Same slot, two ways of pointing at it. */
  it("they point at that slot differently, by index vs by id", () => {
    expect(row(1, true)?.beforeId).toBeNull();
    expect(over(190)?.beforeId).toBe("s3");
    expect(row(1, true)!.index).toBe(over(190)!.index);
  });
});
