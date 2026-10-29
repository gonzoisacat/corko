import type { Settings } from "./settings";

/* ------------------------------------------------------------------ *
 *  A BOARD'S LOOK IS THE BOARD'S (owner, 2026-10-29).
 *
 *  His ask was to share a board "with the same visuals I've dialled in".
 *  Most of what dials a board in was per BROWSER -- the frame and the
 *  wall, the cards' tilt, pins, shadow and corners, the images switch,
 *  the note dots -- so a link carried the board and none of that. His
 *  call, offered the three ways to go: "the overrides are the way out,
 *  for sure. and that we probably should commit most things to the
 *  default board look." So these keys go the way the backdrop went on
 *  2026-09-05 (state/boardLook.ts): THE BOARD HOLDS ONE VALUE THAT
 *  EVERYONE SEES (`Board.style`), and a person's own value is an
 *  OVERRIDE behind the one switch (settings.overrideBackdrop, the
 *  Overrides door by the steering wheel). Switch off: the board's.
 *  Switch on: yours. A board with nothing written wears the APP's
 *  defaults -- "defaults are still settings" (his, 2026-09-10) -- never
 *  the viewer's own.
 *
 *  ITS OWN FIELD, not more keys inside `Board.look`: an older build's
 *  setBoardLook sanitizes the look whole and would drop keys it does not
 *  know the first time someone on a stale tab touched the backdrop.
 *  Nothing old writes `style`, so nothing old can erase it.
 *
 *  What is NOT here, on purpose: dark mode (the app's chrome, not the
 *  board's content -- his "correct on leaving dark mode out"), the view
 *  (Detail or Overview, zoom, folds -- each person keeps folding freely;
 *  a board link carries the sender's, state/boardLink.ts), and the
 *  reading aids (legend collapsed, the Overview's beat text and preview
 *  size, the notes columns).
 *
 *  THE WALL PICTURE is a STILL here (`st-wall-...` in the shared blob
 *  store, R2 where the instance has a bucket), so everyone can fetch it;
 *  a personal one stays in this browser's own wall store (`wall-...`).
 *  The key's prefix says which store to read. An instance with no bucket
 *  keeps the board's picture in the browser that set it, and everyone
 *  else sees the wall color -- the stills' own rule.
 *
 *  Pure: no React, no doc, no storage. settings.ts merges it in.
 * ------------------------------------------------------------------ */

export type CardImages = "on" | "only" | "off";
export const readCardImages = (v: unknown): CardImages =>
  v === "only" ? "only" : v === false || v === "off" ? "off" : "on";
export type FrameStyle = "aluminum" | "wood";
export const FRAME_SCALE_MIN = 1;
export const FRAME_SCALE_MAX = 6;
export const FRAME_PAD_MIN = 0;
export const FRAME_PAD_MAX = 6;

export const STYLE_KEYS = [
  "roundedCorners",
  "cardTilt",
  "pushpins",
  "pushpinColor",
  "liftedShadow",
  "frame",
  "frameStyle",
  "frameScale",
  "framePad",
  "wallColor",
  "wallImage",
  "cardImages",
  "noteDots",
] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];
export type BoardStyle = Partial<Pick<Settings, StyleKey>>;
const STYLE_SET = new Set<string>(STYLE_KEYS);
export const isStyleKey = (k: string): k is StyleKey => STYLE_SET.has(k);

/* What a board wears with nothing written: the app's defaults (TACTILE,
 * frame off). settings.ts builds its own DEFAULTS from this, so the two
 * cannot disagree. */
export const STYLE_DEFAULTS: Required<BoardStyle> = {
  roundedCorners: false,
  cardTilt: true,
  pushpins: true,
  pushpinColor: "random",
  liftedShadow: true,
  frame: false,
  frameStyle: "aluminum",
  frameScale: 1,
  framePad: 1,
  wallColor: "#d8d4cb",
  wallImage: "",
  cardImages: "on",
  noteDots: true,
};

/* A wall picture the BOARD owns lives in the shared still store, under
 * the Worker's still-key shape (`st-` plus up to 40). */
export const SHARED_WALL_PREFIX = "st-wall-";
export const isSharedWall = (key: string): boolean => key.startsWith(SHARED_WALL_PREFIX);

const HEX = /^#[0-9a-f]{6}$/i;
const STILL = /^st-[A-Za-z0-9_-]{1,40}$/;
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;

/* Untrusted (the doc, a board file) -> only keys this build knows, each a
 * value it can draw. Null when nothing survives, so an empty object is
 * never stored. */
export function sanitizeStyle(raw: unknown): BoardStyle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: BoardStyle = {};
  for (const k of ["roundedCorners", "cardTilt", "pushpins", "liftedShadow", "frame", "noteDots"] as const) {
    if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  }
  if (r.pushpinColor === "random" || (typeof r.pushpinColor === "string" && HEX.test(r.pushpinColor))) {
    out.pushpinColor = r.pushpinColor as string;
  }
  if (r.frameStyle === "aluminum" || r.frameStyle === "wood") out.frameStyle = r.frameStyle;
  const fs = num(r.frameScale, FRAME_SCALE_MIN, FRAME_SCALE_MAX);
  if (fs !== undefined) out.frameScale = fs;
  const fp = num(r.framePad, FRAME_PAD_MIN, FRAME_PAD_MAX);
  if (fp !== undefined) out.framePad = fp;
  if (typeof r.wallColor === "string" && HEX.test(r.wallColor)) out.wallColor = r.wallColor;
  if (r.wallImage === "" || (typeof r.wallImage === "string" && STILL.test(r.wallImage))) {
    out.wallImage = r.wallImage as string;
  }
  if (r.cardImages === "on" || r.cardImages === "only" || r.cardImages === "off") out.cardImages = r.cardImages;
  return Object.keys(out).length ? out : null;
}

/* WHAT A PANE SHOWS: your settings with the style keys taken from the
 * board -- unless your override switch is on, and then yours, whole.
 * The same two-case rule as resolveBackdrop, and nothing else. */
export function resolveStyle<S extends Settings>(own: S, style: BoardStyle | undefined): S {
  if (own.overrideBackdrop) return own;
  return { ...own, ...STYLE_DEFAULTS, ...(style ?? {}) };
}

/* THE ONE-TIME CHANGEOVER (his "automatic", 2026-10-29): what an admin's
 * browser writes onto a board that has no style yet -- its own values
 * for that board, only where they differ from the app's defaults. The
 * wall picture is not in it: a personal one is bytes in this browser,
 * and the caller copies it into the shared store first if it wants it. */
export function carryOver(own: Pick<Settings, StyleKey>): BoardStyle {
  const out: BoardStyle = {};
  for (const k of STYLE_KEYS) {
    if (k === "wallImage") continue;
    if (own[k] !== STYLE_DEFAULTS[k]) (out as Record<string, unknown>)[k] = own[k];
  }
  return out;
}
