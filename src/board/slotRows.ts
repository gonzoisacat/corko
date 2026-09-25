/* WHICH SLOT ROWS A CARD HAS POPULATED -- pure, for the one host that
 * cannot ask the DOM.
 *
 * The title-layout rule (index.css, "THE WORDS ENTER THE SLOT ZONE WHEN
 * IT IS EMPTY") slides a top or bottom title into the card's padding
 * only when no slot on that edge is populated. The detail cards answer
 * that with :has() on the rendered slot, because CardSlots renders a
 * slot only when its field has a value. The Overview miniature draws no
 * slots at any size (MiniCard's own decision -- illegible by
 * construction), so it has nothing for :has() to find and would slide
 * every time. It stamps this answer as `data-slot-rows` instead, and the
 * rule reads the attribute where it cannot read the slot.
 *
 * "Populated" here is the same test CardSlots makes minus the field
 * lookup: a slot naming a field, and a non-empty value under that field.
 * A slot whose field was deleted still counts as populated here and not
 * there; that is a removed category lingering on a card, rare and
 * self-healing, and not worth threading the vocabulary through every
 * proxy for. */
import type { Node, SlotId } from "../state/types";

const TOP: SlotId[] = ["tl", "header", "tr"];
const BOTTOM: SlotId[] = ["bl", "footer", "br"];

function populated(node: Pick<Node, "slots" | "values">, slots: SlotId[]): boolean {
  const s = node.slots;
  if (!s) return false;
  return slots.some((slot) => {
    const fieldId = s[slot];
    return Boolean(fieldId && node.values?.[fieldId]);
  });
}

/** "top", "bottom", "top bottom", or "" -- a space-separated token list
 *  for an attribute selector (`[data-slot-rows~="top"]`). */
export function slotRows(node: Pick<Node, "slots" | "values">): string {
  const rows: string[] = [];
  if (populated(node, TOP)) rows.push("top");
  if (populated(node, BOTTOM)) rows.push("bottom");
  return rows.join(" ");
}
