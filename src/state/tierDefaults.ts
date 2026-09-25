import type { LevelDef } from "./types";

/* ------------------------------------------------------------------ *
 *  What a tier LOOKS like on a brand-new board (owner's spec,
 *  2026-08-02, tier by tier from his own board's Options gear).
 *
 *  Keyed by HEIGHT ABOVE THE LEAF, not by position from the top -- the
 *  same leaf-anchored rule as every other role in the app (graduation,
 *  cross-board drops, the palette ladder). T1 is a beat wherever it
 *  lives; T4 is the same shape in a four-rung board and a six-rung one.
 *  "for all boards by default", so this applies to every template,
 *  including the full shelf's and the story scaffolds -- one look, then
 *  people tune from there.
 *
 *  Two things worth knowing about the numbers:
 *
 *  - Every tier ships `expandText`, so a title grows to fill its card.
 *    `textSize` is what it falls back to when someone turns that OFF --
 *    which is also the size a full-width BAND uses, since a band has no
 *    fixed height to expand into.
 *  - `height`/`aspect` and `bandHeight` are both stamped on the header
 *    tiers even though only one applies at a time. That is the whole
 *    reason bandHeight is a separate field (see CLAUDE.md): toggling
 *    "Full width" off has to land on a sensible CARD, not drag a 90px
 *    band height onto it.
 *
 *  Fills are NOT here. They come from the palette picked at creation
 *  (colors.ts paletteTiers, the same leaf-anchored ladder), and font
 *  color stays on auto-contrast -- which is what produces the dark
 *  title on T4's white and the white one on T3's black.
 * ------------------------------------------------------------------ */

export interface TierDefault {
  textSize: number;
  height: number;
  aspect: number;
  fullWidth?: boolean;
  bandHeight?: number;
}

/* index = height above the leaf: [0] is T1. The last entry covers every
 * tier above it -- T4 and up are the same shape. */
export const TIER_DEFAULTS: TierDefault[] = [
  /* textSize is the TARGET size now that expandText is gone (owner,
   * 2026-08-14): 30 everywhere except the leaf, which is 20 -- a beat
   * card is small and its titles are the longest per pixel. A title
   * still auto-shrinks below this whenever it has to. */
  { textSize: 20, height: 80, aspect: 1.85 }, // T1 beat
  { textSize: 30, height: 90, aspect: 1.85 }, // T2 scene
  { textSize: 30, height: 130, aspect: 2.6, fullWidth: true, bandHeight: 70 }, // T3
  { textSize: 30, height: 125, aspect: 3.0, fullWidth: true, bandHeight: 90 }, // T4+
];

export const tierDefault = (height: number): TierDefault =>
  TIER_DEFAULTS[Math.min(Math.max(height, 0), TIER_DEFAULTS.length - 1)];

/* THE TARGET SIZE A TIER RENDERS AT -- the one reader of `textSize`, so
 * the board, the Overview's miniatures and the Options slider can never
 * disagree about what a tier is set to.
 *
 * The `expandText` branch is the retirement's compatibility rule, and it
 * is faithful rather than generous: while that flag was on, the title
 * grew to fill the card and `textSize` was INERT -- the value stamped at
 * creation as a fallback for a mode nobody had switched on. So a level
 * still carrying it never chose a target, and reads as unset. A board
 * that deliberately turned expand OFF keeps the size it chose (CLB's
 * beats stay at 30), and dragging the slider clears the flag, so a tier
 * adopts the new model the moment anyone touches it.
 *
 * That is what spares ~10 colleagues waking up to text that silently
 * shrank from filling the card to a 15px fallback they never picked. */
export function targetFontSize(l: LevelDef, isLeaf: boolean): number {
  const fallback = isLeaf ? TIER_DEFAULTS[0].textSize : TIER_DEFAULTS[1].textSize;
  if (l.expandText) return fallback;
  return l.textSize ?? fallback;
}

/* Stamp the defaults onto a ladder. Only FILLS GAPS: a template that
 * deliberately sets a size keeps it, and this is a starting point rather
 * than a policy. The values are written onto the LevelDefs rather than
 * left as code fallbacks so they show up in the Options gear as real
 * numbers you can drag. */
export function withTierDefaults(levels: LevelDef[]): LevelDef[] {
  const leaf = levels.length - 1;
  return levels.map((l, i) => {
    const d = tierDefault(leaf - i);
    return {
      ...l,
      textSize: l.textSize ?? d.textSize,
      height: l.height ?? d.height,
      aspect: l.aspect ?? d.aspect,
      // a band is a header-tier idea: the leaf and its lane never have one
      ...(i < leaf - 1
        ? {
            fullWidth: l.fullWidth ?? d.fullWidth ?? false,
            bandHeight: l.bandHeight ?? d.bandHeight,
          }
        : {}),
    };
  });
}
