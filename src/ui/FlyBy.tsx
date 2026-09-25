import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/* ------------------------------------------------------------------ *
 *  The easter egg: something sails across the screen and leaves.
 *
 *  Portalled to <body> rather than rendered where it's triggered. The
 *  topbar is a z-index-40 stacking context, so a fixed element inside it
 *  is trapped under the panes; the flight has to be a sibling of the app,
 *  not a descendant of the thing that launched it.
 *
 *  The path is a straight climb to the right at a fixed angle. The travel
 *  is sized off the VIEWPORT rather than being a constant: it always
 *  starts fully below the fold and ends fully above it, so the same
 *  animation reads the same on a laptop and a 34" monitor instead of
 *  barely clearing one and overshooting the other.
 * ------------------------------------------------------------------ */

const RISE_DEG = 25;
const DURATION_MS = 4000;

export function FlyBy({
  src,
  alt,
  width = 300,
  onDone,
}: {
  src: string;
  alt: string;
  width?: number;
  onDone: () => void;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rise = (RISE_DEG * Math.PI) / 180;
    const art = el.naturalHeight ? (width * el.naturalHeight) / el.naturalWidth : width * 0.55;
    /* The angle is what's fixed; the distance follows from it -- and it's
     * whichever edge it reaches FIRST. Sizing the travel off the top alone
     * works at a steep climb but not a shallow one: at 25 degrees clearing
     * the top takes ~3500px of run, so it would sail out the right-hand
     * side a third of the way in and spend the rest of the duration
     * animating where nobody can see it. */
    const toRight = window.innerWidth + width * 2;
    const toTop = (window.innerHeight + art * 2) / Math.tan(rise);
    const dx = Math.min(toRight, toTop);
    const dy = -dx * Math.tan(rise);
    const anim = el.animate(
      [
        { transform: `translate3d(0, 0, 0)` },
        { transform: `translate3d(${dx}px, ${dy}px, 0)` },
      ],
      { duration: DURATION_MS, easing: "linear", fill: "forwards" },
    );
    anim.onfinish = () => done.current();
    return () => anim.cancel();
  }, [width]);

  return createPortal(
    <img
      ref={ref}
      className="flyby"
      src={src}
      alt={alt}
      style={{ width, left: -width, top: window.innerHeight }}
      /* a missing file should be nothing at all, not a broken-image icon
         sailing across someone's cut */
      onError={() => done.current()}
    />,
    document.body,
  );
}
