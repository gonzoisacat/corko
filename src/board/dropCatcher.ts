import type { DragEvent } from "react";
import { dragStore } from "./drag";
import { dropTarget } from "./dropTarget";
import { moveDropped } from "./dropMove";

/* ------------------------------------------------------------------ *
 *  RELEASING ANYWHERE LANDS IT WHERE THE PREVIEW SAYS.
 *
 *  The slot appearing is a promise: let go and it goes there. It wasn't
 *  being kept (owner-reported 2026-08-03) -- in detail you had to release
 *  inside a fairly narrow band, and in the Overview releasing did nothing
 *  at all.
 *
 *  The cause is a rule of HTML5 drag-and-drop rather than a slip in the
 *  arithmetic: an element only receives `drop` if its OWN `dragover`
 *  called preventDefault. So every pixel that doesn't itself publish a
 *  target also refuses the drop -- the strip's padding, the gaps between
 *  rows, a card's inner text, the Overview's column boxes. The preview
 *  stayed up while the browser quietly declined, which is the worst
 *  possible combination: it looks like it will work.
 *
 *  So the CONTAINER catches instead. While any target is published it
 *  accepts the drop over its whole area and acts on that target -- not on
 *  a fresh reading of the cursor, which is the same promise kept once
 *  more. The per-element handlers stay, but only to PUBLISH: they decide
 *  where the slot goes, and this decides that letting go honours it.
 * ------------------------------------------------------------------ */
export function dropCatcher(boardId: string) {
  return {
    onDragOver: (e: DragEvent) => {
      const t = dropTarget.get();
      if (!t || t.boardId !== boardId || !dragStore.get()) return;
      /* Accept over the whole container. Not stopPropagation -- the
       * per-element zones below still need their own dragover to move the
       * slot as the cursor travels. */
      e.preventDefault();
      /* THE MODIFIER MUST WIN HERE. macOS puts the drag session in copy
       * mode while Option is held; answering "move" is an effect the
       * session does not permit, so Chrome resets it to "none" and the
       * drop NEVER FIRES -- the slot sits there looking open and letting
       * go does nothing (owner-reported 2026-08-14). Same shape as the
       * legend chip's effectAllowed bug, one layer down. */
      e.dataTransfer.dropEffect = t.copy || dragStore.dup() ? "copy" : "move";
    },
    onDrop: (e: DragEvent) => {
      const item = dragStore.get();
      const t = dropTarget.get();
      if (!item || !t || t.boardId !== boardId) return;
      e.preventDefault();
      moveDropped(item, t.parentId, t.index, boardId);
      dropTarget.clear();
      dragStore.end();
    },
  };
}
