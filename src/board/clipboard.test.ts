import { describe, expect, it } from "vitest";
import { pasteFits } from "./clipboard";
import type { Node } from "../state/types";

const node = (id: string, children: Node[] = []): Node => ({ id, title: id, children }) as Node;

describe("pasteFits", () => {
  it("a clip with children pastes only at its own role height", () => {
    const clip = { nodes: [node("a", [node("b")])], height: 1 };
    expect(pasteFits(clip, 1)).toBe(true);
    expect(pasteFits(clip, 0)).toBe(false);
    expect(pasteFits(clip, 2)).toBe(false);
  });

  /* owner-reported 2026-09-08: a day card copied without children would
   * not paste on another day board whose Day sat at a different height */
  it("a childless clip pastes at any row", () => {
    const clip = { nodes: [node("a"), node("c")], height: 2 };
    expect(pasteFits(clip, 2)).toBe(true);
    expect(pasteFits(clip, 1)).toBe(true);
    expect(pasteFits(clip, 0)).toBe(true);
    expect(pasteFits({ nodes: [node("a"), node("b", [node("c")])], height: 1 }, 0)).toBe(false); // one with children spoils it
    expect(pasteFits(null, 0)).toBe(false);
    expect(pasteFits({ nodes: [], height: 0 }, 0)).toBe(false);
  });
});
