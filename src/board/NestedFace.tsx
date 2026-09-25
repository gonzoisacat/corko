import { Unlink } from "lucide-react";
import { TypeIcon } from "./typeIcons";
import { styleOf, styleName } from "../state/boardStyles";
import { nestTitle, type NestInfo } from "../state/nesting";
import type { Node } from "../state/types";

/* ------------------------------------------------------------------ *
 *  THE FACE OF A NESTING CARD -- one component, every renderer.
 *
 *  It is BORING ON PURPOSE (docs/explorations/board-shapes.md, DECISIONS
 *  3): the board's own name and a symbol saying what type it is, and
 *  that is all. The split view is one click away, so the card does not
 *  need to preview what it stands in for -- and a preview would be
 *  actively misleading, since the target may have a completely different
 *  STRUCTURE and so would not look like the thing it replaces.
 *
 *  The title is the TARGET'S LIVE TITLE (owner's call), not the node's
 *  own -- which is why a nesting card has no title to edit, and why
 *  double-click is free to mean "open it". The node keeps its `title`
 *  written but unread, so un-nesting hands the card its old name back.
 *  Local context goes on it the way it goes on any other card: display
 *  slots (ADR 0003), which draw here unchanged.
 *
 *  NO COUNT (owner: "I don't care about count... not important
 *  information, esp at that moment of UX"). Dropping it is also what
 *  keeps this cheap -- title and type are a shallow read off the project's
 *  board list, so nothing here walks a node.
 * ------------------------------------------------------------------ */

export interface NestFace {
  title: string;
  styleId: ReturnType<typeof styleOf>;
  typeName: string;
  missing: boolean;
}

/* What a nesting card should draw, given the pane's board index.
 *
 * A MISSING target is the interesting case and it is deliberately not an
 * error: a dangling ref is usually a board that has not SYNCED IN yet,
 * so nothing scrubs it and the card falls back to the tombstone the link
 * was made with (types.ts `boardRefTitle`). That resolves itself the
 * moment the board lands. What it survives is sync and undo; what it does
 * not survive is an export/import round trip, since importBoard mints
 * fresh board ids on purpose -- hence "Relink..." in the card menu. */
export function nestFace(node: Node, nests: Map<string, NestInfo>): NestFace | null {
  if (!node.boardRef) return null;
  const info = nests.get(node.boardRef);
  /* The name comes from `nestTitle`, shared with search -- a card must be
   * findable by the name it is labelled with. */
  const title = nestTitle(node, nests)!;
  if (!info) {
    return { title, styleId: "beatmap", typeName: "", missing: true };
  }
  return {
    title,
    styleId: styleOf(info.type),
    typeName: styleName(info.type),
    missing: false,
  };
}

/* The symbol + name, sized to sit inside whatever card box hosts it. The
 * TITLE is rendered by the host (it owns the fit -- see useFitText), so
 * this draws the mark and the host draws the words. */
export function NestMark({ face, size = 13 }: { face: NestFace; size?: number }) {
  return (
    <span
      className={"nest-mark" + (face.missing ? " missing" : "")}
      aria-hidden
      style={{ width: size, height: size }}
    >
      {face.missing ? <Unlink size={size} /> : <TypeIcon id={face.styleId} size={size} />}
    </span>
  );
}
