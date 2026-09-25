import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

/* ------------------------------------------------------------------ *
 *  Keep a popup on screen -- by MEASURING it (owner-reported,
 *  2026-08-03).
 *
 *  Every popup used to clamp against a hardcoded guess at its own size
 *  ("h = 156"), and every one of them grows with its content: the card
 *  menu gains Stack, Paste, Promote, Demote and a Stowed outline; the
 *  note panel grows with its notes; the metadata panel with its
 *  categories. So the guess was wrong exactly when it mattered and the
 *  menu ran off the bottom of the window.
 *
 *  This clamps the guess first (so the first paint is close), then
 *  corrects from the real box in a LAYOUT effect -- which runs before
 *  the browser paints, so the correction is never visible as a jump.
 *
 *  A popup TALLER than the window is pinned to the top margin and left
 *  to scroll itself; the CSS gives these a max-height for that.
 * ------------------------------------------------------------------ */

const MARGIN = 6;

export interface Pos {
  left: number;
  top: number;
}

const clamp = (x: number, y: number, w: number, h: number): Pos => ({
  left: Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN)),
  top: Math.max(MARGIN, Math.min(y, window.innerHeight - h - MARGIN)),
});

export function useClampToViewport(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  /* rough size, used only for the first paint before we can measure */
  guess: { w: number; h: number },
): Pos {
  const [pos, setPos] = useState<Pos>(() => clamp(x, y, guess.w, guess.h));

  useLayoutEffect(() => {
    const el = ref.current;
    const next = el
      ? clamp(x, y, el.offsetWidth, el.offsetHeight)
      : clamp(x, y, guess.w, guess.h);
    setPos((p) => (p.left === next.left && p.top === next.top ? p : next));
    // measured from the element, so re-running on the guess would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  return pos;
}
