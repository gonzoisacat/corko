import { ops } from "../state/useBoard";
import { selection } from "./selection";
import { dragStore, overtops, type DragItem } from "./drag";

/* ------------------------------------------------------------------ *
 *  Route a drop to the right op (spec Sec 4):
 *
 *  - a multi-selection travels together when the dragged card is part of
 *    it; otherwise just the dragged card moves,
 *  - a drop inside the board the drag started in is a MOVE (long-distance
 *    reorder / re-parent, including between split-view panes showing that
 *    one board),
 *  - a drop into a DIFFERENT board is a COPY -- the split view's core
 *    workflow is pulling beats out of the long master cut into section
 *    boards, which must leave the master intact.
 * ------------------------------------------------------------------ */

/* `destBoardId` is the board the drop zone belongs to (its pane's board);
 * it also names the destination for root-tier drops, where parentId is
 * null and there is no parent to infer the board from. */
export function moveDropped(
  item: DragItem,
  parentId: string | null,
  index: number,
  destBoardId?: string,
) {
  // multi-selection moves as a group; otherwise just the dragged card. Either
  // way moveNodes/copyNodes pull in each card's trailing hidden stack.
  const ids = selection.has(item.id) && selection.size() > 1 ? selection.ids() : [item.id];
  if (destBoardId && item.boardId && item.boardId !== destBoardId) {
    // a node TALLER than the whole destination ladder grows it instead
    // (owner's refinement): the board gains the tiers it lacks, ported
    // from the source, and the newcomer lands beside the wrapped roots
    if (overtops(item, destBoardId)) {
      ops.extendBoardWithNode(destBoardId, item.id);
      return;
    }
    ops.copyNodes(ids, parentId, index, destBoardId);
    return;
  }
  /* Option held: leave the originals where they are and land copies --
   * the same op the cross-board case uses, asked for deliberately rather
   * than implied by the destination (owner, 2026-08-14). */
  if (dragStore.dup()) {
    ops.copyNodes(ids, parentId, index, destBoardId ?? item.boardId);
    return;
  }
  ops.moveNodes(ids, parentId, index, destBoardId);
}
