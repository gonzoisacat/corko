import { describe, expect, it } from "vitest";
import { slotRows } from "./slotRows";

describe("slotRows", () => {
  it("is empty with no slots, or slots without values", () => {
    expect(slotRows({})).toBe("");
    expect(slotRows({ slots: { tl: "f1" } })).toBe("");
    expect(slotRows({ slots: { tl: "f1" }, values: { f1: "" } })).toBe("");
    expect(slotRows({ slots: { tl: "f1" }, values: { f2: "x" } })).toBe("");
  });
  it("names the row a populated slot sits in", () => {
    expect(slotRows({ slots: { tl: "f1" }, values: { f1: "x" } })).toBe("top");
    expect(slotRows({ slots: { header: "f1" }, values: { f1: "x" } })).toBe("top");
    expect(slotRows({ slots: { tr: "f1" }, values: { f1: "x" } })).toBe("top");
    expect(slotRows({ slots: { bl: "f1" }, values: { f1: "x" } })).toBe("bottom");
    expect(slotRows({ slots: { footer: "f1" }, values: { f1: "x" } })).toBe("bottom");
    expect(slotRows({ slots: { br: "f1" }, values: { f1: "x" } })).toBe("bottom");
  });
  it("lists both rows as tokens when both hold a value", () => {
    expect(slotRows({ slots: { tl: "f1", br: "f2" }, values: { f1: "x", f2: "y" } })).toBe("top bottom");
    // one field sits in one slot only, so a bottom slot alone is bottom alone
    expect(slotRows({ slots: { br: "f1" }, values: { f1: "x" } })).toBe("bottom");
  });
});
