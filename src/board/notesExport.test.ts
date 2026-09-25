import { describe, expect, it } from "vitest";
import type { Note } from "../state/types";
import type { NoteRow } from "./notesFeed";
import {
  arrangeColumns,
  availableColumns,
  exportName,
  FUNDAMENTALS,
  isMetaColumn,
  notesCsv,
  notesOutline,
} from "./notesExport";
import type { FieldDef } from "../state/types";

const AT = Date.UTC(2026, 8, 9, 12, 34); // a fixed stamp, so rows are comparable
const note = (extra: Partial<Note> = {}): Note =>
  ({ id: "n1", body: "Lose the crew credits", author: "Robin", state: "open", createdAt: AT, ...extra }) as Note;
const row = (extra: Partial<NoteRow> = {}): NoteRow =>
  ({ nodeId: "c1", title: "Las Vegas", depth: 2, path: "Reel 1 > Act 1", nested: false, order: 0, note: note(), ...extra }) as NoteRow;

describe("notesOutline", () => {
  it("heads with the board and the count it is exporting", () => {
    const out = notesOutline([row()], "REEL 3 GRIEF");
    expect(out).toContain("REEL 3 GRIEF");
    expect(out).toContain("1 note,");
    expect(notesOutline([row(), row({ note: note({ id: "n2" }) })], "X")).toContain("2 notes,");
  });
  it("names a card once however many notes it carries", () => {
    const two = [row(), row({ note: note({ id: "n2", body: "Second" }) })];
    const lines = notesOutline(two, "X").split("\n").filter((l) => l.includes("Las Vegas"));
    expect(lines).toHaveLength(1);
  });
  it("carries the state's own label, the author and the thread", () => {
    const out = notesOutline(
      [row({ note: note({ state: "caveat", replies: [note({ id: "r1", body: "Moved to the tail", author: "Sam" })] }) })],
      "X",
    );
    expect(out).toContain("[Done-ish] Lose the crew credits");
    expect(out).toContain("Robin");
    expect(out).toContain("> Sam: Moved to the tail");
  });
  /* The implementation-note FIELD is retired: a stored one reads as the
   * thread's first message, the way the panel reads it. */
  it("reads a stored implementation note as the thread's first message", () => {
    const out = notesOutline(
      [row({ note: note({ impl: "Cut at the seam", implBy: "Sam", implAt: AT, replies: [note({ id: "r1", body: "Agreed", author: "Jo" })] }) })],
      "X",
    );
    expect(out).toContain("> Sam: Cut at the seam");
    expect(out).toContain("> Jo: Agreed");
    expect(out.indexOf("Cut at the seam")).toBeLessThan(out.indexOf("Agreed"));
    expect(out).not.toContain("Implementation:"); // no longer its own block
  });
  it("puts no timestamp on a message -- when is the note's own column", () => {
    const out = notesOutline([row({ note: note({ replies: [note({ id: "r1", body: "Agreed", author: "Sam", createdAt: AT })] }) })], "X");
    expect(out).toContain("> Sam: Agreed");
    expect(out).not.toMatch(/> Sam \(/);
  });
  it("survives a board with no notes at all", () => {
    expect(notesOutline([], "Empty")).toContain("0 notes,");
  });
});

const COLS = FUNDAMENTALS;

describe("notesCsv", () => {
  it("heads with its columns and writes one row per note", () => {
    const csv = notesCsv([row(), row({ note: note({ id: "n2" }) })], COLS);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(COLS.map((c) => c.name).join(","));
    expect(lines).toHaveLength(3);
  });
  /* The case that matters: a note's body is free text and routinely
   * holds commas, quotes and newlines, any of which would break a row. */
  it("quotes a cell that would otherwise break the row", () => {
    const csv = notesCsv([row({ note: note({ body: 'He said "cut it", then left\nnext line' }) })], COLS);
    expect(csv).toContain('"He said ""cut it"", then left\nnext line"');
    expect(csv.trim().split("\r\n")).toHaveLength(2); // still ONE record
  });
  it("flattens a thread into its own cell, a stored implementation note first", () => {
    const csv = notesCsv(
      [row({ note: note({ impl: "Cut at the seam", implBy: "Sam", replies: [note({ id: "r1", body: "Agreed", author: "Jo" })] }) })],
      COLS,
    );
    expect(csv).toContain("Sam: Cut at the seam\nJo: Agreed");
  });
  /* The retired field is not three empty columns any more. */
  it("offers no column for the implementation-note field itself", () => {
    const ids = COLS.map((c) => c.id);
    expect(ids).not.toContain("impl");
    expect(ids).not.toContain("impl-by");
    expect(ids).not.toContain("impl-at");
    expect(COLS.find((c) => c.id === "replies")!.name).toBe("Implementation notes");
  });
  it("ends in a newline, which some readers need to keep the last row", () => {
    expect(notesCsv([row()], COLS).endsWith("\r\n")).toBe(true);
  });
  it("writes only the columns it is given, in the order it is given", () => {
    const two = COLS.filter((c) => c.id === "state" || c.id === "card").reverse();
    const csv = notesCsv([row()], two);
    expect(csv.trim().split("\r\n")[0]).toBe("State,Card");
    expect(csv.trim().split("\r\n")[1]).toBe("Unaddressed,Las Vegas");
  });
});

const FIELDS: FieldDef[] = [
  { id: "f1", name: "Shoot day" },
  { id: "f2", name: "Timecode" },
  { id: "f3", name: "Never used" },
];

describe("availableColumns", () => {
  /* Only the categories some card ACTUALLY carries a value for: an
   * empty column is a worse answer than a missing one. */
  it("offers the fundamentals plus the metadata in use, and nothing else", () => {
    const cols = availableColumns([row()], FIELDS, () => ({ f1: "DAY 24", f3: "" }));
    const names = cols.map((c) => c.name);
    expect(names.slice(0, FUNDAMENTALS.length)).toEqual(FUNDAMENTALS.map((c) => c.name));
    expect(names).toContain("Shoot day");
    expect(names).not.toContain("Timecode"); // no card holds one
    expect(names).not.toContain("Never used"); // held, but empty
  });
  it("asks the cards the NOTES sit on, since those are the only rows", () => {
    const cols = availableColumns([row({ nodeId: "c1" })], FIELDS, (id) => (id === "other" ? { f2: "01:00" } : undefined));
    expect(cols.map((c) => c.name)).not.toContain("Timecode");
  });
  it("reads a metadata cell from the card's values", () => {
    const cols = availableColumns([row()], FIELDS, () => ({ f1: "DAY 24" }));
    const day = cols.find((c) => c.name === "Shoot day")!;
    expect(day.read(row(), { f1: "DAY 24" })).toBe("DAY 24");
    expect(day.read(row(), undefined)).toBe("");
  });
  /* The mark has to key on the COLUMN, not its position: a metadata
   * column dragged up among the fundamentals is still metadata. */
  it("says which half a column came from, wherever it has been dragged", () => {
    const cols = availableColumns([row()], FIELDS, () => ({ f1: "DAY 24" }));
    expect(isMetaColumn(cols.find((c) => c.name === "Shoot day")!.id)).toBe(true);
    expect(FUNDAMENTALS.every((c) => !isMetaColumn(c.id))).toBe(true);
  });
  it("namespaces a metadata id so it cannot collide with a fundamental", () => {
    const cols = availableColumns([row()], [{ id: "state", name: "State" }], () => ({ state: "x" }));
    const ids = cols.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("arrangeColumns", () => {
  it("is the natural order when nothing is stored", () => {
    expect(arrangeColumns(COLS, undefined).map((c) => c.id)).toEqual(COLS.map((c) => c.id));
    expect(arrangeColumns(COLS, []).map((c) => c.id)).toEqual(COLS.map((c) => c.id));
  });
  it("follows a stored arrangement", () => {
    expect(arrangeColumns(COLS, ["state", "card"]).slice(0, 2).map((c) => c.id)).toEqual(["state", "card"]);
  });
  /* A stored arrangement must never go stale or hide something new. */
  it("drops an id the board no longer offers", () => {
    expect(arrangeColumns(COLS, ["state", "f:gone", "card"]).slice(0, 2).map((c) => c.id)).toEqual(["state", "card"]);
  });
  it("appends anything the board has gained since, rather than hiding it", () => {
    const out = arrangeColumns(COLS, ["state"]);
    expect(out[0].id).toBe("state");
    expect(out.map((c) => c.id).sort()).toEqual(COLS.map((c) => c.id).sort());
  });
});

describe("exportName", () => {
  it("slugs the board's title and dates the file", () => {
    expect(exportName("REEL 3 -- Grief", "csv")).toMatch(/^reel-3-grief-notes-\d{8}\.csv$/);
  });
  it("falls back rather than making a nameless file", () => {
    expect(exportName("", "txt")).toMatch(/^board-notes-\d{8}\.txt$/);
    expect(exportName("///", "txt")).toMatch(/^board-notes-\d{8}\.txt$/);
  });
});
