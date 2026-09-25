import { memo } from "react";
import { useBoardUI } from "../context";
import type { CSSProperties, PointerEvent as RPointerEvent } from "react";
import { CELL, type GridCard } from "../../state/gridBoard";
import { pinColor } from "../tilt";
import { useGridOffset, useGridSpan } from "./gridDrag";

/* ------------------------------------------------------------------ *
 *  THE PINS, AS THEIR OWN LAYER ABOVE THE YARN.
 *
 *  They used to live inside the card, which is where every other pushpin
 *  in the app lives (`.beat::before`). That could not survive the
 *  owner's layering (2026-08-26): he wants the string over the cards --
 *  including a card being DRAGGED -- but the pin heads over the string,
 *  so a string reads as tied UNDER its pin.
 *
 *  A card cannot deliver that from the inside. `.grid-card` has a
 *  z-index and is therefore a stacking context, so nothing inside it can
 *  paint above something the card itself sits below -- the same trap
 *  this repo has recorded three times for tooltips and drop markers. And
 *  the card MUST keep its stacking context: its tag tabs (z 7) and note
 *  dots (5) would otherwise escape and paint over neighbouring cards.
 *
 *  So the pin moves out. That is the structurally honest place for it
 *  anyway -- a pin is the yarn's ANCHOR, and `pinOf`/`PIN_INSET` already
 *  live in gridBoard.ts beside the string maths rather than with the
 *  card. Two things fall out for free: the pin now takes the pointer
 *  BEFORE the yarn's hit band (it is above it), so a string crossing a
 *  pin can no longer steal the grab; and there is still exactly ONE pin
 *  element, so the dot's design is not duplicated.
 * ------------------------------------------------------------------ */

/* One pin. Its own component so it can subscribe to the live drag offset
 * -- a pinned card drags its pin with it, and the doc is not written
 * until the gesture ends (gridDrag.ts). */
const Pin = memo(function Pin({
  card,
  random,
  onYarnStart,
}: {
  card: GridCard;
  random: boolean;
  onYarnStart: (e: RPointerEvent, id: string) => void;
}) {
  const { slot } = useBoardUI();
  const drag = useGridOffset(card.node.id, slot);
  /* The pin sits at the card's top CENTRE, so a resize moves it -- read
   * the live span for the same reason the card does. */
  const live = useGridSpan(card.node.id, slot);
  const span = live ?? card.span;
  const cx = (card.cell.x + span.w / 2) * CELL;
  const cy = card.cell.y * CELL;
  return (
    <button
      className="grid-pin"
      aria-label="Pull a string from this card"
      data-tip="Drag to string yarn"
      style={
        {
          left: cx,
          top: cy,
          /* The look's own pin rule: a random hue per card, or the one
             color the board is set to -- published as `--pin-color`,
             the variable every other pushpin in the app reads. */
          ...(random ? { "--pin-color": pinColor(card.node.id) } : {}),
          ...(drag
            ? { transform: `translate(calc(-50% + ${drag.x * CELL}px), ${drag.y * CELL}px)` }
            : {}),
        } as CSSProperties
      }
      onPointerDown={(e) => {
        e.stopPropagation(); // not a card move
        onYarnStart(e, card.node.id);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
});

export function Pins({
  cards,
  random,
  onYarnStart,
}: {
  cards: GridCard[];
  random: boolean;
  onYarnStart: (e: RPointerEvent, id: string) => void;
}) {
  return (
    <div className="grid-pins">
      {cards.map((c) => (
        <Pin key={c.node.id} card={c} random={random} onYarnStart={onYarnStart} />
      ))}
    </div>
  );
}
