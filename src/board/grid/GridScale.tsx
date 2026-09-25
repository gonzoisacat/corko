import { useLayoutEffect, useRef, useState } from "react";
import type { Board } from "../../state/types";
import { GridView } from "./GridView";
import { clampZoomFactor, useWheelZoom } from "../useWheelZoom";
import { BoardFrame, useWall } from "../BoardFrame";
import { frameMargin, smallestGridCardH } from "../frame";
import { CELL } from "../../state/gridBoard";

/* ------------------------------------------------------------------ *
 *  THE FREE GRID AT TWO SCALES.
 *
 *  The same pair the Columns type has, for the same reason (CLAUDE.md,
 *  "a type answers BOTH view modes itself"): FIXED is the board at the
 *  size you set, FIT is that board shrunk -- or blown up -- until all of
 *  it shows. A wall of pinned things is a picture, so "show me the whole
 *  thing" is a zoom rather than a second drawing.
 *
 *  Two components rather than one with an early return, and it is not
 *  style: written the other way the content ref is null on the only pass
 *  the layout effect is scheduled for, so the observer never attaches
 *  and the sizer stays 0 -- the bug the Columns zoom shipped with for an
 *  hour. It still scrolled, on transformed overflow, which is exactly
 *  the kind of accident that reads as working.
 * ------------------------------------------------------------------ */

interface Props {
  board: Board;
  hasKeyboard: boolean;
}

/* FIT: as full as the pane allows, magnifying a small board rather than
 * only shrinking a big one -- "essentially expand to fill", the owner's
 * reading when the Columns version was decided. Always CONTAIN, so
 * nothing is ever cropped, which is what the word is promising. */
/* FIXED IS A ZOOM FACTOR OVER FIT (owner, 2026-09-04): 1.0x is the whole
 * board -- exactly what Fit shows -- and 2x is twice that, in tenths,
 * from the slider or ctrl-wheel. Relative rather than absolute because a
 * spread board at "100%" was miles of cork and a tight one at 40% was a
 * postage stamp; against the fit, the numbers mean the same thing on
 * every board. Always a scaled wrapper now: the old unscaled path at
 * exactly 100% (and the remount crossing it) had nothing left to do. */
export function GridZoom({
  board,
  hasKeyboard,
  zoom,
  onZoom,
}: Props & { zoom: number; onZoom: (z: number) => void }) {
  const content = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [fit, setFit] = useState(1);
  /* ctrl/cmd + wheel, anchored on the pointer -- the same gesture the
     Overview takes, on the same key (board/useWheelZoom.ts). The anchor
     math is ratio-based, so a factor works there exactly as a scale. */
  useWheelZoom(viewport, zoom, onZoom, clampZoomFactor);
  /* The frame and the wall (board/BoardFrame.tsx): the wall is this
     viewport's background, the frame wraps the board inside the box the
     fit measures, so 1.0x shows the whole framed board. */
  const wall = useWall(board.id);
  useLayoutEffect(() => {
    const ct = content.current;
    const vp = viewport.current;
    if (!ct || !vp) return;
    const measure = () => {
      const w = ct.offsetWidth;
      const h = ct.offsetHeight;
      setNatural({ w, h });
      if (w > 0 && h > 0) {
        /* NEVER ABOVE 1:1 (owner, 2026-09-04): a board smaller than the
         * pane sits at the sizes Options gave its cards, not blown up to
         * fill. So 1.0x is the whole board at natural size or smaller,
         * and the factor scales up from there. */
        const k = Math.min(1, (vp.clientWidth - 8) / w, (vp.clientHeight - 8) / h);
        setFit(k > 0 ? k : 1);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ct);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [board]);
  const scale = fit * zoom;

  return (
    <div className="grid-zoom" ref={viewport} {...wall}>
      {/* the SIZER carries the scaled box: a transform does not change
          layout size, so without it zooming in clips instead of scrolling */}
      <div className="grid-zoom-sizer" style={{ width: natural.w * scale, height: natural.h * scale }}>
        <div
          className="grid-fit-inner"
          ref={content}
          style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <BoardFrame boardId={board.id} margin={frameMargin(smallestGridCardH(board))} lattice={CELL}>
            <GridView board={board} hasKeyboard={hasKeyboard} fitted />
          </BoardFrame>
        </div>
      </div>
    </div>
  );
}
