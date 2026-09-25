import { describe, expect, it } from "vitest";
import { board4 } from "../../test/fixtures";
import { collectColumns, collectItems } from "./overviewLayout";

/* ------------------------------------------------------------------ *
 *  board4: r1 > d1 > (s1 [b1 b2 b3], s2 [b4])
 *
 *  Columning by a deeper tier used to drop everything above it. It now
 *  emits a SPINE for each ancestor tier ENTERED, outermost first, so a
 *  new Reel puts up two bars (the reel, then its first day) and a new
 *  day inside the same reel puts up one.
 * ------------------------------------------------------------------ */

const shape = (items: ReturnType<typeof collectItems>) =>
  items.map((i) => `${i.kind === "spine" ? "spine" + i.depth : "col"}:${i.node.id}`);

describe("collectItems", () => {
  it("has no spines when the columns ARE the top tier", () => {
    expect(shape(collectItems(board4().roots, 0))).toEqual(["col:r1"]);
  });

  it("emits one spine per ancestor tier entered, outermost first", () => {
    // columns are scenes (depth 2): the reel and the day become spines
    expect(shape(collectItems(board4().roots, 2))).toEqual([
      "spine0:r1",
      "spine1:d1",
      "col:s1",
      "col:s2",
    ]);
  });

  it("re-opens a spine only when that ancestor changes", () => {
    const b = board4();
    // a second day under the same reel, holding one scene
    const d2 = { ...b.roots[0].children[0], id: "d2", children: [{ ...b.roots[0].children[0].children[1], id: "s3", children: [] }] };
    b.roots[0].children.push(d2);
    expect(shape(collectItems(b.roots, 2))).toEqual([
      "spine0:r1",
      "spine1:d1",
      "col:s1",
      "col:s2",
      "spine1:d2", // the reel doesn't repeat -- only the day changed
      "col:s3",
    ]);
  });

  it("carries each node's parent and index, like collectColumns", () => {
    const items = collectItems(board4().roots, 2);
    expect(items.map((i) => [i.parentId, i.index])).toEqual([
      [null, 0], // r1
      ["r1", 0], // d1
      ["d1", 0], // s1
      ["d1", 1], // s2
    ]);
    // the columns it emits are exactly the ones collectColumns finds
    expect(items.filter((i) => i.kind === "column").map((i) => i.node.id)).toEqual(
      collectColumns(board4().roots, 2).map((p) => p.node.id),
    );
  });

  it("a childless ancestor still shows its spine", () => {
    const b = board4();
    b.roots[0].children.push({ ...b.roots[0].children[0], id: "d-empty", children: [] });
    expect(shape(collectItems(b.roots, 2))).toContain("spine1:d-empty");
  });
});
