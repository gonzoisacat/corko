import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Node } from "../state/types";
import { useBoxSize } from "./TagTabs";
import { alignOf } from "./cardImage";
import type { CardStrip } from "./cardSizing";
import { useStillUrl } from "./stills";

/* A ceiling on repeats in ONE direction. A very thin image in a large
 * card would otherwise mint a copy per band without limit; twenty-four
 * covers any real card at any real aspect, and the host clips. */
const TILE_CAP = 24;

/* ------------------------------------------------------------------ *
 *  THE IMAGE ON A CARD -- one component, every host.
 *
 *  Named ImageFrame rather than CardImage because `cardImage.ts` already
 *  exists beside it and the two would differ only in CASE, which collides
 *  on a case-insensitive filesystem -- the same trap ConfirmDialogPopover
 *  was named around. That module is the pipeline (downscale, pick, where
 *  an image may go); this is the frame it draws in.
 *
 *  It was a bare `<img className="card-photo">` written out five times
 *  (beat, scene label, header card, column head, grid card). That was
 *  already the drift this repo keeps warning about, and the appearance
 *  modes would have made it five copies of real logic.
 *
 *  TWO LOOKS (types.ts Node.imageFit / imageTile), in whichever box the
 *  card gives them -- the face, or the room a tier appends beside it:
 *
 *    FILL  crop to cover the card. What every image did before these
 *          existed, and still the default -- stored as an ABSENCE.
 *    FIT   the whole image, centered, bars down the sides or along the
 *          top and bottom.
 *    FIT + TILE  those bars filled with a MIRRORED copy of the image,
 *          reflected across the edge each bar sits on.
 *
 *  WHY TILE COSTS A MEASUREMENT, and why only tile does. A mirror has to
 *  be placed exactly where the image ENDS, and CSS cannot say where an
 *  `object-fit: contain` image lands -- there is no mirrored-repeat, and
 *  no way to read the painted box from a stylesheet. So the tile path
 *  measures two things: the image's own aspect (on load, so cards that
 *  already had images work with no new field in the doc) and the card's
 *  box. Fill and Fit measure nothing -- `object-fit` does all of it --
 *  and `useBoxSize`'s `off` flag keeps the observer from even existing
 *  on the cards that do not need it.
 * ------------------------------------------------------------------ */

/* A SIDE PICTURE IS NOT IN A BOX (owner, 2026-09-09: "the image itself
 * should occupy, essentially, a backgroundless, separate space"). It is
 * a bare image standing beside the card at the height its tier's dial
 * gives it, keeping its own aspect, with nothing behind it -- so there
 * is nothing here to letterbox INTO and no bars can exist.
 *
 * `maxWidth` is the only clamp: a picture wider than its strip is fitted
 * to the strip rather than allowed to run under its neighbour, which for
 * a strip proportional to the card only ever bites on something wider
 * than the card itself. `width: auto` with both bounds is what keeps the
 * aspect while honoring them. */
export function SidePicture({ node, strip }: { node: Node; strip: CardStrip }) {
  const stillUrl = useStillUrl(node.image ? undefined : node.still);
  const src = node.image || stillUrl;
  if (!src || !strip.edge || node.imageFit !== "side") return null;
  return (
    <img
      className="side-photo"
      style={{ height: strip.h, width: "auto", maxWidth: strip.w, maxHeight: strip.h }}
      src={src}
      alt=""
      draggable={false}
    />
  );
}

export function ImageFrame({
  node,
  className = "card-photo",
  preview,
  asCard,
}: {
  node: Node;
  className?: string;
  /* THE PANEL'S OWN PREVIEW, which has to show the picture whatever mode
   * the card is in. A Side card wears nothing on its face -- its picture
   * stands beside it -- so without this the preview came up blank on the
   * very card you opened the panel to look at. Previewed as Fit: the
   * whole frame at its own aspect, which is how it stands beside the
   * card too. */
  preview?: boolean;
  /* IMAGE-AS-CARD (owner, 2026-09-09): with the board's switch on
   * "images only", a Side card's words are gone, so the picture stops
   * standing beside the card and BECOMES it -- filling the card's own
   * box, cropped to its shape the way any full-bleed photo is. Not the
   * Fill code path and not the card's stored mode: the card still says
   * Side, and putting the switch back puts the picture back beside the
   * words. It is a rendering answer to "there are no words right now". */
  asCard?: boolean;
}) {
  /* SIDE is contained too: in its own room there is nothing to crop to,
   * and showing the whole frame at its own aspect is the point of it
   * (owner: "you'd fit the picture to the spare room at its normal
   * aspect"). Tiling stays with Fit alone -- mirrored bars inside a
   * room beside the words is a texture nobody asked for. */
  const side = node.imageFit === "side";
  const fit = node.imageFit === "fit" || (preview && side);
  const tile = node.imageFit === "fit" && !!node.imageTile;
  const box = useRef<HTMLDivElement>(null);
  /* Natural aspect, read off the loaded bitmap rather than stored: it
   * costs one frame the first time and works for every image already on
   * a card. */
  const [ar, setAr] = useState(0);
  const size = useBoxSize(box, !tile);
  /* TWO SOURCES, ONE RENDERER. `image` is a data URI pinned by hand;
   * `still` is a key into the BlobStore, grabbed from a proxy by the EDL
   * importer. They differ in lifecycle -- a still can be purged and an
   * image cannot -- and in nothing else a card face cares about, so they
   * resolve to a src here and the rest of this file never knows which it
   * got. A hand-pinned image WINS: it was put there deliberately, and a
   * re-grab should not silently paint over it.
   *
   * The hook is called unconditionally, before the early return, because
   * that is what hooks require -- and it no-ops on undefined. */
  const stillUrl = useStillUrl(node.image ? undefined : node.still);
  const src = node.image || stillUrl;

  if (!src || (side && !preview && !asCard)) return null;

  /* The plain cases are one element and no arithmetic. Fill honours the
   * crop anchor; Fit is always centered, since there is nothing to choose
   * between when the whole image is shown. */
  if (!tile) {
    return (
      <img
        className={className}
        style={fit ? { objectFit: "contain" } : { objectPosition: alignOf(node) }}
        src={src}
        alt=""
        draggable={false}
      />
    );
  }

  /* Where the contained image lands, and then the same image repeated
   * outward from it until the card is covered. */
  const { w, h } = size;
  const ready = ar > 0 && w > 0 && h > 0;
  const copies: { st: CSSProperties; k: number }[] = [];
  if (ready) {
    const wide = ar > w / h; // wider than the card -> bars top and bottom
    const iw = wide ? w : h * ar;
    const ih = wide ? w / ar : h;
    const left = (w - iw) / 2;
    const top = (h - ih) / 2;
    /* HOW MANY, rather than one either side: a card much taller than the
     * image needs the repeat to keep going. Counted from the gap each way
     * and capped, so a pathologically thin image cannot mint hundreds of
     * elements. */
    const step = wide ? ih : iw;
    const before = Math.min(TILE_CAP, Math.ceil((wide ? top : left) / step));
    const after = Math.min(TILE_CAP, Math.ceil(((wide ? h - top - ih : w - left - iw)) / step));
    for (let k = -before; k <= after; k++) {
      /* MIRRORED reflects every other copy, so each meets its neighbour
       * edge-to-edge. Unmirrored just repeats -- the same picture again,
       * which is what you want for a texture rather than a scene. */
      const flip = node.imageMirror && k % 2 !== 0;
      copies.push({
        k,
        st: {
          left: wide ? left : left + k * iw,
          top: wide ? top + k * ih : top,
          width: iw,
          height: ih,
          transform: flip ? (wide ? "scaleY(-1)" : "scaleX(-1)") : undefined,
        },
      });
    }
  }

  return (
    <div className={className + " card-photo-tiled"} ref={box}>
      {/* Measured off a hidden copy so the aspect is known even on the
          first paint, before any of the placed copies have a size. */}
      <img
        className="card-photo-probe"
        src={src}
        alt=""
        draggable={false}
        onLoad={(e) => {
          const el = e.currentTarget;
          if (el.naturalHeight > 0) setAr(el.naturalWidth / el.naturalHeight);
        }}
      />
      {copies.map(({ st, k }) => (
        <img
          key={k}
          className={k === 0 ? "card-photo-main" : "card-photo-mirror"}
          style={st}
          src={src}
          alt=""
          draggable={false}
        />
      ))}
    </div>
  );
}
