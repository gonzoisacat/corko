import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messageCount, notesRead } from "./notesRead";
import { board4 } from "../test/fixtures";
import type { Board, Note } from "./types";

/* ------------------------------------------------------------------ *
 *  Read state is per BROWSER and stored as a COUNT, and both of those
 *  are the decisions worth pinning.
 *
 *  A count rather than a flag, so a thread you cleared goes unread again
 *  when someone answers it -- that is the whole reason to track this on a
 *  board people answer each other on. And a one-time BASELINE, so the
 *  feature doesn't debut by marking every note that predates it as new.
 * ------------------------------------------------------------------ */

const note = (id: string, replies: Note[] = []): Note => ({
  id,
  body: "b",
  author: "Derek",
  state: "open",
  createdAt: 0,
  ...(replies.length ? { replies } : {}),
});

function boardWithNotes(): Board {
  const b = board4();
  const s1 = b.roots[0].children[0].children[0];
  s1.children[0].notes = [note("n1"), note("n2")];
  s1.notes = [note("n3")];
  return b;
}

/* localStorage doesn't exist in the node runner, and the store degrades to
 * in-memory exactly like state/fold does -- which is what the logic tests
 * below want. The LOAD path is the one thing that needs a real one, so the
 * persistence block stubs it and re-imports. */
beforeEach(() => {
  notesRead.reset();
});

function shim() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe("messageCount", () => {
  it("counts the note plus its replies", () => {
    expect(messageCount(note("n1"))).toBe(1);
    expect(messageCount(note("n1", [note("r1"), note("r2")]))).toBe(3);
  });
});

describe("unread", () => {
  it("a note you have never seen is unread", () => {
    expect(notesRead.isUnread(note("n1"))).toBe(true);
  });

  it("marking it read clears it", () => {
    const n = note("n1");
    notesRead.mark(n);
    expect(notesRead.isUnread(n)).toBe(false);
  });

  /* The reason it is a count and not a boolean. */
  it("a REPLY makes a read note unread again", () => {
    const n = note("n1");
    notesRead.mark(n);
    expect(notesRead.isUnread(n)).toBe(false);
    expect(notesRead.isUnread(note("n1", [note("r1")]))).toBe(true);
  });

  it("an EDIT does not -- an edit is not a new message", () => {
    const n = note("n1");
    notesRead.mark(n);
    expect(notesRead.isUnread({ ...n, body: "rewritten" })).toBe(false);
  });

  /* Replying is not being told something. The reply isn't in the snapshot
   * at the moment you send it, so mark() would count one short and the
   * note would resurface as unread the instant the op landed. */
  it("markSeen counts a reply that has not landed yet", () => {
    const n = note("n1");
    notesRead.mark(n);
    notesRead.markSeen(n.id, messageCount(n) + 1);
    expect(notesRead.isUnread(note("n1", [note("mine")]))).toBe(false);
  });

  it("unmark makes it new again", () => {
    const n = note("n1");
    notesRead.mark(n);
    notesRead.unmark(n);
    expect(notesRead.isUnread(n)).toBe(true);
  });
});

describe("baseline", () => {
  it("marks everything that already exists, once", () => {
    const b = boardWithNotes();
    notesRead.baseline([b]);
    expect(notesRead.isUnread(note("n1"))).toBe(false);
    expect(notesRead.isUnread(note("n3"))).toBe(false);
    // a note written AFTER the baseline is new, which is the whole point
    expect(notesRead.isUnread(note("n99"))).toBe(true);
  });

  it("does not re-run, so notes read since stay read and new ones stay new", () => {
    const b = boardWithNotes();
    notesRead.baseline([b]);
    b.roots[0].children[0].children[0].children[0].notes!.push(note("n4"));
    notesRead.baseline([b]);
    expect(notesRead.isUnread(note("n4"))).toBe(true);
  });

  /* The joining-peer hazard: IndexedDB is "ready" and EMPTY before the
   * shared project arrives. Baselining then would mark nothing and every
   * note that synced in would read as new. App gates on `settled`; this
   * pins the store's own half of it. */
  it("refuses to baseline against nothing", () => {
    notesRead.baseline([]);
    const b = boardWithNotes();
    notesRead.baseline([b]);
    expect(notesRead.isUnread(note("n1"))).toBe(false);
  });
});

describe("prune", () => {
  it("drops entries for notes that no longer exist", () => {
    const b = boardWithNotes();
    notesRead.mark([note("n1"), note("gone")]);
    notesRead.prune([b]);
    expect(notesRead.isUnread(note("n1"))).toBe(false);
    expect(notesRead.isUnread(note("gone"))).toBe(true);
  });

  it("keeps replies, which are notes too", () => {
    const b = boardWithNotes();
    b.roots[0].children[0].children[0].children[0].notes![0].replies = [note("r1")];
    notesRead.mark(note("r1"));
    notesRead.prune([b]);
    expect(notesRead.isUnread(note("r1"))).toBe(false);
  });

  it("does nothing against an empty project, so a pre-sync tick can't wipe it", () => {
    notesRead.mark(note("n1"));
    notesRead.prune([]);
    expect(notesRead.isUnread(note("n1"))).toBe(false);
  });
});

/* The load runs at IMPORT, so anything about it has to be staged before
 * the module is pulled in -- writing storage afterwards and calling
 * isUnread would prove nothing at all. */
describe("persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function freshWith(stored: string | null) {
    const s = shim();
    if (stored !== null) s.setItem("corko-notes-read", stored);
    vi.stubGlobal("localStorage", s);
    vi.resetModules();
    return { mod: (await import("./notesRead")).notesRead, storage: s };
  }

  it("writes what it knows, and reads it back on the next load", async () => {
    const { mod, storage } = await freshWith(null);
    mod.mark(note("n1", [note("r1")]));
    expect(storage.getItem("corko-notes-read")).toContain("n1");

    vi.resetModules();
    const again = (await import("./notesRead")).notesRead;
    expect(again.isUnread(note("n1", [note("r1")]))).toBe(false);
    expect(again.isUnread(note("n1", [note("r1"), note("r2")]))).toBe(true);
  });

  it("remembers that it has baselined, so a reload doesn't re-baseline", async () => {
    const { mod } = await freshWith(null);
    mod.baseline([boardWithNotes()]);
    vi.resetModules();
    const again = (await import("./notesRead")).notesRead;
    again.baseline([boardWithNotes()]); // no-op: already based
    expect(again.isUnread(note("n1"))).toBe(false);
    expect(again.isUnread(note("brand-new"))).toBe(true);
  });

  it("tolerates junk rather than throwing", async () => {
    const { mod } = await freshWith("{not json");
    expect(mod.isUnread(note("n1"))).toBe(true);
  });

  it("tolerates a stored shape it doesn't recognize", async () => {
    const { mod } = await freshWith(JSON.stringify(["n1", "n2"]));
    expect(mod.isUnread(note("n1"))).toBe(true);
  });
});
