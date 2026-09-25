import { scoped } from "./project";
/* ------------------------------------------------------------------ *
 *  How the window is arranged: which board each pane shows, and which
 *  PROJECT VIEW is on.
 *
 *  LOCAL per browser (like state/fold.ts and state/settings.ts): how you
 *  arrange your panels is your own view of the project, not shared board
 *  data. Two people can read the same cut in different arrangements.
 *
 *  The project view is a mode, not a pair of booleans:
 *    single -- one board.
 *    split  -- two boards side by side (the master-to-section workflow).
 *    notes  -- one board plus the notes panel: every note in the cut,
 *              filterable, each one navigable back to its card.
 *    player -- one board plus a video player (2026-09-06): a proxy from
 *              disk, and a button that mints a card of a chosen tier
 *              from the frame on screen, stamped with its timecode.
 *  Split, notes and player put a second panel beside the board; split
 *  opens at half every time, the other two remember their own widths.
 * ------------------------------------------------------------------ */

export type PaneViewPref = "detail" | "overview";
export type ProjectView = "single" | "split" | "notes" | "player";

export interface PanesPref {
  a: string | null; // board id in the left/only pane
  b: string | null; // board id in the right pane (split view)
  view: ProjectView;
  viewA: PaneViewPref; // detail vs Overview, per BOARD pane
  viewB: PaneViewPref;
  /* Whether one panel STEERS the other (board/DrivingWheel.tsx). On, a
   * selection or Overview jump in one panel drags a panel showing the
   * same board along -- which is what the split view is for most of the
   * time. Off, the two are independent: you can hold two places in one
   * board without either moving under you.
   *
   * Default ON, because that is what the split view has always done and
   * a silent behavior change would be worse than a toggle nobody finds.
   * Arrangement state, so it lives here beside the rest of it rather
   * than in settings: it describes how your panels relate, not how a
   * board looks. */
  driving: boolean;
  /* WHICH panel drives, while local driving is on. "active" follows the
   * keyboard (whichever panel you are working in steers the other);
   * "a"/"b" pin it, so one panel always drives and the other never does
   * however you click about. */
  driver: DriverMode;
}

export type DriverMode = "active" | "a" | "b";

const KEY = scoped("corko-panes");
const LEGACY_ACTIVE_KEY = scoped("corko-active-board"); // pre-split single pane

const EMPTY: PanesPref = {
  a: null,
  b: null,
  view: "single",
  viewA: "detail",
  viewB: "detail",
  driving: true,
  driver: "active",
};

const isId = (v: unknown): v is string | null => v === null || typeof v === "string";
const asView = (v: unknown): PaneViewPref => (v === "overview" ? "overview" : "detail");
const asProjectView = (v: unknown): ProjectView =>
  v === "split" || v === "notes" || v === "player" ? v : "single";

/* FLIPPING INTO SPLIT MIRRORS THE BOARD YOU ARE ON (owner, 2026-09-04):
 * the second panel opens the SAME board, and when that board is a Beat
 * Map, in the OTHER view -- Detail beside Overview, or Overview beside
 * Detail -- so the split is a second angle on the cut you are reading
 * rather than some other board. A typed board (grid, Columns) has one
 * view, so its second panel is a plain copy and keeps whatever view
 * flag it held. Every flip into split does this, from Single or from
 * Notes; picking a different board for the panel afterwards is a click
 * away. `boardA` is the id pane A actually resolved to (the stored `a`
 * can be null before any board was ever picked). */
export function splitFrom(p: PanesPref, boardA: string | null, beatMap: boolean): PanesPref {
  const flipped: PaneViewPref = p.viewA === "detail" ? "overview" : "detail";
  return { ...p, view: "split", b: boardA ?? p.a, viewB: beatMap ? flipped : p.viewB };
}

/* ...AND BACK TO ONE KEEPS THE ACTIVE BOARD (owner, 2026-09-04): leaving
 * Split, the panel you last worked in (board/paneFocus.ts, which
 * follows mouse-down) is the one that stays, whichever side it was on.
 * The two swap rather than B simply overwriting A, so the other board
 * is still remembered in B. */
export function singleFrom(p: PanesPref, active: "a" | "b", view: ProjectView): PanesPref {
  if (p.view !== "split" || active !== "b") return { ...p, view };
  return { ...p, view, a: p.b, viewA: p.viewB, b: p.a, viewB: p.viewA };
}

export function loadPanes(): PanesPref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PanesPref> & { split?: boolean };
      if (isId(p.a ?? null) && isId(p.b ?? null)) {
        return {
          a: p.a ?? null,
          b: p.b ?? null,
          // `split: true` is the pre-Project-View shape
          view: p.view !== undefined ? asProjectView(p.view) : p.split ? "split" : "single",
          viewA: asView(p.viewA),
          viewB: asView(p.viewB),
          // absent in every browser that predates the toggle, and they
          // all had steering on
          driving: p.driving !== false,
          driver: p.driver === "a" || p.driver === "b" ? p.driver : "active",
        };
      }
    }
    // carry over the single-pane app's remembered board
    const legacy = localStorage.getItem(LEGACY_ACTIVE_KEY);
    if (legacy) return { ...EMPTY, a: legacy };
  } catch {
    /* unavailable / malformed storage -- fall through to defaults */
  }
  return EMPTY;
}

export function savePanes(p: PanesPref) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/* The divider position for each two-panel mode, as pane A's fraction of
 * the width. SPLIT OPENS AT HALF, EVERY TIME (owner, 2026-09-06: "better
 * to just do 50/50 anytime") -- it stays draggable while open, and the
 * next opening is half again; nothing is remembered. Notes defaults to
 * two thirds, so the panel reads as a sidebar rather than a second
 * board, and that one DOES remember where you dragged it. */
const NOTES_AT_KEY = scoped("corko-notes-at");
const PLAYER_AT_KEY = scoped("corko-player-at");
export const DEFAULT_SPLIT_AT = 0.5;
export const DEFAULT_NOTES_AT = 0.67;
export const DEFAULT_PLAYER_AT = 0.5; // a picture wants real width

const remembered = (view: ProjectView): { key: string; fallback: number } | null =>
  view === "notes"
    ? { key: NOTES_AT_KEY, fallback: DEFAULT_NOTES_AT }
    : view === "player"
      ? { key: PLAYER_AT_KEY, fallback: DEFAULT_PLAYER_AT }
      : null;

export function loadSplitAt(view: ProjectView): number {
  const r = remembered(view);
  if (!r) return DEFAULT_SPLIT_AT;
  try {
    const v = Number(localStorage.getItem(r.key));
    return Number.isFinite(v) && v >= 0.15 && v <= 0.85 ? v : r.fallback;
  } catch {
    return r.fallback;
  }
}

export function saveSplitAt(view: ProjectView, at: number) {
  const r = remembered(view);
  if (!r) return; // split is half next time whatever you did
  try {
    localStorage.setItem(r.key, String(at));
  } catch {
    /* ignore */
  }
}
