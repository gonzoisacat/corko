import { describe, expect, it } from "vitest";
import { SHED_STEPS, shedTokens } from "./topbarShed";

/* The ladder is the owner's order (2026-09-04): the pile first, then
 * Usage, then the Project View label, then the sync note's words, then
 * the Project Name label. Pinned so a reorder is a deliberate change. */
describe("topbar shed ladder", () => {
  it("sheds in the owner's order", () => {
    expect([...SHED_STEPS]).toEqual(["pile", "usage", "view-label", "sync-text", "name-label"]);
  });
  it("stamps a cumulative token list", () => {
    expect(shedTokens(0)).toBe("");
    expect(shedTokens(1)).toBe("pile");
    expect(shedTokens(3)).toBe("pile usage view-label");
    expect(shedTokens(SHED_STEPS.length)).toBe("pile usage view-label sync-text name-label");
  });
});
