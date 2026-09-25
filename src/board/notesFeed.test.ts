import { describe, expect, it } from "vitest";
import {
  ALL_STATES,
  CLOSED_STATES,
  OPEN_STATES,
  authorCounts,
  authorFilterLabel,
  collectNotes,
  draftIndex,
  filterNotes,
  focusPlan,
  lastMessage,
  noteAuthors,
  noteMatches,
  pruneAuthors,
  readingCards,
  relTime,
  sameStates,
  setAuthorIn,
  setStateIn,
  stateCounts,
  stateFilterLabel,
  stateMatches,
  statesInOrder,
  toggleAuthor,
  toggleState,
  UNATTRIBUTED,
  type NoteFilter,
} from "./notesFeed";
import { board4 } from "../test/fixtures";
import type { Board, Note } from "../state/types";

/* ------------------------------------------------------------------ *
 *  The Notes view worklist: every note in the board, in CUT order.
 *
 *  Cut order rather than newest-first is the decision worth pinning --
 *  you work notes the way you watch the cut, and the notes that predate
 *  the system all carry createdAt 0, so a time sort would pile them up.
 * ------------------------------------------------------------------ */

const note = (id: string, body: string, author = "", state: Note["state"] = "open"): Note => ({
  id,
  body,
  author,
  state,
  createdAt: 0,
});

function boardWithNotes(): Board {
  const b = board4();
  const s1 = b.roots[0].children[0].children[0]; // scene s1: b1 b2 b3
  const s2 = b.roots[0].children[0].children[1]; // scene s2: b4
  s1.children[0].notes = [note("n1", "Trim the head", "Derek"), note("n2", "Second one", "Sam")];
  s1.notes = [note("n3", "Whole scene runs long", "Derek", "done")];
  s2.children[0].notes = [note("n4", "No author here")];
  return b;
}

describe("collectNotes", () => {
  it("walks the board in document order, several notes per card", () => {
    const rows = collectNotes(boardWithNotes());
    // s1 (the scene) comes before its own beats, and b4's note comes last
    expect(rows.map((r) => r.note.id)).toEqual(["n3", "n1", "n2", "n4"]);
    expect(rows.map((r) => r.title)).toEqual(["s1", "b1", "b1", "b4"]);
  });

  it("carries where the note is, so a bare card title has context", () => {
    const rows = collectNotes(boardWithNotes());
    const onBeat = rows.find((r) => r.note.id === "n1")!;
    expect(onBeat.depth).toBe(3); // reel > section > scene > beat
    expect(onBeat.path).toBe("r1 / d1 / s1");
  });

  it("is empty for no board, and for a board with no notes", () => {
    expect(collectNotes(null)).toEqual([]);
    expect(collectNotes(board4())).toEqual([]);
  });
});

describe("noteAuthors", () => {
  it("lists who wrote something, unattributed last", () => {
    expect(noteAuthors(collectNotes(boardWithNotes()))).toEqual(["Derek", "Sam", UNATTRIBUTED]);
  });

  it("counts reply authors too -- they're in the conversation", () => {
    const b = boardWithNotes();
    b.roots[0].children[0].children[0].children[0].notes![0].replies = [
      note("r1", "It's the only clean take", "Alex"),
    ];
    expect(noteAuthors(collectNotes(b))).toContain("Alex");
  });
});

describe("filterNotes", () => {
  const rows = collectNotes(boardWithNotes());
  const all = { authors: null, replies: true, state: ALL_STATES, unread: false, q: "" };

  it("filters by author and by state, and both at once", () => {
    expect(filterNotes(rows, { ...all, authors: new Set(["Derek"]) }).map((r) => r.note.id)).toEqual([
      "n3",
      "n1",
    ]);
    expect(filterNotes(rows, { ...all, state: new Set(["open"]) }).map((r) => r.note.id)).toEqual([
      "n1",
      "n2",
      "n4",
    ]);
    expect(
      filterNotes(rows, { ...all, authors: new Set(["Derek"]), state: new Set(["open"]) }).map((r) => r.note.id),
    ).toEqual(["n1"]);
  });

  it("finds the unattributed ones, which are real notes", () => {
    expect(filterNotes(rows, { ...all, authors: new Set([UNATTRIBUTED]) }).map((r) => r.note.id)).toEqual([
      "n4",
    ]);
  });

  /* Unread is per BROWSER, so it arrives as a predicate rather than being
   * read off the note -- this file stays pure. */
  it("filters to unread, and composes with the other two", () => {
    const isNew = (n: Note) => n.id === "n1" || n.id === "n3";
    expect(filterNotes(rows, { ...all, unread: true }, isNew).map((r) => r.note.id)).toEqual([
      "n3",
      "n1",
    ]);
    expect(
      filterNotes(rows, { ...all, unread: true, state: new Set(["open"]) }, isNew).map((r) => r.note.id),
    ).toEqual(["n1"]);
  });

  /* A resolved note can be new to you -- someone answered and closed it
   * while you were out. That is why unread is its own switch and not a
   * third option in the open/resolved select. */
  it("keeps an unread note that is RESOLVED", () => {
    const isNew = (n: Note) => n.id === "n3"; // n3 is the resolved one
    expect(filterNotes(rows, { ...all, unread: true }, isNew).map((r) => r.note.id)).toEqual(["n3"]);
  });

  /* A thread you're in is a thread you want to see, whoever opened it --
   * otherwise filtering to your own name hides the note you replied to. */
  it("keeps a note whose REPLY matches the author", () => {
    const b = boardWithNotes();
    b.roots[0].children[0].children[0].children[0].notes![0].replies = [
      note("r1", "Answered", "Alex"),
    ];
    const withReply = collectNotes(b);
    expect(filterNotes(withReply, { ...all, authors: new Set(["Alex"]) }).map((r) => r.note.id)).toEqual(["n1"]);
    // ... unless reply threads are switched off, when only the note's own author counts
    expect(filterNotes(withReply, { ...all, authors: new Set(["Alex"]), replies: false })).toEqual([]);
  });
});

/* The collapsed row says who spoke LAST, so "has anyone come back to me on
 * this" doesn't cost an expand. */
describe("the card walk, the draft's place and the focus effect (2026-09-08)", () => {
  it("every card has an order in the reading walk, and a note row carries its card's", () => {
    const b = boardWithNotes();
    const cards = readingCards(b);
    const rows = collectNotes(b);
    for (const r of rows) expect(cards.get(r.nodeId)!.order).toBe(r.order);
    const orders = rows.map((r) => r.order);
    expect([...orders].sort((x, y) => x - y)).toEqual(orders); // rows are in walk order
    expect(cards.size).toBeGreaterThan(rows.length); // cards without notes are in the walk too
  });

  it("a new note slots after its card's notes and before a later card's", () => {
    const rows = collectNotes(boardWithNotes());
    const first = rows[0];
    expect(draftIndex(rows, first.order)).toBe(rows.filter((r) => r.nodeId === first.nodeId).length);
    expect(draftIndex(rows, -1)).toBe(0);
    expect(draftIndex(rows, 1e9)).toBe(rows.length);
  });

  it("the focus effect rings a noted card's notes and bars a noteless one between its neighbors", () => {
    const b = boardWithNotes();
    const cards = readingCards(b);
    const rows = collectNotes(b);
    const noted = rows[0];
    const ring = focusPlan(rows, noted.nodeId, noted.order)!;
    expect("ring" in ring && [...ring.ring]).toEqual(rows.filter((r) => r.nodeId === noted.nodeId).map((r) => r.note.id));
    const noteless = [...cards.values()].find((c) => !rows.some((r) => r.nodeId === c.nodeId))!;
    const bar = focusPlan(rows, noteless.nodeId, noteless.order)!;
    expect("barBefore" in bar && bar.barBefore).toBe(draftIndex(rows, noteless.order));
    expect(focusPlan(rows, null, undefined)).toBeNull();
    expect(focusPlan(rows, "elsewhere", undefined)).toBeNull(); // a card from another board
    expect(focusPlan([], noted.nodeId, noted.order)).toBeNull(); // nothing to bar between
  });
});

describe("lastMessage", () => {
  it("is the newest reply, or the note itself when nobody answered", () => {
    const bare = note("n1", "Trim the head", "Derek");
    expect(lastMessage(bare).id).toBe("n1");
    bare.replies = [note("r1", "ok", "Sam"), note("r2", "done", "Alex")];
    expect(lastMessage(bare).id).toBe("r2");
  });
});

describe("relTime", () => {
  const now = Date.UTC(2026, 7, 6, 12, 0, 0);
  const ago = (ms: number) => relTime(now - ms, now);

  it("is coarse -- notes are worked over days, not seconds", () => {
    expect(ago(5_000)).toBe("just now");
    expect(ago(4 * 60_000)).toBe("4m");
    expect(ago(3 * 3600_000)).toBe("3h");
    expect(ago(2 * 86400_000)).toBe("2d");
    expect(ago(20 * 86400_000)).toBe("3w");
    expect(ago(400 * 86400_000)).toBe("1y");
  });

  /* Every note that predates the notes system carries createdAt 0 (ADR
   * 0004 derives ids rather than minting them, so there was no honest
   * timestamp to invent). Blank, not "56y" -- a confident lie is worse
   * than saying nothing. */
  it("says nothing for a note with no timestamp", () => {
    expect(relTime(0, now)).toBe("");
    expect(relTime(-1, now)).toBe("");
  });

  it("never goes negative when a peer's clock runs ahead", () => {
    expect(relTime(now + 60_000, now)).toBe("just now");
  });
});

describe("state groups and the notes-only search (2026-09-06)", () => {
  const F = (p: Partial<NoteFilter>): NoteFilter => ({
    authors: null,
    replies: true,
    state: ALL_STATES,
    unread: false,
    q: "",
    ...p,
  });

  it("the filter is a set: every state in it shows, the empty set shows nothing", () => {
    expect(stateMatches("open", ALL_STATES)).toBe(true);
    expect(stateMatches("later", OPEN_STATES)).toBe(true);
    expect(stateMatches("done", OPEN_STATES)).toBe(false);
    expect(stateMatches("declined", CLOSED_STATES)).toBe(true);
    expect(stateMatches("discuss", CLOSED_STATES)).toBe(false);
    expect(stateMatches("caveat", new Set(["caveat"]))).toBe(true);
    expect(stateMatches("caveat", new Set(["done"]))).toBe(false);
    expect(stateMatches("open", new Set())).toBe(false);
    // the two halves partition the legend, and Other counts as open
    expect(OPEN_STATES.size + CLOSED_STATES.size).toBe(ALL_STATES.size);
    expect(OPEN_STATES.has("other")).toBe(true);
  });

  it("toggling a pill adds or removes it and never mutates the set it was handed", () => {
    const a = toggleState(CLOSED_STATES, "later");
    expect(sameStates(a, new Set(["done", "caveat", "declined", "later"]))).toBe(true);
    expect(CLOSED_STATES.has("later")).toBe(false);
    expect(sameStates(toggleState(a, "later"), CLOSED_STATES)).toBe(true);
    expect(sameStates(new Set(["done"]), new Set(["caveat"]))).toBe(false);
  });

  it("a sweep sets rather than toggles, and leaves an unchanged set alone", () => {
    const a = setStateIn(CLOSED_STATES, "later", true);
    expect(a.has("later")).toBe(true);
    expect(setStateIn(a, "later", true)).toBe(a); // same identity: nothing to re-render
    expect(sameStates(setStateIn(a, "later", false), CLOSED_STATES)).toBe(true);
    expect(setStateIn(CLOSED_STATES, "later", false)).toBe(CLOSED_STATES);
  });

  it("the author filter: null is everyone, and a set that covers the roster collapses back to it", () => {
    const roster = ["Alex", "Derek", UNATTRIBUTED];
    const one = setAuthorIn(null, "Alex", false, roster);
    expect(one && [...one]).toEqual(["Derek", UNATTRIBUTED]);
    expect(setAuthorIn(null, "Alex", true, roster)).toBeNull(); // already in: untouched
    expect(setAuthorIn(one, "Alex", true, roster)).toBeNull(); // covers the roster again
    expect(toggleAuthor(null, "Derek", roster)?.has("Derek")).toBe(false);
    expect(authorFilterLabel(null)).toBe("All authors");
    expect(authorFilterLabel(new Set())).toBe("No authors");
    expect(authorFilterLabel(new Set([UNATTRIBUTED]))).toBe("(unattributed)");
    expect(authorFilterLabel(new Set(["Alex", "Derek"]))).toBe("2 authors");
    // a name that left the board leaves the filter; the last one leaving means everyone
    expect(pruneAuthors(new Set(["Alex", "Ghost"]), roster)?.has("Ghost")).toBe(false);
    expect(pruneAuthors(new Set(["Ghost"]), ["Ghost"])).toEqual(new Set(["Ghost"]));
    expect(pruneAuthors(new Set(["Alex", "Derek", "Ghost"]), ["Alex", "Derek"])).toBeNull();
    expect(pruneAuthors(null, roster)).toBeNull();
  });

  it("the implementation note is a response: its author is on the roster and under the reply switch", () => {
    const b = boardWithNotes();
    const rows = collectNotes(b).map((r) =>
      r.note.id === "n2" ? { ...r, note: { ...r.note, impl: "Trimmed it", implBy: "Quinn", implAt: 5 } } : r,
    );
    expect(noteAuthors(rows)).toContain("Quinn");
    expect(authorCounts(rows).get("Quinn")).toBe(1);
    expect(filterNotes(rows, F({ authors: new Set(["Quinn"]) })).map((r) => r.note.id)).toEqual(["n2"]);
    expect(filterNotes(rows, F({ authors: new Set(["Quinn"]), replies: false }))).toEqual([]);
    expect(noteMatches(rows.find((r) => r.note.id === "n2")!.note, "quinn")).toBe(true);
  });

  it("author counts are threads a name is in, note or reply", () => {
    const b = boardWithNotes();
    const rows = collectNotes(b);
    const withReply = rows.map((r) =>
      r.note.id === "n1" ? { ...r, note: { ...r.note, replies: [note("r1", "yes", "Derek")] } } : r,
    );
    const counts = authorCounts(withReply);
    expect(counts.get("Derek")).toBe(rows.filter((r) => r.note.author === "Derek").length); // n1 is already his
    expect(counts.get(UNATTRIBUTED)).toBe(1);
  });

  it("the trigger names a preset, one state, or a count -- and dots follow legend order", () => {
    expect(stateFilterLabel(ALL_STATES)).toBe("All states");
    expect(stateFilterLabel(OPEN_STATES)).toBe("Any open");
    expect(stateFilterLabel(CLOSED_STATES)).toBe("Any closed");
    expect(stateFilterLabel(new Set(["caveat"]))).toBe("Done-ish");
    expect(stateFilterLabel(new Set(["other", "done", "later"]))).toBe("3 states");
    expect(stateFilterLabel(new Set())).toBe("No states");
    expect(statesInOrder(new Set(["other", "done", "later"]))).toEqual(["done", "later", "other"]);
  });

  it("the counts are the whole board's, by state", () => {
    const rows = collectNotes(boardWithNotes());
    const counts = stateCounts(rows);
    let total = 0;
    for (const n of counts.values()) total += n;
    expect(total).toBe(rows.length);
    expect(filterNotes(rows, F({ state: OPEN_STATES })).length).toBe(
      [...OPEN_STATES].reduce((n, s) => n + (counts.get(s) ?? 0), 0),
    );
  });

  it("the search reads the whole thread -- body, implementation, replies, names", () => {
    const n: Note = { ...note("x", "Move the crew credits", "Derek"), impl: "new pass on credits for eval" };
    n.replies = [note("r", "agreed, doing it Monday", "Sam")];
    expect(noteMatches(n, "CREW")).toBe(true);
    expect(noteMatches(n, "eval")).toBe(true);
    expect(noteMatches(n, "monday")).toBe(true);
    expect(noteMatches(n, "sam")).toBe(true);
    expect(noteMatches(n, "opening")).toBe(false);
    expect(noteMatches(n, "   ")).toBe(true); // blank is no filter
  });

  it("the search composes with the other filters", () => {
    const rows = collectNotes(boardWithNotes());
    expect(filterNotes(rows, F({ q: "second" })).map((r) => r.note.id)).toEqual(["n2"]);
    expect(filterNotes(rows, F({ q: "second", authors: new Set(["Derek"]) }))).toEqual([]);
    expect(filterNotes(rows, F({ state: CLOSED_STATES })).map((r) => r.note.id)).toEqual(["n3"]);
    expect(filterNotes(rows, F({ state: OPEN_STATES })).map((r) => r.note.id)).toEqual(["n1", "n2", "n4"]);
  });
});
