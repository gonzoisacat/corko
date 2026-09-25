import type { CardImages } from "../state/settings";
import type { Node } from "../state/types";
import { hasPicture } from "./cardImage";

/* ------------------------------------------------------------------ *
 *  A CARD'S TEXT, resolved (owner, 2026-09-01).
 *
 *  Color, size and the drop shadow are TIER properties with a per-card
 *  override, exactly as the fill has always been: absent means "the tier
 *  decides", so a card nobody has touched carries nothing and looks as
 *  it always did.
 *
 *  IT EXISTS BECAUSE THE AUTO TREATMENT WAS A HIDDEN RULE. A card with a
 *  picture used to get white type and a drop shadow from a CSS rule
 *  nothing could see, name or switch off. Putting a picture on a card
 *  now WRITES those as ordinary overrides (board/cardImage.ts), so the
 *  card does exactly what the panel says it does -- and the CSS that
 *  used to do it invisibly is gone.
 *
 *  ONE resolver rather than six copies: the same six hosts draw a card
 *  (beat, scene label, header, column head, grid card, and MiniCard for
 *  the Overview and the previews), and this file has watched them drift
 *  over `has-image` once already. *
 * ------------------------------------------------------------------ */

export interface CardText {
  color: string;
  size: number;
  shadow: boolean;
}

/* `plain` (2026-09-08): read the tier's values and none of the card's
 * own -- for a card whose picture the board's images switch is hiding,
 * since its overrides were written FOR that picture (white type with a
 * shadow over a photo is unreadable on plain paper). */
export function cardText(node: Node, tierColor: string, tierSize: number, plain = false): CardText {
  if (plain) return { color: tierColor, size: tierSize, shadow: false };
  return {
    color: node.textColor || tierColor,
    /* `?? `, not `||`: a per-card size is a number, and 0 is not a size
     * anyone can choose (the op clamps at 6) -- but the distinction is
     * worth keeping honest at the read as well as the write. */
    size: node.textSize ?? tierSize,
    shadow: !!node.textShadow,
  };
}

/* WHEN A CARD'S WORDS GO PLAIN, and there is one statement of it
 * (2026-09-10). Two cases, and they are the same case: the picture the
 * overrides were written FOR is not under the words.
 *
 *   - the board's images switch is OFF, so there is no picture at all;
 *   - the picture stands BESIDE the card (side-by-side), so the words
 *     sit on paper.
 *
 * It lived inline in CardsLane and the metadata panel's preview grew its
 * own shorter copy, which is exactly the drift the owner reported: the
 * preview kept the drop shadow on a side card whose real card had
 * dropped it. `cardImages` is per board, `imageFit` per card.
 *
 * WHO ASKS IT (2026-09-11, after the audit found six more copies -- and
 * the Columns head with no form of it at all, white shadowed type on a
 * bare head with images off). Every host that draws a card's words, so
 * the next restatement is visible as the odd one out:
 *
 *   board/Card.tsx               the beat card
 *   board/CardsLane.tsx          the scene label (and its side picture)
 *   board/LaneHeader.tsx         the band and the header card
 *   board/grid/GridCard.tsx      the grid card
 *   board/kanban/KanbanView.tsx  the column head
 *   board/overview/ProxyNode.tsx the Overview's proxies -- PLUS its own
 *                                term, a picture below the size gate,
 *                                which is that surface's and not this
 *                                rule's
 *   board/overview/overviewTip.ts  the Overview's hover preview
 *   board/MetaPanelPopover.tsx   the metadata panel's card preview
 *
 * Pinned by cardText.test.ts.
 */
export function plainText(node: Node, cardImages: CardImages): boolean {
  return (cardImages === "off" || node.imageFit === "side") && hasPicture(node);
}

/* The attribute the shadow rule keys on. An attribute rather than a
 * class so it can sit beside `data-title-align` on the card and be read
 * by one CSS rule for every host, the way `has-image` was. */
export const shadowAttr = (node: Node, plain = false): "on" | undefined =>
  node.textShadow && !plain ? "on" : undefined;
