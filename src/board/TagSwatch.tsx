import type { TagDef } from "../state/types";
import { splitFill } from "./tagSplit";

/* ------------------------------------------------------------------ *
 *  A TAG'S CHIP, wherever a tag is listed.
 *
 *  One component because there are three lists -- the legend row, the
 *  search menu's Apply/Remove tag, and the metadata panel's Tags group --
 *  and a tag has to look the same in all of them or the swatch stops
 *  being a thing you recognize. When split tags landed, only the legend
 *  learned to draw them; the other two kept painting a flat rectangle, so
 *  the same tag had two appearances depending on which menu you were in
 *  (owner-reported 2026-08-05).
 *
 *  A swatch is a little CARD, 19x13 at the 1.45 default aspect, so the
 *  row says what these colors paint before you read a word:
 *
 *    tab   -- the card with a bookmark's swallowtail bitten out of its
 *             left edge, the same notch `shape: "ribbon"` cuts into a
 *             real tab, so the row reads as marks and not as a third set
 *             of fills;
 *    split -- the card with the split actually in it, built by the same
 *             splitFill the board uses. So it follows the project's
 *             split axis too: set the direction to diagonal and every
 *             swatch tilts with the cards.
 * ------------------------------------------------------------------ */

/* The card tone a split swatch shows its share against -- a stand-in for
 * "whatever this card's fill is", since a chip belongs to no card. Pale,
 * so the tag's own color is the thing you read. */
const SWATCH_BASE = "#efeee9";

export function TagSwatch({ tag }: { tag: TagDef }) {
  const isSplit = tag.kind === "split";
  return (
    <span
      className={
        "legend-swatch " +
        (isSplit ? "tag-swatch-split" : "tag-swatch") +
        /* an invisible tag still exists and still highlights from the
           legend -- show that in the chip rather than hiding it */
        (tag.visible ? "" : " tag-swatch-hidden")
      }
      style={isSplit ? splitFill(SWATCH_BASE, [tag.color]) : { background: tag.color }}
    />
  );
}
