import type { ReactNode, CSSProperties, DragEvent } from "react";
import { dragStore, itemHeight, overtops } from "./drag";
import { dropTarget } from "./dropTarget";
import { planRow, type RowPlan } from "./dropPlan";
import type { LaneAbove } from "./flatten";
import { moveDropped } from "./dropMove";
import { useBoardUI } from "./context";
import { getSnapshot } from "../state/ydoc";
import { bindDropTargetTo } from "./dropTarget";

bindDropTargetTo(dragStore.subscribe, () => dragStore.get() !== null);

/* ------------------------------------------------------------------ *
 *  The whole ROW is a drop target, and the gap it draws is the one true
 *  insertion point (board/dropTarget.ts).
 *
 *  Two complaints this answers, both owner-reported 2026-08-03:
 *
 *  - TACTILE. The zone used to sit on the band or the scene label itself,
 *    so the tier indent down the left and the vertical space between rows
 *    were dead pixels -- which, dragging a scene down a long board, is
 *    most of the surface you cross. Every pixel of a row is live now.
 *  - ONE PREVIEW PER REORDER. A row hovering its own LOWER half publishes
 *    index + 1, so the gap draws above its NEXT SIBLING -- after this
 *    row's whole subtree, where the node actually goes. Nothing ever
 *    draws between a lane and its own children, which was the wrong
 *    place a Day's "after" gap used to appear.
 *
 *  The drop reads the published target rather than recomputing from the
 *  cursor, so what you were shown is what happens -- not merely the same
 *  arithmetic run twice.
 * ------------------------------------------------------------------ */
export function RowDrop({
  depth,
  parentId,
  index,
  /* Set for a lane: the tier it can also take INSIDE it, so a scene can
   * go into an empty Day without a sibling to aim at. */
  childDepth,
  nodeId,
  above,
  style,
  children,
}: {
  depth: number;
  parentId: string | null;
  index: number;
  childDepth?: number;
  nodeId?: string;
  /* The lanes this row sits inside (flatten's LaneAbove), which is what
   * lets an unfurled section take a drop along its whole height rather
   * than only in the bottom half of its header bar. */
  above?: LaneAbove[];
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { boardId } = useBoardUI();

  /* Does this row take the dragged node at all, and as what? The rule is
   * planRow's (board/dropPlan.ts), beside the Overview's statement of the
   * same thing; this reads the drag store and measures the row. */
  const plan = (e: DragEvent): RowPlan => {
    const item = dragStore.get();
    if (!item) return { kind: "none" };
    const dst = getSnapshot().boards.find((b) => b.id === boardId);
    if (!dst) return { kind: "none" };

    const r = e.currentTarget.getBoundingClientRect();
    const sameBoard = item.boardId === boardId;
    return planRow(
      { depth, parentId, index, childDepth, nodeId, above, lower: e.clientY >= r.top + r.height / 2 },
      {
        height: itemHeight(item),
        ladder: dst.levels.length,
        overtops: overtops(item, boardId),
        isSelf: dragStore.isSelf,
        isSelfTarget: dragStore.isSelfTarget,
        isNoOp: (p, i) => dragStore.isNoOp(p, i, sameBoard),
      },
    );
  };

  /* Option-drag counts as a copy too (board/drag.ts dup). This has to
   * agree with the CATCHER's dropEffect, or the browser resets the
   * effect to "none" and never fires `drop` -- see dropCatcher. */
  const isCopy = () => {
    const item = dragStore.get();
    return (
      dragStore.dup() || Boolean(item && boardId && item.boardId && item.boardId !== boardId)
    );
  };

  /* This row no longer DRAWS the gap: the published target's preview is
   * the owning seam's job now (the row ABOVE the gap -- board/seam.ts
   * computes which addresses each seam answers for, RowSeam sets
   * drop-open, and the row's ::before draws the shelf). This row still
   * RESOLVES drops over its whole surface, which is the drag rework's
   * biggest win and is untouched. */
  return (
    <div
      className="row"
      style={style}
      onDragOver={(e) => {
        const p = plan(e);
        /* THIS row is the tier in play and has nothing to offer -- the
         * card's own origin, or somewhere inside it. Clear unconditionally:
         * a scene card's own zone calls preventDefault to keep the cursor
         * right without publishing anything, so deferring to the event
         * here is exactly wrong over the one spot that needs to go
         * neutral. This is what lets you cross your own origin and out the
         * far side instead of the preview sticking to whichever side you
         * came from. */
        if (p.kind === "neutral") {
          dropTarget.clearFrom(e);
          return;
        }
        if (p.kind === "none") {
          /* This row is not involved at all -- a Day traveling over a
           * scene's strip. A slot from two rows back must not survive the
           * trip (that is the "locks" half of the report: cross an
           * unfurled Day's scenes and the zone you had left stayed lit,
           * so you had to drag right back past it to free the preview).
           *
           * But a DESCENDANT may have published for this same event and
           * then bubbled up here -- a beat card inside a cards lane,
           * which this row plans nothing for. Clearing blindly would wipe
           * the beat's slot on its way past, so ask the event whether
           * anybody accepted, the same way Card.tsx does. */
          if (!e.defaultPrevented) dropTarget.clearFrom(e);
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = isCopy() ? "copy" : "move";
        dropTarget.set({ boardId, ...p.at, copy: isCopy() }, e);
      }}
      onDrop={(e) => {
        const item = dragStore.get();
        const t = dropTarget.get();
        if (!item || !t || t.boardId !== boardId) return;
        e.preventDefault();
        e.stopPropagation();
        /* Act on what was PREVIEWED, not on a fresh reading of the cursor.
         * The gap you can see is the promise; this keeps it. */
        moveDropped(item, t.parentId, t.index, boardId);
        dropTarget.clear();
        dragStore.end();
      }}
    >
      {children}
    </div>
  );
}
