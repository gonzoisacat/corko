import { DEFAULT_PROJECT } from "./project";

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

/* Pure, for the tests: `href` is any address on this instance. */
export function boardLinkFor(href: string, project: string, board: string): string {
  const u = new URL(href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("p", project || DEFAULT_PROJECT);
  u.searchParams.set(BOARD_PARAM, board);
  return u.toString();
}

function boot(): string | null {
  if (typeof location === "undefined") return null;
  const id = readBoardParam(location.search);
  try {
    const url = new URL(location.href);
    if (url.searchParams.has(BOARD_PARAM)) {
      url.searchParams.delete(BOARD_PARAM);
      history.replaceState(history.state, "", url.toString());
    }
  } catch {
    /* ignore */
  }
  return id;
}

/* The board this tab was opened to show, or null. */
export const linkedBoard: string | null = boot();

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
