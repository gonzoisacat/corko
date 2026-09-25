import { CELL, DEFAULT_SPAN, spanOf } from "../state/gridBoard";
import { BEAT_CARD_H } from "./cardSizing";
import type { Board } from "../state/types";

/* ------------------------------------------------------------------ *
 *  THE BOARD FRAME (owner, 2026-09-04): a purely cosmetic edge around a
 *  typed board -- the metal or wood frame of a physical corkboard --
 *  with some cork between it and the nearest card, and a flat WALL
 *  outside it (a color, or a picture of the user's own). Free Grid and
 *  Columns; the Beat Map's Overview is parked until this one has been
 *  seen.
 *
 *  It changes nothing about where a card may go. The frame is drawn
 *  around the board's EXTENT -- the sheet the grid already grows when a
 *  card is dragged past its edge, the column run on Columns -- so a card
 *  dragged outside simply pushes the frame out with it. Per board, per
 *  browser (state/settings.ts), like pushpins and tilt: how the wall
 *  behind your board looks is your own affair.
 *
 *  This is the pure half: the margin rule and the smallest card.
 * ------------------------------------------------------------------ */

export type FrameStyle = "aluminum" | "wood";

/* The cork between the frame and the nearest card: "half the vertical
 * size of the smallest note card, down to a minimum limit" (his rule). */
export const MIN_FRAME_MARGIN = 24;
export const frameMargin = (smallestCardH: number): number =>
  Math.max(MIN_FRAME_MARGIN, Math.round(smallestCardH / 2));

/* The smallest card on a FREE GRID, in px: the shortest span among the
 * roots (a grid is one rung), the default span when there is none. */
export function smallestGridCardH(board: Board): number {
  let h = Infinity;
  for (const n of board.roots) h = Math.min(h, spanOf(n).h);
  return (h === Infinity ? DEFAULT_SPAN.h : h) * CELL;
}

/* On COLUMNS every card is the leaf tier's height. */
export function kanbanCardH(board: Board): number {
  const leaf = board.levels.length - 1;
  return board.levels[leaf]?.height ?? BEAT_CARD_H;
}
