import { describe, expect, it } from "vitest";
import { board4 } from "../test/fixtures";
import type { Board, Node, Project } from "./types";
import {
  boardOnlyStills,
  boardStills,
  formatBytes,
  planPurge,
  purgeSummary,
  referencedStills,
} from "./stillPurge";

/* ------------------------------------------------------------------ *
 *  PURGE.
 *
 *  Pinned harder than most things here because this is the one function
 *  in the app whose mistake DELETES somebody's frames. Every test below
 *  is really the same question: can this ever return a key something
 *  still points at?
 * ------------------------------------------------------------------ */

const withStills = (keys: (string | undefined)[]): Board => {
  const b = board4();
  const leaves: Node[] = [];
  const walk = (n: Node) => {
    if (!n.children.length) leaves.push(n);
    n.children.forEach(walk);
  };
  b.roots.forEach(walk);
  keys.forEach((k, i) => {
    if (k && leaves[i]) leaves[i].still = k;
  });
  return b;
};
const project = (boards: Board[]): Project => ({
  title: "P",
  boards,
  tags: [],
  fields: [],
});
const stored = (...keys: string[]) => keys.map((key) => ({ key, size: 1024 }));

describe("referencedStills", () => {
  it("collects across every board and every depth", () => {
    const p = project([withStills(["st-a", "st-b"]), withStills(["st-c"])]);
    expect([...referencedStills(p)].sort()).toEqual(["st-a", "st-b", "st-c"]);
  });

  it("is empty for a project with no stills, rather than throwing", () => {
    expect(referencedStills(project([board4()])).size).toBe(0);
    expect(referencedStills(project([])).size).toBe(0);
  });
});

describe("planPurge: only what NOTHING points at", () => {
  it("keeps a key a card still uses", () => {
    const p = project([withStills(["st-a"])]);
    expect(planPurge(p, stored("st-a")).orphans).toEqual([]);
  });

  it("A KEY SHARED BY TWO BOARDS IS NOT AN ORPHAN", () => {
    /* The case that makes this a project-wide sweep rather than a
     * per-card cleanup. Duplicating a board copies the cards and
     * `regenBoardIds` rewrites node ids but NOT the still key, so two
     * boards legitimately point at one frame. Deleting it because one
     * board stopped using it would blank the other. */
    const shared = withStills(["st-shared"]);
    const copy = withStills(["st-shared"]);
    const p = project([shared, copy]);
    expect(planPurge(p, stored("st-shared")).orphans).toEqual([]);

    /* ...and it only becomes reclaimable once BOTH have let go. */
    const one = project([copy]);
    expect(planPurge(one, stored("st-shared")).orphans).toEqual([]);
    expect(planPurge(project([]), stored("st-shared")).orphans.map((o) => o.key)).toEqual([
      "st-shared",
    ]);
  });

  it("finds the orphan and totals its bytes", () => {
    const p = project([withStills(["st-a"])]);
    const plan = planPurge(p, [
      { key: "st-a", size: 100 },
      { key: "st-gone", size: 2048 },
    ]);
    expect(plan.orphans.map((o) => o.key)).toEqual(["st-gone"]);
    expect(plan.bytes).toBe(2048);
  });

  it("REPORTS a referenced key that is missing, and never deletes for it", () => {
    /* The normal state for a collaborator who did not run the import, and
     * on a shared store it usually means an upload has not landed. It is
     * surfaced so blank cards are explicable, and it must not appear in
     * `orphans` -- acting on it would be deleting something on the
     * strength of it already being gone. */
    const p = project([withStills(["st-a", "st-nowhere"])]);
    const plan = planPurge(p, stored("st-a"));
    expect(plan.missing).toEqual(["st-nowhere"]);
    expect(plan.orphans).toEqual([]);
  });

  it("an empty store plans nothing, however many cards reference stills", () => {
    expect(planPurge(project([withStills(["st-a", "st-b"])]), []).orphans).toEqual([]);
  });

  it("an empty PROJECT makes every stored key an orphan", () => {
    /* Correct, and exactly why this runs on a deliberate press rather
     * than on load: a project that has not finished syncing looks like
     * this. */
    expect(planPurge(project([]), stored("st-a", "st-b")).orphans.length).toBe(2);
  });
});

describe("boardStills: the per-board case, for deleting one board's frames", () => {
  it("returns just that board's keys", () => {
    expect([...boardStills(withStills(["st-a", "st-b"]))].sort()).toEqual(["st-a", "st-b"]);
  });
});

describe("purgeSummary: the sentence and the deletion share one source", () => {
  it("says plainly when there is nothing to do", () => {
    expect(purgeSummary(planPurge(project([withStills(["st-a"])]), stored("st-a")))).toMatch(
      /Every stored image is still used by a card/,
    );
  });

  it("names the count and the size, and promises no board changes", () => {
    const plan = planPurge(project([]), [{ key: "st-x", size: 3 * 1024 * 1024 }]);
    const s = purgeSummary(plan);
    expect(s).toContain("1 stored image");
    expect(s).toContain("3.0 MB");
    expect(s).toContain("changes no board");
  });

  it("reads in KB when MB would round to nothing", () => {
    expect(purgeSummary(planPurge(project([]), [{ key: "st-x", size: 4096 }]))).toContain("4 KB");
  });

  it("REPORTS missing keys and never counts them as reclaimable", () => {
    /* A referenced key the store does not hold is the normal state for
     * an import that has not synced -- the dialog says so instead of
     * leaving "why are some cards blank" a mystery, and nothing offers
     * to act on it. */
    const plan = planPurge(project([withStills(["st-gone"])]), stored("st-x"));
    expect(plan.missing).toEqual(["st-gone"]);
    const s = purgeSummary(plan);
    expect(s).toContain("1 referenced image is not stored here");
    expect(s).toContain("left alone");
  });

  it("carries the sync + undo caveats whenever it offers a deletion", () => {
    const s = purgeSummary(planPurge(project([]), stored("st-x")));
    expect(s).toContain("imports have synced");
    expect(s).toContain("Undo cannot bring purged images back");
    /* ...and not on the nothing-to-do path, where there is no deletion
     * to caveat. */
    expect(purgeSummary(planPurge(project([withStills(["st-a"])]), stored("st-a")))).not.toContain(
      "undo",
    );
  });
});

describe("boardOnlyStills: what deleting ONE board would strand", () => {
  /* board4() mints one shape, so the ids must be set apart by hand --
   * two boards sharing an id would make the "every other board" filter
   * drop the wrong one, which is the bug this whole function is about. */
  const named = (id: string, keys: string[]): Board => ({ ...withStills(keys), id });

  it("counts the frames no other board references", () => {
    const p = project([named("b1", ["st-a", "st-b"]), named("b2", ["st-c"])]);
    expect(boardOnlyStills(p, "b1", stored("st-a", "st-b", "st-c"))).toEqual({
      count: 2,
      bytes: 2048,
    });
  });

  it("EXCLUDES a key a second board still uses -- the duplicate-board case", () => {
    /* Duplicating a board copies the cards and regenBoardIds rewrites
     * node ids but NOT still keys, so this is the ordinary state of a
     * project, not an edge case. Deleting b1 must not claim st-a. */
    const p = project([named("b1", ["st-a", "st-b"]), named("b2", ["st-a"])]);
    expect(boardOnlyStills(p, "b1", stored("st-a", "st-b"))).toEqual({ count: 1, bytes: 1024 });
  });

  it("ignores a referenced key the store does not hold", () => {
    /* Nothing to reclaim, so nothing to report -- the normal state for
     * a collaborator whose copy of the import has not synced. */
    const p = project([named("b1", ["st-a", "st-b"])]);
    expect(boardOnlyStills(p, "b1", stored("st-a"))).toEqual({ count: 1, bytes: 1024 });
  });

  it("ignores stored frames this board never referenced", () => {
    const p = project([named("b1", ["st-a"])]);
    expect(boardOnlyStills(p, "b1", stored("st-a", "st-orphan"))).toEqual({
      count: 1,
      bytes: 1024,
    });
  });

  it("answers zero for a board that is not in the project", () => {
    const p = project([named("b1", ["st-a"])]);
    expect(boardOnlyStills(p, "gone", stored("st-a"))).toEqual({ count: 0, bytes: 0 });
  });
});

describe("formatBytes: one size string for all three readers", () => {
  it("uses KB below 0.1 MB and MB above it", () => {
    expect(formatBytes(42 * 1024)).toBe("42 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("is the string purgeSummary quotes", () => {
    const p = project([withStills([])]);
    const plan = planPurge(p, stored("st-x", "st-y"));
    expect(purgeSummary(plan)).toContain(formatBytes(plan.bytes));
  });
});
