import { describe, expect, it } from "vitest";
import { board4, boardB, node } from "../test/fixtures";
import type { Board, Node, Project } from "./types";
import { isNested, nestTarget, nestUses } from "./nesting";

const nested = (id: string, ref: string, title = id): Node => ({
  ...node(id),
  title,
  boardRef: ref,
});

const project = (boards: Board[]): Project => ({
  title: "P",
  boards,
  tags: [],
  fields: [],
});

/* bd1's scene s1 points at bd2. */
function linked(): Project {
  const a = board4();
  a.roots[0].children[0].children[0] = nested("s1", "bd2", "Reel 3 -- Grief");
  return project([a, boardB()]);
}

describe("nesting: the reference graph", () => {
  it("isNested is the one definition", () => {
    expect(isNested(nested("x", "bd2"))).toBe(true);
    expect(isNested(node("x"))).toBe(false);
  });

  it("nestUses answers WHERE a board is used -- the delete refusal's list", () => {
    const uses = nestUses(linked()).get("bd2")!;
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({
      boardId: "bd1",
      boardTitle: "Test board",
      nodeId: "s1",
      nodeTitle: "Reel 3 -- Grief",
      depth: 2,
    });
  });

  it("...and counts every use, since one board may be nested many times", () => {
    const p = linked();
    p.boards[0].roots[0].children[0].children[1] = nested("s2", "bd2");
    expect(nestUses(p).get("bd2")).toHaveLength(2);
  });

  it("an unused board has no entry at all", () => {
    expect(nestUses(linked()).get("bd1")).toBeUndefined();
  });

  /* CYCLES ARE ALLOWED (owner, 2026-08-24), so the only thing that has
   * to hold is that the walks which DO exist never follow a ref -- they
   * walk boards and their nodes, so a loop is just data to them. */
  it("nestUses terminates and counts both sides of a LOOP", () => {
    const p = linked(); // bd1 -> bd2
    p.boards[1].roots[0].children[0].children[0] = nested("sB1", "bd1"); // and back
    const uses = nestUses(p);
    expect(uses.get("bd2")).toHaveLength(1);
    expect(uses.get("bd1")).toHaveLength(1);
  });

  it("nestTarget resolves, and answers null for a board that is gone", () => {
    const p = linked();
    const card = p.boards[0].roots[0].children[0].children[0];
    expect(nestTarget(p, card)?.id).toBe("bd2");
    expect(nestTarget(project([p.boards[0]]), card)).toBeNull();
    expect(nestTarget(p, node("plain"))).toBeNull();
  });
});
