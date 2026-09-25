import type { Board, LevelDef, Node, Project } from "../state/types";

/* Deterministic-id fixtures: a 4-tier board shaped like the default
 * ladder (reel -> section -> scene -> beat) with hand-picked ids so
 * tests can address nodes directly. */

/* Helpers below take a Board or a whole Project (walking every board --
 * node ids are unique doc-wide). */
type Scope = Board | Project;
const rootsOf = (s: Scope): Node[] =>
  "boards" in s ? s.boards.flatMap((b) => b.roots) : s.roots;

export const level = (id: string, name = id): LevelDef => ({
  id,
  name,
  variant: "scene",
  fields: { color: id === "beat", notes: true },
});

export const node = (id: string, children: Node[] = []): Node => ({
  id,
  title: id,
  collapsed: false,
  children,
});

/*  r1
 *    d1
 *      s1: b1 b2 b3
 *      s2: b4          */
export function board4(): Board {
  return {
    id: "bd1",
    title: "Test board",
    levels: [level("reel", "Reel"), level("section", "Section"), level("scene", "Scene"), level("beat", "Beat")],
    legend: [], // builders fall back to the default legend
    roots: [
      node("r1", [
        node("d1", [
          node("s1", [node("b1"), node("b2"), node("b3")]),
          node("s2", [node("b4")]),
        ]),
      ]),
    ],
  };
}

/* A second board on the same ladder (cross-board move/copy tests):
 *  rB1 > dB1 > sB1: bB1 bB2 */
export function boardB(): Board {
  return {
    id: "bd2",
    title: "Second board",
    levels: [level("reel", "Reel"), level("section", "Section"), level("scene", "Scene"), level("beat", "Beat")],
    legend: [],
    roots: [node("rB1", [node("dB1", [node("sB1", [node("bB1"), node("bB2")])])])],
  };
}

/* Walk a snapshot for the node with `id`; null when absent. */
export function find(scope: Scope, id: string): Node | null {
  const stack = [...rootsOf(scope)];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    stack.push(...n.children);
  }
  return null;
}

/* How many nodes in the snapshot carry `id` (repair invariant: 1). */
export function countId(scope: Scope, id: string): number {
  let count = 0;
  const stack = [...rootsOf(scope)];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) count++;
    stack.push(...n.children);
  }
  return count;
}

/* Child-id list of the node `id` -- most assertions are about order. */
export function childIds(scope: Scope, id: string): string[] {
  return find(scope, id)?.children.map((c) => c.id) ?? [];
}
