import { describe, expect, it } from "vitest";
import { resolveBackdrop } from "./boardLook";

const mine = { boardBg: "slate" as const, customBg: "#112233", customGrain: true, overrideBackdrop: false };

/* THE WHOLE RULE (owner, 2026-09-10): the switch on shows yours, the
 * switch off shows the board's. There is no third case -- a board with
 * nothing written wears the app's default, not yours, because "defaults
 * are still settings" and every board therefore has a backdrop. */
describe("resolveBackdrop", () => {
  it("shows the board's own look when it has one", () => {
    expect(resolveBackdrop(mine, { bg: "cork" })).toMatchObject({ bg: "cork", grain: false, shared: true });
  });

  /* The bug this replaced: a board with no stored look fell back to
   * YOURS, so your override showed whether the switch was on or off and
   * the switch read as broken. */
  it("shows the DEFAULT on a board with nothing written, never yours", () => {
    const b = resolveBackdrop(mine, undefined);
    expect(b).toMatchObject({ bg: "cork", grain: false, shared: true });
    expect(b.bg).not.toBe(mine.boardBg);
  });

  it("the override on shows yours, whatever the board says", () => {
    expect(resolveBackdrop({ ...mine, overrideBackdrop: true }, { bg: "cork" })).toMatchObject({
      bg: "slate",
      grain: true,
      shared: false,
    });
  });

  /* And it has to bite on a board with nothing written too -- that is the
   * case that used to be indistinguishable from the switch being off. */
  it("the override on is visible on a board with nothing written", () => {
    const off = resolveBackdrop(mine, undefined);
    const on = resolveBackdrop({ ...mine, overrideBackdrop: true }, undefined);
    expect(on).toMatchObject({ bg: "slate", shared: false });
    expect(on.bg).not.toBe(off.bg);
  });

  it("a board's custom color without one set borrows yours, so the swatch is never blank", () => {
    expect(resolveBackdrop(mine, { bg: "custom" }).custom).toBe("#112233");
  });
});
