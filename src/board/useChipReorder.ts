import { useState } from "react";
import type { DragEvent } from "react";
import { legendDrag } from "./legendDrag";

/* ------------------------------------------------------------------ *
 *  Drag a legend swatch onto ANOTHER legend swatch to reorder the row.
 *
 *  Deliberately the SAME gesture that already applies a tag to a card --
 *  the chips have been draggable since ADR 0002, carrying `legendDrag`.
 *  Only the target decides what it means: drop on a card and it applies,
 *  drop on a sibling chip and it reorders. So there is no drag mode to
 *  discover, no modifier to hold, and the two can't be confused because
 *  a card and a chip are never the same pixel.
 *
 *  For TAGS the order is not cosmetic: it is the paint order of the tabs,
 *  so this is how you say which tag wins where two overlap on a card
 *  (board/TagTabs.tsx ranks by the project vocabulary).
 *
 *  The hit area is the whole chip, split down the middle -- drop on the
 *  left half to land before it, the right half to land after -- so every
 *  pixel of the row belongs to some insertion point and there is nothing
 *  to miss between them.
 * ------------------------------------------------------------------ */

export interface ChipReorder {
  /* Which chip is being hovered and on which side, so the row can draw a
   * marker in the gap the drop will land in. */
  markBefore: boolean;
  markAfter: boolean;
  props: {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

export function useChipReorder(
  kind: "tag" | "color",
  /* this chip's id -- the one a drop lands next to */
  id: string,
  /* the id AFTER this chip, so "drop on the right half" can be expressed
   * as "insert before the next one"; null when this is the last chip */
  nextId: string | null,
  onReorder: (dragId: string, beforeId: string | null) => void,
): ChipReorder {
  const [side, setSide] = useState<"before" | "after" | null>(null);

  /* Only a chip of the SAME kind reorders: a color dropped on a tag has
   * no meaning, and silently doing nothing is better than moving the
   * wrong row. A drag with no chip in flight (a card being relocated)
   * isn't ours at all. */
  const mine = () => {
    const c = legendDrag.get();
    return c && c.kind === kind && c.id !== id ? c : null;
  };

  return {
    markBefore: side === "before",
    markAfter: side === "after",
    props: {
      onDragOver: (e: DragEvent) => {
        if (!mine()) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const r = e.currentTarget.getBoundingClientRect();
        const s = e.clientX < r.left + r.width / 2 ? "before" : "after";
        setSide((prev) => (prev === s ? prev : s));
      },
      onDragLeave: (e: DragEvent) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setSide(null);
      },
      onDrop: (e: DragEvent) => {
        const c = mine();
        setSide(null);
        if (!c) return;
        e.preventDefault();
        e.stopPropagation();
        /* "after this chip" is expressed as "before the next one", and
         * before nothing = the end of the row. */
        const s = e.clientX < e.currentTarget.getBoundingClientRect().left +
          e.currentTarget.getBoundingClientRect().width / 2
            ? "before"
            : "after";
        onReorder(c.id, s === "before" ? id : nextId);
        legendDrag.end();
      },
    },
  };
}
