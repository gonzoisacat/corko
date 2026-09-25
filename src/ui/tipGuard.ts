import { useEffect } from "react";

/* ------------------------------------------------------------------ *
 *  A TIP THAT KNOWS WHERE THE WINDOW ENDS.
 *
 *  The tip directions are static CSS -- centered by default, `tip-left`
 *  and `tip-right` as opt-in edge classes -- which is right exactly as
 *  long as a control stays where the class was chosen for it. The pane
 *  bar WRAPS at narrow widths, and a wrapped options gear carries its
 *  `tip-left` (correct at the right edge) to the window's LEFT edge,
 *  where a leftward-growing tip is mostly off-screen -- the panels'
 *  usePanelFlip problem, one layer up (owner: "may as well",
 *  2026-08-29).
 *
 *  A pseudo-element cannot measure itself, so this is ONE document-level
 *  listener (the spacePan shape): on entering any [data-tip] control it
 *  measures the tip's TEXT with a hidden ruler in the tip's own type,
 *  computes where the box lands for the element's current direction,
 *  and corrects the ones that would cross a side edge --
 *
 *    tip-left cropping left  -> `tip-flip-right` (grow rightward)
 *    tip-right cropping right -> `tip-flip-left`
 *    a centered tip cropping either side -> `--tip-shift`, a px nudge
 *      the base rule folds into its translateX
 *
 *  Corrections are applied per HOVER and left in place: a stale one on
 *  an unhovered control is invisible, and the next hover recomputes it
 *  against wherever the control is by then -- so a resize or a re-wrap
 *  needs no listener of its own. The tip has a 1.5s dwell before it
 *  shows, so a mouseover-time measurement is never late.
 * ------------------------------------------------------------------ */

const MARGIN = 4; // keep this clear of the window edge, matching nothing being flush
const GAP = 5; // the tip's own offset from its control, from the base rule

let ruler: HTMLSpanElement | null = null;
function tipBox(text: string): { w: number; h: number } {
  if (!ruler) {
    ruler = document.createElement("span");
    /* the tip's own type, from the [data-tip]::after rule -- if that
     * rule's metrics change, change these with it */
    ruler.style.cssText =
      "position:fixed;left:-9999px;top:0;visibility:hidden;" +
      "padding:3px 7px 4px;font-size:10.5px;line-height:1.3;letter-spacing:0.2px;" +
      "width:max-content;max-width:300px;white-space:normal;";
    document.body.appendChild(ruler);
  }
  ruler.textContent = text;
  return { w: ruler.offsetWidth, h: ruler.offsetHeight };
}

/* THE VERTICAL HALF (owner-reported 2026-09-10: "the tool tip for the
 * reloads etc are spilling off the top of screen"). The base tip hangs
 * ABOVE its control, which is off the window for anything in the topbar
 * or in a panel dragged up against it.
 *
 * IT ONLY CORRECTS WHAT DOES NOT FIT, never what merely could sit the
 * other way. Which way a tip points is a DESIGNED choice in several
 * places and not always about room: the legend's tips point down because
 * a tip pointing up from there paints UNDER the pane bar, which outranks
 * it whatever z-index the tip carries. Flipping those up because the sky
 * is empty would hand back a bug that took a report to find.
 *
 * So the natural direction is read from the pseudo-element itself --
 * with the guard's own flips stripped first, or a flipped tip would read
 * as naturally-down on the next hover and oscillate. */
function correctY(el: HTMLElement, r: DOMRect, h: number, dir: string) {
  const vh = document.documentElement.clientHeight;
  const need = h + GAP + MARGIN;
  if (dir === "down") {
    if (r.bottom + need > vh && r.top - need >= 0) el.classList.add("tip-flip-above");
  } else if (r.top - need < 0 && r.bottom + need <= vh) {
    el.classList.add("tip-flip-below");
  }
}

function correct(el: HTMLElement) {
  const text = el.getAttribute("data-tip");
  if (!text) return;
  const { w, h } = tipBox(text);
  const r = el.getBoundingClientRect();
  /* documentElement, not `window.inner*`: the same number in a browser,
   * and the one that survives a measurement in a hidden pane, where
   * innerWidth/innerHeight read 0 and every fit test would silently
   * answer "no room anywhere". */
  const vw = document.documentElement.clientWidth;
  /* Strip the guard's own flips before asking which way this points, or a
   * flipped tip reads as naturally-that-way on the next hover and the two
   * answers oscillate. */
  el.classList.remove("tip-flip-below", "tip-flip-above");
  const dir = getComputedStyle(el, "::after").getPropertyValue("--tip-dir").trim();
  /* SIDEWAYS TIPS ARE NOBODY'S BUSINESS BUT THEIR OWN (the mark's, which
   * points across the topbar). Every correction below assumes a tip
   * hanging above or under its control, and none of them describe one
   * sitting beside it -- they are also all outranked by the rule that put
   * it there, so they would only ever leave a dead class behind. */
  if (dir === "side") return;
  correctY(el, r, h, dir);

  if (el.classList.contains("tip-left")) {
    /* grows leftward from the element's right edge; flip when that
     * crosses the left edge AND growing rightward would fit better */
    const overLeft = MARGIN - (r.right - w);
    const flippedOverRight = r.left + w - (vw - MARGIN);
    el.classList.toggle("tip-flip-right", overLeft > 0 && flippedOverRight < overLeft);
    return;
  }
  if (el.classList.contains("tip-right")) {
    const overRight = r.left + w - (vw - MARGIN);
    const flippedOverLeft = MARGIN - (r.right - w);
    el.classList.toggle("tip-flip-left", overRight > 0 && flippedOverLeft < overRight);
    return;
  }
  /* centered: nudge by exactly the overhang, no further */
  const center = r.left + r.width / 2;
  let shift = 0;
  if (center - w / 2 < MARGIN) shift = MARGIN - (center - w / 2);
  else if (center + w / 2 > vw - MARGIN) shift = vw - MARGIN - (center + w / 2);
  if (shift !== 0) el.style.setProperty("--tip-shift", `${Math.round(shift)}px`);
  else el.style.removeProperty("--tip-shift");
}

export function useTipGuard() {
  useEffect(() => {
    const on = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]");
      if (el instanceof HTMLElement) correct(el);
    };
    /* focusin too: a tab-focused control shows its tip (the sweep's own
     * accessibility gain), and deserves the same correction */
    document.addEventListener("mouseover", on, true);
    document.addEventListener("focusin", on, true);
    return () => {
      document.removeEventListener("mouseover", on, true);
      document.removeEventListener("focusin", on, true);
      ruler?.remove();
      ruler = null;
    };
  }, []);
}
