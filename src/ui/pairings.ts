import type { MarkDesign } from "../state/types";
/* ------------------------------------------------------------------ *
 *  THE PAIRING TABLE -- a landing plus the board tint that goes with
 *  it, shared by the boot splash and the topbar mark.
 *
 *  These are the owner's own pairings, approved by screenshot
 *  (2026-08-09/10). They are the CURRENT statement of the colorways:
 *  where a look's own `board` color disagrees, the pairing wins, so
 *  the logo and the splash read as one design rather than two eras.
 *
 *  A PAIRING IS A DESIGN DECISION, NOT A CROSS-PRODUCT: the tint is
 *  usually NOT the look's own board color (ocean over pink, classic
 *  over cork), and SIX of the mark's eighteen looks are deliberately
 *  absent (candy, ice, neon, gilded, blossom, checker) -- they were not
 *  in the screenshots. Those keep their own board color. Adding one is
 *  a decision to make with him, not a gap to fill.
 *
 *  A module of its own, with NO imports, purely to break a cycle:
 *  SplashIntro imports GRID + LOOKS from CorkoMark, so CorkoMark cannot
 *  import from SplashIntro to ask what was drawn. Both depend on this.
 * ------------------------------------------------------------------ */

export interface Pairing {
  look: string; // an id in CorkoMark's LOOKS
  /* The corkboard color it is paired with -- or "" for PLAIN CORK, the
   * photo undyed. Empty is not "no pairing" (that is `tintFor` returning
   * null); it is the deliberate choice of cork as itself. */
  tint: string;
}

/* What "Load animation: On" shows every load -- classic's pale-blue pins
 * on PLAIN CORK, the calm one. It was a flat `#e8be82` until the owner
 * put the logo beside the app's own board and saw the difference: that
 * swatch is rgb(232,190,130), where the real texture averages
 * rgb(180,139,109) -- lighter and distinctly yellower. Cork is its own
 * best color, so classic simply wears it. */
export const HOUSE: Pairing = { look: "classic", tint: "" };

/* ...and what "Fun" draws from, one per page load. */
export const POOL: Pairing[] = [
  { look: "classic", tint: "#ef6fa8" }, // pale blue pins on dusty rose
  { look: "matrix", tint: "#000000" }, // green on near-black
  { look: "trans", tint: "#9fbcd8" }, // flag pins on blue-grey
  { look: "rainbow", tint: "#c9a67a" }, // ROYGBV on plain cork
  { look: "smiley", tint: "#5b5bd6" }, // yellow on periwinkle
  { look: "ember", tint: "#7f1d1d" }, // fire ramp on dusty red
  { look: "ocean", tint: "#f28ac8" }, // water ramp on pink
  { look: "starry", tint: "#c9a67a" }, // white + gold on plain cork
  { look: "bee", tint: "#f0a020" }, // honey stripes on orange
  { look: "heart", tint: "#1e8fe0" }, // pink on blue
  { look: "sunset", tint: "#8a3fb5" }, // dusk ramp on violet
  { look: "disco", tint: "#000000" }, // mirrorball on near-black
];

/* The board color a look should sit on, or null if it has no pairing
 * (the six that aren't in the pool -- they keep their own).
 *
 * `classic` appears in BOTH the house pairing and the pool, on different
 * tints; the pool's is the one a click can land on, so it wins here and
 * the house tint reaches the mark only through the splash's own draw. */
export function tintFor(lookId: string): string | null {
  return POOL.find((p) => p.look === lookId)?.tint ?? null;
}

/* ---- what the splash actually drew, this page load ------------------ *
 * SplashIntro sets these at module scope -- which runs during main.tsx's
 * import phase, before React renders -- so the mark's first render can
 * open on the same colorway the fade uncovers. */
let landedLook: string | null = null;
let landedTint: string | null = null;

export function setSplashLook(look: string, tint: string): void {
  landedLook = look;
  landedTint = tint;
}

export function splashLook(): string | null {
  return landedLook;
}

export function splashTint(): string | null {
  return landedTint;
}

/* The DESIGN the splash landed on, when it landed on one rather than a
 * pairing (state/mark.ts pickSplashDesign); the mark opens wearing it. */
let landedDesign: MarkDesign | null = null;
export function setSplashDesign(d: MarkDesign | null): void {
  landedDesign = d;
}
export function splashDesign(): MarkDesign | null {
  return landedDesign;
}
