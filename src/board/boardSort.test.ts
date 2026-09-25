import { describe, expect, it } from "vitest";
import { boardLabel, folderKey, folderPaths, shelfRows, sortBoards, folderContents } from "./boardSort";
import { idStamp, uid } from "../state/ids";

/* A board id carries its creation time (uid -> base36 Date.now()), so
 * these fixtures mint real ids at chosen times rather than faking a
 * field -- if the id format ever changes, these fail loudly, which is
 * the point. */
const at = (ms: number, n = 0) => `bd-${ms.toString(36)}xxxx-${n}`;
const T2026 = Date.UTC(2026, 7, 1);
const DAY = 864e5;

const b = (id: string, title: string) => ({ id, title });
const titles = (bs: { title: string }[]) => bs.map((x) => x.title);

describe("idStamp", () => {
  it("dates anything uid() minted", () => {
    const before = Date.now();
    const t = idStamp(uid("bd"));
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThanOrEqual(before - 1000);
    expect(t!).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("refuses `board-legacy` rather than dating it", () => {
    /* "legacy" is valid base36 and parses to Jan 2011 -- the exact trap
     * the plausibility window exists for. A confident wrong date here
     * would silently file the project's OLDEST board wherever 2011 lands. */
    expect(parseInt("legacy", 36)).toBeGreaterThan(0);
    expect(idStamp("board-legacy")).toBeNull();
  });

  it("refuses ids it did not mint", () => {
    expect(idStamp("nodash")).toBeNull();
    expect(idStamp("bd-!!!!!!!!-0")).toBeNull();
  });
});

describe("sortBoards -- alphabetical", () => {
  const bs = [b(at(T2026), "Zebra"), b(at(T2026 + DAY), "apple"), b(at(T2026 + 2 * DAY), "Mango")];

  it("is case-insensitive", () => {
    expect(titles(sortBoards(bs, "alpha", "asc"))).toEqual(["apple", "Mango", "Zebra"]);
  });

  it("reverses on desc", () => {
    expect(titles(sortBoards(bs, "alpha", "desc"))).toEqual(["Zebra", "Mango", "apple"]);
  });

  it("orders numbers the way a version shelf reads", () => {
    const v = [b(at(T2026), "Reel 10"), b(at(T2026), "Reel 2"), b(at(T2026), "Reel 1")];
    expect(titles(sortBoards(v, "alpha", "asc"))).toEqual(["Reel 1", "Reel 2", "Reel 10"]);
  });

  it("files an untitled board under the label it SHOWS", () => {
    const v = [b(at(T2026), "Alpha"), b(at(T2026), "   "), b(at(T2026), "Zulu")];
    // "Untitled board" sorts between Alpha and Zulu -- not first off ""
    expect(titles(sortBoards(v, "alpha", "asc"))).toEqual(["Alpha", "   ", "Zulu"]);
    expect(boardLabel({ title: "   " })).toBe("Untitled board");
  });
});

describe("sortBoards -- chronological", () => {
  it("orders by when the id was minted, not by array position", () => {
    // document order is deliberately NOT creation order: duplicateBoard
    // inserts a copy next to its original
    const bs = [
      b(at(T2026), "first"),
      b(at(T2026 + 5 * DAY), "duplicate made today"),
      b(at(T2026 + DAY), "second"),
    ];
    expect(titles(sortBoards(bs, "time", "asc"))).toEqual([
      "first",
      "second",
      "duplicate made today",
    ]);
    expect(titles(sortBoards(bs, "time", "desc"))).toEqual([
      "duplicate made today",
      "second",
      "first",
    ]);
  });

  it("puts an undatable id oldest, whichever way it is sorted", () => {
    const bs = [b(at(T2026 + DAY), "newer"), b("board-legacy", "the legacy board"), b(at(T2026), "older")];
    expect(titles(sortBoards(bs, "time", "asc"))[0]).toBe("the legacy board");
    // ...and last when reversed, i.e. it is ordered, not pinned to an end
    expect(titles(sortBoards(bs, "time", "desc"))).toEqual([
      "newer",
      "older",
      "the legacy board",
    ]);
  });
});

describe("sortBoards -- invariants", () => {
  const bs = [b(at(T2026), "b"), b(at(T2026 + DAY), "a"), b("board-legacy", "c")];

  it("never drops or invents a board", () => {
    for (const mode of ["alpha", "time"] as const) {
      for (const dir of ["asc", "desc"] as const) {
        const out = sortBoards(bs, mode, dir);
        expect(out).toHaveLength(bs.length);
        expect(new Set(out.map((x) => x.id))).toEqual(new Set(bs.map((x) => x.id)));
      }
    }
  });

  it("does not mutate its input", () => {
    const input = [...bs];
    sortBoards(input, "alpha", "desc");
    expect(input).toEqual(bs);
  });

  it("breaks ties by document order in BOTH directions", () => {
    /* Reversing the sorted array would flip tied boards too, so two
     * identically-named boards would trade places every time the arrow
     * was toggled. The index tiebreak is applied after the flip. */
    const same = [b(at(T2026), "Same"), b(at(T2026 + DAY), "Same"), b(at(T2026 + 2 * DAY), "Same")];
    const ids = (x: { id: string }[]) => x.map((v) => v.id);
    expect(ids(sortBoards(same, "alpha", "asc"))).toEqual(ids(same));
    expect(ids(sortBoards(same, "alpha", "desc"))).toEqual(ids(same));
  });
});

describe("shelfRows: folders that nest", () => {
  const b = (id: string, title: string, ...folder: string[]) => ({
    id, title, ...(folder.length ? { folder } : {}),
  });
  const shape = (rows: ReturnType<typeof shelfRows<ReturnType<typeof b>>>) =>
    rows.map((r) => (r.kind === "folder" ? `${"  ".repeat(r.depth)}[${r.name}:${r.count}]` : `${"  ".repeat(r.depth)}${r.board.title}`));

  it("draws folders first, then their boards, with the unfiled run last", () => {
    const rows = shelfRows([b("1", "loose"), b("2", "filed", "Archive")], "alpha", "asc");
    expect(shape(rows)).toEqual(["[Archive:1]", "  filed", "loose"]);
  });

  it("looks EXACTLY like today when nothing is filed", () => {
    const rows = shelfRows([b("1", "b"), b("2", "a")], "alpha", "asc");
    expect(shape(rows)).toEqual(["a", "b"]);
  });

  it("nests, and a parent counts every board BELOW it", () => {
    const rows = shelfRows(
      [b("1", "top", "Acme"), b("2", "deep", "Acme", "Reels")],
      "alpha",
      "asc",
    );
    expect(shape(rows)).toEqual(["[Acme:2]", "  [Reels:1]", "    deep", "  top"]);
  });

  it("INVENTS the ancestor of an orphaned path -- 'A/B' always implies 'A'", () => {
    const rows = shelfRows([b("1", "x", "Ghost", "Child")], "alpha", "asc");
    expect(shape(rows)).toEqual(["[Ghost:1]", "  [Child:1]", "    x"]);
  });

  it("shows an EMPTY declared folder, which is the whole point of declaring one", () => {
    const rows = shelfRows([b("1", "loose")], "alpha", "asc", [["Empty"]]);
    expect(shape(rows)).toEqual(["[Empty:0]", "loose"]);
  });

  it("a shut folder hides its WHOLE subtree, not just its own boards", () => {
    const rows = shelfRows(
      [b("1", "top", "Acme"), b("2", "deep", "Acme", "Reels")],
      "alpha",
      "asc",
      [],
      new Set([folderKey(["Acme"])]),
    );
    expect(shape(rows)).toEqual(["[Acme:2]"]);
  });

  it("sorts boards inside a folder by the chosen mode and direction", () => {
    const rows = shelfRows([b("1", "Reel 10", "F"), b("2", "Reel 2", "F")], "alpha", "asc");
    expect(shape(rows).slice(1)).toEqual(["  Reel 2", "  Reel 10"]);
    const d = shelfRows([b("1", "Reel 10", "F"), b("2", "Reel 2", "F")], "alpha", "desc");
    expect(shape(d).slice(1)).toEqual(["  Reel 10", "  Reel 2"]);
  });

  it("INTERLEAVES subfolders and boards, sorted together as siblings", () => {
    /* Two runs put a folder called "Zulu" above a board called "Alpha"
     * for no reason a reader can see. Inside one folder they are just
     * its contents. */
    const rows = shelfRows(
      [b("1", "Alpha", "Acme"), b("2", "Mid", "Acme"), b("3", "x", "Acme", "Zulu")],
      "alpha",
      "asc",
    );
    expect(shape(rows)).toEqual(["[Acme:3]", "  Alpha", "  Mid", "  [Zulu:1]", "    x"]);
  });

  it("interleaves at the ROOT too -- a top folder and a loose board sort together", () => {
    const rows = shelfRows([b("1", "Middle"), b("2", "x", "Alpha"), b("3", "Zulu")], "alpha", "asc");
    expect(shape(rows)).toEqual(["[Alpha:1]", "  x", "Middle", "Zulu"]);
  });

  it("headings FLIP with the direction now, because siblings sort together", () => {
    /* This supersedes the old rule that headings always read A-Z. Once a
     * folder and a board are siblings, a folder that did not reverse
     * would jump across the boards around it. */
    const rows = shelfRows([b("1", "Middle"), b("2", "x", "Alpha"), b("3", "Zulu")], "alpha", "desc");
    expect(shape(rows)).toEqual(["Zulu", "Middle", "[Alpha:1]", "  x"]);
  });

  it("CHRONOLOGICAL keeps folders first, because a folder has no date", () => {
    /* The clock sorts boards by the timestamp in their id and a folder
     * has none, so there is nothing to interleave against. Folders
     * first, alphabetically, is the only coherent reading. */
    const rows = shelfRows([b("1", "Zebra"), b("2", "x", "Alpha")], "time", "asc");
    expect(shape(rows)).toEqual(["[Alpha:1]", "  x", "Zebra"]);
  });

  it("folderPaths lists what exists, ancestors included, without blanks", () => {
    expect(folderPaths([b("1", "a", "Two", "Deep"), b("2", "b")], [["One"]]).map(folderKey))
      .toEqual([["One"], ["Two"], ["Two", "Deep"]].map(folderKey));
  });
});

describe("folderContents", () => {
  it("counts the boards in and under a folder and its distinct subfolders", () => {
    const boards = [
      { folder: ["A"] },
      { folder: ["A", "x"] },
      { folder: ["A", "x", "deep"] },
      { folder: ["A", "y"] },
      { folder: ["B"] },
      {},
    ];
    expect(folderContents(boards, [["A", "z"]], ["A"])).toEqual({ boards: 4, subfolders: 4 });
    expect(folderContents(boards, [], ["A", "x"])).toEqual({ boards: 2, subfolders: 1 });
    expect(folderContents(boards, [], ["Nope"])).toEqual({ boards: 0, subfolders: 0 });
  });
});
