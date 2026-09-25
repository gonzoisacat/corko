import type { Board } from "../state/types";
import { locateCell } from "./keyNav";
import { canShowImage } from "./cardImage";

/* ------------------------------------------------------------------ *
 *  DROPPING A PICTURE FILE ONTO A CARD, on any board type.
 *
 *  The Free Grid has had this since it shipped, and the owner asked for
 *  it everywhere (2026-08-26: "it'd be great to be able to drop an image
 *  on the board from finder"). What travels is the half that matches his
 *  own framing of what a picture IS -- "the image will need to be added
 *  to an existing node, and then it's just basically the color setting
 *  for a node". So a drop onto a CARD sets that card's picture, and the
 *  grid keeps its own extra trick of minting a card on bare cork, which
 *  needs a position only the grid has.
 *
 *  IT LIVES AT THE PANE, NOT ON EVERY CARD, and that is the whole design.
 *  A file drop carries a DataTransfer no card drag ever produces, so it
 *  needs nothing from `useDropZone`, `dropTarget` or the seam -- the
 *  machinery that draws where a CARD lands has no opinion about a JPEG
 *  and should not grow one. One listener on the panel, resolving the card
 *  under the pointer from the DOM, means the four card renderers (beat,
 *  scene label, header card, column head) are untouched and a fifth
 *  inherits this for free.
 *
 *  THE HIGHLIGHT IS A DIRECT CLASS WRITE, not React state and not an
 *  injected rule. Only ONE card can be under the pointer, so this is two
 *  DOM writes per change of target -- against a re-render of every card
 *  in an unvirtualized Overview, which is the cost `legendHighlight` and
 *  `noteMarks` exist to avoid. The simplest thing that cannot be slow.
 * ------------------------------------------------------------------ */

const CLASS = "img-drop-target";

let marked: Element | null = null;

/* Light the card a dropped picture would land on, or clear the mark. */
export function markImageTarget(el: Element | null) {
  if (el === marked) return;
  marked?.classList.remove(CLASS);
  marked = el;
  marked?.classList.add(CLASS);
}

export const clearImageTarget = () => markImageTarget(null);

/* Is this DataTransfer carrying an image? Asked during DRAGOVER, where
 * `files` is deliberately empty for security -- the browser only fills it
 * on the drop itself. So the type has to come from `items`, which is
 * present throughout the drag and carries the MIME type with no access to
 * the bytes. Reading `files` here would mean the pane never lit up and
 * never called preventDefault, so the drop would not fire at all. */
export function draggingImage(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return true;
  }
  /* Some sources describe themselves only as generic files. Accepting
   * those keeps the gesture working; `toCardImage` rejects a non-image
   * with a message, which is a better failure than a dead drop zone. */
  return Array.from(dt.types ?? []).includes("Files");
}

/* The card under the pointer that could actually WEAR a picture.
 *
 * Gated on `canShowImage` for the reason the card menu is: a full-width
 * band draws no picture, so accepting a drop on one would write bytes
 * into the shared doc that nothing renders -- the exact bug the predicate
 * was written to close, arriving through a different door. A refusal is
 * visible rather than silent, because the highlight simply does not
 * appear and the cursor keeps saying no.
 */
export function imageTargetAt(board: Board | null, el: Element | null): {
  el: Element;
  id: string;
} | null {
  if (!board) return null;
  const card = el?.closest?.("[data-node]");
  const id = card?.getAttribute("data-node");
  if (!card || !id) return null;
  const cell = locateCell(board, id);
  if (!cell || !canShowImage(board, cell.node, cell.depth)) return null;
  return { el: card, id };
}
