import { describe, expect, it } from "vitest";
import { cardFill, splitColors, splitFill, SPLIT_AXIS_CSS } from "./tagSplit";
import type { TagDef } from "../state/types";

/* ------------------------------------------------------------------ *
 *  Split tags (ADR 0005). Two rules carry the whole feature and both are
 *  easy to break from a distance, so both are pinned here:
 *
 *    1. the LEGEND's order, read FORWARD -- topmost entry is leftmost,
 *       which is the opposite direction to TagTabs' sort;
 *    2. N + 1 -- the card's own fill always keeps the first share.
 * ------------------------------------------------------------------ */

const tag = (id: string, over: Partial<TagDef> = {}): TagDef => ({
  id,
  name: id,
  color: `#${id.repeat(6).slice(0, 6)}`,
  pos: 0,
  reach: 10,
  span: 10,
  offset: 0,
  shape: "flat",
  visible: true,
  kind: "split",
  ...over,
});

describe("splitColors", () => {
  /* The order is the vocabulary's, NOT the card's own array -- the same
   * reason TagTabs stopped trusting it: `node.tags` is the order they
   * happened to be applied, so two cards carrying the same pair would
   * otherwise stripe in opposite orders. */
  it("orders by the legend, not by how the card applied them", () => {
    const tags = [tag("a"), tag("b"), tag("c")];
    // applied in reverse; must still come out legend-order
    expect(splitColors(["c", "b", "a"], tags)).toEqual([tag("a").color, tag("b").color, tag("c").color]);
  });

  /* THE DIRECTION, stated on its own because it is the opposite of the
   * tab sort sitting one file away. Legend-topmost is LEFTMOST here;
   * legend-topmost is drawn LAST (on top) there. */
  it("reads the legend forward -- topmost entry lands leftmost", () => {
    const tags = [tag("a"), tag("b")];
    const [first] = splitColors(["a", "b"], tags);
    expect(first).toBe(tag("a").color);
  });

  it("ignores tags this card does not carry", () => {
    const tags = [tag("a"), tag("b"), tag("c")];
    expect(splitColors(["b"], tags)).toEqual([tag("b").color]);
  });

  it("ignores tab-kind tags entirely", () => {
    const tags = [tag("a", { kind: "tab" }), tag("b")];
    expect(splitColors(["a", "b"], tags)).toEqual([tag("b").color]);
  });

  /* A tag with no `kind` is a tab -- every board older than this feature
   * is full of them, and they must not start slicing cards. */
  it("treats a tag with no kind as a tab", () => {
    const legacy = { ...tag("a"), kind: undefined } as TagDef;
    expect(splitColors(["a"], [legacy])).toEqual([]);
  });

  /* An invisible tag stays applied and stays highlightable from the
   * legend -- that is the entire point of the toggle -- so it must not
   * quietly take a share and shrink everything else. */
  it("gives an invisible tag no share", () => {
    const tags = [tag("a", { visible: false }), tag("b")];
    expect(splitColors(["a", "b"], tags)).toEqual([tag("b").color]);
  });

  it("is empty for a card with no tags", () => {
    expect(splitColors(undefined, [tag("a")])).toEqual([]);
    expect(splitColors([], [tag("a")])).toEqual([]);
  });
});

describe("splitFill", () => {
  /* N + 1. One split tag is HALF, not the whole card: take the whole
   * card and a split would just be a color override, which is the thing
   * this deliberately is not. */
  it("leaves the fill the first share, so one tag is a half", () => {
    const s = splitFill("#fff", ["#f00"]);
    expect(s.backgroundColor).toBe("#fff");
    expect(s.backgroundImage).toBe("linear-gradient(var(--split-axis, to right), transparent 0 50%, #f00 50% 100%)");
  });

  it("two tags make thirds, three make quarters", () => {
    expect(splitFill("#fff", ["#f00", "#0f0"]).backgroundImage).toContain("transparent 0 33.333%");
    expect(splitFill("#fff", ["#f00", "#0f0", "#00f"]).backgroundImage).toContain("transparent 0 25%");
  });

  /* The regions tile exactly: each starts where the last ended, and the
   * final one reaches the right edge. A gap would show the fill through
   * the middle of the stripes and read as a fourth color. */
  it("tiles the card with no gaps and ends flush at 100%", () => {
    const img = splitFill("#fff", ["#f00", "#0f0", "#00f"]).backgroundImage!;
    expect(img).toBe(
      "linear-gradient(var(--split-axis, to right), transparent 0 25%, #f00 25% 50%, #0f0 50% 75%, #00f 75% 100%)",
    );
  });

  /* The fill's share is TRANSPARENT rather than a copy of the color, so
   * there is one source of truth for it -- a tier default changing must
   * not require the gradient to be rebuilt. */
  it("shows the fill through rather than restating it", () => {
    const s = splitFill("#abcdef", ["#f00"]);
    expect(s.backgroundImage).toContain("transparent 0");
    expect(s.backgroundImage).not.toContain("#abcdef");
  });

  it("a card with no split tags is a plain fill", () => {
    expect(splitFill("#abc", [])).toEqual({ background: "#abc" });
  });

  /* Identical cards must produce identical style strings -- React diffs
   * these as text, and an unrounded 1/3 differs in the last digit. */
  it("rounds the stops so two identical cards write identical styles", () => {
    const a = splitFill("#fff", ["#f00", "#0f0"]).backgroundImage;
    const b = splitFill("#fff", ["#f00", "#0f0"]).backgroundImage;
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{6,}%/); // no 33.33333333333333%
  });
});

describe("cardFill", () => {
  it("is a plain fill when nothing splits it", () => {
    expect(cardFill("#abc", ["a"], [tag("a", { kind: "tab" })])).toEqual({ background: "#abc" });
    expect(cardFill("#abc", undefined, undefined)).toEqual({ background: "#abc" });
  });

  /* The whole feature in one assertion: fill first, then the splits in
   * legend order, left to right. */
  it("puts the fill first and the splits after it in legend order", () => {
    const tags = [tag("a", { color: "#111111" }), tag("b", { color: "#222222" })];
    const s = cardFill("#fill00", ["b", "a"], tags);
    expect(s.backgroundColor).toBe("#fill00");
    expect(s.backgroundImage).toBe(
      "linear-gradient(var(--split-axis, to right), transparent 0 33.333%, #111111 33.333% 66.667%, #222222 66.667% 100%)",
    );
  });
});

/* ------------------------------------------------------------------ *
 *  EITHER A TAB OR A SPLIT, NEVER BOTH (owner-reported 2026-08-05).
 *
 *  The two kinds are two renderers over one vocabulary, so each has to
 *  decline the other's tags. splitColors already skipped tab-kind tags;
 *  TagTabs was drawing split-kind ones as well, which put a second and
 *  meaningless mark on the card wherever the unused tab defaults
 *  happened to place it.
 *
 *  This asserts the two filters PARTITION the card's tags -- every
 *  visible tag goes to exactly one renderer. TagTabs' own filter is
 *  restated here rather than imported because it lives inside a React
 *  component; if that ever drifts, this is the test that should fail.
 * ------------------------------------------------------------------ */
describe("the two renderers partition a card's tags", () => {
  const drawnAsTabs = (ids: string[], tags: TagDef[]) =>
    ids
      .map((id) => tags.find((t) => t.id === id))
      .filter((t): t is TagDef => !!t && t.visible && t.kind !== "split")
      .map((t) => t.color);

  it("no visible tag is drawn by both, and none is dropped by both", () => {
    const tags = [
      tag("a", { kind: "split", color: "#aaaaaa" }),
      tag("b", { kind: "tab", color: "#bbbbbb" }),
      tag("c", { kind: "split", color: "#cccccc" }),
      tag("d", { kind: undefined, color: "#dddddd" }), // legacy = tab
    ];
    const ids = ["a", "b", "c", "d"];
    const asSplit = splitColors(ids, tags);
    const asTab = drawnAsTabs(ids, tags);

    expect(asSplit).toEqual(["#aaaaaa", "#cccccc"]);
    expect(asTab).toEqual(["#bbbbbb", "#dddddd"]);
    // disjoint...
    expect(asSplit.filter((c) => asTab.includes(c))).toEqual([]);
    // ...and complete
    expect([...asSplit, ...asTab].sort()).toEqual(["#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd"]);
  });

  it("an invisible tag is drawn by neither, whatever its kind", () => {
    const tags = [tag("a", { kind: "split", visible: false }), tag("b", { kind: "tab", visible: false })];
    expect(splitColors(["a", "b"], tags)).toEqual([]);
    expect(drawnAsTabs(["a", "b"], tags)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 *  The split AXIS (owner's ask, 2026-08-05): one direction for the whole
 *  project, published as a CSS variable rather than threaded to cards.
 * ------------------------------------------------------------------ */
describe("SPLIT_AXIS_CSS", () => {
  /* A gradient's color bands run PERPENDICULAR to its line, so the
   * diagonal that cuts from the LOWER LEFT to the TOP RIGHT is the line
   * pointing to the bottom-right corner -- which also puts the fill in
   * the top-left and runs the splits toward the bottom right, keeping
   * the same first-to-last order the other two have. Easy to "fix" to
   * `to top right` and invert the whole thing, hence the test. */
  it("maps each axis to the direction that cuts the card that way", () => {
    expect(SPLIT_AXIS_CSS.vertical).toBe("to right");
    expect(SPLIT_AXIS_CSS.horizontal).toBe("to bottom");
    expect(SPLIT_AXIS_CSS.diagonal).toBe("to bottom right");
  });

  /* Corner keywords, not angles: they track the card's aspect so the cut
   * meets the corners on a 1.85 beat and on a full-width band alike. */
  it("uses direction keywords rather than fixed angles", () => {
    for (const v of Object.values(SPLIT_AXIS_CSS)) {
      expect(v).toMatch(/^to /);
      expect(v).not.toMatch(/deg/);
    }
  });

  /* The gradient carries the variable, so ONE declaration on .app
   * re-resolves every card. If this ever becomes a literal again, the
   * axis silently stops working everywhere but the default. */
  it("the gradient defers its direction to the variable, defaulting to vertical", () => {
    const img = splitFill("#fff", ["#f00"]).backgroundImage!;
    expect(img).toContain("var(--split-axis, to right)");
    expect(img).toContain(SPLIT_AXIS_CSS.vertical); // the fallback IS the default axis
  });
});
