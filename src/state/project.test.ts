import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, resolveProject, roomFor, scopedFor, slugify } from "./project";

describe("which project a tab is in", () => {
  it("the URL wins, then memory, then the default", () => {
    expect(resolveProject("?p=acme", "birds")).toBe("acme");
    expect(resolveProject("", "birds")).toBe("birds");
    expect(resolveProject("", null)).toBe(DEFAULT_PROJECT);
    expect(resolveProject("?p=Bad%20Name", "birds")).toBe("birds");
    expect(resolveProject("", "Nope!")).toBe(DEFAULT_PROJECT);
  });

  it("a typed name becomes a slug that can be a room, a prefix and a URL", () => {
    expect(slugify("Harbor Cut")).toBe("harbor-cut");
    expect(slugify("  The Swallows -- 2026!  ")).toBe("the-swallows-2026");
    expect(slugify("!!!")).toBe("");
    expect(slugify("x".repeat(60))).toHaveLength(40);
    expect(slugify("Ünïcode Name")).toBe("n-code-name");
  });

  it("the default project keeps every key and the room it always had", () => {
    expect(roomFor(DEFAULT_PROJECT)).toBe("corko-default");
    expect(scopedFor("corko-panes", DEFAULT_PROJECT)).toBe("corko-panes");
    expect(scopedFor("corko-panes", "acme")).toBe("corko-panes:acme");
  });
});
