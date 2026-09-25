import { useSyncExternalStore } from "react";
import type { MarkDesign, MarkState } from "./types";
import { MAX_POOL, sameDesign, sanitizeMark } from "./mark";
import { scoped } from "./project";

/* ------------------------------------------------------------------ *
 *  THE MARK'S LOCAL SIDE. The pinboard designer's "Share design with
 *  collaborators?" switch (owner, 2026-09-04) decides where an
 *  arrangement is kept: ON, in the project's doc for everyone
 *  (state/mark.ts, ops.setMarkOverride / addMarkToPool); OFF, here, in
 *  this browser alone -- same shape, per project, never synced, like
 *  fold.ts and settings.ts. The mark reads both: a local override wins
 *  over the shared one (it is this person's choice for their own
 *  corner), and the local pool joins the shared one.
 * ------------------------------------------------------------------ */

const KEY = scoped("corko-mark");
/* THE SHARED STATE, REMEMBERED: the boot splash picks its landing at
 * module scope, before the doc has loaded from IndexedDB, so the mark
 * writes the project's shared mark state here whenever it changes and
 * the splash reads the copy. A boot lands on what the last session
 * knew, which is the honest best. */
const SHARED_KEY = scoped("corko-mark-shared");
let state: MarkState = load();
const listeners = new Set<() => void>();

function load(): MarkState {
  try {
    const raw = localStorage.getItem(KEY);
    return (raw && sanitizeMark(JSON.parse(raw))) || {};
  } catch {
    return {};
  }
}
function commit(next: MarkState) {
  state = next;
  try {
    if (next.override || next.pool?.length) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: this session only */
  }
  listeners.forEach((l) => l());
}

export const markLocal = {
  get: (): MarkState => state,
  setOverride(design: MarkDesign | null) {
    const next: MarkState = { ...state };
    if (design) next.override = design;
    else delete next.override;
    commit(next);
  },
  addToPool(design: MarkDesign) {
    const pool = (state.pool ?? []).filter((d) => !sameDesign(d, design));
    pool.push(design);
    commit({ ...state, pool: pool.slice(-MAX_POOL) });
  },
  removeFromPool(design: MarkDesign) {
    const pool = (state.pool ?? []).filter((d) => !sameDesign(d, design));
    const next: MarkState = { ...state };
    if (pool.length) next.pool = pool;
    else delete next.pool;
    commit(next);
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useMarkLocal(): MarkState {
  return useSyncExternalStore(markLocal.subscribe, markLocal.get, () => state);
}

export function rememberShared(shared: MarkState | undefined): void {
  try {
    if (shared) localStorage.setItem(SHARED_KEY, JSON.stringify(shared));
    else localStorage.removeItem(SHARED_KEY);
  } catch {
    /* ignore */
  }
}
export function sharedCache(): MarkState {
  try {
    const raw = localStorage.getItem(SHARED_KEY);
    return (raw && sanitizeMark(JSON.parse(raw))) || {};
  } catch {
    return {};
  }
}
/* What the splash may land on: a local override first, the remembered
 * shared one next; the pool is the local one plus, with Fun on, the
 * shared one -- the same rule the mark applies. */
export function splashMarkState(fun: boolean): { override?: MarkDesign; pool: MarkDesign[] } {
  const shared = sharedCache();
  return {
    override: state.override ?? shared.override,
    pool: [...(fun ? (shared.pool ?? []) : []), ...(state.pool ?? [])],
  };
}
