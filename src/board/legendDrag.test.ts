import { describe, expect, it } from "vitest";
import { LEGEND_DRAG_EFFECT } from "./legendDrag";

/* ------------------------------------------------------------------ *
 *  The chip drag's effectAllowed must permit BOTH effects.
 *
 *  Written after reordering a legend chip did nothing at all
 *  (owner-reported 2026-08-05): the source said effectAllowed "copy"
 *  while useChipReorder asked for dropEffect "move". HTML5 negotiates
 *  those two ends, and an unpermitted dropEffect is reset to "none" --
 *  so `drop` never fires. The marker still draws, because dragover is
 *  accepted either way, which is what made it look like a logic bug.
 *
 *  Nothing else could catch this: the handler, the op and the ordering
 *  arithmetic were all correct and simply never ran. Driving the same
 *  handlers with synthetic events "passed", because dispatching a drop
 *  by hand skips the negotiation entirely. So the value itself is the
 *  thing worth pinning -- "copy" is the tidy-looking edit that breaks it.
 * ------------------------------------------------------------------ */

/* The rule the browser applies, as spelled in the HTML drag-and-drop
 * model: which dropEffect values a given effectAllowed permits. */
const PERMITS: Record<string, string[]> = {
  none: [],
  copy: ["copy"],
  copyLink: ["copy", "link"],
  copyMove: ["copy", "move"],
  link: ["link"],
  linkMove: ["link", "move"],
  move: ["move"],
  all: ["copy", "link", "move"],
  uninitialized: ["copy", "link", "move"],
};

describe("LEGEND_DRAG_EFFECT", () => {
  /* The chip means two things and only the target decides which, so the
   * source has to allow both up front. */
  it("permits the copy a card-drop asks for AND the move a reorder asks for", () => {
    const permitted = PERMITS[LEGEND_DRAG_EFFECT];
    expect(permitted).toBeDefined();
    expect(permitted).toContain("copy"); // drop on a card -> apply the tag
    expect(permitted).toContain("move"); // drop on a sibling chip -> reorder
  });

  /* The regression, named: this exact value is what shipped, and it
   * silently disabled reordering while leaving apply-to-card working. */
  it("is not plain copy, which is what broke reordering", () => {
    expect(LEGEND_DRAG_EFFECT).not.toBe("copy");
  });

  it("is a value the drag-and-drop model actually defines", () => {
    expect(Object.keys(PERMITS)).toContain(LEGEND_DRAG_EFFECT);
  });
});
