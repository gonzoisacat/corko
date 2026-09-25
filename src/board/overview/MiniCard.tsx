import type { CSSProperties } from "react";
import { useFitText } from "../../ui/useFitText";
import { TagTabs } from "../TagTabs";
import { cardFill } from "../tagSplit";
import type { FieldDef, LevelDef, Node, Note, TagDef } from "../../state/types";
import { NoteDot } from "../NoteDot";
import { CardSlots } from "../CardSlots";
import {
  BEAT_CARD_H,
  BEAT_PAD,
  HEAD_GAP,
  HEAD_PAD_X,
  HEAD_PAD_Y,
  LANE_CARD_H,
  NO_STRIP,
  SCENE_GAP,
  SCENE_PAD,
  tierStrip,
} from "../cardSizing";
import type { CardStrip } from "../cardSizing";
import type { CardImages } from "../../state/settings";
import { targetFontSize } from "../../state/tierDefaults";
import { ImageFrame, SidePicture } from "../ImageFrame";
import { hasPicture } from "../cardImage";
import { slotRows } from "../slotRows";

/* ------------------------------------------------------------------ *
 *  A tier's card, drawn small.
 *
 *  Not an approximation of the detail card -- the REAL thing: the card is
 *  laid out at its true detail size (the tier's height x height*aspect,
 *  its real padding, border and reserved footer/subtitle rows), the title
 *  is fitted there with the detail card's own cap and floor, and only then
 *  is the finished card CSS-scaled into its Overview slot. So the title
 *  breaks across exactly the same words in both views, and "Fit text"
 *  means the same thing everywhere.
 *
 *  Doing it the other way round -- fitting directly in a tiny proxy box --
 *  is what made the Overview disagree with the detail view: a 36px-tall
 *  proxy searching for its own font size lands on different line breaks
 *  (and, at a few px, on rounding noise) than the card it stands for.
 *
 *  The same component backs the Overview hover preview, where the scale
 *  goes the other way (a real card scaled UP to a legible size).
 * ------------------------------------------------------------------ */

/* The detail card's geometry for the tier at `depth`, in ONE place. The
 * Overview's proxies, its hover preview and the metadata panel's card
 * preview all scale a REAL card, and they must agree on what "real" is or
 * the same title fits to a different size in each. Mirrors the detail
 * renderers themselves: Card.tsx (beats), CardsLane.tsx (scenes),
 * LaneHeader.tsx (headers). */
export const DEFAULT_ASPECT = 1.45;
export function tierGeometry(
  levels: LevelDef[],
  depth: number,
  /* The board's images switch: the strip is held only in "on" (off hides
   * the pictures, only turns them into the cards). */
  images: CardImages = "on",
  /* Whether to include the room this tier appends for its picture
   * (cardSizing.ts). The metadata panel's card preview passes false: it
   * exists to show where the six SLOTS land, and they land on the text
   * card, so appending room there would draw a bigger picture of a
   * question nobody asked. */
  withRoom = true,
): MiniCardGeometry {
  const leaf = levels.length - 1;
  const lvl = levels[depth];
  const isLeaf = depth === leaf;
  const isScene = depth === leaf - 1;
  const detailH = lvl?.height ?? (isLeaf ? BEAT_CARD_H : LANE_CARD_H);
  const aspect = lvl?.aspect ?? DEFAULT_ASPECT;
  const textW = Math.round(detailH * aspect);
  /* `detailH` and `aspect` still describe the TEXT card, unchanged, and
   * the whole card's box is stated separately -- so nothing that already
   * reads them means something different now. */
  const strip = withRoom ? tierStrip(lvl, textW, detailH, images) : NO_STRIP;
  return {
    detailH,
    aspect,
    strip,
    /* The WHOLE footprint: the card plus the strip standing beside it.
     * The card itself is `detailH` by `detailH * aspect` either way --
     * the strip is a sibling, not part of it -- but a proxy has to be
     * laid out and scaled against the pair. */
    boxW: textW + strip.w,
    boxH: Math.max(detailH, strip.h),
    padY: isLeaf ? BEAT_PAD : isScene ? SCENE_PAD : HEAD_PAD_Y,
    padX: isLeaf ? BEAT_PAD : isScene ? SCENE_PAD : HEAD_PAD_X,
    gap: isLeaf ? 0 : isScene ? SCENE_GAP : HEAD_GAP,
    // the detail card's own cap + floor, so "Fit text" means the same thing
    fitMax: lvl ? targetFontSize(lvl, isLeaf) : isLeaf ? 20 : 30,
    fitMin: 8,
    // ...and the detail title's own type
    weight: isLeaf ? 400 : isScene ? 600 : 700,
    letterSpacing: isLeaf || isScene ? 0 : lvl?.variant === "section" ? 0.2 : 0.4,
    lineHeight: isLeaf ? 1.25 : "normal",
  };
}

export interface MiniCardGeometry {
  detailH: number; // the TEXT card's real height
  aspect: number; // the TEXT card's width = detailH * aspect
  strip: CardStrip; // the strip this tier holds beside its cards, if any
  boxW: number; // the whole footprint: the card plus its strip
  boxH: number;
  padY: number; // the detail card's padding
  padX: number;
  gap: number; // the detail card's flex gap (title box -> footer/meta row)
  fitMax: number; // detail cap: expand-to-fill uses the height, else textSize
  fitMin: number;
  // the detail title's own type -- weight, tracking and line-height all change
  // where a line breaks, so a miniature that skips them fits to a different
  // size than the card it stands for
  weight: number;
  letterSpacing: number;
  lineHeight: number | "normal";
}

export function MiniCard({
  text,
  fontClassName,
  geo,
  targetH,
  bg,
  border,
  color,
  className,
  style,
  tagIds,
  tags,
  tagNodeId,
  notes,
  noteDots,
  slotNode,
  fields,
  imageNode,
  images,
  plain,
  visibleOnly,
  align,
  ...rest
}: {
  text: string;
  fontClassName: string; // fonts.ts class for the title
  geo: MiniCardGeometry;
  targetH: number; // rendered height in the Overview (or the hover preview)
  bg: string;
  border: string;
  color: string;
  className?: string;
  style?: CSSProperties;
  tagIds?: string[]; // applied tags -- drawn at detail size, scaled with the card
  tags?: TagDef[];
  tagNodeId?: string;
  notes?: Note[]; // drawn at detail size like the tabs, so it scales with the card
  noteDots?: boolean;
  slotNode?: Node; // the node whose display slots to draw (same detail-size trick)
  fields?: FieldDef[];
  /* The words read PLAIN (board/cardText.ts): the caller resolved the
   * card's color and size that way and this drops the shadow to match
   * -- the picture is hidden, cornered, or not drawn at this size. */
  plain?: boolean;
  images?: CardImages; // the board's switch, for the image-as-card stand-in
  /* The node whose IMAGE to draw, and the caller's way of saying "this
   * one is big enough on screen to be worth a picture". A proxy passes
   * it only above the size gate (ProxyNode's OV_IMAGE_MIN); the hover
   * preview always does, being 100-200px tall.
   *
   * It is deliberately a separate field from `slotNode` even though both
   * are always the same node: they answer different questions, and they
   * already diverge in one direction -- a proxy draws no slots at any
   * size (illegible by construction) but does draw a photo once it is
   * large enough. One field would make that inexpressible.
   *
   * Nothing here scales the picture down: the card is laid out at its
   * REAL detail size and the whole thing is CSS-scaled, so the image
   * arrives with its fit mode, mirror and crop anchor already correct --
   * the same free ride the tag tabs and the note dot take. */
  imageNode?: Node;
  visibleOnly?: boolean; // queue the fit (unvirtualized Overview leaves)
  /* Cards center their title; a full-width BAND left-aligns it, so the
   * band preview has to as well or it reads as a wide card rather than
   * as the bar it stands for. */
  align?: "center" | "start";
} & React.HTMLAttributes<HTMLDivElement>) {
  const detailW = Math.round(geo.detailH * geo.aspect); // the CARD; the strip is beside it
  const k = targetH / geo.boxH; // the whole miniature is this one scale
  const fit = useFitText(text, geo.fitMax, geo.fitMin, {
    visibleOnly,
    fontKey: fontClassName,
    layoutKey: `${slotNode?.titleAlign ?? imageNode?.titleAlign ?? ""}|${imageNode?.imageFit ?? ""}`,
  });

  return (
    <div
      className={"ov-mini" + (className ? " " + className : "")}
      style={{ width: Math.round(geo.boxW * k), height: Math.round(targetH), ...style }}
      {...rest}
    >
      {/* The strip stands beside the miniature exactly as it does beside
          the real card, under the same one scale. */}
      {geo.strip.edge && (
        <span
          className="ov-mini-strip"
          data-edge={geo.strip.edge}
          data-center={geo.strip.center ? "on" : undefined}
          /* PLACED, not flowed (owner-reported 2026-09-10: "they're both
             left weighted in a box meant to hold both of them"). The
             card is absolutely positioned at the host's origin -- it has
             to be, it is a real card under a scale transform -- so a
             strip in normal flow started at the same left edge and the
             two sat on top of each other inside a box wide enough for
             both. Both are placed now, and centered on the host's height
             the way `.scene-host` centers them in the detail view. */
          style={{
            position: "absolute",
            left: geo.strip.edge === "left" ? 0 : Math.round(detailW * k),
            top: Math.round(((geo.boxH - geo.strip.h) / 2) * k),
            width: geo.strip.w * k,
            height: geo.strip.h * k,
            [geo.strip.edge === "left" ? "paddingRight" : "paddingLeft"]: geo.strip.gap * k,
          }}
        >
          {imageNode && <SidePicture node={imageNode} strip={{ ...geo.strip, w: geo.strip.w * k, h: geo.strip.h * k }} />}
        </span>
      )}
      <div
        /* hasPicture, NOT `imageNode.image` -- a grabbed STILL is a
           picture too, and the narrow test left one wearing the plain
           dark title instead of the white-on-shadow treatment. Exactly
           the drift cardImage.ts's helper exists to stop; this was the
           seventh host and the one it had not reached. */
        /* NOT for a side card: `has-image` is what the "images only" rule
           hides a title by, and a side card's title sits on paper beside
           its picture rather than over it. */
        className={
          "ov-mini-card" +
          (imageNode && hasPicture(imageNode) && (images === "only" || imageNode.imageFit !== "side")
            ? " has-image"
            : "")
        }
        /* The per-card text overrides ride along, so a miniature reads
           the way its card does -- the same free ride tag tabs take. */
        data-title-align={slotNode?.titleAlign ?? imageNode?.titleAlign}
        /* Which slot rows hold a value, for the title's slide into the
           empty slot zone (index.css "THE WORDS ENTER THE SLOT ZONE"):
           a proxy draws no slots, so the rule cannot ask :has() here
           and reads this instead (board/slotRows.ts). */
        data-slot-rows={slotNode ? slotRows(slotNode) || undefined : undefined}
        data-text-shadow={
          // a Corner thumbnail leaves the words plain (owner, 2026-09-08), and
          // so does a hidden picture -- the caller's `plain` says which
          !plain && (slotNode?.textShadow || imageNode?.textShadow) ? "on" : undefined
        }
        style={{
          /* the strip's opposite number: after it on a left strip, at the
             origin on a right one, and centered on the host's height */
          left: geo.strip.edge === "left" ? Math.round(geo.strip.w * k) : 0,
          top: Math.round(((geo.boxH - geo.detailH) / 2) * k),
          width: detailW,
          height: geo.detailH,
          padding: `${geo.padY}px ${geo.padX}px`,
          // the slide's reach: this card's vertical padding less 3px of edge
          "--slot-slide": `${Math.max(0, geo.padY - 3)}px`,
          gap: geo.gap,
          ...cardFill(bg, tagIds, tags),
          borderColor: border,
          color,
          transform: `scale(${k})`,
        } as CSSProperties}
      >
        {/* First child, so the tabs, the note dot and the title all paint
            over it -- the same DOM-order rule the detail card relies on. */}
        {imageNode && <ImageFrame node={imageNode} asCard={images === "only" && imageNode.imageFit === "side"} />}
        <TagTabs ids={tagIds} tags={tags ?? []} nodeId={tagNodeId} w={detailW} h={geo.detailH} />
        <NoteDot notes={notes} on={Boolean(noteDots)} nodeId={tagNodeId} hostScale={k} />
        {slotNode && <CardSlots node={slotNode} fields={fields ?? []} color={color} />}
        <div
          className={"ov-mini-fit" + fontClassName}
          ref={fit.ref}
          style={align === "start" ? { justifyContent: "flex-start" } : undefined}
        >
          <span
            style={{
              lineHeight: geo.lineHeight,
              fontWeight: geo.weight,
              letterSpacing: geo.letterSpacing || undefined,
            }}
          >
            {text}
          </span>
        </div>
      </div>
    </div>
  );
}
