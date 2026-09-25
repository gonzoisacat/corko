import { useLayoutEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ *
 *  A RIGHT-ANCHORED DROPDOWN THAT KNOWS WHEN IT HAS MOVED HOUSE.
 *
 *  `.options-panel` anchors `right: 0` because its buttons -- stats,
 *  usage, the options gear -- live at the pane bar's right end, so the
 *  panel hangs leftward into the window. But the bar WRAPS at narrow
 *  widths (a wrap the owner is fine with), and the wrapped row starts at
 *  the LEFT edge -- where a leftward-hanging panel is mostly off-screen
 *  (owner-reported 2026-08-29: "they then still open to the left even
 *  though they're on the left side of the screen. so cropped").
 *
 *  So the panel measures itself ON OPEN, in its default right-anchored
 *  spot, and flips to left-anchored if it pokes past the window's left
 *  edge -- the "positionally aware" of his three offered fixes, because
 *  it needs no knowledge of WHY the button moved and keeps working if
 *  the bar ever wraps differently. A LAYOUT effect, so the measure and
 *  the flip land in the same frame and the panel is never painted
 *  cropped. Measured once per open: a bar cannot re-wrap under an open
 *  panel without the window resizing, and closing resets it.
 *
 *  (BoardsMenu never needs this -- it lives at the LEFT edge always and
 *  carries its own permanent left anchor; SearchMenu clamps itself with
 *  useClampToViewport, being fixed-position rather than anchored.)
 * ------------------------------------------------------------------ */
export function usePanelFlip(open: boolean): {
  ref: React.RefObject<HTMLDivElement>;
  flip: boolean;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    if (!open) {
      setFlip(false);
      return;
    }
    const el = ref.current;
    if (!el) return;
    setFlip(el.getBoundingClientRect().left < 4);
  }, [open]);
  return { ref, flip };
}
