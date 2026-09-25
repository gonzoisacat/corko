/* ------------------------------------------------------------------ *
 *  Which boards THIS BROWSER has opened before (owner's call,
 *  2026-08-03).
 *
 *  It exists to answer one question: is this the first time I'm looking
 *  at this board? A board you've never opened should land in the detail
 *  view, fully unfurled -- but only that once. After that your fold and
 *  your view are yours: furl a board, step away, come back, and it is
 *  still furled.
 *
 *  Local per browser, like state/fold.ts and state/panes.ts, and for the
 *  same reason: "have I looked at this yet" is a fact about a person at
 *  a keyboard, not about the cut. Nothing here goes near the Yjs doc.
 * ------------------------------------------------------------------ */

const KEY = "corko-seen-boards";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return new Set(arr.filter((v): v is string => typeof v === "string"));
    }
  } catch {
    /* unavailable / malformed storage -- everything reads as unseen,
       which just means one extra unfurl */
  }
  return new Set();
}

let seen = load();

export const seenBoards = {
  has: (id: string): boolean => seen.has(id),
  /* Returns whether this was NEW, so the caller can do its first-open
   * setup and mark it in one step without racing itself. */
  mark(id: string): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...seen]));
    } catch {
      /* ignore */
    }
    return true;
  },
  /* tests */
  reset() {
    seen = new Set();
  },
};
