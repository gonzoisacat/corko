import { describe, expect, it } from "vitest";
import { cardText, plainText, shadowAttr } from "./cardText";
import type { Node } from "../state/types";

const node = (over: Partial<Node>): Node =>
  ({ id: "n1", title: "A", children: [], ...over }) as Node;

describe("cardText", () => {
  it("reads the card's own overrides over the tier's values", () => {
    const n = node({ textColor: "#fff", textSize: 22, textShadow: true });
    expect(cardText(n, "#111", 14)).toEqual({ color: "#fff", size: 22, shadow: true });
    expect(shadowAttr(n)).toBe("on");
    expect(cardText(node({}), "#111", 14)).toEqual({ color: "#111", size: 14, shadow: false });
  });

  /* the board's images switch (2026-09-08): a hidden picture takes the
   * text treatment written for it along -- the tier's values, no shadow */
  it("plain ignores every override, for a card whose picture is hidden", () => {
    const n = node({ textColor: "#fff", textSize: 22, textShadow: true, image: "data:," });
    expect(cardText(n, "#111", 14, true)).toEqual({ color: "#111", size: 14, shadow: false });
    expect(shadowAttr(n, true)).toBeUndefined();
  });
});

/* THE ONE RULE for when a card's words go plain (2026-09-10, pinned
 * 2026-09-11 when the audit found it restated six ways): the picture the
 * overrides were written for is not under the words -- hidden by the
 * board's images switch, or standing beside the card. A card with no
 * picture is never plain, whatever the switch says: its overrides were
 * written for paper. */
describe("plainText", () => {
  const pictured = node({ image: "data:," });
  const still = node({ still: "s-1" });
  it("is plain when the board's images switch is off", () => {
    expect(plainText(pictured, "off")).toBe(true);
    expect(plainText(still, "off")).toBe(true);
  });
  it("is plain when the picture stands beside the card, whatever the switch", () => {
    const side = node({ image: "data:,", imageFit: "side" });
    expect(plainText(side, "on")).toBe(true);
    expect(plainText(side, "only")).toBe(true);
    expect(plainText(side, "off")).toBe(true);
  });
  it("is not plain with the picture on the card and the switch on", () => {
    expect(plainText(pictured, "on")).toBe(false);
    expect(plainText(pictured, "only")).toBe(false);
    expect(plainText(node({ image: "data:,", imageFit: "fit" }), "on")).toBe(false);
  });
  it("is never plain for a card without a picture", () => {
    const bare = node({ textColor: "#fff", textShadow: true });
    expect(plainText(bare, "off")).toBe(false);
    expect(plainText(bare, "on")).toBe(false);
    expect(plainText(node({ imageFit: "side" }), "off")).toBe(false);
  });
});
