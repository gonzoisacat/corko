/* ------------------------------------------------------------------ *
 *  THE DESIGNER'S OWN UNDO (owner, 2026-09-04: "can we like.. branch
 *  for it? once we close it goes back to a list for the board?").
 *
 *  Yes: a branch. The designer's design is local, unsaved state -- it
 *  reaches the doc only through Override or Add to fun pool -- so its
 *  edits cannot live on the board's Yjs UndoManager, and should not:
 *  Cmd+Z there would drag the board's last real edit back through a
 *  sketch. So while the designer is open the keys drive THIS history;
 *  closing it throws the history away, and the board's stack is where
 *  it was.
 *
 *  Pure and pinned. Every edit is a step, except a RUN of edits with
 *  the same key close together in time -- a color slider being dragged
 *  -- which is one step, so undo does not walk a hue back one notch at
 *  a time. The run's first "before" is what undo returns to.
 * ------------------------------------------------------------------ */

export interface History<T> {
  past: T[];
  future: T[];
  /* the coalescing run: its key and when it was last extended */
  key: string | null;
  stamp: number;
}

/* edits closer than this, with the same key, are one step */
export const RUN_GAP = 800;

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], key: null, stamp: 0 });

/* Record `before` as the state an undo returns to. A keyed edit that
 * continues the current run records nothing (the run's first before
 * already stands); any edit ends the future. */
export function push<T>(h: History<T>, before: T, key: string | null, now: number): History<T> {
  const continues = key !== null && key === h.key && now - h.stamp < RUN_GAP;
  return {
    past: continues ? h.past : [...h.past, before],
    future: [],
    key,
    stamp: now,
  };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}
export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

/* Step back: the value to show, and the history after. `current` goes
 * to the future so redo can bring it back. Null when there is nothing. */
export function undo<T>(h: History<T>, current: T): { value: T; history: History<T> } | null {
  if (!h.past.length) return null;
  const value = h.past[h.past.length - 1];
  return { value, history: { past: h.past.slice(0, -1), future: [current, ...h.future], key: null, stamp: 0 } };
}

export function redo<T>(h: History<T>, current: T): { value: T; history: History<T> } | null {
  if (!h.future.length) return null;
  const value = h.future[0];
  return { value, history: { past: [...h.past, current], future: h.future.slice(1), key: null, stamp: 0 } };
}
