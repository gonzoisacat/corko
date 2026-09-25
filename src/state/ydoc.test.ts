import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { tierDefault } from "./tierDefaults";
import { board4, boardB, childIds, countId, find, level, node } from "../test/fixtures";
import type { Board, Node } from "./types";
import { sameRole } from "../board/drag";
import { replaceAll } from "./search";
import { DEFAULT_YARN_WIDTH, SPAN_MAX, SPAN_MIN } from "./gridBoard";
import { sanitizeBoard, sanitizeProject } from "./validate";
import { resolveNodeEntry } from "../colors";
import {
  addBoardRaw,
  doc,
  getSnapshot,
  intentJournal,
  LEGACY_BOARD_ID,
  migrateLegacyBoard,
  ops,
  projectMap,
  repairDuplicates,
  undoManager,
} from "./ydoc";

/* ------------------------------------------------------------------ *
 *  Headless tests over the singleton doc (Phase 4 project shape). Each
 *  test resets the project to one fixture board, then exercises ops --
 *  including the merge scenarios Yjs cannot express natively, which the
 *  repair pass must self-heal: a "remote peer" is a second Y.Doc forked
 *  from the singleton's state, mutated raw (the same clone+delete shape
 *  relocate produces), and merged back with a non-local origin.
 * ------------------------------------------------------------------ */

type YMap = Y.Map<unknown>;
type YArr = Y.Array<YMap>;

const boardsOf = (d: Y.Doc): YArr | null => {
  const a = (d.getMap("project") as YMap).get("boards");
  return a instanceof Y.Array ? (a as YArr) : null;
};

/* find a node's containing array/index/map inside an arbitrary doc */
function findInDoc(d: Y.Doc, id: string): { arr: YArr; index: number; map: YMap } | null {
  const boards = boardsOf(d);
  if (!boards) return null;
  for (let b = 0; b < boards.length; b++) {
    const roots = boards.get(b).get("roots") as YArr | undefined;
    if (!roots) continue;
    const stack: YArr[] = [roots];
    while (stack.length) {
      const arr = stack.pop()!;
      for (let i = 0; i < arr.length; i++) {
        const m = arr.get(i);
        if (m.get("id") === id) return { arr, index: i, map: m };
        const ch = m.get("children") as YArr | undefined;
        if (ch && ch.length) stack.push(ch);
      }
    }
  }
  return null;
}

/* deep-clone a node Y.Map (fresh Y types, same values -- same id!) */
function cloneNodeY(m: YMap): YMap {
  const c = new Y.Map() as YMap;
  m.forEach((v, k) => {
    if (k === "children") {
      const arr = new Y.Array() as YArr;
      arr.push((v as YArr).toArray().map(cloneNodeY));
      c.set(k, arr);
    } else {
      c.set(k, v);
    }
  });
  return c;
}

function forkRemote(): Y.Doc {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  return remote;
}

function mergeBack(remote: Y.Doc) {
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "remote-peer");
}

/* let the queued migrate+repair microtask run */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  // reset: empty the project (and any legacy leftovers), then seed one board
  doc.transact(() => {
    const boards = projectMap.get("boards");
    if (boards instanceof Y.Array) boards.delete(0, boards.length);
    projectMap.set("title", "Test project");
    const tags = projectMap.get("tags");
    if (tags instanceof Y.Array) tags.delete(0, tags.length);
    const fields = projectMap.get("fields");
    if (fields instanceof Y.Array) fields.delete(0, fields.length);
    const folders = projectMap.get("folders");
    if (folders instanceof Y.Array) folders.delete(0, folders.length);
    const palette = projectMap.get("palette");
    if (palette instanceof Y.Array) palette.delete(0, palette.length);
    const legacy = doc.getMap("board") as YMap;
    legacy.delete("title");
    legacy.delete("levels");
    legacy.delete("legend");
    legacy.delete("roots");
  }, "local");
  addBoardRaw(board4());
  undoManager.clear();
  intentJournal.clear();
});

describe("ops basics", () => {
  it("addRoot cascades one empty child per tier down to the leaf-parent", () => {
    const id = ops.addRoot("bd1");
    const snap = getSnapshot();
    const root = find(snap, id)!;
    expect(root.children).toHaveLength(1); // section
    expect(root.children[0].children).toHaveLength(1); // scene
    expect(root.children[0].children[0].children).toHaveLength(0); // no beats yet
  });

  /* The top tier's half of "every gap between siblings takes an insert"
   * (the vertical chips). addRoot appends; this one lands where you point. */
  it("addRootAt inserts at an index and builds the same subtree as addRoot", () => {
    const before = getSnapshot().boards[0].roots.map((r) => r.id);
    const id = ops.addRootAt("bd1", 0);
    const snap = getSnapshot();
    expect(snap.boards[0].roots.map((r) => r.id)).toEqual([id, ...before]);
    const root = find(snap, id)!;
    expect(root.children).toHaveLength(1);
    expect(root.children[0].children).toHaveLength(1);
  });

  it("addRootAt clamps an out-of-range index instead of dropping the node", () => {
    const before = getSnapshot().boards[0].roots.length;
    const hi = ops.addRootAt("bd1", 999);
    const lo = ops.addRootAt("bd1", -5);
    const roots = getSnapshot().boards[0].roots.map((r) => r.id);
    expect(roots).toHaveLength(before + 2);
    expect(roots[0]).toBe(lo); // clamped to the front
    expect(roots[roots.length - 1]).toBe(hi); // clamped to the end
  });

  it("addRootAt no-ops on a board that isn't there", () => {
    expect(ops.addRootAt("nope", 0)).toBe("");
  });

  it("moveNode reorders within a parent (insert-before semantics)", () => {
    ops.moveNode("b1", "s1", 2); // before the node currently at index 2
    expect(childIds(getSnapshot(), "s1")).toEqual(["b2", "b1", "b3"]);
  });

  it("moveNode re-parents across lanes", () => {
    ops.moveNode("b1", "s2", 0);
    const snap = getSnapshot();
    expect(childIds(snap, "s1")).toEqual(["b2", "b3"]);
    expect(childIds(snap, "s2")).toEqual(["b1", "b4"]);
  });

  it("moveNode rejects a tier change", () => {
    ops.moveNode("s1", "s2", 0); // scene into a scene = would change tier
    const snap = getSnapshot();
    expect(childIds(snap, "d1")).toEqual(["s1", "s2"]);
    expect(childIds(snap, "s2")).toEqual(["b4"]);
  });

  it("moveNodes moves a selection as one ordered block", () => {
    ops.moveNodes(["b3", "b1"], "s2", 0); // ids in click order, not document order
    const snap = getSnapshot();
    expect(childIds(snap, "s1")).toEqual(["b2"]);
    expect(childIds(snap, "s2")).toEqual(["b1", "b3", "b4"]); // document order kept
  });

  it("moveNodes carries a trailing hidden stack with its lead", () => {
    ops.setHidden(["b2"], true); // b2 tucks behind b1
    ops.moveNodes(["b1"], "s2", 0);
    const snap = getSnapshot();
    expect(childIds(snap, "s1")).toEqual(["b3"]);
    expect(childIds(snap, "s2")).toEqual(["b1", "b2", "b4"]);
  });

  it("extractNodes + insertNodes round-trips content with fresh ids", () => {
    const clip = ops.extractNodes(["b1", "b2"])!;
    expect(clip.depth).toBe(3);
    expect(clip.nodes.map((n) => n.title)).toEqual(["b1", "b2"]);
    expect(childIds(getSnapshot(), "s1")).toEqual(["b3"]);

    ops.insertNodes("s2", 1, clip.nodes);
    const s2 = childIds(getSnapshot(), "s2");
    expect(s2).toHaveLength(3);
    expect(s2[0]).toBe("b4");
    expect(s2.slice(1)).not.toContain("b1"); // fresh ids on paste
    const titles = find(getSnapshot(), "s2")!.children.map((n) => n.title);
    expect(titles).toEqual(["b4", "b1", "b2"]);
  });

  it("copyNodes clones a selection in document order, leaving the sources", () => {
    const made = ops.copyNodes(["b3", "b1"], "s2", 0); // click order, not document order
    const snap = getSnapshot();
    expect(childIds(snap, "s1")).toEqual(["b1", "b2", "b3"]); // sources untouched
    expect(childIds(snap, "s2")).toEqual([...made, "b4"]);
    expect(made).toHaveLength(2);
    expect(find(snap, "s2")!.children.map((n) => n.title)).toEqual(["b1", "b3", "b4"]);
    expect(countId(snap, "b1")).toBe(1); // the copy got a fresh id
  });

  it("copyNodes deep-clones children and carries a hidden stack", () => {
    ops.setHidden(["b2"], true); // b2 tucks behind b1
    ops.copyNodes(["b1"], "s2", 1);
    const snap = getSnapshot();
    expect(childIds(snap, "s1")).toEqual(["b1", "b2", "b3"]); // still there
    const copies = find(snap, "s2")!.children;
    expect(copies.map((n) => n.title)).toEqual(["b4", "b1", "b2"]);
    expect(copies[2].hidden).toBe(true); // the stack came along
    // a whole subtree clones with fresh ids at every level
    ops.copyNodes(["s1"], "d1", 2);
    const s1copy = find(getSnapshot(), "d1")!.children[2];
    expect(s1copy.children.map((n) => n.title)).toEqual(["b1", "b2", "b3"]);
    expect(s1copy.children.every((c) => !["b1", "b2", "b3"].includes(c.id))).toBe(true);
  });

  it("copyNodes skips nodes whose tier doesn't match the destination", () => {
    ops.copyNodes(["s1"], "s2", 0); // a scene into a scene = wrong tier
    expect(childIds(getSnapshot(), "s2")).toEqual(["b4"]);
  });

  it("duplicateNode inserts a fresh-id copy right after the original", () => {
    const copyId = ops.duplicateNode("b1");
    expect(copyId).not.toBe("b1");
    const snap = getSnapshot();
    expect(childIds(snap, "s1")).toEqual(["b1", copyId, "b2", "b3"]);
    expect(find(snap, copyId)!.title).toBe("b1");
  });

  it("undo reverts a local move; redo replays it", () => {
    ops.moveNode("b1", "s2", 0);
    undoManager.undo();
    expect(childIds(getSnapshot(), "s1")).toEqual(["b1", "b2", "b3"]);
    undoManager.redo();
    expect(childIds(getSnapshot(), "s2")).toEqual(["b1", "b4"]);
  });

  it("ops no-op (not throw) when the boards array is missing", () => {
    doc.transact(() => {
      projectMap.delete("boards");
    }, "local");
    expect(ops.addRoot("bd1")).toBe("");
    expect(() => ops.moveNode("b1", null, 0, "bd1")).not.toThrow();
    expect(() => ops.setHidden(["b1"], true)).not.toThrow();
    expect(ops.extractNodes(["b1"])).toBeNull();
  });
});

describe("boards (Phase 4)", () => {
  it("cross-board move at the same tier relocates the node", () => {
    addBoardRaw(boardB());
    ops.moveNode("b1", "sB1", 0);
    const snap = getSnapshot();
    expect(childIds(snap, "s1")).toEqual(["b2", "b3"]);
    expect(childIds(snap, "sB1")).toEqual(["b1", "bB1", "bB2"]);
  });

  it("cross-board root move needs its destination board", () => {
    addBoardRaw(boardB());
    ops.moveNode("r1", null, 1, "bd2"); // reel from bd1 to bd2's roots
    const snap = getSnapshot();
    expect(snap.boards.find((b) => b.id === "bd1")!.roots).toHaveLength(0);
    expect(snap.boards.find((b) => b.id === "bd2")!.roots.map((r) => r.id)).toEqual(["rB1", "r1"]);
  });

  it("cross-board copy leaves the source board intact (the split-view pull)", () => {
    addBoardRaw(boardB());
    const made = ops.copyNodes(["b1", "b2"], "sB1", 1);
    const snap = getSnapshot();
    expect(childIds(snap, "s1")).toEqual(["b1", "b2", "b3"]); // master untouched
    expect(childIds(snap, "sB1")).toEqual(["bB1", ...made, "bB2"]);
    expect(find(snap, made[0])!.title).toBe("b1");
    expect(countId(snap, "b1")).toBe(1);
  });

  it("cross-board root copy needs its destination board", () => {
    addBoardRaw(boardB());
    const made = ops.copyNodes(["r1"], null, 0, "bd2");
    const snap = getSnapshot();
    expect(snap.boards.find((b) => b.id === "bd1")!.roots.map((r) => r.id)).toEqual(["r1"]);
    expect(snap.boards.find((b) => b.id === "bd2")!.roots.map((r) => r.id)).toEqual([...made, "rB1"]);
  });

  it("paste works across boards (fresh ids)", () => {
    addBoardRaw(boardB());
    const clip = ops.extractNodes(["b1"])!;
    ops.insertNodes("sB1", 0, clip.nodes);
    const snap = getSnapshot();
    const sB1 = find(snap, "sB1")!;
    expect(sB1.children[0].title).toBe("b1");
    expect(sB1.children[0].id).not.toBe("b1");
  });

  it("duplicateBoard deep-clones with fresh node ids, inserted after", () => {
    const copyId = ops.duplicateBoard("bd1");
    const snap = getSnapshot();
    expect(snap.boards.map((b) => b.id)).toEqual(["bd1", copyId]);
    const copy = snap.boards[1];
    expect(copy.title).toBe("Test board copy");
    expect(copy.roots[0].children[0].children[0].children.map((n) => n.title)).toEqual(["b1", "b2", "b3"]);
    expect(countId(snap, "b1")).toBe(1); // the clone got fresh ids
  });

  it("importBoard adds with fresh board + node ids (safe re-import)", () => {
    const id1 = ops.importBoard(board4());
    const id2 = ops.importBoard(board4());
    expect(id1).not.toBe("bd1");
    expect(id1).not.toBe(id2);
    repairDuplicates(); // must be a no-op: nothing collides
    const snap = getSnapshot();
    expect(snap.boards).toHaveLength(3);
    expect(countId(snap, "b1")).toBe(1); // only the original keeps the id
    for (const b of snap.boards) {
      expect(b.roots[0].children[0].children[0].children).toHaveLength(3);
    }
  });

  it("importProject adds every board with fresh ids (backup restore)", () => {
    const file = { title: "Backup", boards: [board4(), boardB()], tags: [], fields: [] };
    const ids = ops.importProject(file);
    const snap = getSnapshot();
    expect(ids).toHaveLength(2);
    expect(snap.boards.map((b) => b.id)).toEqual(["bd1", ...ids]); // added, not replaced
    repairDuplicates(); // nothing collides: the restore got fresh ids throughout
    const after = getSnapshot();
    expect(after.boards).toHaveLength(3);
    expect(countId(after, "b1")).toBe(1); // only the original board keeps the id
    expect(find(after, ids[0])).toBeNull(); // board ids aren't node ids
    const restored = after.boards[1];
    expect(restored.title).toBe("Test board");
    expect(restored.roots[0].children[0].children[0].children.map((n) => n.title)).toEqual([
      "b1",
      "b2",
      "b3",
    ]);
  });

  it("importProject names an untitled project from the file, else keeps its own", () => {
    doc.transact(() => projectMap.set("title", ""), "local");
    ops.importProject({ title: "From the file", boards: [boardB()], tags: [], fields: [] });
    expect(getSnapshot().title).toBe("From the file");
    ops.importProject({ title: "Another file", boards: [boardB()], tags: [], fields: [] });
    expect(getSnapshot().title).toBe("From the file"); // a named project keeps its name
  });

  it("deleteBoard removes exactly that board", () => {
    addBoardRaw(boardB());
    ops.deleteBoard("bd1");
    const snap = getSnapshot();
    expect(snap.boards.map((b) => b.id)).toEqual(["bd2"]);
  });
});

describe("graduation: promote / demote with stow (owner's design)", () => {
  it("promote lifts a node beside its old parent, same id, subtree riding", () => {
    // b2 (a beat) becomes a scene right after s1
    expect(ops.promoteNode("b2")).toBe(true);
    const snap = getSnapshot();
    expect(childIds(snap, "s1")).toEqual(["b1", "b3"]);
    expect(childIds(snap, "d1")).toEqual(["s1", "b2", "s2"]); // same id, new tier
    // ...and a scene promotes to a section, beats becoming scenes
    expect(ops.promoteNode("s2")).toBe(true);
    expect(childIds(getSnapshot(), "r1")).toEqual(["d1", "s2"]);
    expect(childIds(getSnapshot(), "s2")).toEqual(["b4"]); // b4 is a scene now
  });

  it("promote strips the beat idioms (breakAfter, hidden) but keeps content", () => {
    ops.toggleBreak("b1");
    ops.setHidden(["b1"], true);
    const tagId = ops.addTag({ name: "Ported" });
    ops.setNodeTag(["b1"], tagId, true);
    ops.setNodeValue(["b1"], ops.addField({ name: "TC" }), "01:00:00:00");
    ops.promoteNode("b1");
    const b1 = find(getSnapshot(), "b1")!;
    expect(b1.breakAfter).toBeUndefined();
    expect(b1.hidden).toBeUndefined();
    expect(b1.tags).toEqual([tagId]); // tags + values port (tier-agnostic)
    expect(Object.values(b1.values ?? {})).toEqual(["01:00:00:00"]);
  });

  it("promote 'before' lands the first child ahead of its parent -- order preserved", () => {
    expect(ops.promoteNode("b1", "before")).toBe(true);
    expect(childIds(getSnapshot(), "d1")).toEqual(["b1", "s1", "s2"]);
    expect(childIds(getSnapshot(), "s1")).toEqual(["b2", "b3"]);
  });

  it("promote 'split' halves the parent around a surrounded card", () => {
    // b2 sits mid-scene: s1 keeps b1, b2 lands next, "(cont'd)" takes b3
    const tagId = ops.addTag({ name: "Day" });
    ops.setNodeTag(["s1"], tagId, true);
    ops.setNodeValue(["s1"], ops.addField({ name: "Shoot" }), "DAY 06");
    ops.addNote("s1", { body: "a note about s1" });
    expect(ops.promoteNode("b2", "split")).toBe(true);
    const d1 = find(getSnapshot(), "d1")!;
    expect(d1.children.map((n) => n.title)).toEqual(["s1", "b2", "s1 (cont'd)", "s2"]);
    expect(childIds(getSnapshot(), "s1")).toEqual(["b1"]);
    const cont = d1.children[2];
    expect(cont.children.map((n) => n.id)).toEqual(["b3"]); // MOVED, id kept
    // the continuation IS the same scene resumed: tags + values ride
    // (owner's call) -- but not the notes, which belong to the original
    expect(cont.tags).toEqual([tagId]);
    expect(Object.values(cont.values ?? {})).toEqual(["DAY 06"]);
    expect(cont.notes).toBeUndefined();
    expect(find(getSnapshot(), "s1")!.notes).toHaveLength(1);
    // one undo step brings the whole split back
    ops.undo();
    expect(childIds(getSnapshot(), "s1")).toEqual(["b1", "b2", "b3"]);
  });

  it("roots can't promote; leaves can't demote; only children need the wrap", () => {
    expect(ops.promoteNode("r1")).toBe(false);
    expect(ops.demoteNode("b1", "stow").ok).toBe(false); // already leaf
    expect(ops.demoteNode("d1", "stow").ok).toBe(false); // only child, no neighbor
  });

  it("demote into a WRAP mints an untitled container in place -- and frees only children", () => {
    // d1 is an only child: no neighbor, but the wrap always works
    const r = ops.demoteNode("d1", "stow", "wrap");
    expect(r.ok).toBe(true);
    expect(r.wrapper).not.toBeNull();
    const snap = getSnapshot();
    const shell = find(snap, r.wrapper!)!;
    expect(childIds(snap, "r1")).toEqual([r.wrapper]); // in place, order kept
    expect(shell.title).toBe(""); // untitled -- the caller opens it for naming
    expect(shell.children.map((n) => n.id)).toEqual(["d1"]); // demoted inside, id kept
    expect(childIds(snap, "d1")).toEqual(["s1", "s2"]); // subtree rode along (stowed below)
    // one undo step reverses the mint + demote together
    ops.undo();
    expect(childIds(getSnapshot(), "r1")).toEqual(["d1"]);
  });

  it("wrap-demote of a scene puts it where it stood, its beats stowing", () => {
    const r = ops.demoteNode("s1", "stow", "wrap");
    const snap = getSnapshot();
    expect(find(snap, "d1")!.children.map((n) => n.id)).toEqual([r.wrapper, "s2"]);
    expect(childIds(snap, r.wrapper!)).toEqual(["s1"]); // s1 is a beat now
    expect(childIds(snap, "s1")).toEqual(["b1", "b2", "b3"]); // dormant, intact
  });

  it("demote with STOW keeps the beats as dormant below-leaf children, and promote round-trips", () => {
    // s2 tucks into s1; its beat b4 stays as s2's (below-leaf) child
    expect(ops.demoteNode("s2", "stow").ok).toBe(true);
    let snap = getSnapshot();
    expect(childIds(snap, "d1")).toEqual(["s1"]);
    expect(childIds(snap, "s1")).toEqual(["b1", "b2", "b3", "s2"]); // s2 is a beat now
    expect(childIds(snap, "s2")).toEqual(["b4"]); // stowed, still in the doc

    // the round trip: promote brings it back with its beat visible
    expect(ops.promoteNode("s2")).toBe(true);
    snap = getSnapshot();
    expect(childIds(snap, "d1")).toEqual(["s1", "s2"]);
    expect(childIds(snap, "s2")).toEqual(["b4"]); // surfaced again
  });

  it("demote with DELETE trims exactly the would-be below-leaf subtrees", () => {
    // demoting d1 makes its scenes beats; their beats would cross the leaf
    ops.addRoot("bd1"); // a second reel so d1 has a demote target? no -- d1 needs a SIBLING section
    const d2 = ops.addChild("r1"); // second section beside d1
    ops.setNodeField(d2, "title", "D2");
    expect(ops.demoteNode("d1", "delete").ok).toBe(true);
    const snap = getSnapshot();
    const d2node = find(snap, d2)!;
    // d1 tucked into its FOLLOWING sibling (no preceding one), as first child
    expect(d2node.children[0]?.id).toBe("d1");
    const d1 = find(snap, "d1")!; // a scene now; its scenes became beats
    expect(d1.children.map((n) => n.id)).toEqual(["s1", "s2"]);
    expect(d1.children.every((c) => c.children.length === 0)).toBe(true); // beats gone
  });

  it("demote with STOW keeps deep content; one undo step reverses the lot", () => {
    const d2 = ops.addChild("r1");
    undoManager.clear();
    ops.demoteNode("d1", "stow");
    let d1 = find(getSnapshot(), "d1")!;
    expect(d1.children.map((n) => n.id)).toEqual(["s1", "s2"]);
    expect(childIds(getSnapshot(), "s1")).toEqual(["b1", "b2", "b3"]); // dormant but present
    ops.undo();
    expect(childIds(getSnapshot(), "r1")).toEqual(["d1", d2]);
    d1 = find(getSnapshot(), "d1")!;
    expect(d1.children.map((n) => n.id)).toEqual(["s1", "s2"]);
  });
});

describe("cross-ladder moves: height is the law (owner's call)", () => {
  const threeTier = () => ({
    id: "bd3",
    title: "Three tiers",
    levels: [level("act"), level("sc"), level("bt")],
    legend: [],
    roots: [node("a1", [node("sc1", [node("bt1")])])],
  });

  it("copyNodes pairs same-HEIGHT tiers across different ladders", () => {
    addBoardRaw(threeTier());
    // a 4-tier scene (depth 2, height 1) lands at the 3-tier scene rung
    // (depth 1, height 1) -- different depths, same role
    const made = ops.copyNodes(["s1"], "a1", 0);
    expect(made).toHaveLength(1);
    const copy = find(getSnapshot(), made[0])!;
    expect(copy.children.map((n) => n.title)).toEqual(["b1", "b2", "b3"]);
    // and beats land beside beats (height 0), depth 3 -> depth 2
    const madeBeat = ops.copyNodes(["b4"], "sc1", 0);
    expect(find(getSnapshot(), madeBeat[0])!.title).toBe("b4");
  });

  it("copyNodes still refuses a WRONG role even at a matching depth", () => {
    addBoardRaw(threeTier());
    // 4-tier scene (depth 2) into the 3-tier beat row (also depth 2):
    // the old corruption -- nothing may land
    const made = ops.copyNodes(["s1"], "sc1", 0);
    expect(made).toHaveLength(0);
    expect(childIds(getSnapshot(), "sc1")).toEqual(["bt1"]);
  });

  it("a cut clip carries its role height, and pastes by it", () => {
    addBoardRaw(threeTier());
    const clip = ops.extractNodes(["s2"])!; // a scene: depth 2, height 1
    expect(clip.depth).toBe(2);
    expect(clip.height).toBe(1);
    // pastes at the 3-tier board's scene rung (depth 1, height 1)
    ops.insertNodes("a1", 1, clip.nodes);
    expect(find(getSnapshot(), "a1")!.children.map((n) => n.title)).toEqual(["sc1", "s2"]);
  });

  it("a TALLER node grows the destination ladder (extendBoardWithNode)", () => {
    addBoardRaw(threeTier());
    // r1 is a reel: height 3; bd3 tops out at height 2
    const made = ops.extendBoardWithNode("bd3", "r1");
    expect(made).not.toBeNull();
    const bd3 = getSnapshot().boards.find((b) => b.id === "bd3")!;
    // the ladder grew a top tier ported from the source (the Reel def)
    expect(bd3.levels.map((l) => l.name)).toEqual(["Reel", "act", "sc", "bt"]);
    // old roots wrapped under one blank node; the newcomer beside it
    expect(bd3.roots).toHaveLength(2);
    expect(bd3.roots[0].title).toBe("");
    expect(bd3.roots[0].children.map((n) => n.id)).toEqual(["a1"]);
    expect(bd3.roots[1].id).toBe(made); // fresh id -- a copy, source intact
    expect(bd3.roots[1].children.map((n) => n.title)).toEqual(["d1"]);
    expect(countId(getSnapshot(), "r1")).toBe(1); // the original stayed home
    // ...and the ported tier brought a default color entry for itself
    expect(bd3.legend.some((e) => e.tier === bd3.levels[0].id)).toBe(true);
  });

  it("extendBoardWithNode refuses when the node isn't actually taller", () => {
    addBoardRaw(threeTier());
    expect(ops.extendBoardWithNode("bd3", "s1")).toBeNull(); // fits at a rung
    expect(getSnapshot().boards.find((b) => b.id === "bd3")!.levels).toHaveLength(3);
  });
});

describe("cross-board role guard (drag.ts sameRole)", () => {
  it("equal depth is not equal ROLE across different ladders", () => {
    // a 3-tier board next to the 4-tier fixture: its depth-2 is the LEAF
    addBoardRaw({
      id: "bd3",
      title: "Three tiers",
      levels: [level("act"), level("sc"), level("bt")],
      legend: [],
      roots: [node("a1", [node("sc1", [node("bt1")])])],
    });
    // same board: depth is the role, always fine
    expect(sameRole("bd1", 2, "bd1", 2)).toBe(true);
    // 4-tier scene (depth 2, height 1) onto 3-tier beat row (depth 2,
    // height 0): the drop that used to clone children below the leaf
    expect(sameRole("bd1", 2, "bd3", 2)).toBe(false);
    // same HEIGHT across the ladders -- the pairing a future relaxation
    // would accept (beats are beats everywhere)
    expect(sameRole("bd1", 3, "bd3", 2)).toBe(true);
    expect(sameRole("bd1", 2, "bd3", 1)).toBe(true);
    // unknown boards refuse; a zone with no board keeps the old rule
    expect(sameRole("bd1", 2, "nope", 2)).toBe(false);
    expect(sameRole("bd1", 2, "", 2)).toBe(true);
  });

  /* A NESTING CARD has no role to match: no children, so no rung is
   * wrong for it. Every pairing the rule refuses above is accepted once
   * the item is nested. */
  it("a nesting card matches every rung of every ladder", () => {
    addBoardRaw({
      id: "bd3",
      title: "Three tiers",
      levels: [level("act"), level("sc"), level("bt")],
      legend: [],
      roots: [node("a1", [node("sc1", [node("bt1")])])],
    });
    expect(sameRole("bd1", 2, "bd3", 2, true)).toBe(true); // was false
    expect(sameRole("bd1", 3, "bd3", 0, true)).toBe(true); // leaf -> top tier
    expect(sameRole("bd1", 0, "bd1", 3, true)).toBe(true); // top -> leaf, same board
  });
});

describe("delNodes (the keyboard's Delete)", () => {
  it("deletes a whole selection in one transaction -- and one undo step", () => {
    ops.delNodes(["b1", "b3"]);
    expect(childIds(getSnapshot(), "s1")).toEqual(["b2"]);
    ops.undo();
    expect(childIds(getSnapshot(), "s1")).toEqual(["b1", "b2", "b3"]);
  });

  it("survives ids that don't resolve, and an empty list", () => {
    ops.delNodes([]);
    ops.delNodes(["nope", "b4"]);
    expect(childIds(getSnapshot(), "s2")).toEqual([]);
    expect(childIds(getSnapshot(), "s1")).toEqual(["b1", "b2", "b3"]);
  });
});

describe("tier band height", () => {
  it("sets, survives the snapshot, and clears back to content-sized", () => {
    ops.setLevelBandHeight("bd1", 1, 72);
    expect(getSnapshot().boards[0].levels[1].bandHeight).toBe(72);
    ops.setLevelBandHeight("bd1", 1, 0); // 0 = back to auto
    expect(getSnapshot().boards[0].levels[1].bandHeight).toBeUndefined();
  });
});

/* The descriptor says what a tier's default COLOR means, in the legend
 * only: "Scene (Linear)" against a "Scene (Floaters)" override. Two ops
 * write that label -- renaming the tier and editing the descriptor -- so
 * what's pinned here is that they can't clobber each other. */
describe("tier descriptor", () => {
  const tierEntry = () => {
    const b = getSnapshot().boards[0];
    return b.legend.find((e) => e.tier === b.levels[1].id)!;
  };

  it("appends to the legend swatch's label without touching the tier name", () => {
    const name = getSnapshot().boards[0].levels[1].name;
    ops.setLevelDescriptor("bd1", 1, "Linear");
    expect(getSnapshot().boards[0].levels[1].descriptor).toBe("Linear");
    expect(getSnapshot().boards[0].levels[1].name).toBe(name); // the noun is untouched
    expect(tierEntry().label).toBe(`${name} (Linear)`);
  });

  it("survives a rename -- and the rename still lands", () => {
    ops.setLevelDescriptor("bd1", 1, "Linear");
    ops.setLevelName("bd1", 1, "Sequence");
    expect(getSnapshot().boards[0].levels[1].name).toBe("Sequence");
    expect(tierEntry().label).toBe("Sequence (Linear)");
  });

  it("blank is not a value: it clears the key and the parentheses", () => {
    ops.setLevelDescriptor("bd1", 1, "Linear");
    ops.setLevelDescriptor("bd1", 1, "   ");
    expect(getSnapshot().boards[0].levels[1].descriptor).toBeUndefined();
    expect(tierEntry().label).toBe(getSnapshot().boards[0].levels[1].name);
  });

  it("trims, so a stray space can't widen the parentheses", () => {
    ops.setLevelDescriptor("bd1", 1, "  Floaters  ");
    expect(getSnapshot().boards[0].levels[1].descriptor).toBe("Floaters");
  });
});

/* Recoloring a run of cards -- the card menu's swatches, and a color
 * dragged out of the legend. Selection-aware at the CALL sites (they
 * pass the ids); what's pinned here is that the op paints many in one
 * transaction and that "" means "back to the tier default". */
describe("setNodesColor", () => {
  it("paints every id in one step", () => {
    const beats = getSnapshot().boards[0].roots[0].children[0].children[0].children;
    const ids = beats.slice(0, 2).map((b) => b.id);
    ops.setNodesColor(ids, "green");
    const after = getSnapshot().boards[0].roots[0].children[0].children[0].children;
    expect(after[0].color).toBe("green");
    expect(after[1].color).toBe("green");
    expect(after[2]?.color).not.toBe("green"); // untouched
  });

  it('"" clears back to the tier default rather than storing a blank', () => {
    const beat = getSnapshot().boards[0].roots[0].children[0].children[0].children[0];
    ops.setNodesColor([beat.id], "green");
    ops.setNodesColor([beat.id], "");
    const after = getSnapshot().boards[0].roots[0].children[0].children[0].children[0];
    expect(after.color).toBeUndefined();
  });

  it("is one undo step for the whole run", () => {
    const beats = getSnapshot().boards[0].roots[0].children[0].children[0].children;
    const ids = beats.map((b) => b.id);
    ops.setNodesColor(ids, "pink");
    undoManager.undo();
    const after = getSnapshot().boards[0].roots[0].children[0].children[0].children;
    expect(after.every((b) => b.color !== "pink")).toBe(true);
  });

  it("ignores ids that aren't in the doc", () => {
    expect(() => ops.setNodesColor(["nope"], "green")).not.toThrow();
  });
});

describe("setEdgeWidth", () => {
  const grid = () => {
    addBoardRaw({
      id: "gb",
      title: "Grid",
      type: "grid",
      levels: [level("card", "Card")],
      legend: [],
      roots: [node("c1"), node("c2")],
    });
    return ops.addEdge("gb", "c1", "c2");
  };

  it("sets a width", () => {
    const id = grid();
    ops.setEdgeWidth("gb", id, 5);
    expect(getSnapshot().boards.find((b) => b.id === "gb")!.edges![0].width).toBe(5);
  });

  it("THE DEFAULT IS STORED AS AN ABSENCE", () => {
    /* So a string set back to normal is indistinguishable from one
     * nobody ever touched -- and `yarnWidth` stays the one place that
     * decides what unset draws at. */
    const id = grid();
    ops.setEdgeWidth("gb", id, 4);
    ops.setEdgeWidth("gb", id, DEFAULT_YARN_WIDTH);
    expect(getSnapshot().boards.find((b) => b.id === "gb")!.edges![0].width).toBeUndefined();
  });

  it("leaves the color and the endpoints alone", () => {
    const id = grid();
    ops.setEdgeColor("gb", id, "#2d6cdf");
    ops.setEdgeWidth("gb", id, 2.5);
    const e = getSnapshot().boards.find((b) => b.id === "gb")!.edges![0];
    expect(e).toMatchObject({ from: "c1", to: "c2", color: "#2d6cdf", width: 2.5 });
  });

  it("no-ops on an edge that is not there", () => {
    grid();
    expect(() => ops.setEdgeWidth("gb", "nope", 5)).not.toThrow();
  });
});

describe("extractNodes: cut vs copy", () => {
  it("cut takes the cards OUT of the doc", () => {
    const res = ops.extractNodes(["b1", "b2"], true)!;
    expect(res.nodes.map((n) => n.id)).toEqual(["b1", "b2"]);
    expect(childIds(getSnapshot(), "s1")).toEqual(["b3"]);
  });

  it("COPY returns the identical clip and leaves the board alone", () => {
    /* The only difference between them, and it has to stay the only one
     * -- a copy that disagreed with a cut about WHAT it took would be a
     * nasty thing to debug. */
    /* COPY first, so both runs see the same board -- a re-insert would
     * not restore it, since insertNodes mints fresh ids by design. */
    const copied = ops.extractNodes(["b1", "b2"], false)!;
    expect(childIds(getSnapshot(), "s1")).toEqual(["b1", "b2", "b3"]); // nothing removed
    const cut = ops.extractNodes(["b1", "b2"], true)!;
    expect(copied.depth).toBe(cut.depth);
    expect(copied.height).toBe(cut.height);
    expect(copied.nodes).toEqual(cut.nodes);
  });

  it("a copy carries what a card is WEARING, not just its title", () => {
    ops.setNodeImage("b1", "data:image/png;base64,AAAA");
    ops.setNodeField("b1", "color", "red");
    const copied = ops.extractNodes(["b1"], false)!;
    expect(copied.nodes[0].image).toBe("data:image/png;base64,AAAA");
    expect(copied.nodes[0].color).toBe("red");
    expect(find(getSnapshot(), "b1")).toBeTruthy();
  });

  it("copying twice is idempotent -- the board never shrinks", () => {
    ops.extractNodes(["b1"], false);
    ops.extractNodes(["b1"], false);
    expect(childIds(getSnapshot(), "s1")).toEqual(["b1", "b2", "b3"]);
  });
});

describe("replaceInTitles (bulk find and replace)", () => {
  it("rewrites every occurrence, across tiers, in ONE undo step", () => {
    ops.setNodeField("s1", "title", "Ariel enters");
    ops.setNodeField("b1", "title", "Ariel + Stephen, Ariel leads");
    ops.setNodeField("b2", "title", "no one");
    /* The UndoManager merges transactions inside its capture window, so
     * without this the setup above and the replace below become ONE undo
     * step and the assertion below would be testing the fixture, not the
     * op. */
    undoManager.stopCapturing();

    const changed = ops.replaceInTitles(["s1", "b1", "b2"], "Ariel", "Ari");

    expect(changed).toBe(2); // b2 never contained it
    const snap = getSnapshot();
    expect(find(snap, "s1")!.title).toBe("Ari enters");
    expect(find(snap, "b1")!.title).toBe("Ari + Stephen, Ari leads");
    expect(find(snap, "b2")!.title).toBe("no one");

    undoManager.undo(); // ONE step puts all of it back
    const back = getSnapshot();
    expect(find(back, "s1")!.title).toBe("Ariel enters");
    expect(find(back, "b1")!.title).toBe("Ariel + Stephen, Ariel leads");
  });

  it("leaves untouched titles out of the transaction entirely", () => {
    ops.setNodeField("b1", "title", "Ariel");
    expect(ops.replaceInTitles(["b1", "b2", "b3"], "zzz", "x")).toBe(0);
  });

  it("honours match case", () => {
    ops.setNodeField("b1", "title", "ariel and Ariel");
    expect(ops.replaceInTitles(["b1"], "Ariel", "Ari", true)).toBe(1);
    expect(find(getSnapshot(), "b1")!.title).toBe("ariel and Ari");
  });

  it("an empty replacement deletes the term rather than no-opping", () => {
    ops.setNodeField("b1", "title", "DRAFT Ariel enters");
    ops.replaceInTitles(["b1"], "DRAFT ", "");
    expect(find(getSnapshot(), "b1")!.title).toBe("Ariel enters");
  });

  it("an empty find changes nothing", () => {
    ops.setNodeField("b1", "title", "Ariel");
    expect(ops.replaceInTitles(["b1"], "", "x")).toBe(0);
    expect(find(getSnapshot(), "b1")!.title).toBe("Ariel");
  });

  it("NEVER a nesting card, whose title is the one it hides", () => {
    /* A nesting card draws its TARGET board's name and keeps `title`
     * written but unread, so a search matches it on the target's name
     * (state/nesting.ts searchTitle). Rewriting `title` here would edit
     * a name nobody can see AND would not touch the words the preview
     * showed. Guarded in the OP so no caller can route round the UI --
     * this test calls it directly with a find that DOES match the hidden
     * title, which is exactly what the UI would never send. */
    addBoardRaw(boardB()); // a target to point at (bd2)
    expect(ops.nestNode("b1", "bd2")).toBe(true);
    /* The conversion blanks the title, so set one AFTER -- an older doc
     * can still carry one, and the op must refuse those too. */
    ops.setNodeField("b1", "title", "hidden name");
    expect(ops.replaceInTitles(["b1"], "hidden", "WRECKED")).toBe(0);
    expect(find(getSnapshot(), "b1")!.title).toBe("hidden name");
  });

  it("...and the cards beside it still change in the same call", () => {
    addBoardRaw(boardB());
    expect(ops.nestNode("b1", "bd2")).toBe(true);
    ops.setNodeField("b1", "title", "shared word"); // an older doc's leftover
    ops.setNodeField("b2", "title", "shared word");
    expect(ops.replaceInTitles(["b1", "b2"], "shared", "SWAPPED")).toBe(1);
    expect(find(getSnapshot(), "b1")!.title).toBe("shared word");
    expect(find(getSnapshot(), "b2")!.title).toBe("SWAPPED word");
  });

  /* The op has its own copy of the replacement rule (ydoc doesn't import
   * render-side helpers). If the two ever drift, the preview lies about
   * what the button will write -- so run both over the same inputs. */
  it("writes EXACTLY what the preview renders", () => {
    const cases: [string, string, string, boolean][] = [
      ["Ariel + Stephen, Ariel leads", "Ariel", "Ari", false],
      ["ariel and Ariel", "ariel", "X", false],
      ["ariel and Ariel", "Ariel", "X", true],
      ["DRAFT Ariel", "DRAFT ", "", false],
      ["aaaa", "aa", "b", false],
    ];
    for (const [title, from, to, mc] of cases) {
      ops.setNodeField("b1", "title", title);
      ops.replaceInTitles(["b1"], from, to, mc);
      expect(find(getSnapshot(), "b1")!.title).toBe(replaceAll(title, from, to, mc));
    }
  });
});

describe("reordering the legend (tag paint order)", () => {
  it("moves a tag before another, which is what sets paint order", () => {
    const a = ops.addTag({ name: "A" });
    const b = ops.addTag({ name: "B" });
    const c = ops.addTag({ name: "C" });
    expect(getSnapshot().tags.map((t) => t.name)).toEqual(["A", "B", "C"]);

    ops.reorderTag(c, a); // C to the front
    expect(getSnapshot().tags.map((t) => t.name)).toEqual(["C", "A", "B"]);

    ops.reorderTag(c, null); // ...and to the end
    expect(getSnapshot().tags.map((t) => t.name)).toEqual(["A", "B", "C"]);
    expect([a, b, c].every(Boolean)).toBe(true);
  });

  it("keeps everything the tag carries -- it is a move, not a rebuild", () => {
    const a = ops.addTag({ name: "A", color: "#123456", pos: 0.4, reach: 19, visible: false });
    ops.addTag({ name: "B" });
    ops.reorderTag(a, null);
    const moved = getSnapshot().tags.find((t) => t.id === a)!;
    expect(moved.color).toBe("#123456");
    expect(moved.pos).toBeCloseTo(0.4);
    expect(moved.reach).toBe(19);
    expect(moved.visible).toBe(false);
  });

  it("applied tags survive a reorder -- the cards reference ids, not slots", () => {
    const a = ops.addTag({ name: "A" });
    const b = ops.addTag({ name: "B" });
    ops.setNodeTag(["b1"], a, true);
    ops.setNodeTag(["b1"], b, true);
    ops.reorderTag(b, a);
    expect(find(getSnapshot(), "b1")!.tags!.sort()).toEqual([a, b].sort());
  });

  it("moving a tag onto itself does nothing", () => {
    const a = ops.addTag({ name: "A" });
    ops.addTag({ name: "B" });
    ops.reorderTag(a, a);
    expect(getSnapshot().tags.map((t) => t.name)).toEqual(["A", "B"]);
  });

  it("reorders a legend OVERRIDE, and refuses to move a tier default", () => {
    const boardId = getSnapshot().boards[0].id;
    ops.ensureTierDefaults(boardId);
    const one = ops.addLegendEntry(boardId);
    const two = ops.addLegendEntry(boardId);
    // the default legend already ships four overrides (B-roll, Confirmed,
    // ...), so assert on the two this test added rather than the whole row
    const mine = () =>
      getSnapshot()
        .boards[0].legend.filter((e) => !e.tier && (e.id === one || e.id === two))
        .map((e) => e.id);
    expect(mine()).toEqual([one, two]);

    ops.reorderLegendEntry(boardId, two, one);
    expect(mine()).toEqual([two, one]);

    /* a tier default is the ladder's order, not a free list -- moving one
     * would either lie about the ladder or silently re-tier the board */
    const tierEntry = getSnapshot().boards[0].legend.find((e) => e.tier)!;
    const before = getSnapshot().boards[0].legend.map((e) => e.id);
    ops.reorderLegendEntry(boardId, tierEntry.id, one);
    expect(getSnapshot().boards[0].legend.map((e) => e.id)).toEqual(before);
  });
});

describe("tags (ADR 0002)", () => {
  it("a tag is project-level and applies to any tier", () => {
    const t = ops.addTag({ name: "Michael", color: "#e5484d", pos: 0.25 });
    ops.setNodeTag(["b1", "s1"], t, true); // a beat AND a scene
    const snap = getSnapshot();
    expect(snap.tags.map((x) => x.name)).toEqual(["Michael"]);
    expect(find(snap, "b1")!.tags).toEqual([t]);
    expect(find(snap, "s1")!.tags).toEqual([t]);
    expect(find(snap, "b2")!.tags).toBeUndefined();
  });

  it("applying is idempotent; removing drops the empty list", () => {
    const t = ops.addTag();
    ops.setNodeTag(["b1"], t, true);
    ops.setNodeTag(["b1"], t, true);
    expect(find(getSnapshot(), "b1")!.tags).toEqual([t]);
    ops.setNodeTag(["b1"], t, false);
    expect(find(getSnapshot(), "b1")!.tags).toBeUndefined();
  });

  it("setTag edits placement without touching applications", () => {
    const t = ops.addTag({ pos: 0 });
    ops.setNodeTag(["b1"], t, true);
    ops.setTag(t, { pos: 0.75, span: 40, visible: false });
    const snap = getSnapshot();
    expect(snap.tags[0]).toMatchObject({ pos: 0.75, span: 40, visible: false });
    expect(find(snap, "b1")!.tags).toEqual([t]); // still applied while invisible
  });

  it("clearNodeTags detaches every tag from a card, keeping the definitions", () => {
    const a = ops.addTag({ name: "A" });
    const b = ops.addTag({ name: "B" });
    ops.setNodeTag(["b1", "b2"], a, true);
    ops.setNodeTag(["b1"], b, true);
    ops.clearNodeTags(["b1"]);
    const snap = getSnapshot();
    expect(find(snap, "b1")!.tags).toBeUndefined();
    expect(find(snap, "b2")!.tags).toEqual([a]); // other cards untouched
    expect(snap.tags).toHaveLength(2); // definitions survive
  });

  it("removeTag also strips it from every card that carried it", () => {
    const t = ops.addTag();
    ops.setNodeTag(["b1", "b4", "r1"], t, true);
    ops.removeTag(t);
    const snap = getSnapshot();
    expect(snap.tags).toHaveLength(0);
    for (const id of ["b1", "b4", "r1"]) expect(find(snap, id)!.tags).toBeUndefined();
  });

  it("repair drops duplicate and dangling tag ids off nodes", () => {
    const t = ops.addTag();
    ops.setNodeTag(["b1"], t, true);
    // a remote peer tags the same card with the same id, and with one that
    // no longer exists here
    const remote = forkRemote();
    const n = findInDoc(remote, "b1")!;
    const arr = n.map.get("tags") as unknown as Y.Array<string>;
    arr.push([t, "tag-gone"]);
    mergeBack(remote);
    repairDuplicates();
    expect(find(getSnapshot(), "b1")!.tags).toEqual([t]);
  });

  it("importBoard merges the file's tag defs, keeping ours on a clash", () => {
    const mine = ops.addTag({ name: "Mine", pos: 0.1 });
    const file = {
      ...boardB(),
      tags: [
        { id: mine, name: "Theirs", color: "#3a7bd5", pos: 0.9, span: 20, reach: 10, offset: 0, shape: "flat" as const, visible: true },
        { id: "tag-new", name: "New one", color: "#2f9e44", pos: 0.5, span: 20, reach: 10, offset: 0, shape: "flat" as const, visible: true },
      ],
    };
    ops.importBoard(file);
    const tags = getSnapshot().tags;
    expect(tags.map((t) => t.name).sort()).toEqual(["Mine", "New one"]);
    expect(tags.find((t) => t.id === mine)!.pos).toBe(0.1); // ours, not the file's
  });
});

/* Notes: a LIST per card now, each with an author, an open/resolved state
 * and its own replies. The load-bearing bits are the lifecycle (resolving
 * is not deleting) and the migration off the old single-string note, which
 * has to converge when two peers do it at once. */
describe("notes", () => {
  it("a card holds several notes, each with its own author", () => {
    const a = ops.addNote("b1", { body: "Trim the head", author: "Derek" });
    const b = ops.addNote("b1", { body: "Check the clearance", author: "Sam" });
    const notes = find(getSnapshot(), "b1")!.notes!;
    expect(notes.map((n) => n.id)).toEqual([a, b]); // written order
    expect(notes.map((n) => n.author)).toEqual(["Derek", "Sam"]);
    expect(notes.every((n) => n.state === "open")).toBe(true);
    expect(notes[0].createdAt).toBeGreaterThan(0);
  });

  it("closing keeps the note; deleting is the separate act", () => {
    const a = ops.addNote("b1", { body: "One" });
    const b = ops.addNote("b1", { body: "Two" });
    ops.setNote("b1", a, { state: "done" });
    let notes = find(getSnapshot(), "b1")!.notes!;
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.id === a)!.state).toBe("done");
    ops.removeNote("b1", a);
    notes = find(getSnapshot(), "b1")!.notes!;
    expect(notes.map((n) => n.id)).toEqual([b]);
  });

  it("resetLevelGeometry puts one tier's sizes back to the app defaults, and only its sizes", () => {
    const bid = getSnapshot().boards[0].id;
    const n = getSnapshot().boards[0].levels.length;
    const leaf = n - 1;
    ops.setLevelTextSize(bid, leaf, 9);
    ops.setLevelHeight(bid, leaf, 200);
    ops.setLevelAspect(bid, leaf, 1.1);
    ops.setLevelTextColor(bid, leaf, "#123456");
    ops.resetLevelGeometry(bid, leaf);
    const l = getSnapshot().boards[0].levels[leaf];
    const d = tierDefault(0);
    expect(l.textSize).toBe(d.textSize);
    expect(l.height).toBe(d.height);
    expect(l.aspect).toBe(d.aspect);
    expect(l.textColor).toBe("#123456"); // identity stays
    expect(l.fullWidth).toBeUndefined(); // the leaf never bands
    if (n >= 3) {
      ops.setLevelFullWidth(bid, 0, false);
      ops.setLevelBandHeight(bid, 0, 12);
      ops.resetLevelGeometry(bid, 0);
      const top = getSnapshot().boards[0].levels[0];
      const dt = tierDefault(leaf);
      expect(top.fullWidth).toBe(dt.fullWidth ?? false);
      expect(top.bandHeight).toBe(dt.bandHeight);
    }
  });

  it("the board's gamma is shared, round-trips, and stores 1 as an absence", () => {
    /* A BOARD field (2026-09-10), so it has to survive both projections
     * -- the snapshot everyone reads and the per-board one -- and it is
     * stored as an ABSENCE at 1 so an older build sees the pictures as
     * they are. */
    expect(getSnapshot().boards[0].gamma).toBeUndefined();
    ops.setBoardGamma(getSnapshot().boards[0].id, 2.2);
    expect(getSnapshot().boards[0].gamma).toBe(2.2);
    // clamped to the knob's travel, never stored outside it
    ops.setBoardGamma(getSnapshot().boards[0].id, 99);
    expect(getSnapshot().boards[0].gamma).toBe(2.5);
    ops.setBoardGamma(getSnapshot().boards[0].id, 0);
    expect(getSnapshot().boards[0].gamma).toBe(0.5);
    // 1 is off, and off is nothing at all
    ops.setBoardGamma(getSnapshot().boards[0].id, 1);
    expect(getSnapshot().boards[0].gamma).toBeUndefined();
  });

  it("a card stored by the Corner build reads as Fill, and keeps its own text", () => {
    /* CORNER RETIRED 2026-09-08 (types.ts). A colleague's board -- or
     * this one, mid-sync -- can still carry `imageFit: "corner"`, so the
     * read has to land it somewhere sane rather than draw a mode that no
     * longer exists. It falls through to Fill, which is what an older
     * build already did with an unknown value, and the card's own white
     * and shadowed overrides (written when its picture arrived, merely
     * suppressed while it was a thumbnail) come back with it. */
    ops.setNodeImage("b1", "data:image/png;base64,iVBORw0KGgo=");
    /* Reach past the ops to write exactly what yesterday's build wrote.
     * A deep walk rather than a path, so the test does not pin the doc's
     * shape as well as this behavior. */
    const findY = (v: unknown): Y.Map<unknown> | null => {
      if (v instanceof Y.Map) {
        if (v.get("id") === "b1") return v;
        for (const k of Array.from(v.keys())) {
          const hit = findY(v.get(k));
          if (hit) return hit;
        }
      } else if (v instanceof Y.Array) {
        for (const item of v.toArray()) {
          const hit = findY(item);
          if (hit) return hit;
        }
      }
      return null;
    };
    const y = findY(projectMap);
    expect(y).toBeTruthy();
    y!.set("imageFit", "corner");
    y!.set("imageCorner", "tl");
    const read = find(getSnapshot(), "b1")!;
    expect(read.imageFit).toBeUndefined(); // Fill, the absence
    expect(read.imageCorner).toBe("tl"); // still round-trips, ignored by every renderer
    expect(read.textColor).toBe("#ffffff"); // the caption's own overrides, back
    expect(read.textShadow).toBe(true);
  });

  it("setNodeImageSit writes the whole sit at once, and the fill defaults read as absent", () => {
    ops.setNodeImageSit(["b1"], { fit: "fit", tile: true, mirror: true, align: "left top", corner: "br" });
    let n = find(getSnapshot(), "b1")!;
    expect(n).toMatchObject({ imageFit: "fit", imageTile: true, imageMirror: true, imageAlign: "left top" });
    expect(n.imageCorner).toBeUndefined(); // br is the absence
    // the sit's text position: "" is centered and clears the caption's bottom
    ops.setNodeImageSit(["b1"], { fit: "fit", tile: false, mirror: false, align: "center center", corner: "br", titleAlign: "top" });
    expect(find(getSnapshot(), "b1")!.titleAlign).toBe("top");
    ops.setNodeImageSit(["b1"], { fit: "fill", tile: false, mirror: false, align: "center center", corner: "br", titleAlign: "" });
    expect(find(getSnapshot(), "b1")!.titleAlign).toBeUndefined();
    ops.setNodeImageSit(["b1"], { fit: "fill", tile: false, mirror: false, align: "center center", corner: "br" });
    n = find(getSnapshot(), "b1")!;
    expect(n.imageFit).toBeUndefined();
    expect(n.imageTile).toBeUndefined();
    expect(n.imageMirror).toBeUndefined();
    expect(n.imageAlign).toBeUndefined();
  });

  it("an implementation note is one per note, and an empty one is none", () => {
    const a = ops.addNote("b1", { body: "Lose the crew credits" });
    ops.setNote("b1", a, { impl: "Moved to the tail", state: "caveat" });
    let note = find(getSnapshot(), "b1")!.notes![0];
    expect(note).toMatchObject({ impl: "Moved to the tail", state: "caveat" });
    ops.setNote("b1", a, { impl: "" });
    note = find(getSnapshot(), "b1")!.notes![0];
    expect(note.impl).toBeUndefined();
    expect(note.state).toBe("caveat"); // clearing the words keeps the color
  });

  it("the implementation note carries who wrote it and when, and loses both with the words", () => {
    const a = ops.addNote("b1", { body: "Hold on her a beat longer" });
    ops.setNote("b1", a, { impl: "Held 8 frames", implBy: "Derek", implAt: 1700000000000 });
    let note = find(getSnapshot(), "b1")!.notes![0];
    expect(note).toMatchObject({ impl: "Held 8 frames", implBy: "Derek", implAt: 1700000000000 });
    // a second writer takes the stamp
    ops.setNote("b1", a, { impl: "Held 12", implBy: "Sam", implAt: 1700000001000 });
    note = find(getSnapshot(), "b1")!.notes![0];
    expect(note).toMatchObject({ impl: "Held 12", implBy: "Sam", implAt: 1700000001000 });
    ops.setNote("b1", a, { impl: "" });
    note = find(getSnapshot(), "b1")!.notes![0];
    expect(note.impl).toBeUndefined();
    expect(note.implBy).toBeUndefined();
    expect(note.implAt).toBeUndefined();
  });

  it("the last note out takes the list with it", () => {
    const a = ops.addNote("b1", { body: "Only one" });
    ops.removeNote("b1", a);
    expect(find(getSnapshot(), "b1")!.notes).toBeUndefined();
  });

  it("a reply hangs off its note, and deleting the last one clears them", () => {
    const a = ops.addNote("b1", { body: "Why this cut?", author: "Derek" });
    const r1 = ops.addReply("b1", a, { body: "It's the only clean take", author: "Sam" });
    const r2 = ops.addReply("b1", a, { body: "Agreed", author: "Derek" });
    let note = find(getSnapshot(), "b1")!.notes![0];
    expect(note.replies?.map((r) => r.body)).toEqual(["It's the only clean take", "Agreed"]);
    ops.setNote("b1", a, { body: "edited" }, r1);
    note = find(getSnapshot(), "b1")!.notes![0];
    expect(note.replies![0].body).toBe("edited"); // the reply, not the note
    expect(note.body).toBe("Why this cut?");
    ops.removeNote("b1", a, r1);
    ops.removeNote("b1", a, r2);
    note = find(getSnapshot(), "b1")!.notes![0];
    expect(note.replies).toBeUndefined();
    expect(note.body).toBe("Why this cut?"); // the note itself survives
  });

  it("deleting a note takes its replies with it", () => {
    const a = ops.addNote("b1", { body: "Question" });
    ops.addReply("b1", a, { body: "Answer" });
    ops.removeNote("b1", a);
    expect(find(getSnapshot(), "b1")!.notes).toBeUndefined();
  });

  it("notes ride along with a duplicated card", () => {
    const a = ops.addNote("b1", { body: "Carried", author: "Derek" });
    ops.addReply("b1", a, { body: "Also carried" });
    const copy = ops.duplicateNode("b1");
    const notes = find(getSnapshot(), copy)!.notes!;
    expect(notes[0].body).toBe("Carried");
    expect(notes[0].replies![0].body).toBe("Also carried");
  });

  /* The pre-notes-system shape: `notes` was a plain string on the node. */
  it("migrates a legacy string note, and converges when two peers do it", async () => {
    doc.transact(() => {
      findInDoc(doc, "b1")!.map.set("notes", "an old note");
      findInDoc(doc, "b2")!.map.set("notes", ""); // an empty one was never a note
    }, "local");
    // it READS as a note before any migration runs, so nothing vanishes in
    // the window before the repair pass reaches it
    expect(find(getSnapshot(), "b1")!.notes![0].body).toBe("an old note");

    // two peers migrate independently, then merge
    const remote = forkRemote();
    const rn = findInDoc(remote, "b1")!;
    const arr = new Y.Array() as YArr;
    const one = new Y.Map() as YMap;
    one.set("id", "nt-b1-0"); // the same DERIVED id this doc will mint
    one.set("body", "an old note");
    one.set("author", "");
    one.set("state", "open");
    one.set("createdAt", 0);
    arr.push([one]);
    rn.map.set("notes", arr);

    repairDuplicates(); // local migration
    mergeBack(remote);
    await tick();
    const notes = find(getSnapshot(), "b1")!.notes!;
    expect(notes).toHaveLength(1); // not two copies of the same note
    expect(notes[0]).toMatchObject({ id: "nt-b1-0", body: "an old note", state: "open" });
    expect(find(getSnapshot(), "b2")!.notes).toBeUndefined();
  });

  it("an op works on a card whose notes the migration hasn't reached", () => {
    doc.transact(() => findInDoc(doc, "b3")!.map.set("notes", "written last year"), "local");
    const added = ops.addNote("b3", { body: "written today", author: "Derek" });
    const notes = find(getSnapshot(), "b3")!.notes!;
    expect(notes.map((n) => n.body)).toEqual(["written last year", "written today"]);
    expect(notes[1].id).toBe(added);
  });
});

/* Metadata categories (spec Sec 7 "scalar layers"): a project-level
 * definition + a per-node value. The invariants that matter are the ones
 * that keep the doc from filling with values nothing can show -- a blank is
 * not a value, and a value whose category is gone is dead weight. */
describe("metadata categories", () => {
  it("a category is project-level; values are per node, at any tier", () => {
    const f = ops.addField({ name: "Shoot day" });
    ops.setNodeValue(["b1"], f, "DAY 06");
    ops.setNodeValue(["r1"], f, "DAYS 1-4"); // a reel, not just a leaf
    const snap = getSnapshot();
    expect(snap.fields).toEqual([{ id: f, name: "Shoot day" }]);
    expect(find(snap, "b1")!.values).toEqual({ [f]: "DAY 06" });
    expect(find(snap, "r1")!.values).toEqual({ [f]: "DAYS 1-4" });
    expect(find(snap, "b2")!.values).toBeUndefined(); // unfilled carries nothing
  });

  it("a blank value is no value: it drops the key, then the map", () => {
    const a = ops.addField({ name: "TC in" });
    const b = ops.addField({ name: "TC out" });
    ops.setNodeValue(["b1"], a, "01:00:00:00");
    ops.setNodeValue(["b1"], b, "01:00:04:12");
    ops.setNodeValue(["b1"], a, "");
    expect(find(getSnapshot(), "b1")!.values).toEqual({ [b]: "01:00:04:12" });
    ops.setNodeValue(["b1"], b, "");
    expect(find(getSnapshot(), "b1")!.values).toBeUndefined();
  });

  it("clearing a value on a card with none is a no-op, not an empty map", () => {
    const f = ops.addField();
    ops.setNodeValue(["b2"], f, "");
    expect(find(getSnapshot(), "b2")!.values).toBeUndefined();
  });

  it("setNodeValue fills a whole selection at once", () => {
    const f = ops.addField({ name: "Shoot day" });
    ops.setNodeValue(["b1", "b2", "b3"], f, "DAY 09");
    const snap = getSnapshot();
    for (const id of ["b1", "b2", "b3"]) expect(find(snap, id)!.values).toEqual({ [f]: "DAY 09" });
  });

  it("renaming a category leaves every value filed under it", () => {
    const f = ops.addField({ name: "Day" });
    ops.setNodeValue(["b1"], f, "DAY 06");
    ops.setField(f, { name: "Shoot day" });
    const snap = getSnapshot();
    expect(snap.fields[0].name).toBe("Shoot day");
    expect(find(snap, "b1")!.values).toEqual({ [f]: "DAY 06" });
  });

  it("removeField deletes the category and every value under it", () => {
    const f = ops.addField({ name: "Shoot day" });
    const keep = ops.addField({ name: "TC in" });
    ops.setNodeValue(["b1", "b4", "s1"], f, "DAY 06");
    ops.setNodeValue(["b1"], keep, "01:00:00:00");
    ops.removeField(f);
    const snap = getSnapshot();
    expect(snap.fields.map((x) => x.id)).toEqual([keep]);
    expect(find(snap, "b1")!.values).toEqual({ [keep]: "01:00:00:00" }); // other survives
    for (const id of ["b4", "s1"]) expect(find(snap, id)!.values).toBeUndefined();
  });

  it("duplicating a card carries its values", () => {
    const f = ops.addField({ name: "Shoot day" });
    ops.setNodeValue(["b1"], f, "DAY 06");
    const copy = ops.duplicateNode("b1");
    expect(find(getSnapshot(), copy)!.values).toEqual({ [f]: "DAY 06" });
  });

  it("repair strips values whose category is gone, and blanks", () => {
    const f = ops.addField({ name: "Shoot day" });
    ops.setNodeValue(["b1"], f, "DAY 06");
    // a remote peer files a value under a category this doc doesn't have,
    // and blanks another -- both are invisible weight
    const remote = forkRemote();
    const n = findInDoc(remote, "b1")!;
    const values = n.map.get("values") as unknown as Y.Map<string>;
    values.set("fld-gone", "whatever");
    const other = findInDoc(remote, "b2")!;
    const blank = new Y.Map<string>();
    blank.set(f, "");
    other.map.set("values", blank as unknown as YMap);
    mergeBack(remote);
    repairDuplicates();
    const snap = getSnapshot();
    expect(find(snap, "b1")!.values).toEqual({ [f]: "DAY 06" });
    expect(find(snap, "b2")!.values).toBeUndefined(); // blank map removed entirely
  });

  it("repair collapses duplicate category definitions", () => {
    const f = ops.addField({ name: "Shoot day" });
    doc.transact(() => {
      const arr = projectMap.get("fields") as YArr;
      const dup = new Y.Map() as YMap;
      dup.set("id", f); // two peers importing the same board file
      dup.set("name", "Shoot day");
      arr.push([dup]);
    }, "remote-peer");
    repairDuplicates();
    expect(getSnapshot().fields).toHaveLength(1);
  });

  /* The bulk half: paste a copied card's values onto a whole selection. */
  it("setNodeValues writes several categories onto several cards at once", () => {
    const day = ops.addField({ name: "Shoot day" });
    const tc = ops.addField({ name: "TC in" });
    ops.setNodeValues(["b1", "b2", "b3"], { [day]: "DAY 06", [tc]: "01:00:00:00" });
    const snap = getSnapshot();
    for (const id of ["b1", "b2", "b3"]) {
      expect(find(snap, id)!.values).toEqual({ [day]: "DAY 06", [tc]: "01:00:00:00" });
    }
    expect(find(snap, "b4")!.values).toBeUndefined(); // untouched
  });

  it("pasting a blank clears that category across the selection", () => {
    const day = ops.addField({ name: "Shoot day" });
    const tc = ops.addField({ name: "TC in" });
    ops.setNodeValues(["b1", "b2"], { [day]: "DAY 06", [tc]: "01:00:00:00" });
    ops.setNodeValues(["b1", "b2"], { [day]: "" }); // clear one column
    const snap = getSnapshot();
    for (const id of ["b1", "b2"]) {
      expect(find(snap, id)!.values).toEqual({ [tc]: "01:00:00:00" });
    }
    // ...and clearing the last one drops the map, like every other writer
    ops.setNodeValues(["b1"], { [tc]: "" });
    expect(find(getSnapshot(), "b1")!.values).toBeUndefined();
  });

  it("setNodeValues on a card with no values at all is a no-op, not an empty map", () => {
    const day = ops.addField();
    ops.setNodeValues(["b4"], { [day]: "" });
    expect(find(getSnapshot(), "b4")!.values).toBeUndefined();
  });

  /* Display slots: WHERE a value shows on the card face. Per card, so the
   * invariants are about not leaving stale placements behind. */
  it("a category goes in a slot, and MOVES rather than duplicating", () => {
    const f = ops.addField({ name: "Shoot day" });
    ops.setNodeSlot(["b1"], "footer", f);
    expect(find(getSnapshot(), "b1")!.slots).toEqual({ footer: f });
    ops.setNodeSlot(["b1"], "tl", f); // the same category, somewhere else
    expect(find(getSnapshot(), "b1")!.slots).toEqual({ tl: f });
  });

  it("clearing the last slot drops the map", () => {
    const f = ops.addField();
    ops.setNodeSlot(["b1"], "header", f);
    ops.setNodeSlot(["b1"], "header", null);
    expect(find(getSnapshot(), "b1")!.slots).toBeUndefined();
  });

  it("removeField takes its placements with it, via repair", () => {
    const f = ops.addField({ name: "Shoot day" });
    ops.setNodeSlot(["b1"], "footer", f);
    ops.removeField(f);
    repairDuplicates();
    expect(find(getSnapshot(), "b1")!.slots).toBeUndefined();
  });

  it("applyValues copies the ticked values to the same tier, scoped", () => {
    const day = ops.addField({ name: "Shoot day" });
    const tc = ops.addField({ name: "TC" });
    ops.setNodeValue(["b1"], day, "DAY 01");
    ops.setNodeValue(["b1"], tc, "01:00:00:00");

    // only the ticked category travels -- filling in a shoot day must not
    // drag the timecode along with it
    const n = ops.applyValues("b1", "s1", [day]); // s1 holds b1 b2 b3; s2 holds b4
    const snap = getSnapshot();
    expect(n).toBe(2); // b2 b3, not the source
    expect(find(snap, "b2")!.values).toEqual({ [day]: "DAY 01" });
    expect(find(snap, "b3")!.values).toEqual({ [day]: "DAY 01" });
    expect(find(snap, "b4")!.values).toBeUndefined(); // other scene, out of scope
    expect(find(snap, "s1")!.values).toBeUndefined(); // other tier, untouched
  });

  it("applyValues with a blank source CLEARS the category on the targets", () => {
    const day = ops.addField({ name: "Shoot day" });
    ops.setNodeValue(["b2", "b3"], day, "DAY 09");
    // b1 has no value for it at all -- ticking it is how a column gets wiped
    const n = ops.applyValues("b1", null, [day]);
    const snap = getSnapshot();
    expect(n).toBe(3);
    // and the map goes with the last key, per ADR 0003
    expect(find(snap, "b2")!.values).toBeUndefined();
    expect(find(snap, "b3")!.values).toBeUndefined();
  });

  it("applyValues leaves categories it wasn't given alone", () => {
    const day = ops.addField({ name: "Shoot day" });
    const tc = ops.addField({ name: "TC" });
    ops.setNodeValue(["b1"], day, "DAY 01");
    ops.setNodeValue(["b2"], tc, "keep me");
    ops.applyValues("b1", null, [day]);
    const snap = getSnapshot();
    expect(find(snap, "b2")!.values).toEqual({ [tc]: "keep me", [day]: "DAY 01" });
  });

  it("applyValues with nothing ticked is a no-op", () => {
    const day = ops.addField();
    ops.setNodeValue(["b1"], day, "DAY 01");
    expect(ops.applyValues("b1", null, [])).toBe(0);
    expect(find(getSnapshot(), "b2")!.values).toBeUndefined();
  });

  it("applyLayout copies the layout to the same tier, board-wide", () => {
    const f = ops.addField({ name: "Shoot day" });
    ops.setNodeSlot(["b1"], "footer", f);
    ops.setNodeValue(["b1"], f, "DAY 06");
    const n = ops.applyLayout("b1", null);
    const snap = getSnapshot();
    expect(n).toBe(3); // b2 b3 b4 -- every other beat, not the source
    for (const id of ["b2", "b3", "b4"]) expect(find(snap, id)!.slots).toEqual({ footer: f });
    // layout only: nobody else got b1's VALUE
    expect(find(snap, "b2")!.values).toBeUndefined();
    expect(find(snap, "b1")!.values).toEqual({ [f]: "DAY 06" });
    // ...and other tiers are untouched
    expect(find(snap, "s1")!.slots).toBeUndefined();
  });

  it("applyLayout can be scoped to one ancestor's subtree", () => {
    const f = ops.addField();
    ops.setNodeSlot(["b1"], "tr", f);
    const n = ops.applyLayout("b1", "s1"); // s1 holds b1 b2 b3; s2 holds b4
    const snap = getSnapshot();
    expect(n).toBe(2);
    expect(find(snap, "b2")!.slots).toEqual({ tr: f });
    expect(find(snap, "b4")!.slots).toBeUndefined(); // the other scene is out of scope
  });

  it("applying an empty layout clears the others", () => {
    const f = ops.addField();
    ops.setNodeSlot(["b1", "b2"], "footer", f);
    ops.setNodeSlot(["b1"], "footer", null); // the source now shows nothing
    ops.applyLayout("b1", null);
    expect(find(getSnapshot(), "b2")!.slots).toBeUndefined();
  });

  it("importBoard merges the file's categories, keeping ours on a clash", () => {
    const mine = ops.addField({ name: "Shoot day" });
    const file = {
      ...boardB(),
      fields: [
        { id: mine, name: "Their name for it" },
        { id: "fld-new", name: "Duration" },
      ],
    };
    ops.importBoard(file);
    const fields = getSnapshot().fields;
    expect(fields.map((f) => f.name).sort()).toEqual(["Duration", "Shoot day"]);
  });

  it("an imported card keeps its values, under the merged category", () => {
    const b = boardB();
    b.roots[0].children[0].children[0].children[0].values = { "fld-day": "DAY 12" };
    ops.importBoard({ ...b, fields: [{ id: "fld-day", name: "Shoot day" }] });
    const snap = getSnapshot();
    expect(snap.fields).toEqual([{ id: "fld-day", name: "Shoot day" }]);
    const imported = snap.boards[1].roots[0].children[0].children[0].children[0];
    expect(imported.values).toEqual({ "fld-day": "DAY 12" });
    // ...and the repair pass agrees the value resolves, so it survives
    repairDuplicates();
    const after = getSnapshot().boards[1].roots[0].children[0].children[0].children[0];
    expect(after.values).toEqual({ "fld-day": "DAY 12" });
  });
});

describe("legacy migration", () => {
  /* write a pre-Phase-4 shape into the root "board" map */
  function writeLegacy(d: Y.Doc) {
    d.transact(() => {
      const legacy = d.getMap("board") as YMap;
      legacy.set("title", "Old cut");
      const levels = new Y.Array() as YArr;
      for (const lid of ["reel", "section", "scene", "beat"]) {
        const l = new Y.Map() as YMap;
        l.set("id", lid);
        l.set("name", lid);
        l.set("variant", "scene");
        const f = new Y.Map() as YMap;
        f.set("subtitle", false);
        f.set("tag", false);
        f.set("color", lid === "beat");
        f.set("notes", true);
        l.set("fields", f);
        levels.push([l]);
      }
      legacy.set("levels", levels);
      const roots = new Y.Array() as YArr;
      const mk = (id: string, kids: YMap[]): YMap => {
        const m = new Y.Map() as YMap;
        m.set("id", id);
        m.set("title", id);
        m.set("collapsed", false);
        const ch = new Y.Array() as YArr;
        ch.push(kids);
        m.set("children", ch);
        return m;
      };
      roots.push([mk("L-r1", [mk("L-d1", [mk("L-s1", [mk("L-b1", []), mk("L-b2", [])])])])]);
      legacy.set("roots", roots);
    }, "legacy-writer");
  }

  it("wraps a legacy board as a project board and clears the old keys", async () => {
    writeLegacy(doc);
    await tick(); // the non-local write queues migrate+repair
    const snap = getSnapshot();
    const legacyBoard = snap.boards.find((b) => b.id === LEGACY_BOARD_ID)!;
    expect(legacyBoard.title).toBe("Old cut");
    expect(childIds(snap, "L-s1")).toEqual(["L-b1", "L-b2"]);
    expect((doc.getMap("board") as YMap).get("roots")).toBeUndefined();
  });

  it("two peers migrating the same doc concurrently converge to ONE board", async () => {
    writeLegacy(doc);
    const remote = forkRemote(); // both sides now hold the un-migrated doc
    migrateLegacyBoard(); // local migrates...
    migrateLegacyBoard(remote); // ...and so does the remote peer
    mergeBack(remote);
    await tick();
    const snap = getSnapshot();
    expect(snap.boards.filter((b) => b.id === LEGACY_BOARD_ID)).toHaveLength(1);
    expect(countId(snap, "L-b1")).toBe(1);
  });
});

describe("structural sharing", () => {
  it("keeps object identity of untouched boards and subtrees", () => {
    addBoardRaw(boardB());
    const before = getSnapshot();
    ops.setNodeField("b1", "title", "changed");
    const after = getSnapshot();
    expect(find(after, "b1")!.title).toBe("changed");
    // the changed path is new objects...
    expect(find(after, "s1")).not.toBe(find(before, "s1"));
    // ...everything untouched is the SAME object (memo/bail-out fuel)
    expect(find(after, "s2")).toBe(find(before, "s2"));
    const b = (p: typeof after, id: string) => p.boards.find((x) => x.id === id)!;
    expect(b(after, "bd2")).toBe(b(before, "bd2")); // whole other board: same ref
    expect(b(after, "bd1").levels).toBe(b(before, "bd1").levels);
    expect(b(after, "bd1").legend).toBe(b(before, "bd1").legend);
  });

  /* The project-level vocabularies are read by a hook in EVERY card
   * (useTags), so a fresh array per snapshot would re-render every mounted
   * card on every unrelated keystroke -- and the Overview isn't virtualized,
   * so "every mounted card" can be thousands. They're cached and invalidated
   * on their own writes. */
  it("keeps the tag and field arrays identical across unrelated edits", () => {
    const t = ops.addTag({ name: "Alice" });
    const f = ops.addField({ name: "Shoot day" });
    const before = getSnapshot();
    ops.setNodeField("b1", "title", "changed");
    ops.setBoardTitle("bd1", "New title");
    const after = getSnapshot();
    expect(after.tags).toBe(before.tags);
    expect(after.fields).toBe(before.fields);
    // ...and a write to one vocabulary leaves the other's identity alone
    ops.setTag(t, { pos: 0.5 });
    const afterTag = getSnapshot();
    expect(afterTag.tags).not.toBe(before.tags);
    expect(afterTag.fields).toBe(before.fields);
    ops.setField(f, { name: "Day" });
    const afterField = getSnapshot();
    expect(afterField.fields).not.toBe(afterTag.fields);
    expect(afterField.tags).toBe(afterTag.tags);
  });

  it("a per-card value edit doesn't disturb the category list", () => {
    const f = ops.addField({ name: "Shoot day" });
    const before = getSnapshot();
    ops.setNodeValue(["b1"], f, "DAY 06");
    const after = getSnapshot();
    expect(after.fields).toBe(before.fields);
    expect(find(after, "b1")!.values).toEqual({ [f]: "DAY 06" });
    expect(find(after, "s2")).toBe(find(before, "s2")); // untouched subtree
  });

  it("a board-title edit leaves that board's parts untouched", () => {
    const before = getSnapshot();
    ops.setBoardTitle("bd1", "New title");
    const after = getSnapshot();
    expect(after.boards[0].title).toBe("New title");
    expect(after.boards[0].roots).toBe(before.boards[0].roots);
    expect(after.boards[0].levels).toBe(before.boards[0].levels);
    expect(after.boards[0].legend).toBe(before.boards[0].legend);
  });
});

describe("merge repair", () => {
  /* An import must reach a peer as ONE update carrying the board AND the
   * definitions its cards reference. It used to be three transactions --
   * board, then tags, then fields -- so a peer could receive the board
   * alone, treat it as remote, and run repairNodeVocab over cards whose
   * tag ids and value keys resolved to nothing yet. That pass deletes
   * exactly those, and the deletions synced back: an import silently
   * arrived stripped of its metadata for everyone.
   *
   * It only ever reproduced with a second peer connected -- repair skips
   * local-origin transactions -- which is why it has to be pinned here
   * rather than checked by hand. */
  it("imports a board and its vocabulary in ONE update, so a peer can't repair the metadata away", () => {
    const file = board4();
    file.id = "imported";
    const scene = file.roots[0].children[0].children[0];
    scene.values = { "fld-tc": "01:00:00:00" };
    scene.children[0].tags = ["tag-alice"];
    file.fields = [{ id: "fld-tc", name: "TC in" }];
    file.tags = [
      {
        id: "tag-alice",
        name: "Alice",
        color: "#e5484d",
        pos: 0,
        reach: 12,
        span: 26,
        offset: 0,
        shape: "flat",
        visible: true,
      },
    ];

    // a peer already in sync BEFORE the import -- the real scenario, and
    // the only one that reproduced the bug
    const peer = forkRemote();

    const updates: Uint8Array[] = [];
    const collect = (u: Uint8Array) => updates.push(u);
    doc.on("update", collect);
    const newId = ops.importBoard(file);
    doc.off("update", collect);

    // one transaction => one update on the wire => no peer can ever observe
    // a board whose definitions haven't arrived
    expect(updates.length).toBe(1);

    // and that single update, delivered on its own, carries both
    Y.applyUpdate(peer, updates[0], "remote-peer");
    const proj = peer.getMap("project");
    const fieldIds = ((proj.get("fields") as YArr | undefined)?.toArray() ?? []).map(
      (f) => (f as YMap).get("id") as string,
    );
    const tagIds = ((proj.get("tags") as YArr | undefined)?.toArray() ?? []).map(
      (t) => (t as YMap).get("id") as string,
    );
    expect(fieldIds).toContain("fld-tc");
    expect(tagIds).toContain("tag-alice");

    // the values themselves survived the round trip locally too
    const board = getSnapshot().boards.find((b) => b.id === newId)!;
    const importedScene = board.roots[0].children[0].children[0];
    expect(importedScene.values?.["fld-tc"]).toBe("01:00:00:00");
    expect(importedScene.children[0].tags).toEqual(["tag-alice"]);
  });

  /* copyNodes is the other path that writes cards carrying vocabulary
   * references -- but unlike an import, the definitions ALREADY live in
   * this doc (they're project-level), so they reached every peer before
   * any copy that references them could. This pins that: the repair pass
   * run over a fresh cross-board copy must leave its tags and values
   * alone. If someone ever makes copyNodes mint or carry definitions of
   * its own, this is the test that should make them read withVocabulary. */
  it("a cross-board copy's tags and values survive the repair pass", async () => {
    addBoardRaw(boardB());
    const tagId = ops.addTag({ name: "Alice" });
    const fieldId = ops.addField({ name: "Shoot day" });
    ops.setNodeTag(["b1"], tagId, true);
    ops.setNodeValue(["b1"], fieldId, "DAY 06");

    // a peer in sync before the copy, as in the importBoard test above
    const peer = forkRemote();

    const made = ops.copyNodes(["b1"], "sB1", 0); // the split-view drag
    expect(made).toHaveLength(1);

    // the peer receives the copy and echoes it back as a remote-origin
    // transaction; the queued repair then sweeps the copied node
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc), "remote-peer");
    mergeBack(peer);
    repairDuplicates();
    await tick();

    const copy = find(getSnapshot(), made[0])!;
    expect(copy.tags).toEqual([tagId]);
    expect(copy.values?.[fieldId]).toBe("DAY 06");
  });

  it("concurrent moves of one node converge to a single copy", async () => {
    const remote = forkRemote();

    // local peer: b1 -> s2 head (through ops, i.e. clone + delete)
    ops.moveNode("b1", "s2", 0);

    // remote peer: b1 -> end of s1 (raw clone + delete, same shape as relocate)
    const rb = findInDoc(remote, "b1")!;
    const rs1 = findInDoc(remote, "s1")!;
    remote.transact(() => {
      const clone = cloneNodeY(rb.map);
      rb.arr.delete(rb.index, 1);
      (rs1.map.get("children") as YArr).push([clone]);
    });

    mergeBack(remote);
    expect(countId(getSnapshot(), "b1")).toBe(2); // the merge artifact
    await tick(); // repair runs off the remote-origin transaction
    expect(countId(getSnapshot(), "b1")).toBe(1);
  });

  it("a merged double ladder (concurrent replace) is de-duplicated", async () => {
    const remote = forkRemote();
    remote.transact(() => {
      const board = boardsOf(remote)!.get(0);
      const levels = board.get("levels") as YArr;
      const copies = levels.toArray().map((m) => {
        const c = new Y.Map() as YMap;
        m.forEach((v, k) => {
          if (k === "fields") {
            const f = new Y.Map() as YMap;
            (v as YMap).forEach((fv, fk) => f.set(fk, fv));
            c.set(k, f);
          } else {
            c.set(k, v);
          }
        });
        return c;
      });
      levels.push(copies);
    });

    mergeBack(remote);
    expect(getSnapshot().boards[0].levels).toHaveLength(8);
    await tick();
    expect(getSnapshot().boards[0].levels.map((l) => l.id)).toEqual(["reel", "section", "scene", "beat"]);
  });

  it("two default-color entries bound to one tier collapse to one", () => {
    doc.transact(() => {
      const board = boardsOf(doc)!.get(0);
      const legend = board.get("legend") as YArr;
      const dup = new Y.Map() as YMap;
      dup.set("id", "someone-elses-entry");
      dup.set("label", "Beat");
      dup.set("bg", "#ffffff");
      dup.set("border", "#eeeeee");
      dup.set("tier", "beat"); // second entry claiming the beat tier
      legend.push([dup]);
    }, "remote-peer");

    repairDuplicates();
    const bound = getSnapshot().boards[0].legend.filter((e) => e.tier === "beat");
    expect(bound).toHaveLength(1);
  });

  it("repair is a no-op on a healthy project", () => {
    const before = JSON.stringify(getSnapshot());
    repairDuplicates();
    expect(JSON.stringify(getSnapshot())).toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 *  insertTierAt -- pinning a card of any tier at a gap.
 *
 *  The rule under test is the corkboard one: a card of tier T pinned at a
 *  point absorbs everything below it down to the next card of tier T or
 *  shallower, and anything absorbed that is DEEPER than T gets a no-name
 *  parent minted at each tier in between. Everything else here follows
 *  from that one sentence.
 * ------------------------------------------------------------------ */
describe("insertTierAt (pin a card of any tier at a gap)", () => {
  /*  r1                    r2
   *    d1                    d3
   *      s1: b1 b2             s5
   *      s2: b3
   *      s3: b4
   *    d2
   *      s4: b5                                              */
  function wide(): Board {
    return {
      id: "bd1",
      title: "Wide",
      levels: [level("reel", "Reel"), level("day", "Day"), level("scene", "Scene"), level("beat", "Beat")],
      legend: [],
      roots: [
        node("r1", [
          node("d1", [node("s1", [node("b1"), node("b2")]), node("s2", [node("b3")]), node("s3", [node("b4")])]),
          node("d2", [node("s4", [node("b5")])]),
        ]),
        node("r2", [node("d3", [node("s5")])]),
      ],
    };
  }
  const reseed = (b: Board) => {
    doc.transact(() => {
      const boards = projectMap.get("boards");
      if (boards instanceof Y.Array) boards.delete(0, boards.length);
    }, "local");
    addBoardRaw(b);
    undoManager.clear();
  };
  beforeEach(() => reseed(wide()));

  const kidsOf = (id: string) => childIds(getSnapshot(), id);

  it("the gap's OWN tier is a plain insert -- nothing moves", () => {
    const id = ops.insertTierAt("bd1", "d1", 1, 2);
    expect(kidsOf("d1")).toEqual(["s1", id, "s2", "s3"]);
    expect(kidsOf("r1")).toEqual(["d1", "d2"]); // untouched
  });

  it("the PARENT's tier splits it, and the next sibling's own card stops the absorption", () => {
    const id = ops.insertTierAt("bd1", "d1", 1, 1);
    expect(kidsOf("d1")).toEqual(["s1"]); // keeps what was above the pin
    expect(kidsOf(id)).toEqual(["s2", "s3"]); // takes what was below
    expect(kidsOf("r1")).toEqual(["d1", id, "d2"]); // lands right after d1
    expect(kidsOf("d2")).toEqual(["s4"]); // d2's own card stopped it
  });

  it("a GRANDPARENT tier mints the no-name parent the orphans need", () => {
    const id = ops.insertTierAt("bd1", "d1", 1, 0);
    const snap = getSnapshot();
    expect(snap.boards[0].roots.map((r) => r.id)).toEqual(["r1", id, "r2"]);
    expect(kidsOf("d1")).toEqual(["s1"]);
    // the new reel: a minted day holding the orphaned scenes, then d2 whole
    const kids = kidsOf(id);
    expect(kids).toHaveLength(2);
    expect(kids[1]).toBe("d2");
    expect(childIds(snap, kids[0])).toEqual(["s2", "s3"]);
    expect(find(snap, kids[0])!.title).toBe(""); // no-name
    expect(kidsOf("r1")).toEqual(["d1"]); // d2 went with it
    expect(kidsOf("r2")).toEqual(["d3"]); // r2's own card stopped it
  });

  it("carries the absorbed cards by IDENTITY -- these are the same cards, not copies", () => {
    const before = find(getSnapshot(), "b3")!;
    const id = ops.insertTierAt("bd1", "d1", 1, 0);
    const after = find(getSnapshot(), "b3")!;
    expect(after.id).toBe(before.id); // ids travel
    expect(find(getSnapshot(), "s2")).not.toBeNull();
    // and only ONE of each still exists
    let seen = 0;
    const count = (ns: Node[]) => {
      for (const n of ns) {
        if (n.id === "s2") seen++;
        count(n.children);
      }
    };
    count(getSnapshot().boards[0].roots);
    expect(seen).toBe(1);
    expect(id).not.toBe("");
  });

  it("absorbs NOTHING at the foot of a lane -- which is how you start the next one", () => {
    const id = ops.insertTierAt("bd1", "d1", 3, 1); // after the last scene
    expect(kidsOf("d1")).toEqual(["s1", "s2", "s3"]); // nothing taken
    expect(kidsOf("r1")).toEqual(["d1", id, "d2"]);
    // and it arrives with the same empty cascade any other new day gets
    expect(find(getSnapshot(), id)!.children).toHaveLength(1);
  });

  it("a gap at a lane boundary needs no no-name parent", () => {
    const id = ops.insertTierAt("bd1", "r1", 1, 0); // between d1 and d2
    expect(kidsOf(id)).toEqual(["d2"]); // d2 is already the right tier
    expect(kidsOf("r1")).toEqual(["d1"]);
  });

  /* The gap between a container and its first child can only make that
   * container's children -- otherwise pinning a Day above the first scene
   * would take every scene and leave the day it split off empty. */
  it("refuses an ancestor tier at index 0, and still allows the own tier there", () => {
    expect(ops.insertTierAt("bd1", "d1", 0, 1)).toBe("");
    expect(kidsOf("d1")).toEqual(["s1", "s2", "s3"]); // untouched
    expect(kidsOf("r1")).toEqual(["d1", "d2"]);
    const id = ops.insertTierAt("bd1", "d1", 0, 2);
    expect(kidsOf("d1")).toEqual([id, "s1", "s2", "s3"]);
  });

  it("is ONE undo step however much it takes in", () => {
    const before = JSON.stringify(getSnapshot().boards[0].roots);
    ops.insertTierAt("bd1", "d1", 1, 0);
    expect(JSON.stringify(getSnapshot().boards[0].roots)).not.toBe(before);
    ops.undo();
    expect(JSON.stringify(getSnapshot().boards[0].roots)).toBe(before);
  });

  it("refuses a tier DEEPER than the gap, and a board that isn't there", () => {
    expect(ops.insertTierAt("bd1", "d1", 1, 3)).toBe("");
    expect(ops.insertTierAt("nope", "d1", 1, 1)).toBe("");
  });

  /* Two tiers between the pin and the gap, so the minting LOOP runs rather
   * than the single-parent shortcut. */
  it("mints a no-name parent at EVERY tier in between", () => {
    reseed({
      id: "bd1",
      title: "Deep",
      levels: ["a", "b", "c", "d", "e"].map((x) => level(x, x.toUpperCase())),
      legend: [],
      roots: [
        node("a1", [
          node("b1", [node("c1", [node("d1", [node("e1")]), node("d2", [node("e2")])]), node("c2")]),
          node("b2"),
        ]),
      ],
    });
    // gap between d1 and d2 (inside c1 inside b1 inside a1), pinning an A
    const id = ops.insertTierAt("bd1", "c1", 1, 0);
    const snap = getSnapshot();
    expect(snap.boards[0].roots.map((r) => r.id)).toEqual(["a1", id]);
    expect(childIds(snap, "c1")).toEqual(["d1"]);
    const b = childIds(snap, id); // the new A holds a minted B, then b2
    expect(b).toHaveLength(2);
    expect(b[1]).toBe("b2");
    const c = childIds(snap, b[0]); // that B holds a minted C, then c2
    expect(c).toHaveLength(2);
    expect(c[1]).toBe("c2");
    expect(childIds(snap, c[0])).toEqual(["d2"]); // the orphan, rehomed
    expect(find(snap, b[0])!.title).toBe("");
    expect(find(snap, c[0])!.title).toBe("");
  });
});

describe("nested boards (docs/explorations/board-shapes.md, DECISIONS 3)", () => {
  beforeEach(() => addBoardRaw(boardB()));

  it("nesting points a card at a board and DELETES the children it had", () => {
    const before = find(getSnapshot(), "s1")!;
    expect(before.children).toHaveLength(3); // b1 b2 b3

    expect(ops.nestNode("s1", "bd2")).toBe(true);
    const s1 = find(getSnapshot(), "s1")!;
    expect(s1.boardRef).toBe("bd2");
    expect(s1.children).toHaveLength(0);
    // ...and every one of them is gone from the doc, not merely detached
    for (const id of ["b1", "b2", "b3"]) expect(find(getSnapshot(), id)).toBeNull();
  });

  /* The confirm dialog promises the convert is reversible, and this is
   * what that promise rests on: one tx, so the wipe and the ref undo
   * together (the caveat is undo's own -- local origins only). */
  it("...and the whole convert is ONE undo step", () => {
    ops.nestNode("s1", "bd2");
    undoManager.undo();
    const s1 = find(getSnapshot(), "s1")!;
    expect(s1.boardRef).toBeUndefined();
    expect(childIds(getSnapshot(), "s1")).toEqual(["b1", "b2", "b3"]);
  });

  it("carries the target's title as a TOMBSTONE, for when the board is gone", () => {
    ops.nestNode("s1", "bd2");
    expect(find(getSnapshot(), "s1")!.boardRefTitle).toBe("Second board");
    // deleting the target leaves the ref AND its tombstone standing: a
    // dangling ref is usually a board that has not arrived yet, so
    // nothing scrubs it
    ops.deleteBoard("bd2");
    const s1 = find(getSnapshot(), "s1")!;
    expect(s1.boardRef).toBe("bd2");
    expect(s1.boardRefTitle).toBe("Second board");
  });

  it("converting DISCARDS the old title, like it discards the children", () => {
    /* Owner, 2026-08-26: "it should just be a nested node. we don't need
     * to hold onto what was there (except for undo purposes)." Keeping it
     * meant carrying a name nobody could see -- the same objection that
     * made a nesting card searchable by the wrong string. */
    ops.setNodeField("s1", "title", "Rehearsal");
    ops.nestNode("s1", "bd2");
    expect(find(getSnapshot(), "s1")!.title).toBe("");
  });

  it("...and UNDO is the escape hatch the owner named", () => {
    ops.setNodeField("s1", "title", "Rehearsal");
    /* Outside the capture window, or the setup merges with the
     * conversion and the undo below tests the fixture rather than the op. */
    undoManager.stopCapturing();
    ops.nestNode("s1", "bd2");
    expect(find(getSnapshot(), "s1")!.title).toBe("");
    undoManager.undo();
    const back = find(getSnapshot(), "s1")!;
    expect(back.title).toBe("Rehearsal");
    expect(back.boardRef).toBeUndefined();
  });

  it("...so un-nesting gives a BLANK card, nothing to hand back", () => {
    ops.setNodeField("s1", "title", "Rehearsal");
    ops.nestNode("s1", "bd2");
    ops.unnestNode("s1");
    const s1 = find(getSnapshot(), "s1")!;
    expect(s1.boardRef).toBeUndefined();
    expect(s1.boardRefTitle).toBeUndefined();
    expect(s1.title).toBe("");
  });

  /* CYCLES ARE ALLOWED, and the useful case is the reason (owner,
   * 2026-08-24): a card deep in a section board that takes you back to
   * the master map. A nesting card draws its target's NAME and never its
   * content, so no render recurses and there is no loop to blow up. */
  it("allows a board that points BACK -- the back-link case", () => {
    expect(ops.nestNode("sB1", "bd1")).toBe(true); // bd2 -> bd1
    expect(ops.nestNode("s1", "bd2")).toBe(true); // ...and bd1 -> bd2
    expect(find(getSnapshot(), "s1")!.boardRef).toBe("bd2");
    expect(find(getSnapshot(), "sB1")!.boardRef).toBe("bd1");
  });

  /* The one refusal left, and not for recursion -- nothing would break.
   * A nesting card means GO SOMEWHERE ELSE, and yourself is the only
   * target that isn't somewhere else. */
  it("refuses the HOST board -- the card would say go where you already are", () => {
    expect(ops.nestNode("s1", "bd1")).toBe(false);
    expect(find(getSnapshot(), "s1")!.boardRef).toBeUndefined();
  });

  it("...and refuses it on a board that is ALREADY in a loop", () => {
    ops.nestNode("sB1", "bd1"); // bd2 -> bd1
    ops.nestNode("s1", "bd2"); // bd1 -> bd2, a live cycle
    expect(ops.nestNode("s2", "bd1")).toBe(false); // still not itself
  });

  /* One board may be nested in SEVERAL places (owner, 2026-08-15), which
   * is the whole reason the cycle check walks a graph. */
  it("allows the same board nested in two places", () => {
    expect(ops.nestNode("s1", "bd2")).toBe(true);
    expect(ops.nestNode("s2", "bd2")).toBe(true);
    expect(find(getSnapshot(), "s2")!.boardRef).toBe("bd2");
  });

  describe("a nested node cannot take children", () => {
    beforeEach(() => {
      ops.nestNode("s1", "bd2");
    });

    it("addChild / addChildAt refuse", () => {
      expect(ops.addChild("s1")).toBe("");
      expect(ops.addChildAt("s1", 0)).toBe("");
      expect(find(getSnapshot(), "s1")!.children).toHaveLength(0);
    });

    it("moveNode refuses -- a drag cannot drop into one", () => {
      ops.moveNode("b4", "s1", 0);
      expect(find(getSnapshot(), "s1")!.children).toHaveLength(0);
      expect(find(getSnapshot(), "b4")).not.toBeNull(); // and the card is unharmed
    });

    it("moveNodes / copyNodes / insertNodes refuse", () => {
      ops.moveNodes(["b4"], "s1", 0);
      ops.copyNodes(["bB1"], "s1", 0);
      ops.insertNodes("s1", 0, [node("pasted")]);
      expect(find(getSnapshot(), "s1")!.children).toHaveLength(0);
    });

    it("the seam's come-inside insert refuses (insertTierAt at the node's own child tier)", () => {
      expect(ops.insertTierAt("bd1", "s1", 0, 3)).toBe("");
      expect(find(getSnapshot(), "s1")!.children).toHaveLength(0);
    });

    it("demoting a neighbour INTO it refuses", () => {
      // s2 sits after s1, so a demote-into-previous targets s1
      const r = ops.demoteNode("s2", "stow", "neighbor");
      expect(r.ok).toBe(false);
      expect(find(getSnapshot(), "s1")!.children).toHaveLength(0);
      expect(find(getSnapshot(), "s2")).not.toBeNull();
    });
  });

  /* Cross-board copy and duplicate keep the ref pointing where it did:
   * a reference is reusable, and regenIds only rewrites NODE ids. */
  it("a duplicated nesting card still points at the same board", () => {
    ops.nestNode("s1", "bd2");
    const copy = ops.duplicateNode("s1");
    expect(find(getSnapshot(), copy)!.boardRef).toBe("bd2");
  });

  /* Every ordered pair except a board and itself -- which is exactly
   * the row the picker greys. If the two ever disagreed the list would
   * hand out links that silently do nothing. */
  it("every board is a valid target except the host's own", () => {
    ops.nestNode("sB1", "bd1"); // seed a loop first, so none of this is fresh
    const ids = getSnapshot().boards.map((b) => b.id);
    for (const host of ids) {
      for (const target of ids) {
        const card = ops.addRoot(host);
        expect(ops.nestNode(card, target)).toBe(host !== target);
        ops.delNode(card);
      }
    }
  });

  it("importProject REMAPS refs inside the file to its own fresh boards", () => {
    ops.nestNode("s1", "bd2");
    const file = getSnapshot();
    const made = ops.importProject(file);
    expect(made).toHaveLength(2);
    const snap = getSnapshot();
    const copy = snap.boards.find((b) => b.id === made[0])!;
    const card = copy.roots[0].children[0].children[0];
    // ...at its OWN copy of bd2, not at the original still sitting here
    expect(card.boardRef).toBe(made[1]);
    expect(card.boardRef).not.toBe("bd2");
  });

  /* A nesting card is TIER-FREE (owner, 2026-08-24). The tier invariant
   * exists to protect the SUBTREE -- a node at depth d has children at
   * d+1 -- and a nesting card has none, so there is nothing to protect. */
  describe("a nesting card moves to any tier", () => {
    beforeEach(() => {
      ops.nestNode("b1", "bd2"); // a BEAT, depth 3 on a 4-tier ladder
    });

    it("moves UP the ladder -- a beat becomes a root", () => {
      ops.moveNode("b1", null, 0, "bd1");
      const snap = getSnapshot();
      expect(snap.boards[0].roots.map((r) => r.id)).toEqual(["b1", "r1"]);
      expect(find(snap, "b1")!.boardRef).toBe("bd2"); // and it is still a link
    });

    it("...and DOWN again, into a lane at any depth", () => {
      ops.moveNode("b1", null, 0, "bd1");
      ops.moveNode("b1", "d1", 0); // a section's children are scenes
      expect(childIds(getSnapshot(), "d1")).toEqual(["b1", "s1", "s2"]);
    });

    it("refuses a rung BELOW the leaf -- that is the stowed region", () => {
      // b2 is a leaf beat, so its children would be below the ladder
      ops.moveNode("b1", "b2", 0);
      expect(find(getSnapshot(), "b2")!.children).toHaveLength(0);
      expect(find(getSnapshot(), "b1")).not.toBeNull();
    });

    it("moveNodes carries one across tiers too", () => {
      ops.moveNodes(["b1"], null, 0, "bd1");
      expect(getSnapshot().boards[0].roots[0].id).toBe("b1");
    });

    it("copies across boards at a DIFFERENT rung", () => {
      // bd2's roots are its top tier; a beat could never land there before
      const made = ops.copyNodes(["b1"], null, 0, "bd2");
      expect(made).toHaveLength(1);
      const copy = getSnapshot().boards[1].roots[0];
      expect(copy.boardRef).toBe("bd2");
    });

    it("an ORDINARY card still cannot change tier", () => {
      ops.moveNode("b2", null, 0, "bd1");
      expect(getSnapshot().boards[0].roots.map((r) => r.id)).toEqual(["r1"]);
      expect(find(getSnapshot(), "b2")).not.toBeNull(); // and is unharmed
    });

    it("...and un-nesting takes the freedom away again", () => {
      ops.moveNode("b1", null, 0, "bd1"); // now a root
      ops.unnestNode("b1");
      ops.moveNode("b1", "d1", 0); // would be a tier change: refused
      expect(getSnapshot().boards[0].roots.map((r) => r.id)).toEqual(["b1", "r1"]);
    });
  });

  it("...and leaves a ref pointing OUT of the file alone, to dangle or resolve", () => {
    ops.nestNode("s1", "bd2");
    const file = getSnapshot();
    file.boards = [file.boards[0]]; // export board 1 only; bd2 is not in it
    const made = ops.importProject(file);
    const copy = getSnapshot().boards.find((b) => b.id === made[0])!;
    expect(copy.roots[0].children[0].children[0].boardRef).toBe("bd2");
  });
});

describe("free grid (the third board type)", () => {
  const gridBoard = (): Board => ({
    id: "bdg",
    title: "Corkboard",
    type: "grid",
    levels: [level("card", "Card")],
    legend: [],
    roots: [node("c1"), node("c2"), node("c3")],
  });
  beforeEach(() => addBoardRaw(gridBoard()));

  it("a cell round-trips through the doc, clamped", () => {
    ops.setNodeCells({ c1: { x: 4, y: 7 }, c2: { x: -3, y: 2.6 } });
    const snap = getSnapshot();
    expect(find(snap, "c1")!.cell).toEqual({ x: 4, y: 7 });
    expect(find(snap, "c2")!.cell).toEqual({ x: 0, y: 3 });
  });

  it("a span round-trips, clamped to what the surface can draw", () => {
    ops.setNodeSpan("c1", { w: 40, h: 1 });
    expect(find(getSnapshot(), "c1")!.span).toEqual({ w: SPAN_MAX, h: SPAN_MIN });
  });

  /* A data URI is heavy, so an empty one DELETES the key rather than
   * storing "" -- otherwise every card that ever had a picture keeps a
   * stray value forever. */
  it("clearing an image removes the key", () => {
    ops.setNodeImage("c1", "data:image/png;base64,AAAA");
    expect(find(getSnapshot(), "c1")!.image).toBe("data:image/png;base64,AAAA");
    ops.setNodeImage("c1", "");
    expect(find(getSnapshot(), "c1")!.image).toBeUndefined();
  });

  it("removing the image takes its appearance with it", () => {
    /* imageFit/imageTile describe a picture that is no longer there;
     * leaving them would silently re-apply to whatever is added next. */
    ops.setNodeImage("b1", "data:image/png;base64,AAAA");
    ops.setNodeImageFit("b1", "fit");
    ops.setNodeImageTile("b1", true);
    ops.setNodeImage("b1", "");
    const n = find(getSnapshot(), "b1")!;
    expect(n.image).toBeUndefined();
    expect(n.imageFit).toBeUndefined();
    expect(n.imageTile).toBeUndefined();
  });

  it("a picture brings white, shadowed, bottom-set text ONLY onto a card that has chosen nothing", () => {
    /* 2026-09-01 audit: the guard was "had no picture", so a card whose
     * words somebody had already colored got repainted the moment an
     * image landed. Now any text choice at all means the picture keeps
     * its hands off. */
    ops.setNodeImage("b1", "data:image/png;base64,AAAA");
    let n = find(getSnapshot(), "b1")!;
    expect(n.textColor).toBe("#ffffff");
    expect(n.textShadow).toBe(true);
    expect(n.titleAlign).toBe("bottom");

    ops.setNodeTextColor(["b2"], "#ff0000");
    ops.setNodeImage("b2", "data:image/png;base64,AAAA");
    n = find(getSnapshot(), "b2")!;
    expect(n.textColor).toBe("#ff0000");
    expect(n.textShadow).toBeUndefined();
    expect(n.titleAlign).toBeUndefined();
  });

  it("removing the last picture takes the photo text back -- unless it was changed", () => {
    ops.setNodeImage("b1", "data:image/png;base64,AAAA");
    ops.setNodeImage("b1", "");
    let n = find(getSnapshot(), "b1")!;
    expect(n.textColor).toBeUndefined();
    expect(n.textShadow).toBeUndefined();
    expect(n.titleAlign).toBeUndefined();

    ops.setNodeImage("b2", "data:image/png;base64,AAAA");
    ops.setNodeTextColor(["b2"], "#ffee00"); // theirs now
    ops.setNodeImage("b2", "");
    n = find(getSnapshot(), "b2")!;
    expect(n.textColor).toBe("#ffee00");
    expect(n.textShadow).toBe(true);
    expect(n.titleAlign).toBe("bottom");

    // a still underneath keeps the treatment: the picture is not gone
    ops.setNodeStill("c1", "st-abc");
    ops.setNodeImage("c1", "data:image/png;base64,AAAA");
    ops.setNodeImage("c1", "");
    expect(find(getSnapshot(), "c1")!.textColor).toBe("#ffffff");
    ops.setNodeStill("c1", "");
    expect(find(getSnapshot(), "c1")!.textColor).toBeUndefined();
  });

  it("FILL IS STORED AS AN ABSENCE, so an untouched card and a reset one match", () => {
    ops.setNodeImage("b1", "data:image/png;base64,AAAA");
    ops.setNodeImageFit("b1", "fit");
    expect(find(getSnapshot(), "b1")!.imageFit).toBe("fit");
    ops.setNodeImageFit("b1", "fill");
    expect(find(getSnapshot(), "b1")!.imageFit).toBeUndefined();
  });

  it("A MODE ROUND TRIP KEEPS ITS SUB-SETTINGS", () => {
    /* Reversed 2026-08-27, when each mode grew its own options: Fill used
     * to clear the tile flag, on the reasoning that a hidden flag
     * springing back is surprising. Losing your tiling every time you
     * glance at Fill is the more surprising of the two, and a stale flag
     * draws nothing because each key is read only in its own mode. */
    ops.setNodeImage("b1", "data:image/png;base64,AAAA");
    ops.setNodeImageFit("b1", "fit");
    ops.setNodeImageTile("b1", true);
    ops.setNodeImageMirror("b1", true);
    ops.setNodeImageFit("b1", "fill");
    ops.setNodeImageAlign("b1", "left top");
    ops.setNodeImageFit("b1", "fit");
    const n = find(getSnapshot(), "b1")!;
    expect(n.imageTile).toBe(true);
    expect(n.imageMirror).toBe(true);
    expect(n.imageAlign).toBe("left top"); // Fill's own setting, also kept
  });

  it("the crop anchor stores the CENTRE as an absence", () => {
    ops.setNodeImage("b1", "data:image/png;base64,AAAA");
    ops.setNodeImageAlign("b1", "right bottom");
    expect(find(getSnapshot(), "b1")!.imageAlign).toBe("right bottom");
    ops.setNodeImageAlign("b1", "center center");
    expect(find(getSnapshot(), "b1")!.imageAlign).toBeUndefined();
  });

  it("removing the image clears the anchor and the mirror too", () => {
    ops.setNodeImage("b1", "data:image/png;base64,AAAA");
    ops.setNodeImageFit("b1", "fit");
    ops.setNodeImageTile("b1", true);
    ops.setNodeImageMirror("b1", true);
    ops.setNodeImageAlign("b1", "left top");
    ops.setNodeImage("b1", "");
    const n = find(getSnapshot(), "b1")!;
    expect(n.imageFit).toBeUndefined();
    expect(n.imageTile).toBeUndefined();
    expect(n.imageMirror).toBeUndefined();
    expect(n.imageAlign).toBeUndefined();
  });

  it("the tile flag toggles off to an absence too", () => {
    ops.setNodeImage("b1", "data:image/png;base64,AAAA");
    ops.setNodeImageFit("b1", "fit");
    ops.setNodeImageTile("b1", true);
    ops.setNodeImageTile("b1", false);
    expect(find(getSnapshot(), "b1")!.imageTile).toBeUndefined();
  });

  it("strings yarn between two cards, and reads it back on the board", () => {
    const id = ops.addEdge("bdg", "c1", "c2", "#c0392b");
    expect(id).not.toBe("");
    const b = getSnapshot().boards.find((x) => x.id === "bdg")!;
    expect(b.edges).toHaveLength(1);
    expect(b.edges![0]).toMatchObject({ from: "c1", to: "c2", color: "#c0392b" });
  });

  it("refuses a card to itself, a card that is not on this board, and a repeat", () => {
    expect(ops.addEdge("bdg", "c1", "c1")).toBe("");
    expect(ops.addEdge("bdg", "c1", "b1")).toBe(""); // b1 lives on the fixture board
    expect(ops.addEdge("bdg", "c1", "c2")).not.toBe("");
    expect(ops.addEdge("bdg", "c2", "c1")).toBe(""); // same pair, other way round
    expect(getSnapshot().boards.find((x) => x.id === "bdg")!.edges).toHaveLength(1);
  });

  it("recolors and removes one string without touching the others", () => {
    const a = ops.addEdge("bdg", "c1", "c2");
    const b = ops.addEdge("bdg", "c2", "c3");
    ops.setEdgeColor("bdg", a, "#2d6cdf");
    const edges = () => getSnapshot().boards.find((x) => x.id === "bdg")!.edges ?? [];
    expect(edges().find((e) => e.id === a)!.color).toBe("#2d6cdf");
    ops.removeEdge("bdg", a);
    expect(edges().map((e) => e.id)).toEqual([b]);
  });

  /* Unlike a nested board's ref -- which is left standing because it
   * usually means "that board has not synced in yet" -- an edge's
   * endpoints are cards on THIS board, so a missing one means deleted. */
  it("the repair pass drops yarn whose card is gone", () => {
    ops.addEdge("bdg", "c1", "c2");
    ops.delNode("c2");
    repairDuplicates();
    expect(getSnapshot().boards.find((x) => x.id === "bdg")!.edges ?? []).toHaveLength(0);
  });

  it("...and de-duplicates a pair two peers strung at once", () => {
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    // the remote peer strings the same two cards, with its own edge id
    const remoteBoards = boardsOf(doc2)!;
    let remoteBoard: YMap | null = null;
    for (let i = 0; i < remoteBoards.length; i++) {
      if (remoteBoards.get(i).get("id") === "bdg") remoteBoard = remoteBoards.get(i);
    }
    const mkEdge = (id: string) => {
      const m = new Y.Map() as YMap;
      m.set("id", id);
      m.set("from", "c1");
      m.set("to", "c2");
      m.set("color", "#c0392b");
      return m;
    };
    doc2.transact(() => {
      const arr = new Y.Array() as YArr;
      arr.push([mkEdge("remote-yarn")]);
      remoteBoard!.set("edges", arr);
    }, "remote");
    ops.addEdge("bdg", "c1", "c2"); // and we string it locally too

    Y.applyUpdate(doc, Y.encodeStateAsUpdate(doc2), "remote");
    repairDuplicates();
    const edges = getSnapshot().boards.find((x) => x.id === "bdg")!.edges ?? [];
    expect(edges).toHaveLength(1); // one line, not two drawn on top of each other
  });
});

describe("free grid: cutting a card cuts its yarn", () => {
  const gridBoard = (): Board => ({
    id: "bdg2",
    title: "Wall",
    type: "grid",
    levels: [level("card", "Card")],
    legend: [],
    roots: [node("g1"), node("g2"), node("g3")],
  });
  beforeEach(() => addBoardRaw(gridBoard()));
  const edges = () => getSnapshot().boards.find((b) => b.id === "bdg2")!.edges ?? [];

  it("deleting a card takes its strings with it", () => {
    ops.addEdge("bdg2", "g1", "g2");
    ops.addEdge("bdg2", "g2", "g3");
    ops.addEdge("bdg2", "g1", "g3");
    expect(edges()).toHaveLength(3);
    ops.delNodes(["g2"]);
    // the one string not touching g2 survives
    expect(edges().map((e) => `${e.from}-${e.to}`)).toEqual(["g1-g3"]);
  });

  /* The reason it happens HERE and not only in the repair pass: repair
   * runs under an origin the UndoManager does not track, so a card
   * brought back by Cmd-Z would come back bare. */
  it("...and one undo brings the card AND its strings back", () => {
    ops.addEdge("bdg2", "g1", "g2");
    ops.addEdge("bdg2", "g2", "g3");
    undoManager.stopCapturing();
    ops.delNodes(["g2"]);
    expect(edges()).toHaveLength(0);
    undoManager.undo();
    expect(find(getSnapshot(), "g2")).not.toBeNull();
    expect(edges()).toHaveLength(2);
  });

  it("delNode does it too -- the single-card path", () => {
    ops.addEdge("bdg2", "g1", "g2");
    ops.delNode("g1");
    expect(edges()).toHaveLength(0);
  });

  /* On a positioned board a copy at the same cell sits perfectly behind
   * its original, so the gesture looks like it did nothing. */
  it("a duplicated card lands BESIDE the original, not on top of it", () => {
    ops.setNodeCells({ g1: { x: 5, y: 5 } });
    const copy = ops.duplicateNode("g1");
    expect(find(getSnapshot(), copy)!.cell).toEqual({ x: 7, y: 7 });
  });

  it("...and a card with no cell is untouched by that", () => {
    const copy = ops.duplicateNode("g3");
    expect(find(getSnapshot(), copy)!.cell).toBeUndefined();
  });
});

describe("free grid: yarn survives being copied", () => {
  /* Every path that copies a board regenerates NODE ids so the copy
   * cannot collide with its source -- and an Edge is a pair of node ids.
   * A bare roots.map(regenIds) leaves every string pointing at the
   * originals, they dangle, and the repair pass eats them: the board
   * arrives with its cards intact and its connections silently gone. */
  const wall = (): Board => ({
    id: "bdw",
    title: "Wall",
    type: "grid",
    levels: [level("card", "Card")],
    legend: [],
    roots: [
      { ...node("w1"), cell: { x: 1, y: 1 } },
      { ...node("w2"), cell: { x: 8, y: 1 } },
    ],
    edges: [{ id: "y1", from: "w1", to: "w2", color: "#c0392b" }],
  });

  const drawn = (boardId: string) => {
    const b = getSnapshot().boards.find((x) => x.id === boardId)!;
    const ids = new Set(b.roots.map((r) => r.id));
    return (b.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to));
  };

  it("duplicating a grid board keeps its strings tied", () => {
    addBoardRaw(wall());
    const copyId = ops.duplicateBoard("bdw");
    expect(drawn(copyId)).toHaveLength(1);
    // ...and re-tied to the COPIES, not still pointing at the originals
    const copy = getSnapshot().boards.find((b) => b.id === copyId)!;
    expect(copy.edges![0].from).toBe(copy.roots[0].id);
    expect(copy.edges![0].from).not.toBe("w1");
  });

  it("importing a board file keeps them too", () => {
    const id = ops.importBoard(sanitizeBoard(wall())!);
    expect(drawn(id)).toHaveLength(1);
    expect(getSnapshot().boards.find((b) => b.id === id)!.edges![0].from).not.toBe("w1");
  });

  it("...and so does a whole-project restore", () => {
    addBoardRaw(wall());
    const made = ops.importProject(getSnapshot());
    const copy = made.map(drawn).find((e) => e.length);
    expect(copy).toHaveLength(1);
  });

  /* The sanitizer is the other end of the same rule: a file cannot carry
   * a string to a card it does not contain. */
  it("a file's yarn is dropped when an endpoint is not in the file", () => {
    const bad = { ...wall(), edges: [{ id: "y1", from: "w1", to: "elsewhere", color: "#000" }] };
    expect(sanitizeBoard(bad)!.edges).toBeUndefined();
  });
});

describe("a grabbed still survives the doc round trip", () => {
  /* THE PROJECTION LAYER HAS TO KNOW ABOUT EVERY FIELD, and it enumerates
   * them by hand on both sides. This was added and the doc layer was NOT
   * taught about it, so the whole pipeline worked -- frames grabbed,
   * blobs stored, board built, sanitizer passing it through -- and the
   * cards came out blank, because `buildNodeY` silently dropped the one
   * key that pointed at the pictures. Nothing threw.
   *
   * It is pinned here rather than in the pure suites because those all
   * passed while it was broken: the break was only ever visible ACROSS
   * the doc write. */
  const walk = (b: Board): Node[] => {
    const out: Node[] = [];
    const go = (n: Node) => {
      out.push(n);
      n.children.forEach(go);
    };
    b.roots.forEach(go);
    return out;
  };
  const boardWithStill = (key: string) => {
    const b = board4();
    const leaf = b.roots[0].children[0].children[0].children[0];
    leaf.still = key;
    return { b, srcId: leaf.id };
  };

  it("writes and reads Node.still", () => {
    const { b } = boardWithStill("st-abc123xyz-0");
    const id = ops.importBoard(b);
    const board = getSnapshot().boards.find((x) => x.id === id)!;
    expect(walk(board).filter((n) => n.still).map((n) => n.still)).toEqual(["st-abc123xyz-0"]);
  });

  it("keeps the still when node ids are regenerated by the import", () => {
    /* importBoard mints fresh node ids. The blob key must NOT be derived
     * from them or every still would be stranded by the very op that
     * brings the board in -- which is why keys are minted separately and
     * ride along as an ordinary string field. */
    const { b, srcId } = boardWithStill("st-keepme-1");
    const id = ops.importBoard(b);
    const board = getSnapshot().boards.find((x) => x.id === id)!;
    const back = walk(board).find((n) => n.still)!;
    expect(back.still).toBe("st-keepme-1");
    expect(back.id).not.toBe(srcId); // the id DID change
  });

  it("a card with no still carries no key at all", () => {
    /* Absent rather than empty: this is read straight into a lookup, and
     * an empty string would be a request for a blob that cannot exist. */
    const id = ops.importBoard(board4());
    const board = getSnapshot().boards.find((x) => x.id === id)!;
    expect(walk(board).some((n) => "still" in n)).toBe(false);
  });
});

describe("folders on the shelf", () => {
  /* A folder is a NAME on the board, not an entry in a vocabulary
   * (state/types.ts Board.folder), so these are the whole model: filing
   * writes a string, unfiling DELETES the key, and renaming rewrites
   * every board that names it in ONE transaction. */

  it("files a board, and unfiling DELETES the key rather than storing an empty string", () => {
    ops.setBoardFolder("bd1", ["Archive"]);
    expect(getSnapshot().boards[0].folder).toEqual(["Archive"]);
    ops.setBoardFolder("bd1", []);
    /* Not "" -- a board filed nowhere must be byte-identical to one that
     * never was, or every board grows a key meaning nothing. */
    expect("folder" in getSnapshot().boards[0]).toBe(false);
  });

  it("trims, and treats whitespace as filed nowhere", () => {
    ops.setBoardFolder("bd1", ["  Archive  "]);
    expect(getSnapshot().boards[0].folder).toEqual(["Archive"]);
    ops.setBoardFolder("bd1", ["   "]);
    expect("folder" in getSnapshot().boards[0]).toBe(false);
  });

  it("renames EVERY board in the folder, in one undo step", () => {
    const b = addBoardRaw(boardB());
    ops.setBoardFolder("bd1", ["Archive"]);
    ops.setBoardFolder(b, ["Archive"]);
    ops.renameFolder(["Archive"], ["Cold Storage"]);
    const after = getSnapshot().boards;
    expect(after.map((x) => x.folder)).toEqual([["Cold Storage"], ["Cold Storage"]]);
  });

  it("leaves boards in OTHER folders alone", () => {
    const b = addBoardRaw(boardB());
    ops.setBoardFolder("bd1", ["Archive"]);
    ops.setBoardFolder(b, ["Live"]);
    ops.renameFolder(["Archive"], ["Cold Storage"]);
    const by = new Map(getSnapshot().boards.map((x) => [x.id, x.folder]));
    expect(by.get("bd1")).toEqual(["Cold Storage"]);
    expect(by.get(b)).toEqual(["Live"]);
  });

  it("renaming to an EXISTING folder merges the two -- there is no identity to collide", () => {
    const b = addBoardRaw(boardB());
    ops.setBoardFolder("bd1", ["Archive"]);
    ops.setBoardFolder(b, ["Live"]);
    ops.renameFolder(["Archive"], ["Live"]);
    expect(getSnapshot().boards.every((x) => x.folder?.[0] === "Live")).toBe(true);
  });

  it("renaming to nothing EMPTIES the folder, which is how one is deleted", () => {
    ops.setBoardFolder("bd1", ["Archive"]);
    ops.renameFolder(["Archive"], []);
    expect("folder" in getSnapshot().boards[0]).toBe(false);
  });

  it("survives the doc round trip -- the field is on BOTH sides of the projection", () => {
    /* The four-places rule: types, validate, and both halves of ydoc.
     * Node.still was added to three of them and came out blank. */
    ops.setBoardFolder("bd1", ["Archive"]);
    const file = getSnapshot().boards[0];
    const id = ops.importBoard({ ...file, id: "copy" });
    expect(getSnapshot().boards.find((x) => x.id === id)?.folder).toEqual(["Archive"]);
  });
});

describe("duplicating a folder", () => {
  it("copies every board in and under it into a sibling copy, subfolders and all, with fresh ids", () => {
    addBoardRaw({ ...boardB(), id: "f1", title: "One", folder: ["Acme"] });
    addBoardRaw({ ...boardB(), id: "f2", title: "Two", folder: ["Acme", "Reels"] });
    addBoardRaw({ ...boardB(), id: "f3", title: "Elsewhere", folder: ["Other"] });
    ops.addFolder(["Acme", "Empty"]);
    const dst = ops.duplicateFolder(["Acme"]);
    expect(dst).toEqual(["Acme copy"]);
    const snap = getSnapshot();
    const copies = snap.boards.filter((b) => b.folder?.[0] === "Acme copy");
    expect(copies.map((b) => [b.title, b.folder])).toEqual([
      ["One", ["Acme copy"]],
      ["Two", ["Acme copy", "Reels"]],
    ]);
    expect(copies.every((b) => b.id !== "f1" && b.id !== "f2")).toBe(true);
    expect(snap.boards.filter((b) => b.folder?.[0] === "Acme")).toHaveLength(2); // the originals stay
    expect(snap.boards.find((b) => b.id === "f3")!.folder).toEqual(["Other"]);
    expect(snap.folders).toEqual(expect.arrayContaining([["Acme copy"], ["Acme copy", "Empty"]]));
    // one undo step
    ops.undo();
    expect(getSnapshot().boards.some((b) => b.folder?.[0] === "Acme copy")).toBe(false);
  });

  it("numbers the copy when the name is taken, and copies nothing for an empty path", () => {
    addBoardRaw({ ...boardB(), id: "f1", title: "One", folder: ["Acme"] });
    ops.addFolder(["Acme copy"]);
    expect(ops.duplicateFolder(["Acme"])).toEqual(["Acme copy 2"]);
    expect(ops.duplicateFolder([])).toEqual([]);
  });
});

describe("folders that nest", () => {
  /* A folder is a PATH, which is what makes nesting a prefix test
   * rather than a tree of ids. These pin the prefix arithmetic, since
   * every one of them is a chance to strand somebody's boards. */

  it("makes an EMPTY folder, and it survives with no boards in it", () => {
    ops.addFolder(["Acme"]);
    expect(getSnapshot().folders).toEqual([["Acme"]]);
  });

  it("does not duplicate a folder two people made", () => {
    ops.addFolder(["Acme"]);
    ops.addFolder(["Acme"]);
    expect(getSnapshot().folders).toEqual([["Acme"]]);
  });

  it("trims names, so one folder cannot have two spellings", () => {
    ops.addFolder(["  Acme ", " Reels  "]);
    expect(getSnapshot().folders).toEqual([["Acme", "Reels"]]);
  });

  it("A SLASH IS AN ORDINARY CHARACTER -- one folder, not two", () => {
    /* The owner's call: film people write "Interviews/B-roll" far more
     * readily than they write code-like paths, so nesting is a gesture
     * and no character is special. */
    ops.addFolder(["Interviews/B-roll"]);
    expect(getSnapshot().folders).toEqual([["Interviews/B-roll"]]);
  });

  it("refuses to move a folder inside ITSELF, which a drag can ask for", () => {
    ops.addFolder(["Acme", "Reels"]);
    ops.renameFolder(["Acme"], ["Acme", "Reels", "Acme"]);
    expect(getSnapshot().folders).toEqual([["Acme", "Reels"]]);
  });

  it("RENAMING A PARENT carries its subfolders and their boards", () => {
    ops.addFolder(["Acme", "Reels"]);
    ops.setBoardFolder("bd1", ["Acme", "Reels"]);
    ops.renameFolder(["Acme"], ["Zenith"]);
    expect(getSnapshot().folders).toEqual([["Zenith", "Reels"]]);
    expect(getSnapshot().boards[0].folder).toEqual(["Zenith", "Reels"]);
  });

  it("renames an EMPTY folder -- which local drafts could not do", () => {
    /* The owner hit exactly this: renaming worked on a populated folder
     * and did nothing on an empty one, because the op only rewrote
     * boards and an empty folder has none. */
    ops.addFolder(["Typo"]);
    ops.renameFolder(["Typo"], ["Fixed"]);
    expect(getSnapshot().folders).toEqual([["Fixed"]]);
  });

  it("does not touch a folder that merely SHARES A PREFIX", () => {
    /* "Acme2" starts with "Acme" but is not inside it -- the test has
     * to be on the separator, not on the string. */
    ops.addFolder(["Acme"]);
    ops.addFolder(["Acme2"]);
    ops.renameFolder(["Acme"], ["Zenith"]);
    expect(getSnapshot().folders).toEqual([["Acme2"], ["Zenith"]]);
  });

  it("removing a folder moves its boards and subfolders UP to the parent", () => {
    ops.addFolder(["Acme", "Reels", "Old"]);
    ops.setBoardFolder("bd1", ["Acme", "Reels"]);
    ops.removeFolder(["Acme", "Reels"]);
    /* Only DECLARED paths are stored; "Acme" is implied by its children
     * and is filled in at display time (boardSort folderPaths). The doc
     * holding one entry per folder somebody actually made is the point
     * -- ancestors are arithmetic, not data. */
    expect(getSnapshot().folders).toEqual([["Acme", "Old"]]);
    expect(getSnapshot().boards[0].folder).toEqual(["Acme"]);
  });

  it("removing a TOP-level folder unfiles its boards rather than stranding them", () => {
    ops.setBoardFolder("bd1", ["Acme"]);
    ops.removeFolder(["Acme"]);
    expect("folder" in getSnapshot().boards[0]).toBe(false);
  });
});

describe("folders survive a project round trip", () => {
  it("a restore brings its folders, empty ones included, and MERGES", () => {
    ops.addFolder(["Mine"]);
    const backup = {
      title: "Backup",
      boards: [{ ...getSnapshot().boards[0], id: "other", folder: ["Theirs", "Deep"] }],
      tags: [],
      fields: [],
      folders: [["Theirs"], ["Theirs", "Empty"]],
    };
    ops.importProject(backup);
    const after = getSnapshot().folders ?? [];
    /* Merged, not replaced -- a restore must never delete a folder that
     * is already here. */
    const keys = after.map((f) => f.join(" > "));
    expect(keys).toContain("Mine");
    expect(keys).toContain("Theirs");
    expect(keys).toContain("Theirs > Empty");
  });
});

describe("filing several boards at once", () => {
  it("files them all in ONE transaction, so a multi-drag is one undo step", () => {
    const b = addBoardRaw(boardB());
    ops.setBoardsFolder(["bd1", b], ["Archive"]);
    expect(getSnapshot().boards.map((x) => x.folder)).toEqual([["Archive"], ["Archive"]]);
    ops.undo();
    expect(getSnapshot().boards.every((x) => !x.folder)).toBe(true);
  });

  it("skips an id that is not a board rather than throwing", () => {
    ops.setBoardsFolder(["bd1", "ghost"], ["Archive"]);
    expect(getSnapshot().boards[0].folder).toEqual(["Archive"]);
  });
});

describe("title position on a card", () => {
  const byId = (id: string): Node => {
    const hunt = (n: Node): Node | null =>
      n.id === id ? n : n.children.reduce<Node | null>((f, c) => f ?? hunt(c), null);
    return getSnapshot().boards.reduce<Node | null>(
      (f, b) => f ?? b.roots.reduce<Node | null>((g, r) => g ?? hunt(r), null),
      null,
    )!;
  };

  it("stores top and bottom, and anything else DELETES the key", () => {
    ops.setNodeTitleAlign(["b1"], "top");
    expect(byId("b1").titleAlign).toBe("top");
    ops.setNodeTitleAlign(["b1"], "");
    /* Centered is an ABSENCE, so a card left alone is byte-identical to
     * one nobody asked about -- the rule every optional field keeps. */
    expect("titleAlign" in byId("b1")).toBe(false);
  });

  /* RESET IS ONE TRANSACTION (2026-09-12): five overrides cleared on a
   * set of cards, one undo step to bring them all back. */
  it("resetNodeText clears all five on every card in one undo step", () => {
    ops.setNodeTextColor(["b1", "b2"], "#ffffff");
    ops.setNodeTextSize(["b1", "b2"], 22);
    ops.setNodeTextShadow(["b1"], true);
    ops.setNodeFont(["b2"], "marker");
    ops.setNodeTitleAlign(["b1", "b2"], "top");
    undoManager.stopCapturing();
    ops.resetNodeText(["b1", "b2"]);
    for (const id of ["b1", "b2"]) {
      const n = byId(id);
      expect(n.textColor).toBeUndefined();
      expect(n.textSize).toBeUndefined();
      expect(n.textShadow).toBeUndefined();
      expect(n.font).toBeUndefined();
      expect(n.titleAlign).toBeUndefined();
    }
    undoManager.undo();
    expect(byId("b1")).toMatchObject({ textColor: "#ffffff", textSize: 22, textShadow: true, titleAlign: "top" });
    expect(byId("b2")).toMatchObject({ textColor: "#ffffff", textSize: 22, font: "marker", titleAlign: "top" });
  });

  it("survives the doc round trip -- the field is on BOTH sides", () => {
    ops.setNodeTitleAlign(["b1"], "bottom");
    const id = ops.importBoard({ ...getSnapshot().boards[0], id: "copy" });
    const copy = getSnapshot().boards.find((b) => b.id === id)!;
    const walkFind = (n: Node): Node | null =>
      n.titleAlign ? n : n.children.reduce<Node | null>((f, c) => f ?? walkFind(c), null);
    expect(copy.roots.reduce<Node | null>((f, r) => f ?? walkFind(r), null)?.titleAlign).toBe(
      "bottom",
    );
  });
});

describe("a picture writes the text treatment, rather than implying it", () => {
  const PX = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  const byId = (id: string): Node => {
    const hunt = (n: Node): Node | null =>
      n.id === id ? n : n.children.reduce<Node | null>((f, c) => f ?? hunt(c), null);
    return getSnapshot().boards.reduce<Node | null>(
      (f, b) => f ?? b.roots.reduce<Node | null>((g, r) => g ?? hunt(r), null),
      null,
    )!;
  };

  it("writes white, shadowed and bottom onto a BARE card", () => {
    /* The point of the whole change: it used to be a stylesheet rule
     * nothing could see or switch off. Now they are values. */
    ops.setNodeImage("b1", PX);
    const n = byId("b1");
    expect(n.textColor).toBe("#ffffff");
    expect(n.textShadow).toBe(true);
    expect(n.titleAlign).toBe("bottom");
  });

  it("does NOT overwrite choices made since -- only a bare card gets them", () => {
    ops.setNodeImage("b1", PX);
    ops.setNodeTextColor(["b1"], "#112233");
    ops.setNodeTitleAlign(["b1"], "top");
    ops.setNodeImage("b1", PX + "x"); // replacing, not adding
    const n = byId("b1");
    expect(n.textColor).toBe("#112233");
    expect(n.titleAlign).toBe("top");
  });

  it("a grabbed STILL brings the same treatment, from one definition", () => {
    ops.setNodeStill("b1", "st-x");
    const n = byId("b1");
    expect(n.textColor).toBe("#ffffff");
    expect(n.textShadow).toBe(true);
  });

  it("every override CLEARS back to an absence, so a card can follow its tier", () => {
    ops.setNodeImage("b1", PX);
    ops.setNodeTextColor(["b1"], "");
    ops.setNodeTextSize(["b1"], null);
    ops.setNodeTextShadow(["b1"], false);
    ops.setNodeTitleAlign(["b1"], "");
    ops.setNodeFont(["b1"], "");
    const n = byId("b1");
    for (const k of ["textColor", "textSize", "textShadow", "titleAlign", "font"]) {
      expect(k in n).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 *  INTENT REPAIR (state/intent.ts). Every structural op is clone +
 *  delete, so a peer's write into the OLD map is lost on every side and
 *  no duplicate exists for the repair pass to see. The journal puts this
 *  browser's own writes back onto the clone. These are the cases that
 *  matter, driven as a real second peer.
 * ------------------------------------------------------------------ */
describe("intent repair", () => {
  /* A move the way relocate() does it, on the remote: clone into the same
   * parent's end (or another parent), delete the original. */
  function remoteMove(remote: Y.Doc, id: string, toParent = "s1") {
    const src = findInDoc(remote, id)!;
    const dst = findInDoc(remote, toParent)!;
    remote.transact(() => {
      const clone = cloneNodeY(src.map);
      src.arr.delete(src.index, 1);
      (dst.map.get("children") as YArr).push([clone]);
    });
  }

  it("a title typed into a scene somebody else then moved survives the move", async () => {
    const remote = forkRemote(); // the mover's copy predates the edit
    ops.setNodeField("b1", "title", "typed while they were dragging");
    remoteMove(remote, "s1", "d1"); // s1 cloned to the end of d1, old map deleted
    mergeBack(remote);
    /* Yjs alone: the edit went into the deleted map, so the clone has the
     * old title. This is the loss the audit measured. */
    expect(find(getSnapshot(), "b1")!.title).not.toBe("typed while they were dragging");
    await tick();
    expect(find(getSnapshot(), "b1")!.title).toBe("typed while they were dragging");
    expect(countId(getSnapshot(), "b1")).toBe(1);
  });

  it("an OFFLINE session's edits and added beats come back after the reconnect merge", async () => {
    const remote = forkRemote();
    // offline for a while: rename, recolor, add a beat, leave a note
    ops.setNodeField("b2", "title", "offline rename");
    ops.setNodesColor(["b3"], "c-red");
    const added = ops.addChildAt("s1", 1);
    ops.setNodeField(added, "title", "new beat");
    const noteId = ops.addNote("b1", { body: "a note", author: "me" });
    // meanwhile the office reordered the reel: d1 moved (clone) under r1 again
    remoteMove(remote, "d1", "r1");
    mergeBack(remote);
    await tick();
    const snap = getSnapshot();
    expect(find(snap, "b2")!.title).toBe("offline rename");
    expect(find(snap, "b3")!.color).toBe("c-red");
    expect(find(snap, added)!.title).toBe("new beat");
    expect(childIds(snap, "s1")).toEqual(["b1", added, "b2", "b3"]);
    expect(find(snap, "b1")!.notes?.map((n) => n.id)).toEqual([noteId]);
    expect(countId(snap, "d1")).toBe(1);
  });

  it("does NOT overrule a field somebody else changed after me", async () => {
    const remote = forkRemote();
    ops.setNodeField("b1", "title", "mine");
    const rb = findInDoc(remote, "b1")!;
    remote.transact(() => rb.map.set("title", "theirs, later"));
    remoteMove(remote, "s1", "d1");
    mergeBack(remote);
    await tick();
    expect(find(getSnapshot(), "b1")!.title).toBe("theirs, later");
  });

  it("respects my own undo: an undone edit is not resurrected", async () => {
    const remote = forkRemote();
    ops.setNodeField("b1", "title", "typo");
    ops.undo();
    remoteMove(remote, "s1", "d1");
    mergeBack(remote);
    await tick();
    expect(find(getSnapshot(), "b1")!.title).toBe("b1");
  });

  it("a beat a colleague deleted on purpose stays deleted", async () => {
    const added = ops.addChildAt("s1", 0);
    const remote = forkRemote(); // they have the new beat...
    const r = findInDoc(remote, added)!;
    remote.transact(() => r.arr.delete(r.index, 1)); // ...and delete it, s1 untouched
    mergeBack(remote);
    await tick();
    expect(find(getSnapshot(), added)).toBeNull();
    // a later move of s1 by anyone must not bring it back
    const remote2 = forkRemote();
    remoteMove(remote2, "s1", "d1");
    mergeBack(remote2);
    await tick();
    expect(find(getSnapshot(), added)).toBeNull();
    expect(intentJournal.entries.some((e) => e.nodeId === added)).toBe(false);
  });

  it("re-applies through a SECOND move too, and is not an undo step", async () => {
    const remote = forkRemote();
    ops.setNodeField("b1", "title", "kept");
    remoteMove(remote, "s1", "d1");
    mergeBack(remote);
    await tick();
    const remote2 = forkRemote(); // they have "kept" now; a second clone keeps it anyway
    remoteMove(remote2, "d1", "r1");
    mergeBack(remote2);
    await tick();
    expect(find(getSnapshot(), "b1")!.title).toBe("kept");
    expect(undoManager.undoStack.length).toBe(1); // only my edit
  });

  it("the journal is local and bounded: nothing about it reaches the doc", () => {
    ops.setNodeField("b1", "title", "x");
    expect(intentJournal.entries.length).toBeGreaterThan(0);
    const raw = JSON.stringify(getSnapshot());
    expect(raw).not.toContain("intent");
  });
});

describe("the mark's design lives on the project", () => {
  const c = { cells: [".####.", "##...#", "##....", "##....", "##...#", ".####."], board: "#1d2027", pin: "#9ec5ff" };
  const heart = { ...c, cells: ["......", ".#..#.", "#####.", ".###..", "..#...", "......"], pin: "#ff0000" };

  it("an override and a pool round-trip through the doc, and clear away to nothing", () => {
    expect(getSnapshot().mark).toBeUndefined();
    ops.setMarkOverride(heart);
    expect(getSnapshot().mark?.override?.cells).toEqual(heart.cells);
    ops.addMarkToPool(c);
    ops.addMarkToPool(c); // once
    ops.addMarkToPool(heart);
    expect(getSnapshot().mark?.pool).toHaveLength(2);
    ops.setMarkOverride(null);
    expect(getSnapshot().mark?.override).toBeUndefined();
    expect(getSnapshot().mark?.pool).toHaveLength(2);
    ops.clearMarkPool();
    expect(getSnapshot().mark).toBeUndefined();
  });

  it("a project file carries its logo, and a project that has one keeps its own", () => {
    ops.setMarkOverride(heart);
    const file = sanitizeProject(JSON.parse(JSON.stringify({ ...getSnapshot(), boards: [boardB()] })))!;
    expect(file.mark?.override?.cells).toEqual(heart.cells);
    ops.setMarkOverride(c);
    ops.importProject(file);
    expect(getSnapshot().mark?.override?.cells).toEqual(c.cells); // kept its own
    ops.setMarkOverride(null);
    ops.importProject(file);
    expect(getSnapshot().mark?.override?.cells).toEqual(heart.cells); // took the file's
  });
});

/* ------------------------------------------------------------------ *
 *  THE PROJECT PALETTE (ADR 0006): color overrides are project-level.
 * ------------------------------------------------------------------ */
describe("the project palette", () => {
  const opt = (id: string, label: string) => ({ id, label, bg: "#cfe3f4", border: "#a9cbe8" });
  const withOverride = (b: Board, entry: ReturnType<typeof opt>, cardId: string): Board => {
    const paint = (n: Node): Node => ({ ...n, ...(n.id === cardId ? { color: entry.id } : {}), children: n.children.map(paint) });
    return { ...b, legend: [...b.legend, entry], roots: b.roots.map(paint) };
  };
  const ownLegendIds = (boardId: string): string[] => {
    const boards = projectMap.get("boards") as Y.Array<YMap>;
    const m = boards.toArray().find((x) => x.get("id") === boardId)!;
    return ((m.get("legend") as Y.Array<YMap>)?.toArray() ?? []).map((e) => e.get("id") as string);
  };

  const boardC = (): Board => ({
    ...boardB(),
    id: "bd3",
    title: "Third board",
    roots: [node("rC1", [node("dC1", [node("sC1", [node("bC1"), node("bC2")])])])],
  });

  it("hoists a board's overrides into the palette on repair, and its cards keep their color", () => {
    addBoardRaw(withOverride(boardB(), opt("broll", "B-roll"), "bB1"));
    repairDuplicates();
    const snap = getSnapshot();
    expect(snap.palette?.map((e) => e.id)).toEqual(["broll"]);
    const b = snap.boards.find((x) => x.id === boardB().id)!;
    expect(ownLegendIds(b.id)).not.toContain("broll"); // gone from the board's own list
    expect(b.legend.some((e) => e.id === "broll")).toBe(true); // ...but projected onto it
    expect(resolveNodeEntry(b.legend, find(snap, "bB1")!.color, b.levels[b.levels.length - 1].id)?.label).toBe("B-roll");
  });

  it("remaps a same-label override onto the project's, so two boards' 'archival' become one", () => {
    addBoardRaw(withOverride(boardB(), opt("a1", "Archival"), "bB1"));
    repairDuplicates();
    addBoardRaw(withOverride(boardC(), opt("c1", "archival"), "bC1"));
    repairDuplicates();
    const snap = getSnapshot();
    expect(snap.palette?.map((e) => e.id)).toEqual(["a1"]);
    expect(find(snap, "bC1")!.color).toBe("a1");
  });

  it("a card copied to another board keeps its override", () => {
    addBoardRaw(withOverride(boardB(), opt("broll", "B-roll"), "bB1"));
    repairDuplicates();
    const home = getSnapshot().boards.find((b) => b.id === board4().id)!;
    const made = ops.copyNodes(["bB1"], "s2", 1, home.id);
    const snap = getSnapshot();
    const there = snap.boards.find((b) => b.id === home.id)!;
    const copy = find(snap, made[0])!;
    expect(copy.color).toBe("broll");
    expect(resolveNodeEntry(there.legend, copy.color, there.levels[there.levels.length - 1].id)?.id).toBe("broll");
  });

  it("a new override is the project's: on every board's legend, and removed from all", () => {
    addBoardRaw(boardB());
    const id = ops.addLegendEntry(board4().id);
    let snap = getSnapshot();
    expect(snap.boards.every((b) => b.legend.some((e) => e.id === id))).toBe(true);
    ops.removeLegendEntry(boardB().id, id);
    snap = getSnapshot();
    expect(snap.boards.some((b) => b.legend.some((e) => e.id === id))).toBe(false);
    expect(snap.palette ?? []).toEqual([]);
  });

  it("a project file's palette lands by the same rules", () => {
    ops.addLegendEntry(board4().id);
    const mine = getSnapshot().palette![0];
    ops.setLegendLabel(board4().id, mine.id, "Needs review");
    const file = sanitizeProject({
      title: "Backup",
      boards: [withOverride(boardC(), opt("rv", "needs review"), "bC1")],
      palette: [opt("rv", "needs review"), opt("new1", "Interview")],
    })!;
    ops.importProject(file);
    const snap = getSnapshot();
    expect(snap.palette!.map((e) => e.label).sort()).toEqual(["Interview", "Needs review"]);
    const imported = snap.boards.find((b) => b.title === boardC().title)!;
    const colored: string[] = [];
    const walk = (n: Node) => { if (n.color) colored.push(n.color); n.children.forEach(walk); };
    imported.roots.forEach(walk);
    expect(colored).toEqual([mine.id]);
  });
});
