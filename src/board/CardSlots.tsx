import type { CSSProperties } from "react";
import type { FieldDef, Node, SlotId } from "../state/types";

/* ------------------------------------------------------------------ *
 *  A card's metadata on its face.
 *
 *  Six places (state/types.ts SlotId), as TWO ROWS OF THREE: tl | header |
 *  tr across the top, bl | footer | br across the bottom, each a third of
 *  the card's width. `header`/`footer` began as full-width bands, which
 *  sat on the same line as the corners and overlapped them whenever both
 *  were filled; they are center thirds now, and their ids are kept because
 *  they're persisted in `Node.slots`.
 *
 *  The footer is where the old hardcoded "DAY XX" ghost line used to sit,
 *  which is the point -- that line was the one thing a card could display
 *  besides its title, and it wasn't configurable, wasn't editable in
 *  place, and only existed on scenes.
 *
 *  A slot draws only when the card has a VALUE for the category in it: an
 *  empty slot is nothing, not a placeholder. (The panel's preview is where
 *  empty slots are visible, because that's where you're aiming.)
 *
 *  Sized in em so a slot scales with whatever the host card is doing --
 *  the Overview draws real detail-sized cards under a transform, so these
 *  come along for free, the way tag tabs do.
 * ------------------------------------------------------------------ */

export function CardSlots({
  node,
  fields,
  color,
}: {
  node: Node;
  fields: FieldDef[];
  color?: string; // the card's title color, so slots read on any fill
}) {
  const slots = node.slots;
  if (!slots || !fields.length) return null;
  const entries = (Object.entries(slots) as [SlotId, string][]).filter(([, id]) => id);
  if (!entries.length) return null;

  const style: CSSProperties | undefined = color ? { color } : undefined;
  const drawn = entries.map(([slot, fieldId]) => {
    const field = fields.find((f) => f.id === fieldId);
    const value = node.values?.[fieldId];
    if (!field || !value) return null;
    return (
      <span key={slot} className={"card-slot card-slot-" + slot} style={style} aria-label={field.name}>
        {field.showLabel && <span className="card-slot-label">{field.name}</span>}
        {value}
      </span>
    );
  });
  return <>{drawn}</>;
}
