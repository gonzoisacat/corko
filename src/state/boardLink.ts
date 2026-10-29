import { DEFAULT_PROJECT } from "./project";
import type { Board, Node } from "./types";
import type { PaneViewState } from "./paneView";

/* ------------------------------------------------------------------ *
 *  A LINK TO ONE BOARD (owner, 2026-10-28): "a link for my collaborators
 *  that already have been passworded in. it would bypass bringing up any
 *  new board menu if they were opening a new browser window."
 *
 *  The link is the project's own address plus `b=<board id>` -- an id, so
 *  a rename never breaks it, and never a password. The project is ALWAYS
 *  named, the default one too: without `p` a browser falls back to the
 *  project it last opened, which may not be the one the board is in.
 *
 *  It is read ONCE, at import time, and taken out of the address bar at
 *  once, so a reload or a bookmark made afterwards is the project link
 *  and does not keep yanking back to this board. App opens the board when
 *  the boards have arrived (single view, left pane -- the door's answer)
 *  and puts the OPEN BOARD DOOR up instead when it is not there any more.
 *
 *  THE SENDER'S VIEW RIDES ALONG (owner, 2026-10-29): Detail or
 *  Overview, the zoom, the Overview's tiers, and the FOLDS -- "yes view
 *  state" -- applied once when the link opens, never stored on the board.
 *  Folds go as a BITMAP over the board's foldable lanes in tree order
 *  (`laneIds`), prefixed by their count: a 2,500-card board furled to
 *  Scenes is a few dozen characters rather than kilobytes of ids. A board
 *  edited between copy and open has a different count, and its folds are
 *  skipped rather than landed on the wrong lanes. Opening a link also
 *  turns the reader's override switch OFF (his), so they see the board
 *  as it was dressed.
 *
 *  A key that does not open the linked project is sent to one it does
 *  (main.tsx's `settle`, a reload); `noteRefused` leaves word for the
 *  next load, which says so rather than landing silently (his pick iii).
 * ------------------------------------------------------------------ */

export const BOARD_PARAM = "b";
const BOARD_ID = /^[A-Za-z0-9_-]{1,80}$/;
/* Session-scoped: it lives exactly as long as the reload it is for. */
const REFUSED_KEY = "corko-link-refused";

/* Pure, for the tests. */
export function readBoardParam(search: string): string | null {
  const b = new URLSearchParams(search).get(BOARD_PARAM);
  return b && BOARD_ID.test(b) ? b : null;
}

export interface LinkView extends PaneViewState {
  folds?: string;
}

/* The lanes a fold can close, in tree order -- fold.foldToTier's own
 * walk, so the two agree on what is foldable. */
export function laneIds(board: Board): string[] {
  const leaf = board.levels.length - 1;
  const out: string[] = [];
  const walk = (n: Node, depth: number) => {
    if (depth >= leaf || n.children.length === 0) return;
    out.push(n.id);
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const r of board.roots) walk(r, 0);
  return out;
}

const toB64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/* "" when nothing on the board is foldable or nothing is folded. */
export function encodeFolds(board: Board, isCollapsed: (id: string) => boolean): string {
  const ids = laneIds(board);
  if (!ids.some(isCollapsed)) return "";
  const bytes = new Uint8Array(Math.ceil(ids.length / 8));
  ids.forEach((id, i) => {
    if (isCollapsed(id)) bytes[i >> 3] |= 1 << (i & 7);
  });
  return `${ids.length}.${toB64(bytes)}`;
}

/* The lanes to fold, or null when the board no longer matches. */
export function decodeFolds(board: Board, s: string): Set<string> | null {
  const m = /^(\d+)\.([A-Za-z0-9_-]*)$/.exec(s);
  const ids = laneIds(board);
  if (!m || Number(m[1]) !== ids.length) return null;
  let bytes: Uint8Array;
  try {
    bytes = fromB64(m[2]);
  } catch {
    return null;
  }
  const out = new Set<string>();
  ids.forEach((id, i) => {
    if ((bytes[i >> 3] ?? 0) & (1 << (i & 7))) out.add(id);
  });
  return out;
}

const round = (n: number) => String(Math.round(n * 1000) / 1000);

/* Pure, for the tests: `href` is any address on this instance. */
export function boardLinkFor(href: string, project: string, board: string, view: LinkView = {}): string {
  const u = new URL(href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("p", project || DEFAULT_PROJECT);
  u.searchParams.set(BOARD_PARAM, board);
  if (view.view) u.searchParams.set("v", view.view === "overview" ? "o" : "d");
  if (view.zoom !== undefined) u.searchParams.set("z", round(view.zoom));
  if (view.factor !== undefined && view.factor !== 1) u.searchParams.set("x", round(view.factor));
  if (view.column) u.searchParams.set("c", String(view.column));
  if (view.depth !== undefined) u.searchParams.set("d", String(view.depth));
  if (view.folds) u.searchParams.set("f", view.folds);
  return u.toString();
}

const VIEW_PARAMS = ["v", "z", "x", "c", "d", "f"];

/* Pure, for the tests: whatever of a view the address carries, each
 * value checked; nothing usable is null. */
export function readViewParams(search: string): LinkView | null {
  const q = new URLSearchParams(search);
  const out: LinkView = {};
  const v = q.get("v");
  if (v === "o" || v === "d") out.view = v === "o" ? "overview" : "detail";
  const num = (k: string, lo: number, hi: number) => {
    const raw = q.get(k);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
  };
  const z = num("z", 0.01, 20);
  if (z !== undefined) out.zoom = z;
  const x = num("x", 0.1, 20);
  if (x !== undefined) out.factor = x;
  const c = num("c", 0, 12);
  if (c !== undefined) out.column = Math.round(c);
  const d = num("d", 0, 12);
  if (d !== undefined) out.depth = Math.round(d);
  const f = q.get("f");
  if (f && /^\d+\.[A-Za-z0-9_-]{0,4000}$/.test(f)) out.folds = f;
  return Object.keys(out).length ? out : null;
}

function boot(): { board: string | null; view: LinkView | null } {
  if (typeof location === "undefined") return { board: null, view: null };
  const board = readBoardParam(location.search);
  const view = board ? readViewParams(location.search) : null;
  try {
    const url = new URL(location.href);
    if (url.searchParams.has(BOARD_PARAM)) {
      for (const k of [BOARD_PARAM, ...VIEW_PARAMS]) url.searchParams.delete(k);
      history.replaceState(history.state, "", url.toString());
    }
  } catch {
    /* ignore */
  }
  return { board, view };
}

const booted = boot();
/* The board this tab was opened to show, or null -- and the view the
 * sender had of it, if the link carried one. */
export const linkedBoard: string | null = booted.board;
export const linkedView: LinkView | null = booted.view;

export function noteRefused(): void {
  try {
    sessionStorage.setItem(REFUSED_KEY, "1");
  } catch {
    /* ignore: the visitor lands without the note */
  }
}

export function takeRefused(): boolean {
  try {
    const v = sessionStorage.getItem(REFUSED_KEY);
    if (v) sessionStorage.removeItem(REFUSED_KEY);
    return !!v;
  } catch {
    return false;
  }
}
