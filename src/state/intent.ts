import type { Node } from "./types";

/* ------------------------------------------------------------------ *
 *  INTENT JOURNAL -- what THIS browser wrote, so it can be written again
 *  when a move by somebody else throws it away.
 *
 *  Yjs cannot move a node. Every structural op in ydoc.ts (reorder,
 *  re-parent, promote, demote, the seam's absorb, a grid drop onto a
 *  card) is clone + delete: a NEW Y.Map with the same id lands where the
 *  card goes and the old map is deleted. Anything written into the old
 *  map that the mover had not yet seen -- a title typed a moment before,
 *  a note left an hour ago on a laptop that was offline, a beat added to
 *  the scene -- is integrated into a deleted type and is gone, on every
 *  peer, with no duplicate for the repair pass to notice (2026-09-01
 *  audit, verified with a two-doc script: both sides converge on the
 *  loss). The real fix is a model where order is a field rather than a
 *  position; that is a rewrite of every index-based op and is not this.
 *
 *  This is the safety net that needs no doc-shape change. The doc layer
 *  records, per local transaction, a FIELD-LEVEL diff of each node it
 *  touched -- keyed on the Yjs ITEM IDENTITY of the node's map, which a
 *  clone always changes and an in-place edit never does -- and after
 *  every remote transaction asks, for each entry: is this node now a
 *  different map than the one I wrote into, and does it still carry the
 *  value I overwrote? If both, the clone was made from a copy that
 *  predates my write, and my write goes onto the clone. If the clone
 *  carries something ELSE, somebody changed the field after me and the
 *  entry adopts the new map rather than fighting them.
 *
 *  Inserted children get the same treatment one level up: a child I
 *  added that is missing from a CLONED parent is put back; one missing
 *  from an UNCHANGED parent was deleted on purpose and its entry is
 *  dropped. Deletions are not journaled -- a lost delete brings a card
 *  back, which is visible and redoable, unlike lost typing.
 *
 *  What it does NOT cover, said plainly: another peer on an older bundle
 *  (no journal) still loses their writes inside my moves; a card I added
 *  while online, which a colleague then deleted AND whose scene they
 *  moved while I was offline, comes back when I reconnect (the merged
 *  state cannot tell that sequence from a clone that missed my insert --
 *  which is why inserts age out in two days where fields get a week);
 *  and a move that mints fresh ids (a cross-ladder drop that extends the
 *  destination board) is a copy as far as the journal can see.
 *
 *  Kept in localStorage so a reload does not drop what an offline
 *  session wrote, bounded by count, bytes and age. Local per browser,
 *  never synced, never in a board file -- like fold.ts and settings.ts.
 * ------------------------------------------------------------------ */

export interface FieldEntry {
  kind: "field";
  t: number;
  nodeId: string;
  /* the Yjs item id of the node map this was written into */
  item: string;
  key: string;
  before: unknown;
  after: unknown;
}
export interface InsertEntry {
  kind: "insert";
  t: number;
  /* the child that was added */
  nodeId: string;
  parentId: string;
  parentItem: string;
  index: number;
  node: Node;
}
export type IntentEntry = FieldEntry | InsertEntry;

/* Every plain field of a Node except its identity and its children --
 * children are the insert entries' job. Kept as a list rather than
 * derived from a sample node so an absent-on-both-sides key still
 * compares (undefined === undefined) without being invented. */
export const NODE_FIELDS: (keyof Node)[] = [
  "title",
  "collapsed",
  "subtitle",
  "tag",
  "color",
  "notes",
  "font",
  "hidden",
  "breakAfter",
  "boardRef",
  "boardRefTitle",
  "cell",
  "span",
  "image",
  "still",
  "imageFit",
  "imageTile",
  "imageMirror",
  "imageAlign",
  "titleAlign",
  "textColor",
  "textSize",
  "textShadow",
  "tags",
  "slots",
  "values",
];

export const same = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* The entries one local transaction produced for one node: a field entry
 * per changed field, an insert entry per child id that is new. Reorders
 * of existing children are not intent worth keeping (the mover's own
 * clone carries the order). */
export function diffNode(before: Node, after: Node, item: string, t: number): IntentEntry[] {
  const out: IntentEntry[] = [];
  for (const key of NODE_FIELDS) {
    const b = before[key];
    const a = after[key];
    if (same(a, b)) continue;
    out.push({ kind: "field", t, nodeId: after.id, item, key, before: b, after: a });
  }
  const had = new Set(before.children.map((c) => c.id));
  after.children.forEach((c, index) => {
    if (had.has(c.id)) return;
    out.push({ kind: "insert", t, nodeId: c.id, parentId: after.id, parentItem: item, index, node: c });
  });
  return out;
}

/* Fields keep a week: an offline laptop is the case that matters and a
 * week is longer than one stays shut. Inserts keep two days, for the
 * resurrection case the header describes. */
export const FIELD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INSERT_TTL_MS = 2 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 3000;
export const MAX_BYTES = 1_000_000;

export interface IntentStorage {
  read(): string | null;
  write(v: string | null): void;
}

const memoryStorage = (): IntentStorage => {
  let v: string | null = null;
  return { read: () => v, write: (s) => (v = s) };
};

export class IntentJournal {
  entries: IntentEntry[] = [];
  constructor(private storage: IntentStorage = memoryStorage()) {
    try {
      const raw = storage.read();
      const v = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(v)) this.entries = v.filter(isEntry);
    } catch {
      this.entries = [];
    }
  }

  add(entries: IntentEntry[], now = Date.now()): void {
    if (!entries.length) return;
    this.entries.push(...entries);
    this.prune(now);
    this.persist();
  }

  /* A child deleted on purpose (its parent unchanged) must not be put
   * back by a later clone of that parent. */
  dropInserts(ids: Set<string>): void {
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.kind !== "insert" || !ids.has(e.nodeId));
    if (this.entries.length !== n) this.persist();
  }

  prune(now = Date.now()): void {
    this.entries = this.entries.filter((e) =>
      e.kind === "field" ? now - e.t < FIELD_TTL_MS : now - e.t < INSERT_TTL_MS,
    );
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES);
    // oldest out until the whole thing fits; an image data URI is the
    // one entry that can be big, and it is also the one worth keeping
    let bytes = JSON.stringify(this.entries).length;
    while (bytes > MAX_BYTES && this.entries.length) {
      const gone = this.entries.shift()!;
      bytes -= JSON.stringify(gone).length;
    }
  }

  persist(): void {
    try {
      this.storage.write(this.entries.length ? JSON.stringify(this.entries) : null);
    } catch {
      /* private mode or quota: the journal is best-effort past this session */
    }
  }

  clear(): void {
    this.entries = [];
    this.persist();
  }
}

function isEntry(v: unknown): v is IntentEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.t !== "number" || typeof e.nodeId !== "string") return false;
  if (e.kind === "field") return typeof e.key === "string" && typeof e.item === "string";
  if (e.kind === "insert") {
    return typeof e.parentId === "string" && typeof e.parentItem === "string" && typeof e.node === "object";
  }
  return false;
}

export function localStorageIntent(key: string): IntentStorage {
  return {
    read: () => {
      try {
        return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write: (v) => {
      if (typeof localStorage === "undefined") return;
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
    },
  };
}
