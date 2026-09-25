import type { ImageEdge, LevelDef } from "../state/types";
import { DEFAULT_IMAGE_ROOM, MAX_IMAGE_GAP, MAX_IMAGE_ROOM, MIN_IMAGE_ROOM } from "../state/types";
import type { CardImages } from "../state/settings";

/* Detail-view card sizing. Height is anchored per tier; the tier's aspect
 * widens/narrows the card (width = height * aspect). Level-2-and-up tiers
 * (scene + header cards) share one height so their rows stay uniform. The
 * anchors are chosen so the default aspect (1.45) reproduces the prior look
 * (~150-wide beats, ~190-wide scene/header cards). */
export const BEAT_CARD_H = 103; // leaf tier (beat)
export const LANE_CARD_H = 131; // scene + header tiers (level 2 and up)

/* ---- card interiors ----------------------------------------------- *
 * The Overview draws every tier as a REAL detail-sized card that is then
 * CSS-scaled down (overview/MiniCard.tsx), so a title wraps identically in
 * both views. That only holds while the miniature's interior matches the
 * detail card's, so the numbers the CSS uses live here and both sides read
 * them. Keep them in step with .beat / .scene-label / .lane-card in
 * index.css (each rule points back here). */
export const BEAT_PAD = 12; // .beat padding
export const SCENE_PAD = 16; // .scene-label padding
export const SCENE_GAP = 2; // .scene-label gap (title box -> footer)
export const HEAD_PAD_Y = 16; // .lane-card padding (block)
export const HEAD_PAD_X = 12; // .lane-card padding (inline)
export const HEAD_GAP = 3; // .lane-card gap
export const CARD_BORDER = 1; // every card: 1px border, box-sizing border-box

/* Overview miniature scales: one per card family, so the zoomed-out board
 * keeps the detail view's proportions. A tier with a custom height scales
 * with it (a taller card stays taller here too) instead of being pinned to
 * a fixed proxy size. */
export const BEAT_MINI = 18 / BEAT_CARD_H; // was a flat 18px beat cell
export const LANE_MINI = 36 / LANE_CARD_H; // was a flat 36px scene proxy

/* ---- THE PICTURE BESIDE THE CARD (owner, 2026-09-08/09) ---------- *
 *  A SCENE card can hang its picture beside it instead of wearing it.
 *  His shape, and every line below follows from it: "the image itself
 *  should occupy, essentially, a backgroundless, separate space. the
 *  dial is just a scaler for the entire image, which retains its aspect,
 *  and just snugs up to the side of the card."
 *
 *  SO THE CARD IS NOT TOUCHED AT ALL -- not its box, not its padding,
 *  not its pin ("the pin does not move with the picture. it stays
 *  centered on a card, and we're just appending a picture next to the
 *  card"). The picture is a SIBLING of the card, not something inside
 *  it, which is the whole difference from the first two attempts: those
 *  grew the card and padded it, which moved the pin and the slots.
 *
 *  THE STRIP is the space held beside every card at the tier, picture or
 *  no picture, so the cards stay in one column and the beat strips all
 *  start at the same place ("the bar will add a global blank space to
 *  the side of any card with no image. so the scene cards themselves
 *  will also be aligned"). It has no background; a card with no picture
 *  simply holds it empty.
 *
 *  WHY THE STRIP NEEDS NOTHING TO BE MEASURED. The dial scales the
 *  picture's HEIGHT against the card's, and the strip takes the SAME
 *  multiple of the card's WIDTH. So a tier's reserve is known from the
 *  tier alone, with no picture loaded and no shape recorded, and it
 *  stays in proportion at any card aspect. A picture wider than its
 *  strip is fitted to the strip instead, keeping its aspect -- the one
 *  clamp here, and it only ever fires for something wider than the card
 *  itself, an anamorphic frame on a squarer card.
 * ------------------------------------------------------------------- */

export interface CardStrip {
  edge: ImageEdge | null;
  w: number; // the whole strip held beside the card, GAP INCLUDED
  h: number; // how tall the picture is allowed to stand
  gap: number; // air between the picture and the card's edge
  center: boolean; // centered in the strip, or snug against the card
}

export const NO_STRIP: CardStrip = { edge: null, w: 0, h: 0, gap: 0, center: false };

/** The strip a tier holds beside its cards, measured against one card.
 *  IT IS HELD ONLY WHILE THE PICTURES ACTUALLY STAND THERE, which is the
 *  board's images switch in its "on" position and nothing else
 *  (owner-reported 2026-09-09, twice). OFF hides the pictures, so a band
 *  of reserved space with nothing in it would say the opposite of what
 *  the switch says. ONLY turns the picture INTO the card, so there is
 *  again nothing beside it to hold room for. Either way the board reads
 *  as an ordinary one and "you'd collapse the space back". Geometry
 *  only, and the switch is per browser per board, so this moves nobody
 *  else's cards. */
export function tierStrip(
  lvl: LevelDef | undefined,
  cardW: number,
  cardH: number,
  images: CardImages = "on",
): CardStrip {
  const edge = lvl?.imageEdge;
  if (images !== "on" || (edge !== "left" && edge !== "right")) return NO_STRIP;
  const scale = Math.min(MAX_IMAGE_ROOM, Math.max(MIN_IMAGE_ROOM, lvl?.imageRoom ?? DEFAULT_IMAGE_ROOM));
  /* The gap EXTENDS the strip rather than eating into it, so widening
   * the air never shrinks the picture, and every card at the tier still
   * holds the same total space. */
  const gap = Math.min(MAX_IMAGE_GAP, Math.max(0, Math.round(lvl?.imageGap ?? 0)));
  return {
    edge,
    w: Math.round(cardW * scale) + gap,
    h: Math.round(cardH * scale),
    gap,
    center: !!lvl?.imageCenter,
  };
}
