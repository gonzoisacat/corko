import { idStamp } from "../state/ids";
import type { BoardSort, SortDir } from "../state/settings";

/* ------------------------------------------------------------------ *
 *  How the Boards menu orders a project's boards.
 *
 *  Pure, so it can be pinned by boardSort.test.ts -- the ordering is the
 *  whole feature, and it has two edge cases that are easy to get wrong
 *  silently (an undatable id, and ties).
 *
 *  ALPHABETICAL is the default because that is how you look a board UP.
 *  Creation order only helps if you remember roughly when you made it,
 *  which stops being true about the time a project grows the dozen
 *  versions that make the menu worth sorting at all.
 *
 *  CHRONOLOGICAL is NOT document order, which is the tempting shortcut
 *  and is wrong: `duplicateBoard` inserts the copy next to its original
 *  (ydoc.ts, `boards.insert(at, ...)`), so a duplicate made today sits in
 *  the middle of the array. The ids carry the real answer -- see
 *  idStamp -- so this needs no new field on Board and no migration.
 * ------------------------------------------------------------------ */

/* Sort by what the menu SHOWS, so an untitled board files under "U"
 * where its label puts it rather than sorting first off an empty string.
 * Keep in step with the row's own fallback text. */
export const boardLabel = (b: { title: string }): string => b.title.trim() || "Untitled board";

export function sortBoards<T extends { id: string; title: string }>(
  boards: readonly T[],
  mode: BoardSort,
  dir: SortDir,
): T[] {
  const keyed = boards.map((b, i) => ({ b, i }));
  const cmp = (x: T, y: T): number => {
    if (mode === "alpha") {
      /* `numeric` so "Reel 2" precedes "Reel 10" -- version shelves are
       * full of numbered boards and a plain string sort reads as broken.
       * `sensitivity: base` so case and accents don't split the list. */
      return boardLabel(x).localeCompare(boardLabel(y), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    }
    const sx = idStamp(x.id);
    const sy = idStamp(y.id);
    // an undatable id is the OLDEST thing in the project by construction:
    // the only one in the wild is `board-legacy`, which predates Phase 4.
    if (sx === null || sy === null) return (sx === null ? 0 : 1) - (sy === null ? 0 : 1);
    return sx - sy;
  };
  keyed.sort((x, y) => {
    const d = cmp(x.b, y.b);
    /* Ties fall back to DOCUMENT order, and the index tiebreak is applied
     * after the direction flip rather than by reversing the result --
     * reversing would flip tied boards too, so two identically-named
     * boards would swap places every time you toggled the arrow. */
    return (dir === "desc" ? -d : d) || x.i - y.i;
  });
  return keyed.map((e) => e.b);
}

/* ------------------------------------------------------------------ *
 *  THE SHELF IN FOLDERS, WHICH NEST (owner, 2026-08-30).
 *
 *  Grouping only. A folder tidies the list and hides NOTHING -- keeping
 *  boards out of somebody's reach is a PROJECT, which is a room and its
 *  own doc. The two must not be conflated, or a folder eventually gets
 *  mistaken for a wall.
 *
 *  A FOLDER IS THE LIST OF NAMES THAT LEADS TO IT (state/types.ts
 *  Board.folder). No separator, so no character is special and nothing
 *  typed is mangled -- "Interviews/B-roll" is one ordinary name. Nesting
 *  is a GESTURE (drag a folder onto a folder), never a syntax.
 *
 *  `shelfRows` turns those lists into the flat, indented list the shelf
 *  draws -- flat because that is what the panel renders, and because a
 *  list with a depth on each row is far easier to test than a tree.
 *
 *  WHAT EXISTS is the union of Project.folders (which is how an EMPTY
 *  folder is real) and every folder a board names, plus every ancestor
 *  of both -- so ["A","B"] always implies ["A"], declared or not.
 * ------------------------------------------------------------------ */

/* An in-memory key for a folder, for Map lookups, React keys and the
 * collapsed set. The separator is a control character purely so it
 * cannot occur in a name -- and this string is NEVER written to the doc
 * or to a board file, which is the whole reason the stored shape is a
 * list. Keep it that way: the moment a key like this is persisted, the
 * character becomes forbidden again. */
export const folderKey = (folder: readonly string[]): string => folder.join("\u001f");

export type ShelfRow<T> =
  | {
      kind: "folder";
      folder: string[]; // ["Acme Doc", "Reels"]
      key: string; // folderKey, for React and the collapsed set
      name: string; // "Reels" -- the last name, which is what it is called
      depth: number;
      /* Boards ANYWHERE below, not just directly inside. A collapsed
       * folder should say how much it is hiding, and an expanded one
       * already shows its own underneath. */
      count: number;
    }
  | { kind: "board"; board: T; depth: number };

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/* Every folder that exists, ancestors filled in, in shelf order. */
export function folderPaths(
  boards: readonly { folder?: string[] }[],
  declared: readonly string[][] = [],
): string[][] {
  const all = new Map<string, string[]>();
  const add = (f: readonly string[] | undefined) => {
    if (!f?.length) return;
    /* Every ancestor, so a board filed two deep cannot produce a
     * subfolder with no parent to hang under. */
    for (let i = 1; i <= f.length; i++) {
      const cut = f.slice(0, i);
      all.set(folderKey(cut), cut);
    }
  };
  for (const d of declared) add(d);
  for (const b of boards) add(b.folder);
  return [...all.values()].sort((x, y) => {
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const c = byName(x[i], y[i]);
      if (c) return c;
    }
    return x.length - y.length;
  });
}

/* What a folder holds, for the "duplicate this?" question: every board
 * in it or under it, and every distinct subfolder under it (declared or
 * implied by a board's path). */
export function folderContents(
  boards: readonly { folder?: string[] }[],
  declared: readonly string[][],
  folder: readonly string[],
): { boards: number; subfolders: number } {
  const under = (f: readonly string[] | undefined): boolean =>
    !!f && f.length >= folder.length && folder.every((seg, i) => f[i] === seg);
  let n = 0;
  for (const b of boards) if (under(b.folder)) n++;
  const subs = new Set<string>();
  for (const p of folderPaths(boards, declared)) {
    if (p.length > folder.length && under(p)) subs.add(folderKey(p));
  }
  return { boards: n, subfolders: subs.size };
}

export function shelfRows<T extends { id: string; title: string; folder?: string[] }>(
  boards: readonly T[],
  mode: BoardSort,
  dir: SortDir,
  declared: readonly string[][] = [],
  /* Rolled-up folders, by key. A shut folder hides its whole subtree,
   * which is the only reading of "collapsed" once folders nest. */
  shut: { has(key: string): boolean } = new Set<string>(),
): ShelfRow<T>[] {
  const folders = folderPaths(boards, declared);
  const direct = new Map<string, T[]>();
  const loose: T[] = [];
  for (const b of boards) {
    if (!b.folder?.length) loose.push(b);
    else {
      const k = folderKey(b.folder);
      const run = direct.get(k);
      if (run) run.push(b);
      else direct.set(k, [b]);
    }
  }
  /* Descendant totals: a folder's count is its own boards plus every
   * board filed anywhere beneath it. */
  const total = new Map<string, number>();
  for (const f of folders) {
    const k = folderKey(f);
    let n = direct.get(k)?.length ?? 0;
    for (const [other, run] of direct) if (other.startsWith(k + "\u001f")) n += run.length;
    total.set(k, n);
  }
  const childrenOf = (parent: readonly string[]): string[][] =>
    folders.filter((f) => f.length === parent.length + 1 && parent.every((s, i) => s === f[i]));

  const rows: ShelfRow<T>[] = [];
  /* SUBFOLDERS AND BOARDS INTERLEAVE, sorted together as siblings
   * (owner, 2026-09-01). They used to be two runs -- every subfolder,
   * then every board -- which files a folder called "Zulu" above a board
   * called "Alpha" for no reason a reader can see. Inside one folder
   * they are just its contents.
   *
   * ONLY IN A-Z MODE, and that is a limit rather than a choice: the
   * clock sorts boards by the timestamp in their id, and a folder has no
   * date to compare against one. So chronological keeps the old shape --
   * folders first, alphabetically, then boards by date -- which is the
   * only coherent reading of "sort these by time" when half of them have
   * none. */
  const walk = (parent: string[], depth: number) => {
    const subs = childrenOf(parent);
    const own = sortBoards(direct.get(folderKey(parent)) ?? [], mode, dir);
    const emitFolder = (folder: string[]) => {
      const key = folderKey(folder);
      rows.push({
        kind: "folder",
        folder,
        key,
        name: folder[folder.length - 1],
        depth,
        count: total.get(key) ?? 0,
      });
      if (!shut.has(key)) walk(folder, depth + 1);
    };
    if (mode !== "alpha") {
      for (const f of subs) emitFolder(f);
      for (const b of own) rows.push({ kind: "board", board: b, depth });
      return;
    }
    const mixed: ({ f: string[] } | { b: T })[] = [
      ...subs.map((f) => ({ f })),
      ...own.map((b) => ({ b })),
    ];
    const label = (x: (typeof mixed)[number]) =>
      "f" in x ? x.f[x.f.length - 1] : boardLabel(x.b);
    mixed.sort((x, y) => {
      const c = byName(label(x), label(y));
      return dir === "desc" ? -c : c;
    });
    for (const x of mixed) {
      if ("f" in x) emitFolder(x.f);
      else rows.push({ kind: "board", board: x.b, depth });
    }
  };
  /* The root level is walked with its own contents being the UNFILED
   * boards, so a top-level folder and a loose board interleave by the
   * same rule everything else does. */
  direct.set(folderKey([]), loose);
  walk([], 0);
  return rows;
}
