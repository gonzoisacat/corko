import type { Board, Node, Note, NoteState } from "../state/types";
import { readingOrder } from "../state/gridBoard";
import { isNested } from "../state/nesting";
import { NOTE_STATES, noteStateDef } from "../state/noteStates";

/* ------------------------------------------------------------------ *
 *  Every note in a board, as a flat list you can work through.
 *
 *  This is the thing Notes view exists for: a note lives on one card, but
 *  the job -- giving notes, answering them, clearing them -- is done
 *  across the whole cut, and one card at a time is exactly the wrong unit
 *  for that.
 *
 *  Ordered by READING ORDER, not by when the note was written. You work
 *  notes the way you watch the cut: top to bottom. (createdAt is on every
 *  note if a "newest first" order is wanted later; the legacy notes that
 *  predate the system carry 0, which is why it isn't the default order.)
 *
 *  On every board type but one that IS document order. A FREE GRID has
 *  no sequence to appeal to, and its document order is stacking order --
 *  so this list used to reshuffle whenever somebody dragged one card
 *  onto another. `readingOrder` (state/gridBoard.ts) gives that type a
 *  spatial order instead, top down then left to right.
 * ------------------------------------------------------------------ */

/* A CARD, as the notes list needs it: everything a row shows about the
 * card a note sits on, and the card's ORDER -- its index in the reading
 * walk -- which is what places a new note among the others and what
 * the focus effect measures a noteless card against (2026-09-08). */
export interface CardRef {
  nodeId: string;
  title: string; // the card the note is on
  depth: number; // its tier, for the row's little tier label
  path: string; // ancestor titles, so a bare "Beat: hesitation" has context
  /* what the row needs to paint the card's own fill as its swatch
     (owner, 2026-09-07: "a little rectangle that's the color of the
     card it was made on") -- resolved by the panel against the legend */
  colorId?: string;
  nested: boolean;
  /* the card's tags, for the swatch's SPLIT shares (his, 2026-09-07:
     "preview a multi-color card if applicable"); the other kind of tag
     is not drawn on it, by his word */
  tags?: string[];
  order: number;
}

export interface NoteRow extends CardRef {
  note: Note;
}

/* Every card in reading order, by id. One walk, shared by the notes
 * list, the new-note draft and the focus effect. */
export function readingCards(board: Board | null): Map<string, CardRef> {
  const cards = new Map<string, CardRef>();
  if (!board) return cards;
  let order = 0;
  const walk = (nodes: Node[], depth: number, trail: string[]) => {
    for (const n of nodes) {
      cards.set(n.id, {
        nodeId: n.id,
        title: n.title,
        depth,
        path: trail.filter(Boolean).join(" / "),
        colorId: n.color,
        nested: isNested(n),
        tags: n.tags,
        order: order++,
      });
      if (n.children.length) walk(n.children, depth + 1, [...trail, n.title]);
    }
  };
  walk(readingOrder(board), 0, []);
  return cards;
}

export function collectNotes(board: Board | null): NoteRow[] {
  if (!board) return [];
  const rows: NoteRow[] = [];
  const cards = readingCards(board);
  const byOrder = [...cards.values()].sort((a, b) => a.order - b.order);
  const nodeById = new Map<string, Node>();
  const index = (nodes: Node[]) => {
    for (const n of nodes) {
      nodeById.set(n.id, n);
      if (n.children.length) index(n.children);
    }
  };
  index(board.roots);
  for (const card of byOrder) {
    const n = nodeById.get(card.nodeId);
    for (const note of n?.notes ?? []) rows.push({ ...card, note });
  }
  return rows;
}

/* WHERE A NEW NOTE FOR THIS CARD GOES in the list: after every note on
 * the card and before the first note on a later card (2026-09-08, the
 * draft entry that replaced the popover while Notes is open). */
export function draftIndex(rows: NoteRow[], order: number): number {
  const i = rows.findIndex((r) => r.order > order);
  return i < 0 ? rows.length : i;
}

/* THE FOCUS EFFECT (owner, 2026-09-08): the selected card's place in the
 * list. A card WITH notes rings them; a card between notes gets a thin
 * bar between the two nearest, above the first row when every note comes
 * after it and below the last when every note comes before. `undefined`
 * means the card is not on this board (or nothing is selected). */
export type FocusPlan = { ring: Set<string> } | { barBefore: number } | null;

export function focusPlan(rows: NoteRow[], nodeId: string | null, order: number | undefined): FocusPlan {
  if (!nodeId || order === undefined || rows.length === 0) return null;
  const ring = new Set(rows.filter((r) => r.nodeId === nodeId).map((r) => r.note.id));
  if (ring.size) return { ring };
  return { barBefore: draftIndex(rows, order) };
}

/* The authors who actually wrote something in this board, for the filter.
 * Unattributed notes are real (every note that predates the author field is
 * one), so they get their own bucket rather than being hidden.
 *
 * The LEADING SPACE is the sentinel: every author is compared after
 * `.trim()`, so no name a person can type will ever equal this. It was a
 * literal NUL byte until 2026-08-06, which worked but made git treat this
 * whole file as BINARY -- no line diffs in review or in `git log -p` for
 * as long as it was there. Keep it printable. */
export const UNATTRIBUTED = " unattributed";

export function noteAuthors(rows: NoteRow[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.note.author.trim() || UNATTRIBUTED);
    // the implementation note is a response too (2026-09-07), so its
    // author is on the roster like a reply's
    if (r.note.impl && r.note.implBy?.trim()) seen.add(r.note.implBy.trim());
    for (const reply of r.note.replies ?? []) seen.add(reply.author.trim() || UNATTRIBUTED);
  }
  // named authors alphabetically, with the unattributed bucket last
  const named = [...seen].filter((a) => a !== UNATTRIBUTED).sort((a, b) => a.localeCompare(b));
  return seen.has(UNATTRIBUTED) ? [...named, UNATTRIBUTED] : named;
}

/* THE STATE FILTER is a SET of states the list shows (owner, 2026-09-06,
 * his second pass on it: "multi select ... with the color language in
 * it"). It replaced a single choice of everything / either half / one
 * state. The halves survive as PRESETS -- one click sets the whole set
 * -- and state/noteStates.ts still draws the open/closed line; nothing
 * here knows which states are which beyond asking it.
 *
 * Every state in the set is shown, so the full set is "no filter" and
 * the EMPTY set shows nothing. Empty is allowed on purpose: a set you
 * emptied by hand that silently meant "everything" would be the one
 * surprise this control could hold. */
export type StateFilter = ReadonlySet<NoteState>;

export const ALL_STATES: StateFilter = new Set(NOTE_STATES.map((s) => s.id));
export const OPEN_STATES: StateFilter = new Set(NOTE_STATES.filter((s) => !s.closed).map((s) => s.id));
export const CLOSED_STATES: StateFilter = new Set(NOTE_STATES.filter((s) => s.closed).map((s) => s.id));

export function toggleState(filter: StateFilter, state: NoteState): StateFilter {
  const next = new Set(filter);
  if (next.has(state)) next.delete(state);
  else next.add(state);
  return next;
}

/* A SWEEP sets rather than toggles: the pill you press on takes the
 * opposite of what it was, and every pill you drag across takes that
 * same value (the pinboard designer's trace-select, which he knows). */
export function setStateIn(filter: StateFilter, state: NoteState, on: boolean): StateFilter {
  if (filter.has(state) === on) return filter;
  const next = new Set(filter);
  if (on) next.add(state);
  else next.delete(state);
  return next;
}

export function sameStates(a: StateFilter, b: StateFilter): boolean {
  if (a.size !== b.size) return false;
  for (const s of a) if (!b.has(s)) return false;
  return true;
}

/* What the trigger says: the preset's name when the set IS a preset, the
 * state's own label when it is one state, else a count. Legend order for
 * the dots beside it, so "3 states" always shows the same three the same
 * way round. */
export function stateFilterLabel(filter: StateFilter): string {
  if (sameStates(filter, ALL_STATES)) return "All states";
  if (sameStates(filter, OPEN_STATES)) return "Any open";
  if (sameStates(filter, CLOSED_STATES)) return "Any closed";
  if (filter.size === 0) return "No states";
  if (filter.size === 1) return noteStateDef([...filter][0]).label;
  return `${filter.size} states`;
}

export function statesInOrder(filter: StateFilter): NoteState[] {
  return NOTE_STATES.map((s) => s.id).filter((id) => filter.has(id));
}

/* How many notes stand in each state, for the number beside each pill --
 * the whole board's, never the filtered list's, since the pill you are
 * about to light is by definition not in that list. */
export function stateCounts(rows: NoteRow[]): Map<NoteState, number> {
  const m = new Map<NoteState, number>();
  for (const r of rows) m.set(r.note.state, (m.get(r.note.state) ?? 0) + 1);
  return m;
}

/* THE AUTHOR FILTER (owner, 2026-09-06, the same evening: "similarly
 * improve the menu for notes authors ... default to All Authors ...
 * populate any authors of notes or responses on the board with their
 * own pills"). A set of names, or null for EVERYONE -- null rather than
 * the full set because the roster is not fixed the way the states are:
 * a new name appearing on the board joins "All authors" on its own,
 * where a set copied from yesterday's roster would have left them out.
 * A set that comes to cover every name collapses back to null for the
 * same reason. The unattributed bucket is a name like any other here. */
export type AuthorFilter = ReadonlySet<string> | null;

export const authorName = (a: string) => (a === UNATTRIBUTED ? "(unattributed)" : a);

const coversAll = (set: ReadonlySet<string>, all: string[]) =>
  all.length > 0 && all.every((a) => set.has(a));

export function setAuthorIn(filter: AuthorFilter, author: string, on: boolean, all: string[]): AuthorFilter {
  const cur = filter ?? new Set(all);
  if (cur.has(author) === on) return filter;
  const next = new Set(cur);
  if (on) next.add(author);
  else next.delete(author);
  return coversAll(next, all) ? null : next;
}

export function toggleAuthor(filter: AuthorFilter, author: string, all: string[]): AuthorFilter {
  const cur = filter ?? new Set(all);
  return setAuthorIn(filter, author, !cur.has(author), all);
}

/* A name that has left the board (its last note deleted) leaves the
 * filter too, so the list never sits empty on a ghost. */
export function pruneAuthors(filter: AuthorFilter, all: string[]): AuthorFilter {
  if (!filter) return null;
  const kept = [...filter].filter((a) => all.includes(a));
  if (kept.length === filter.size) return filter;
  const next = new Set(kept);
  return coversAll(next, all) ? null : next;
}

export function authorFilterLabel(filter: AuthorFilter): string {
  if (!filter) return "All authors";
  if (filter.size === 0) return "No authors";
  if (filter.size === 1) return authorName([...filter][0]);
  return `${filter.size} authors`;
}

/* How many THREADS each name is in, as note author or in the replies --
 * the rows that name's pill brings when reply threads are included. */
export function authorCounts(rows: NoteRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const names = new Set<string>([r.note.author.trim() || UNATTRIBUTED]);
    if (r.note.impl && r.note.implBy?.trim()) names.add(r.note.implBy.trim());
    for (const reply of r.note.replies ?? []) names.add(reply.author.trim() || UNATTRIBUTED);
    for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
}

export interface NoteFilter {
  authors: AuthorFilter; // null = everyone
  /* "Include reply threads" (his): a note whose AUTHOR is not in the
   * filter still shows when somebody in the filter answered on it. On
   * by default, which is what the filter always did before the switch. */
  replies: boolean;
  state: StateFilter;
  unread: boolean; // false = everything, true = only what's new to me
  /* NOTES-ONLY SEARCH (owner, 2026-09-06: "solely for notes, not cross
   * contaminating with find cards"). Matches the words of a note, its
   * implementation note, its replies and their authors. Never the card. */
  q: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/* Does this thread say the words? Body, implementation note, author, and
 * every reply's body and author -- the whole conversation, since a search
 * for a name should find the thread the person answered in. */
export function noteMatches(note: Note, q: string): boolean {
  const needle = norm(q);
  if (!needle) return true;
  const has = (s: string | undefined) => !!s && s.toLowerCase().includes(needle);
  if (has(note.body) || has(note.impl) || has(note.author) || (!!note.impl && has(note.implBy))) return true;
  return (note.replies ?? []).some((r) => has(r.body) || has(r.author));
}

export function stateMatches(state: NoteState, filter: StateFilter): boolean {
  return filter.has(state);
}

/* By author, a note matches if IT is theirs or -- with reply threads
 * included -- any of its replies is: a thread you're in is a thread you
 * want to see, whoever opened it.
 *
 * `isUnread` is passed in rather than imported: read state is per browser
 * and lives in localStorage (state/notesRead), and this file stays pure so
 * the worklist's rules can be tested without a DOM or a store. */
export function matchNote(r: NoteRow, filter: NoteFilter, isUnread: (note: Note) => boolean): boolean {
  if (!stateMatches(r.note.state, filter.state)) return false;
  if (filter.unread && !isUnread(r.note)) return false;
  if (!noteMatches(r.note, filter.q)) return false;
  const who = filter.authors;
  if (!who) return true;
  const by = (n: Note) => who.has(n.author.trim() || UNATTRIBUTED);
  if (by(r.note)) return true;
  if (!filter.replies) return false;
  // the implementation note counts as a response, under the same switch
  const answered = !!r.note.impl && !!r.note.implBy?.trim() && who.has(r.note.implBy.trim());
  return answered || (r.note.replies ?? []).some(by);
}

/* The list the filters leave -- when they HIDE. Since 2026-09-07 the
 * panel's default is to keep every row and fold the rest
 * (settings.notesFiltered), so it asks matchNote per row instead;
 * this stays for that mode, for stepping, and for the tests. */
export function filterNotes(
  rows: NoteRow[],
  filter: NoteFilter,
  isUnread: (note: Note) => boolean = () => false,
): NoteRow[] {
  return rows.filter((r) => matchNote(r, filter, isUnread));
}

/* The last thing SAID in a thread -- the note itself when nobody has
 * answered. The collapsed row shows who spoke last, because "has anyone
 * come back to me on this" is the question you scan a worklist for, and
 * today it costs an expand to answer. */
export function lastMessage(note: Note): Note {
  const replies = note.replies ?? [];
  return replies.length ? replies[replies.length - 1] : note;
}

/* A compact age. Notes are worked over days, so the useful resolution is
 * coarse -- what matters is "this morning" vs "last week", never seconds.
 *
 * Returns "" for createdAt 0, which is every note that predates the notes
 * system (ADR 0004: the migration derives ids rather than minting them, so
 * there was no honest timestamp to invent). A blank is right: showing them
 * all as 56 years old would be a lie the UI states confidently. */
export function relTime(at: number, now: number = Date.now()): string {
  if (!at || at <= 0) return "";
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (days < 365) return weeks < 9 ? `${weeks}w` : `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}
