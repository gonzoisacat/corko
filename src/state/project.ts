/* ------------------------------------------------------------------ *
 *  WHICH PROJECT THIS TAB IS IN.
 *
 *  A project is a room is a doc is a password scope (worker/access.ts
 *  has the server half and the reasoning). This module answers one
 *  question for everything else -- `projectId` -- and it answers it at
 *  IMPORT time, before the doc, the sync layer or any per-browser store
 *  reads localStorage, because every one of them keys off it.
 *
 *  The answer comes from `?p=<id>` in the URL, else the last project this
 *  browser opened, else `default` -- the project whose room is
 *  `corko-default`, i.e. the one every deployment has had since Phase 3.
 *  Switching project is a RELOAD with the param set: the doc, the undo
 *  manager and the sync provider are module singletons built for one
 *  room, and a reload is the honest way to rebuild all three.
 *
 *  `scoped(key)` is how a per-browser store keeps one project's state
 *  apart from another's on the same origin. The default project's keys
 *  are UNCHANGED, so nobody's saved arrangement, fold state or notes
 *  baseline moves when this lands. Not everything is scoped: settings
 *  are about you, not the project; board and node ids are unique across
 *  docs (uid carries a session tag), so fold and seen-boards need no
 *  fence; and the card clipboard stays global on purpose -- cut here,
 *  paste there is how content moves between projects.
 * ------------------------------------------------------------------ */

export const DEFAULT_PROJECT = "default";
export const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/* Deliberately NOT scoped: it is the pointer to the scope. */
const CURRENT_KEY = "corko-project-current";

export const roomFor = (project: string): string => `corko-${project}`;

/* Pure, for the tests: the URL wins, then what the browser remembers. */
export function resolveProject(search: string, remembered: string | null): string {
  const p = new URLSearchParams(search).get("p");
  if (p && PROJECT_ID.test(p)) return p;
  if (remembered && PROJECT_ID.test(remembered)) return remembered;
  return DEFAULT_PROJECT;
}

function boot(): string {
  if (typeof location === "undefined") return DEFAULT_PROJECT;
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(CURRENT_KEY);
  } catch {
    /* private mode: the URL alone decides */
  }
  const id = resolveProject(location.search, remembered);
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    /* ignore */
  }
  /* Show the project in the address bar even when it came from memory,
   * so the URL someone copies out of the bar opens the same project. */
  try {
    const url = new URL(location.href);
    const want = id === DEFAULT_PROJECT ? null : id;
    if (url.searchParams.get("p") !== want) {
      if (want) url.searchParams.set("p", want);
      else url.searchParams.delete("p");
      history.replaceState(history.state, "", url.toString());
    }
  } catch {
    /* ignore */
  }
  return id;
}

export const projectId: string = boot();
export const roomName: string = roomFor(projectId);

export const scoped = (key: string): string => (projectId === DEFAULT_PROJECT ? key : `${key}:${projectId}`);
export const scopedFor = (key: string, project: string): string =>
  project === DEFAULT_PROJECT ? key : `${key}:${project}`;

/* The `p=` half of a query string for the still routes, "" for the
 * default project so existing URLs are byte-identical. */
export const projectParam = (): string => (projectId === DEFAULT_PROJECT ? "" : `p=${encodeURIComponent(projectId)}`);

/* A name typed by a person -> the slug that will be its room, prefix and
 * URL. Lower-case, runs of anything else become one dash, trimmed and
 * capped at the id's length limit; "" when nothing survives. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return PROJECT_ID.test(s) ? s : "";
}

/* The name a new project was given in the dialog, carried across the
 * reload that opens it: the room is empty until then, and the doc is the
 * only place a project's name lives. Read once by whoever opens it. */
const TITLE_KEY = "corko-project-title";
export function stashTitle(id: string, title: string): void {
  try {
    localStorage.setItem(`${TITLE_KEY}:${id}`, title);
  } catch {
    /* ignore */
  }
}
export function takeStashedTitle(): string | null {
  try {
    const k = `${TITLE_KEY}:${projectId}`;
    const v = localStorage.getItem(k);
    if (v !== null) localStorage.removeItem(k);
    return v;
  } catch {
    return null;
  }
}

/* Whether the next boot plays the splash. A switch between projects
 * you already have does not (owner, 2026-09-04); arriving in a project
 * set up a moment ago does, like any first arrival. Session-scoped, so
 * it lives exactly as long as the reload it is for. */
const SKIP_SPLASH_KEY = "corko-skip-splash";
export function takeSkipSplash(): boolean {
  try {
    const v = sessionStorage.getItem(SKIP_SPLASH_KEY);
    if (v) sessionStorage.removeItem(SKIP_SPLASH_KEY);
    return !!v;
  } catch {
    return false;
  }
}

export function switchProject(id: string, opts: { splash?: boolean } = {}): void {
  if (!PROJECT_ID.test(id) || id === projectId) return;
  try {
    localStorage.setItem(CURRENT_KEY, id);
    if (opts.splash === false) sessionStorage.setItem(SKIP_SPLASH_KEY, "1");
  } catch {
    /* ignore */
  }
  const url = new URL(location.href);
  if (id === DEFAULT_PROJECT) url.searchParams.delete("p");
  else url.searchParams.set("p", id);
  location.href = url.toString();
}
