import { describe, expect, it } from "vitest";
import { hoistNeeded, isOption, planHoist, usedColorIds } from "./palette";
import type { Board, LegendEntry, Node } from "./types";

const entry = (id: string, label: string, tier?: string): LegendEntry => ({ id, label, bg: "#" + id.padEnd(6, "0").slice(0, 6), border: "#000000", ...(tier ? { tier } : {}) });
const node = (id: string, color?: string, children: Node[] = []): Node => ({ id, title: id, children, ...(color ? { color } : {}) }) as unknown as Node;
const board = (id: string, legend: LegendEntry[], roots: Node[] = []): Board =>
  ({ id, title: id, levels: [{ id: "L", name: "Beat" }], legend, roots }) as unknown as Board;

/* The owner's rules for a color that travels between boards (ADR 0006). */
describe("planHoist", () => {
  it("moves a board's option entries up and leaves its tier defaults", () => {
    const b = board("b1", [entry("tierL", "Beat", "L"), entry("broll", "B-roll")]);
    const h = planHoist([b], []);
    expect(h.add.map((e) => e.id)).toEqual(["broll"]);
    expect(h.strip.get("b1")).toEqual(["broll"]);
    expect(h.remap.size).toBe(0);
    expect(isOption(entry("tierL", "Beat", "L"))).toBe(false);
  });
  it("keeps a reference the palette already has, and the project's version wins", () => {
    const b = board("b1", [entry("broll", "B-roll (mine)")]);
    const h = planHoist([b], [entry("broll", "B-roll")]);
    expect(h.add).toEqual([]);
    expect(h.remap.size).toBe(0);
    expect(h.strip.get("b1")).toEqual(["broll"]);
  });
  it("remaps a same-label entry onto the project's, case and space blind", () => {
    const b = board("b1", [entry("x9", "  needs REVIEW ")]);
    const h = planHoist([b], [entry("review", "Needs review")]);
    expect(h.add).toEqual([]);
    expect(h.remap.get("x9")).toBe("review");
  });
  it("merges two boards that named the same color separately: first met wins", () => {
    const a = board("a", [entry("a1", "Archival")]);
    const b = board("b", [entry("b1", "archival")]);
    const h = planHoist([a, b], []);
    expect(h.add.map((e) => e.id)).toEqual(["a1"]);
    expect(h.remap.get("b1")).toBe("a1");
  });
  it("never matches unnamed entries by label", () => {
    const a = board("a", [entry("a1", "")]);
    const b = board("b", [entry("b1", "")]);
    const h = planHoist([a, b], []);
    expect(h.add.map((e) => e.id)).toEqual(["a1", "b1"]);
  });
  it("is a no-op on a hoisted project, so the repair pass can run it every sync", () => {
    const b = board("b1", [entry("tierL", "Beat", "L")]);
    const h = planHoist([b], [entry("broll", "B-roll")]);
    expect(hoistNeeded(h)).toBe(false);
  });
});

describe("usedColorIds", () => {
  it("collects the colors cards name, at any depth", () => {
    const b = board("b", [], [node("r", "a", [node("c", "b"), node("d")])]);
    expect([...usedColorIds(b)].sort()).toEqual(["a", "b"]);
  });
});
