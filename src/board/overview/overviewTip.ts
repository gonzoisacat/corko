import { useSyncExternalStore } from "react";
import type { LegendEntry, LevelDef, Node } from "../../state/types";
import { resolveNodeColor, textColor } from "../../colors";
import { fontClass } from "../../fonts";
import { tierGeometry } from "./MiniCard";
import { NO_STRIP } from "../cardSizing";
import type { CardImages } from "../../state/settings";
import type { CardStrip } from "../cardSizing";
import { nestFace } from "../NestedFace";
import { cardText, plainText } from "../cardText";
import { isNested } from "../../state/nesting";
import type { NestInfo } from "../../state/nesting";

/* Hover tooltip for the Overview. Proxies live inside a scaled container, so
 * a CSS tooltip would scale down with them (unreadable). Instead proxies
 * report hover into this module store and OverviewView renders one preview
 * at screen scale (same external-store pattern as board/cardMenu.ts). The
 * preview is a detail-sized notecard -- the hovered proxy's real fill/border/
 * text color + font -- not a plain text tooltip. */

export interface TipCard {
  text: string;
  bg: string;
  border: string;
  color: string; // text color
  fontClass: string; // title font class (from fonts.ts)
  aspect: number; // tier card aspect (width / height)
  height: number; // tier card height (px), scaled up for the preview
  // useFitText cap/floor measured at the CARD's real size (like the detail
  // card): the tier's TARGET font size. The preview renders that real card
  // and CSS-scales it up, so wrapping matches 1:1.
  fitMax: number;
  fitMin: number;
  /* The strip this tier holds beside its cards, and the whole footprint
   * with it (cardSizing.ts). A band holds none. */
  strip: CardStrip;
  boxW: number;
  boxH: number;
  // the hovered TIER's own interior, so the preview is that card enlarged --
  // not always a beat card (a scene has deeper padding).
  padY: number;
  padX: number;
  gap: number;
  weight: number;
  letterSpacing: number;
  lineHeight: number | "normal";
  tags?: string[]; // applied tag ids -- the preview draws their tabs too
  /* The node itself, so the preview can draw its metadata slots. Proxies
   * deliberately don't (see ProxyNode): at proxy size a value is a letter
   * and an ellipsis. */
  slotNode?: Node;
  /* The node whose IMAGE the preview draws. Always set, and always
   * drawn -- the preview is 100-200px tall, so it is above any size gate
   * a proxy could apply, and showing the card WITHOUT its photo would
   * make the one surface whose whole job is "what does this card
   * actually look like" the one surface that lies about it.
   *
   * A separate field from `slotNode` above even though both hold the
   * same node: they are different questions, and the proxies already
   * answer them differently (slots never, image above the gate). */
  imageNode?: Node;
  /* The card's text is the TIER's, not its own (board/cardText.ts
   * `plain`): its picture is hidden by the board's images switch, or
   * sits in a corner. The preview's shadow keys on it. */
  plain?: boolean;
  /* This tier is a full-width BAND, so the preview draws a bar rather
   * than a card (title left, not centered). See BAND_PREVIEW_ASPECT. */
  fullWidth?: boolean;
}

/* A band has no intrinsic width -- in detail it fills its row, so there
 * is no "real" number to scale up. The preview therefore picks one, and
 * it only has to do one job: read as the wide bar the board shows rather
 * than as the tall card the tier's `aspect` would give. */
const BAND_PREVIEW_ASPECT = 5.5;
export interface Tip extends TipCard {
  x: number;
  y: number;
}

/* The preview for one node at one tier -- the card the Overview WOULD
 * draw at detail size. Extracted when the keyboard cursor grew a preview
 * of its own: a hover and an arrow key must produce the identical card,
 * and two copies of this would drift the first time a tier gained a
 * knob. */
export function tipCardFor(
  node: Node,
  depth: number,
  levels: LevelDef[],
  legend: LegendEntry[],
  /* The pane's board index, so a NESTING CARD previews the board it
   * stands in for rather than its own unread title. Optional because the
   * two callers reach it differently and a missing index degrades to
   * exactly the old behavior. */
  nests?: Map<string, NestInfo>,
  /* The board's images switch is OFF (settings.cardImages): the picture
   * is hidden by the pane's CSS, so the words read plain, as on the
   * detail card. */
  images: CardImages = "on",
): TipCard {
  const lvl = levels[depth];
  const c = resolveNodeColor(legend, node.color, lvl?.id ?? "", isNested(node));
  const geo = tierGeometry(levels, depth, images);
  /* A FULL-WIDTH TIER PREVIEWS AS THE BAND IT IS (owner's ask). It used
   * to preview as a normal aspect card, which looks nothing like the bar
   * on the board -- and got the type wrong twice over:
   *
   *  - the SHAPE came from the tier's `aspect`, which a band ignores
   *    entirely (LaneHeader only reads aspect when `asCard`), so a Day
   *    with height 143 previewed as a tall card instead of a wide bar;
   *  - the CAP came from `geo.fitMax`, which used to be `detailH`
   *    whenever `expandText` was on -- but a band is not
   *    height-constrained, so detail never expanded it and set the title
   *    to `textSize` flat. CLB's Day previewed with a cap of 143px
   *    against the 23px it actually rendered at. That half is MOOT since
   *    expandText retired (2026-08-14): fitMax is the tier's target size
   *    for every tier now, band or not, so only the SHAPE is overridden
   *    below.
   *
   * tierGeometry itself is deliberately NOT changed: the metadata
   * panel's card preview draws every tier as a normal card on purpose
   * (ADR 0003 / CLAUDE.md), and that is the shape slot layout is defined
   * in. This override belongs to the Overview's preview alone. */
  /* A nesting card is a CARD at every tier (see ProxyNode / flatten), so
   * it never takes the band shape below however its tier is configured. */
  const face = nests ? nestFace(node, nests) : null;
  const band = !!lvl?.fullWidth && !face;
  const bandH = lvl?.bandHeight ?? geo.detailH;
  /* THE CARD'S OWN TEXT (owner-reported 2026-09-08: "the overview hover
   * card versions of image'd cards aren't applying the font color").
   * The preview read the tier's color and size and none of the card's
   * overrides, so a photo caption written white came up in the tier's
   * ink. One resolver with the detail card (board/cardText.ts), the
   * same `plain` rule (plainText): a hidden or side picture reads plain. */
  const plain = plainText(node, images);
  const ink = cardText(node, lvl?.textColor ?? textColor(c.bg), geo.fitMax, plain);
  return {
    text: face ? face.title : node.title || lvl?.name || "",
    bg: c.bg,
    border: c.border,
    color: ink.color,
    plain,
    fontClass: fontClass(node.font ?? lvl?.defaultFont),
    aspect: band ? BAND_PREVIEW_ASPECT : geo.aspect,
    height: band ? bandH : geo.detailH,
    strip: band ? NO_STRIP : geo.strip,
    boxW: band ? Math.round(bandH * BAND_PREVIEW_ASPECT) : geo.boxW,
    boxH: band ? bandH : geo.boxH,
    fitMax: ink.size, // the tier's target size, band or card alike, or the card's own
    fitMin: geo.fitMin,
    fullWidth: band,
    padY: geo.padY,
    padX: geo.padX,
    gap: geo.gap,
    weight: geo.weight,
    letterSpacing: geo.letterSpacing,
    lineHeight: geo.lineHeight,
    tags: node.tags,
    slotNode: node,
    imageNode: node,
  };
}

let tip: Tip | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const overviewTip = {
  show(card: TipCard, x: number, y: number) {
    if (!card.text) {
      this.hide();
      return;
    }
    tip = { ...card, x, y };
    emit();
  },
  hide() {
    if (tip) {
      tip = null;
      emit();
    }
  },
};

export function useOverviewTip(): Tip | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tip,
    () => null,
  );
}
