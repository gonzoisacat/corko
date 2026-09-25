import { useLayoutEffect, useRef } from "react";

/* ------------------------------------------------------------------ *
 *  CTRL + WHEEL ZOOMS, ANCHORED ON THE POINTER.
 *
 *  WHY CTRL AND NOT OPTION (the owner asked which is more common, and
 *  assumed a Mac/PC split): there isn't one. Ctrl+wheel is the zoom
 *  idiom on BOTH platforms -- every browser's own page zoom, Figma,
 *  Miro, Google Maps, Excalidraw, tldraw, VS Code. Option/Alt+wheel is
 *  really only Photoshop's, and on Windows it is not a zoom idiom at all.
 *
 *  The decisive part is smaller and better: macOS trackpad PINCH is
 *  delivered to the web as a wheel event with `ctrlKey: true`. Browsers
 *  chose that mapping precisely because Ctrl+wheel was already the
 *  idiom -- so handling ctrlKey gets two-finger pinch-to-zoom free, and
 *  on a corkboard that is the gesture people will actually reach for.
 *
 *  Cmd is kept as an alias because the Overview already accepted it and
 *  taking it away would be a regression; nothing in the browser binds
 *  Cmd+wheel, so intercepting it is safe.
 *
 *  ANCHORING is the part that has to be right. Multiplying the zoom
 *  alone keeps the scroll offset, so the board grows away from its
 *  top-left corner and whatever you were looking at slides off -- which
 *  is what the Overview did before this. Keeping the point under the
 *  cursor fixed is two lines of arithmetic and the difference between
 *  zooming and hunting.
 *
 *  THE SCROLL CORRECTION MUST WAIT FOR THE NEW LAYOUT. The zoom is React
 *  state, so during the handler the sizer is still the OLD size and
 *  setting scrollLeft would clamp against a box that has not grown yet.
 *  Hence the pending ref plus a LAYOUT effect: after the DOM is updated,
 *  before paint, so the board is never seen at the wrong offset.
 *
 *  Every caller lays out the same way -- a scrolling viewport around a
 *  sizer, content at `transform-origin: top left` -- which is what lets
 *  one hook serve the Overview, Columns and the Free Grid.
 * ------------------------------------------------------------------ */

/* The point under the cursor, in CONTENT coordinates, plus where in the
 * viewport it was sitting. Put the first back under the second. */
interface Anchor {
  cx: number;
  cy: number;
  vx: number;
  vy: number;
}

/* MODULE-LEVEL, and that is not laziness -- it is what makes the handoff
 * across zoom 1 work.
 *
 * The Fixed views mount no transform wrapper at exactly 100% (it would
 * make a containing block and scale every hairline for nothing), so the
 * element that SCROLLS changes identity as the zoom leaves or reaches 1:
 * the board's own root at 1, a wrapper either side of it. A pending
 * anchor held in the component would then be applied to a viewport that
 * has just been unmounted -- measured as a 49px drift on the first
 * notch out of 100%.
 *
 * Held out here it is picked up by whichever hook instance is mounted
 * when the new zoom lands, since the correcting effect also runs on
 * mount. Only one wheel gesture exists at a time and the anchor is
 * consumed immediately, so a single slot is enough for both panes. */
/* THE ZOOM FACTOR (owner, 2026-09-04): a typed board's zoom is a factor
 * over its fit -- 1.0x is the whole board, 6.0x the top, in tenths from
 * the slider or the wheel. Shared by the grid and Columns scalers and
 * the pane bar, so the three cannot disagree about the ends. The floor
 * is 0.8 (owner, later the same day: "zoom out a bit more, whether in
 * border mode or continuous cork") -- the whole board at four fifths,
 * with more wall or cork around it; 1.0x still says "(full board)". */
export const ZOOM_FACTOR_MIN = 0.8;
export const ZOOM_FACTOR_MAX = 6;
export const clampZoomFactor = (f: number): number =>
  Math.round(Math.max(ZOOM_FACTOR_MIN, Math.min(ZOOM_FACTOR_MAX, f)) * 10) / 10;

let pendingAnchor: Anchor | null = null;

/* ANCHOR THE NEXT ZOOM WITHOUT A POINTER -- the pane-bar SLIDER's path
 * (owner, 2026-08-29: "make it so that Fixed has its zoom anchor point
 * around a selected card"). The wheel has a cursor to anchor on; the
 * slider does not, so it used to scale from the top-left corner and
 * whatever you were looking at drifted off. The anchor is the SELECTED
 * card's center when one is on screen in this pane, and the viewport's
 * own center otherwise -- both strict improvements on a corner.
 *
 * It writes the same module-level pendingAnchor the wheel writes, so the
 * correcting layout effect -- and the zoom-1 mount/unmount handoff it
 * exists for -- serves both paths with no new machinery.
 *
 * The viewport is found by an EXPLICIT selector list, the keyNav
 * data-kbd lesson: a new board type with a Fixed zoom must register its
 * scroller here or its slider falls back to corner-anchored zooming --
 * degraded, not broken. */
const ZOOM_VIEWPORTS = ".grid-zoom, .grid-surface, .kanban-zoom, .kanban";

export function anchorSliderZoom(paneRoot: HTMLElement | null, from: number) {
  const vp = paneRoot?.querySelector<HTMLElement>(ZOOM_VIEWPORTS);
  if (!vp) return;
  const r = vp.getBoundingClientRect();
  let vx = r.width / 2;
  let vy = r.height / 2;
  /* `.selected` is the grid card and the cut card; `.sel` the kanban
   * head. Only when its center is actually IN VIEW: anchoring on an
   * off-screen card would hold it off-screen, which reads as the zoom
   * ignoring you. */
  const sel = paneRoot?.querySelector<HTMLElement>(".selected[data-node], .sel[data-node]");
  if (sel) {
    const s = sel.getBoundingClientRect();
    const cx = s.left + s.width / 2;
    const cy = s.top + s.height / 2;
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
      vx = cx - r.left;
      vy = cy - r.top;
    }
  }
  pendingAnchor = {
    cx: (vp.scrollLeft + vx) / from,
    cy: (vp.scrollTop + vy) / from,
    vx,
    vy,
  };
}

export function useWheelZoom(
  viewport: React.RefObject<HTMLElement | null>,
  zoom: number,
  /* NULL means this instance is not the one that owns the zoom, and the
   * hook then does NOTHING -- no listener, and crucially no anchor
   * correction.
   *
   * That matters because the board views nest: GridView renders inside
   * GridZoomed, so both call this. React runs a CHILD's layout effect
   * before its parent's, so the inner instance was consuming the pending
   * anchor and applying it to its own element at its own scale -- the
   * wrong element, the wrong zoom, and the outer instance then found
   * nothing left to apply. Measured as a drift that grew with every
   * notch (49px, then 65px) instead of the point staying put. */
  setZoom: ((z: number) => void) | null,
  clamp: (z: number) => number,
  /* Called when the wheel actually zooms -- the Overview uses it to leave
   * fit-to-screen, since a zoom you set by hand is a zoom you chose.
   * Types whose Fit is a separate view mode pass nothing. */
  onManual?: (v: boolean) => void,
) {
  /* Read live, so the listener never needs re-attaching and a stale
   * closure can never zoom from the wrong starting scale. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /* THE EXACT ZOOM, CARRIED BETWEEN EVENTS (owner-reported 2026-09-13:
   * "none of the keys are successfully causing free grid to zoom with
   * me scrolling"). The typed boards' zoom is a factor in TENTHS
   * (clampZoomFactor rounds), and a trackpad notch or a mouse click is
   * a few pixels of delta -- a factor of 0.99, which rounds straight
   * back to the tenth it started on, so no single event ever moved it
   * and the gesture did nothing. The Overview's clamp does not round,
   * which is why it worked there and here did not. So the multiplication
   * runs on this unrounded value and only the ROUNDED result is
   * published; re-seeded whenever the published zoom moves by another
   * hand (the slider, the fit), so the two cannot drift apart. */
  const exactRef = useRef(zoom);
  if (clamp(exactRef.current) !== zoom) exactRef.current = zoom;

  /* Runs on zoom change AND on mount -- the mount case is the handoff
   * described above, where a different element is doing the scrolling. */
  useLayoutEffect(() => {
    const a = pendingAnchor;
    const vp = viewport.current;
    if (!setZoom || !a || !vp) return;
    pendingAnchor = null;
    vp.scrollLeft = a.cx * zoom - a.vx;
    vp.scrollTop = a.cy * zoom - a.vy;
  }, [zoom, viewport, setZoom]);

  useLayoutEffect(() => {
    const vp = viewport.current;
    if (!vp || !setZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      /* Non-passive, so this suppresses the browser's own page zoom. A
       * plain wheel is left alone and still scrolls the board. */
      e.preventDefault();
      const from = zoomRef.current;
      /* Proportional to the delta rather than a fixed step, so a trackpad
       * pinch is smooth instead of stepping in 10% jumps -- one pinch
       * delivers many events carrying small deltas. Run on the EXACT
       * value (above), then rounded by the caller's clamp. */
      const exact = exactRef.current * Math.exp(-e.deltaY * 0.0015);
      const next = clamp(exact);
      // keep the carry inside the clamp's range, so a long scroll past
      // the end does not bank a run-up the way back has to spend first
      exactRef.current = Math.max(clamp(0), Math.min(clamp(Infinity), exact));
      if (next === from) return;
      const r = vp.getBoundingClientRect();
      const vx = e.clientX - r.left;
      const vy = e.clientY - r.top;
      pendingAnchor = {
        cx: (vp.scrollLeft + vx) / from,
        cy: (vp.scrollTop + vy) / from,
        vx,
        vy,
      };
      onManual?.(true);
      setZoom(next);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [viewport, setZoom, clamp, onManual]);
}
