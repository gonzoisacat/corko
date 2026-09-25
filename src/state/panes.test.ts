import { describe, expect, it } from "vitest";
import { singleFrom, splitFrom, type PanesPref } from "./panes";

const base: PanesPref = {
  a: "cut-1",
  b: "other",
  view: "single",
  viewA: "detail",
  viewB: "detail",
  driving: true,
  driver: "active",
};

/* Flipping into split mirrors the board you are on (owner, 2026-09-04). */
describe("splitFrom", () => {
  it("opens the same board in the second panel", () => {
    const p = splitFrom(base, "cut-1", true);
    expect(p.view).toBe("split");
    expect(p.b).toBe("cut-1");
  });
  it("opens a Beat Map in the OTHER view", () => {
    expect(splitFrom(base, "cut-1", true).viewB).toBe("overview");
    expect(splitFrom({ ...base, viewA: "overview" }, "cut-1", true).viewB).toBe("detail");
  });
  it("leaves a typed board's view flag alone -- it has one view", () => {
    expect(splitFrom({ ...base, viewB: "overview" }, "grid-1", false).viewB).toBe("overview");
    expect(splitFrom(base, "grid-1", false).b).toBe("grid-1");
  });
  it("falls back to the stored id when pane A resolved nothing", () => {
    expect(splitFrom(base, null, true).b).toBe("cut-1");
  });
  it("overrides a remembered second board every time", () => {
    expect(splitFrom({ ...base, b: "remembered" }, "cut-1", true).b).toBe("cut-1");
  });
});

/* Leaving Split keeps the panel you were working in (owner, 2026-09-04). */
describe("singleFrom", () => {
  const split: PanesPref = { ...base, view: "split", a: "left", b: "right", viewA: "detail", viewB: "overview" };
  it("keeps A when A was active", () => {
    const p = singleFrom(split, "a", "single");
    expect([p.view, p.a, p.viewA]).toEqual(["single", "left", "detail"]);
  });
  it("swaps B into A when B was active, and remembers A in B", () => {
    const p = singleFrom(split, "b", "single");
    expect([p.a, p.viewA, p.b, p.viewB]).toEqual(["right", "overview", "left", "detail"]);
  });
  it("does the same going to Notes", () => {
    expect(singleFrom(split, "b", "notes").a).toBe("right");
  });
  it("changes nothing but the view when not coming from Split", () => {
    const p = singleFrom({ ...base, view: "notes" }, "b", "single");
    expect([p.view, p.a, p.b]).toEqual(["single", "cut-1", "other"]);
  });
});
