import type { NoteRow } from "./notesFeed";
import type { FieldDef, Note } from "../state/types";
import { noteStateDef } from "../state/noteStates";

/* ------------------------------------------------------------------ *
 *  NOTES, OUT OF THE APP (owner, 2026-09-09: "exporting notes to either
 *  a pdf or text outline format or a csv").
 *
 *  PURE, so the shape of an export is testable without a board, a DOM or
 *  a download. Both writers take the rows the panel is ALREADY showing,
 *  which is the whole point of taking them from the panel: what you
 *  filtered to is what you get, and the count in the menu says so.
 *
 *  TWO SHAPES BECAUSE THEY ANSWER DIFFERENT QUESTIONS. The OUTLINE is
 *  for reading and pasting -- the cut's order, the card each note sits
 *  on, and the thread under it, indented. The CSV is for sorting and
 *  filtering somewhere else -- one row per note, every field its own
 *  column, replies flattened into one cell because a spreadsheet has no
 *  second dimension to put them in.
 * ------------------------------------------------------------------ */

const stamp = (ms?: number): string => {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const label = (n: Note): string => noteStateDef(n.state).label;

/* THE THREAD, which is what the implementation notes ARE (owner,
 * 2026-09-07: "kill the text field in implementation notes entirely. it
 * becomes a header with a dropdown"). A stored `impl` survives from the
 * field's one day and reads as the thread's FIRST message, exactly as
 * NotesPanel reads it, so nothing written then is lost here either --
 * and nothing writes a new one, which is why it is no longer a column
 * of its own. Three columns that are empty for everybody is the fault
 * this file's own rule warns about.
 *
 * NO TIMESTAMPS on a message (his call, 2026-09-09). Who said it is the
 * part you scan; when is on the note itself, in its own column. */
export function thread(n: Note): Note[] {
  const impl: Note[] = n.impl
    ? [{ id: n.id + ":impl", body: n.impl, author: n.implBy ?? "", state: "open", createdAt: n.implAt ?? 0 }]
    : [];
  return [...impl, ...(n.replies ?? [])];
}

const replyLine = (r: Note): string => `${r.author || "unattributed"}: ${r.body}`;

/** The notes as an indented outline, grouped under the card each sits on. */
export function notesOutline(rows: NoteRow[], boardTitle: string): string {
  const out: string[] = [];
  out.push(boardTitle || "Untitled board");
  out.push("=".repeat((boardTitle || "Untitled board").length));
  out.push(`${rows.length} note${rows.length === 1 ? "" : "s"}, exported ${stamp(Date.now())}`);
  out.push("");

  /* Grouped by CARD, in the order the panel had them, so the outline
   * reads down the cut the way the board does. A card with several notes
   * names itself once. */
  let lastCard = "";
  for (const r of rows) {
    if (r.nodeId !== lastCard) {
      lastCard = r.nodeId;
      out.push(`${r.path ? r.path + " > " : ""}${r.title || "(untitled)"}`);
    }
    const n = r.note;
    out.push(`  - [${label(n)}] ${n.body}`);
    const who = `${n.author || "unattributed"}${n.createdAt ? `, ${stamp(n.createdAt)}` : ""}`;
    out.push(`      ${who}`);
    for (const msg of thread(n)) out.push(`      > ${replyLine(msg)}`);
    out.push("");
  }
  return out.join("\n");
}

/* A CSV cell: quoted when it holds anything that would break a row, and
 * a quote inside doubles. The newline case is the one that matters --
 * a note's body is free text and routinely has them. */
const cell = (v: string): string =>
  /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/* ------------------------------------------------------------------ *
 *  THE COLUMNS (owner, 2026-09-09: "we'd be able to rearrange the order
 *  of the columns, which would be populated by the fundamentals plus the
 *  metadata that exists on any given card on the board").
 *
 *  So a column is a NAME and a way to read one, and the list is built
 *  per board: the fundamentals every note has, then one per metadata
 *  category that some card on THIS board actually carries a value for.
 *  A category nobody has filled in is not offered -- an empty column is
 *  a worse answer than a missing one, and the vocabulary is
 *  project-wide while this list is about one board.
 *
 *  The ARRANGEMENT is just an ordered list of ids, which is what makes
 *  it cheap to store and cheap to reorder: an id the board no longer has
 *  falls out on read, and a category added since is appended, so a
 *  stored arrangement never goes stale or hides something new.
 * ------------------------------------------------------------------ */

export interface ExportColumn {
  id: string;
  name: string;
  read: (r: NoteRow, values: Record<string, string> | undefined) => string;
}

/* The fixed half. `impl-at` and `tier` are here rather than dropped
 * because a spreadsheet is where someone sorts by them. */
export const FUNDAMENTALS: ExportColumn[] = [
  { id: "card", name: "Card", read: (r) => r.title },
  { id: "path", name: "Path", read: (r) => r.path },
  { id: "tier", name: "Tier", read: (r) => String(r.depth) },
  { id: "note", name: "Note", read: (r) => r.note.body },
  { id: "state", name: "State", read: (r) => label(r.note) },
  { id: "author", name: "Author", read: (r) => r.note.author || "" },
  { id: "created", name: "Created", read: (r) => stamp(r.note.createdAt) },
  /* ONE column for the thread, named as the panel names the section.
   * Its id stays `replies` so a stored arrangement made before this
   * keeps the place it had. */
  {
    id: "replies",
    name: "Implementation notes",
    read: (r) => thread(r.note).map(replyLine).join("\n"),
  },
];

/* A metadata column's id is namespaced, so a category can never collide
 * with a fundamental however it is named -- and so a column can say
 * which half it came from wherever it has been dragged to. */
const fieldCol = (id: string) => `f:${id}`;
export const isMetaColumn = (id: string): boolean => id.startsWith("f:");

/** Every column this board can offer, fundamentals first. */
export function availableColumns(rows: NoteRow[], fields: FieldDef[], valuesOf: ValuesOf): ExportColumn[] {
  /* WHICH CATEGORIES ARE ACTUALLY IN USE, asked of the cards the notes
   * sit on rather than of the whole board: those are the only rows the
   * export will have, so a category filled in only on cards with no
   * notes would still come out an empty column. */
  const used = new Set<string>();
  for (const r of rows) {
    const v = valuesOf(r.nodeId);
    if (!v) continue;
    for (const [id, val] of Object.entries(v)) if (val) used.add(id);
  }
  const meta = fields
    .filter((f) => used.has(f.id))
    .map((f) => ({
      id: fieldCol(f.id),
      name: f.name,
      read: (_r: NoteRow, values: Record<string, string> | undefined) => values?.[f.id] ?? "",
    }));
  return [...FUNDAMENTALS, ...meta];
}

export type ValuesOf = (nodeId: string) => Record<string, string> | undefined;

/* A stored arrangement, reconciled with what the board can offer NOW:
 * ids that no longer exist fall out, and anything the board gained since
 * is appended rather than hidden. An absent arrangement is all of them,
 * in their natural order. */
export function arrangeColumns(available: ExportColumn[], order: string[] | undefined): ExportColumn[] {
  if (!order?.length) return available;
  const by = new Map(available.map((c) => [c.id, c]));
  const out: ExportColumn[] = [];
  for (const id of order) {
    const c = by.get(id);
    if (c) {
      out.push(c);
      by.delete(id);
    }
  }
  return [...out, ...by.values()];
}

/** One row per note, one cell per chosen column, in the order given. */
export function notesCsv(rows: NoteRow[], columns: ExportColumn[], valuesOf: ValuesOf = () => undefined): string {
  const lines = [columns.map((c) => cell(c.name)).join(",")];
  for (const r of rows) {
    const values = valuesOf(r.nodeId);
    lines.push(columns.map((c) => cell(c.read(r, values))).join(","));
  }
  /* A trailing newline, because a file that does not end in one makes
   * some readers drop or mangle the last row. */
  return lines.join("\r\n") + "\r\n";
}

/** A filename that is safe everywhere and says what it holds. */
export function exportName(boardTitle: string, ext: string): string {
  const base =
    (boardTitle || "board")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "board";
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${base}-notes-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${ext}`;
}

/* THE ONE IMPURE LINE, kept beside its writers rather than in a util:
 * hand the browser a Blob and click a link at it. Mirrors
 * BoardsMenu's `downloadJson`, which is the same three lines for the
 * board files. */
export function downloadText(text: string, name: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
