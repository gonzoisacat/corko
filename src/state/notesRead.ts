import { useSyncExternalStore } from "react";
import { scoped } from "./project";
import type { Board, Node, Note } from "./types";

/* ------------------------------------------------------------------ *
 *  Which notes THIS BROWSER has read -- local, like state/fold.ts and
 *  state/seenBoards.ts, and for the same reason: "have I read this yet"
 *  is a fact about the person at this keyboard, not about the cut. Two
 *  people working the same board have different unread lists, and
 *  neither of them wants the other's marked off.
 *
 *  Nothing here goes near the Yjs doc. That also means it costs no
 *  coordinated reload and no migration -- an older bundle simply doesn't
 *  show the state.
 *
 *  WHAT IS STORED is a COUNT, not a flag: how many messages (the note
 *  plus its replies) you had seen when you last read it. So a thread you
 *  cleared goes unread again the moment someone answers it, which is the
 *  whole point of tracking this on a board people are answering each
 *  other on. Editing a body doesn't change the count and doesn't
 *  resurface the note -- an edit is not a new message.
 * ------------------------------------------------------------------ */

const KEY = scoped("corko-notes-read"); // per project: a baseline taken in one must not blank another

interface Stored {
  /* Set once, the first time this browser ever resolves the project with
   * the feature present. See `baseline`. */
  base: boolean;
  seen: Record<string, number>; // note id -> messages seen
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Partial<Stored>;
        const seen: Record<string, number> = {};
        if (o.seen && typeof o.seen === "object") {
          for (const [k, n] of Object.entries(o.seen)) {
            if (typeof n === "number" && n > 0) seen[k] = n;
          }
        }
        return { base: o.base === true, seen };
      }
    }
  } catch {
    /* malformed / unavailable storage: everything reads as unread, which
       is noisy but never wrong. The baseline below is what stops that
       being the normal first experience. */
  }
  return { base: false, seen: {} };
}

let store = load();
let version = 0; // bumps on every change; memo key for anything derived
const listeners = new Set<() => void>();

function commit() {
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/* A note plus its replies. The unit of "is there anything new here". */
export function messageCount(note: Note): number {
  return 1 + (note.replies?.length ?? 0);
}

function everyNote(boards: Board[], visit: (n: Note) => void) {
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.notes?.length) for (const note of n.notes) visit(note);
      if (n.children.length) walk(n.children);
    }
  };
  for (const b of boards) walk(b.roots);
}

export const notesRead = {
  isUnread(note: Note): boolean {
    const seen = store.seen[note.id];
    return seen === undefined || seen < messageCount(note);
  },

  /* Read one note (or a list). Idempotent -- called from every gesture
   * that means "I have looked at this", so it must be cheap to repeat. */
  mark(notes: Note | Note[]) {
    const list = Array.isArray(notes) ? notes : [notes];
    let changed = false;
    for (const note of list) {
      const count = messageCount(note);
      if (store.seen[note.id] !== count) {
        store.seen[note.id] = count;
        changed = true;
      }
    }
    if (changed) commit();
  },

  /* Mark a note read at a count you name. The one caller is "I just
   * replied": your own answer is not news to you, but it isn't in the
   * snapshot yet at the moment you send it, so mark() would count the
   * thread one message short and the note would resurface as unread the
   * instant the op lands. */
  markSeen(noteId: string, count: number) {
    if (store.seen[noteId] === count) return;
    store.seen[noteId] = count;
    commit();
  },

  /* Deliberately NOT the inverse of mark(): dropping the entry entirely
   * is what "unread" means, and it keeps the map to only what you HAVE
   * read. */
  unmark(note: Note) {
    if (store.seen[note.id] === undefined) return;
    delete store.seen[note.id];
    commit();
  },

  /* Every note that exists right now counts as read.
   *
   * Called once ever (`base`), and this is why: without it the feature
   * arrives showing every note on a real board as unread -- 40 of them on
   * the live cut, none of them actually new to anyone -- so it would
   * debut as noise to be dismissed rather than as a signal. Unread means
   * "new since you got this", which is the only thing it can honestly
   * mean for notes that predate it.
   *
   * MUST be called only once the project has actually arrived. A joining
   * peer's IndexedDB is "ready" (empty) before the shared doc lands, so
   * baselining early would mark nothing and then every note that syncs in
   * would read as new -- the same shape as the first-run picker's wipe
   * risk. App gates this on `settled`. */
  baseline(boards: Board[]) {
    if (store.base) return;
    if (!boards.length) return; // nothing to baseline against yet
    everyNote(boards, (note) => {
      store.seen[note.id] = messageCount(note);
    });
    store.base = true;
    commit();
  },

  /* Clear the whole worklist's unread state -- the "Mark all read" in the
   * notes panel, which takes the rows it is SHOWING, so a filtered list
   * clears only what it lists. */
  markAll(notes: Note[]) {
    notesRead.mark(notes);
  },

  /* Prune entries for notes that no longer exist anywhere in the project.
   * Deleted notes would otherwise sit in localStorage forever. Cheap and
   * rare: called from the same place as `baseline`, and only writes when
   * it actually drops something. */
  prune(boards: Board[]) {
    if (!boards.length) return;
    const live = new Set<string>();
    everyNote(boards, (note) => {
      live.add(note.id);
      for (const r of note.replies ?? []) live.add(r.id);
    });
    let changed = false;
    for (const id of Object.keys(store.seen)) {
      if (!live.has(id)) {
        delete store.seen[id];
        changed = true;
      }
    }
    if (changed) commit();
  },

  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /* tests */
  reset() {
    store = { base: false, seen: {} };
    version++;
  },
};

/* Change counter for anything derived from the whole read set -- the
 * notes panel's counts and the injected unread paint (board/noteMarks).
 * A version rather than the map itself, so a subscriber re-derives
 * instead of comparing thousands of keys. */
export function useNotesReadVersion(): number {
  return useSyncExternalStore(
    notesRead.subscribe,
    () => version,
    () => 0,
  );
}
