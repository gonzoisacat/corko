import { describe, expect, it } from "vitest";
import { shared, sharedSlot, sharedText, sharedValue, subjectLabel, tagShare, tagsOnAny } from "./groupEdit";
import type { Node } from "../state/types";

const node = (over: Partial<Node>): Node =>
  ({ id: "n", title: "A", collapsed: false, children: [], ...over }) as Node;

/* What a panel about a SELECTION shows (2026-09-12, his "mixed panel
 * ideally"): a value the cards share reads as itself; one they disagree
 * on reads as mixed; absent and empty agree. */
describe("shared", () => {
  it("agrees on one value, and on none", () => {
    expect(shared(["x", "x", "x"])).toEqual({ value: "x", mixed: false });
    expect(shared<string>([])).toEqual({ value: undefined, mixed: false });
    expect(shared(["x"])).toEqual({ value: "x", mixed: false });
  });
  it("is mixed when any card differs, carrying the first as the resting value", () => {
    expect(shared(["x", "y"])).toEqual({ value: "x", mixed: true });
    expect(shared([12, 12, 14])).toEqual({ value: 12, mixed: true });
    expect(shared([undefined, "x"])).toEqual({ value: undefined, mixed: true });
  });
});

describe("sharedValue", () => {
  const a = node({ id: "a", values: { tc: "01:00:00:00", loc: "Kitchen" } });
  const b = node({ id: "b", values: { tc: "01:00:00:00" } });
  const c = node({ id: "c", values: { tc: "01:00:00:00", loc: "" } });
  it("reads a category the cards share", () => {
    expect(sharedValue([a, b, c], "tc")).toEqual({ value: "01:00:00:00", mixed: false });
  });
  it("treats absent and empty as the same, and a differing card as mixed", () => {
    expect(sharedValue([b, c], "loc")).toEqual({ value: "", mixed: false });
    expect(sharedValue([a, b, c], "loc")).toEqual({ value: "Kitchen", mixed: true });
  });
  it("one card is never mixed", () => {
    expect(sharedValue([a], "loc")).toEqual({ value: "Kitchen", mixed: false });
  });
});

describe("sharedSlot", () => {
  it("reads which category sits in a slot across the set", () => {
    const a = node({ id: "a", slots: { bl: "tc" } });
    const b = node({ id: "b", slots: { bl: "tc", tr: "loc" } });
    expect(sharedSlot([a, b], "bl")).toEqual({ value: "tc", mixed: false });
    expect(sharedSlot([a, b], "tr")).toEqual({ value: null, mixed: true });
    expect(sharedSlot([a, b], "header")).toEqual({ value: null, mixed: false });
  });
});

describe("sharedText", () => {
  it("reads overrides, not results: absent is a value of its own", () => {
    const a = node({ id: "a", textColor: "#fff", textSize: 20, textShadow: true });
    const b = node({ id: "b", textColor: "#fff", textShadow: true });
    const t = sharedText([a, b]);
    expect(t.color).toEqual({ value: "#fff", mixed: false });
    expect(t.size).toEqual({ value: 20, mixed: true });
    expect(t.shadow).toEqual({ value: true, mixed: false });
    expect(t.font).toEqual({ value: undefined, mixed: false });
    expect(t.align).toEqual({ value: undefined, mixed: false });
    expect(t.clean).toBe(false);
  });
  it("is clean only when nothing is set on any card", () => {
    expect(sharedText([node({ id: "a" }), node({ id: "b" })]).clean).toBe(true);
    expect(sharedText([node({ id: "a" }), node({ id: "b", font: "marker" })]).clean).toBe(false);
  });
});

describe("tags across the set", () => {
  const a = node({ id: "a", tags: ["t1", "t2"] });
  const b = node({ id: "b", tags: ["t2"] });
  const c = node({ id: "c" });
  it("counts how many cards wear a tag", () => {
    expect(tagShare([a, b, c], "t2")).toEqual({ on: 2, of: 3 });
    expect(tagShare([a, b, c], "t1")).toEqual({ on: 1, of: 3 });
    expect(tagShare([a, b, c], "t9")).toEqual({ on: 0, of: 3 });
  });
  it("lists every tag on any card, in the project's order", () => {
    expect(tagsOnAny([a, b, c], ["t3", "t2", "t1"])).toEqual(["t2", "t1"]);
    expect(tagsOnAny([c], ["t1"])).toEqual([]);
  });
});

describe("subjectLabel", () => {
  it("names one card by its title and many by a count in the tier's word", () => {
    expect(subjectLabel(1, "Scene", "Kitchen")).toBe("Kitchen");
    expect(subjectLabel(3, "Scene", "Kitchen")).toBe("3 scenes");
    expect(subjectLabel(2, "Beat", "")).toBe("2 beats");
    expect(subjectLabel(2, "Class", "")).toBe("2 classes");
  });
});
