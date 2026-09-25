import { useEffect, useMemo, useRef } from "react";
import type { DragEvent } from "react";
import { VList, type VListHandle } from "virtua";
import { Plus } from "lucide-react";
import type { Board } from "../state/types";
import { ops } from "../state/useBoard";
import { flattenBoard, type Row } from "./flatten";
import { LaneHeader } from "./LaneHeader";
import { Card } from "./Card";
import { CardsLane } from "./CardsLane";
import { RowDrop } from "./RowDrop";
import { dropCatcher } from "./dropCatcher";
import { dragStore, useDropZone } from "./drag";
import { selection } from "./selection";
import { fold, useFoldVersion } from "../state/fold";
import { useBoardUI } from "./context";
import { moveDropped } from "./dropMove";
import { RowSeam } from "./RowSeam";
import { headSeam, isBoardHead, seamFor } from "./seam";

/* The ONE labeled add-chip left: an EMPTY board's (flatten emits it only
 * then). With no rows there are no seams to offer the first card, and
 * its drop zone is how a cross-board drag lands in a brand-new board.
 * Every other add affordance is a promoted seam disc now. */
function AddRootRow({ count, name }: { count: number; name: string }) {
  const { boardId } = useBoardUI();
  const drop = useDropZone(0, (item) => moveDropped(item, null, count, boardId));
  return (
    <div className="row add-row" style={{ marginTop: 12 }}>
      <button
        className={"add-chip add-chip-root" + (drop.over ? " drop-into" : "")}
        onClick={() => ops.addRoot(boardId)}
        data-tip={"Add " + name.toLowerCase()}
        {...drop.props}
      >
        <Plus size={15} />
        <span className="add-chip-label">Add {name.toLowerCase()}</span>
      </button>
    </div>
  );
}

/* The vertical inserts are SEAMS now -- board/seam.ts is the arithmetic,
 * board/RowSeam.tsx the element. Each lane row mounts its seam in flow
 * directly after its head; a cards-lane row mounts its own inside the
 * scene card (CardsLane), because only the card's box knows where the
 * card ends. The measured gap pass that used to live here (runGapPass:
 * lead/trail measuring, the open-gap guard, the mouseleave catch-up, the
 * resize listener) is gone with the geometry that needed it: a seam
 * anchored below its card takes nothing from the neighbouring row. */
function RowView({ row, board, query }: { row: Row; board: Board; query: string }) {
  switch (row.kind) {
    case "lane": {
      const folded = fold.isCollapsed(row.node.id) && query.length === 0;
      const spec = seamFor(row, {
        kind: "lane",
        nodeId: row.node.id,
        parentId: row.parentId,
        index: row.index,
        depth: row.depth,
        folded,
        last: row.last,
        siblingCount: row.siblingCount,
        childCount: row.childCount,
        above: row.above,
      });
      return (
        <RowDrop
          depth={row.depth}
          parentId={row.parentId}
          index={row.index}
          childDepth={row.depth + 1}
          nodeId={row.node.id}
          above={row.above}
          style={{ paddingLeft: row.depth * 20, marginTop: row.depth === 0 ? 18 : 10 }}
        >
          {isBoardHead(row.parentId, row.index) && (
            <RowSeam
              spec={headSeam()}
              levels={board.levels}
              legend={board.legend}
              rowDepth={row.depth}
              variant="flow"
              above
            />
          )}
          <LaneHeader
            node={row.node}
            depth={row.depth}
            level={row.level}
            parentId={row.parentId}
            index={row.index}
            childName={row.childName}
            childCount={row.childCount}
            stack={row.stack}
          />
          <RowSeam
            spec={spec}
            levels={board.levels}
            legend={board.legend}
            rowDepth={row.depth}
            variant="flow"
          />
        </RowDrop>
      );
    }
    case "cards-lane": {
      const spec = seamFor(row, {
        kind: "cards-lane",
        nodeId: row.node.id,
        parentId: row.parentId,
        index: row.index,
        depth: row.depth,
        folded: false,
        last: row.last,
        siblingCount: row.siblingCount,
        above: row.above,
      });
      return (
        <RowDrop
          depth={row.depth}
          parentId={row.parentId}
          index={row.index}
          above={row.above}
          style={{ paddingLeft: row.depth * 20 }}
        >
          <CardsLane
            node={row.node}
            depth={row.depth}
            level={row.level}
            leafLevel={row.leafLevel}
            parentId={row.parentId}
            index={row.index}
            cards={row.cards}
            stack={row.stack}
            levels={board.levels}
            seam={spec}
            headSpec={isBoardHead(row.parentId, row.index) ? headSeam() : null}
          />
        </RowDrop>
      );
    }
    /* A card standing in for another board, at a tier ABOVE the leaf
     * (flatten.ts's "nested" row says why it is not a band). It takes
     * the ordinary card component at its own tier's geometry, and its
     * seam offers only after-me forms -- there is no come-inside
     * address, because a nesting card can never take a child. */
    case "nested": {
      const spec = seamFor(row, {
        kind: "nested",
        nodeId: row.node.id,
        parentId: row.parentId,
        index: row.index,
        depth: row.depth,
        folded: false,
        last: row.last,
        siblingCount: row.siblingCount,
        above: row.above,
      });
      return (
        <RowDrop
          depth={row.depth}
          parentId={row.parentId}
          index={row.index}
          above={row.above}
          style={{ paddingLeft: row.depth * 20, marginTop: row.depth === 0 ? 18 : 10 }}
        >
          {isBoardHead(row.parentId, row.index) && (
            <RowSeam
              spec={headSeam()}
              levels={board.levels}
              legend={board.legend}
              rowDepth={row.depth}
              variant="flow"
              above
            />
          )}
          <div className="nested-row">
            <Card
              card={row.node}
              depth={row.depth}
              leafLevel={row.level}
              parentId={row.parentId ?? ""}
              index={row.index}
              draggable
              stack={undefined}
              axis="y"
              tier="lane"
            />
          </div>
          <RowSeam
            spec={spec}
            levels={board.levels}
            legend={board.legend}
            rowDepth={row.depth}
            variant="flow"
          />
        </RowDrop>
      );
    }
    case "add-root":
      return <AddRootRow count={row.count} name={row.name} />;
  }
}

/* Virtualized edit view. Only on-screen rows mount, so the board stays
 * smooth at tens of thousands of cards (spec Sec 2, Sec 3). While
 * dragging, hovering near the top/bottom edge auto-scrolls so off-screen
 * targets in the windowed list can be reached -- each pane's list handles
 * its own dragover, so the auto-scroll always follows the pane under the
 * cursor.
 *
 * `focus` is the pane's scroll-to-node command ({id, n}); the counter `n`
 * makes a repeat jump to the SAME node fire again (a sibling Overview
 * pane clicking the same card twice). */
export function BoardView({
  board,
  query,
  focus,
}: {
  board: Board;
  query: string;
  focus?: { id: string; n: number } | null;
}) {
  const { matchCase, nests } = useBoardUI();
  // foldVersion isn't read in the body -- it keys the memo so local
  // fold/unfold recomputes the row list (fold.isCollapsed is stable).
  const foldVersion = useFoldVersion();
  const rows = useMemo(
    /* `matchCase` was being dropped here, so the detail view quietly
       ignored the search bar's Aa toggle while the Overview and the match
       count honoured it -- the two halves of one query disagreeing, which
       is the exact drift `nests` is being threaded to prevent. */
    () => flattenBoard(board, query, fold.isCollapsed, matchCase, nests),
    [board, query, foldVersion, matchCase, nests],
  );

  const vlist = useRef<VListHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const speed = useRef(0);
  const raf = useRef<number | undefined>(undefined);

  // Jump target from an Overview (this pane's or a sibling pane's): scroll
  // the node's row into view. Beats live inside a cards-lane row, so match
  // either the row's node or a card.
  const focusId = focus?.id ?? null;
  const focusN = focus?.n ?? 0;
  useEffect(() => {
    if (!focusId) return;
    const i = rows.findIndex(
      (r) =>
        ("node" in r && r.node.id === focusId) ||
        (r.kind === "cards-lane" && r.cards.some((c) => c.id === focusId)),
    );
    if (i >= 0) vlist.current?.scrollToIndex(i, { align: "center" });
    /* That was the VERTICAL scroll -- the virtualized list's. A beat also
     * sits inside its strip's own HORIZONTAL scroller (.beats), which the
     * list knows nothing about, so keyboard-walking into a strip that
     * runs off screen selected cards you couldn't see. Once the row is
     * mounted (virtualization -- the element may need a few frames to
     * exist), nudge the card itself into view on both axes. `nearest` so
     * this never fights the centered row scroll above, and scoped to this
     * pane's wrap -- in the split view the same board can be open twice,
     * and the OTHER pane's copy of the card must not hijack the scroll. */
    let tries = 0;
    let raf = 0;
    const nudge = () => {
      const el = wrapRef.current?.querySelector(`[data-node="${CSS.escape(focusId)}"]`);
      if (!el) {
        if (++tries < 12) raf = requestAnimationFrame(nudge);
        return;
      }
      const row = el.closest(".beat-row");
      const strip = el.closest(".beats");

      /* EVERY STRIP BUT THIS ONE WINDS BACK. A strip scrolled deep to the
       * right and then left behind keeps that offset for as long as its
       * row stays mounted, so the board holds a horizontal position
       * nothing on screen explains -- and since every other strip sits at
       * 0, it reads as a rendering fault rather than as scroll state.
       *
       * STATELESS ON PURPOSE. The first cut remembered the strip the
       * cursor was last in and reset that one, which missed the case the
       * owner hit immediately: mouse-scroll a strip while nothing is
       * selected, CLICK a card in it, then navigate away. A click doesn't
       * change `focusId` (only reveal/onOvJump do), so nothing ever
       * recorded that strip and it was never wound back. Asking "which
       * strips are scrolled that shouldn't be?" needs no history and
       * cannot miss a way in -- mouse, click, drag or key.
       *
       * `s !== strip` is the one exemption and it is load-bearing: the
       * wrapped rows of a strip share a single horizontal scroller, and
       * the cursor is a spreadsheet caret -- Down holds the COLUMN, so
       * the card below sits at the same horizontal position and winding
       * back would throw the cursor off screen. Stepping out to a scene
       * card (no strip at all) resets everything, which is right.
       *
       * Scoped to this pane's wrap, and only the mounted rows exist
       * (virtualized), so this is a handful of elements. */
      wrapRef.current?.querySelectorAll(".beats").forEach((s) => {
        if (s !== strip && s.scrollLeft !== 0) s.scrollLeft = 0;
      });

      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      /* THE FIRST CARD OF A ROW SNAPS THE STRIP FULLY LEFT, and `nearest`
       * cannot do it. The strip holds its overhang room as padding
       * CANCELLED BY AN EQUAL NEGATIVE MARGIN (see .beats), so its
       * scrollport's left edge sits further left than where the cards
       * visually begin -- out under the scene card beside it. `nearest`
       * aligns the card to exactly that edge, which parks a row's first
       * card half under its own T2 parent.
       *
       * Nothing is lost by going to 0: the first card of a row IS the
       * left end of the strip's content, so scrollLeft 0 is the only
       * position that shows it whole (and reveals its leading insert
       * slot). Rows share ONE horizontal scroller, so this holds for a
       * card after a line break exactly as for the very first one.
       *
       * The first card is the first [data-node] in the row, NOT
       * firstElementChild -- a row leads with an insert slot. */
      if (row && strip && row.querySelector("[data-node]") === el) strip.scrollLeft = 0;
    };
    raf = requestAnimationFrame(nudge);
    return () => cancelAnimationFrame(raf);
    // rows is intentionally out of the deps: a later edit shouldn't re-scroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, focusN]);

  const tick = () => {
    if (speed.current !== 0 && vlist.current) {
      vlist.current.scrollBy(speed.current);
      raf.current = requestAnimationFrame(tick);
    } else {
      raf.current = undefined;
    }
  };

  const catcher = dropCatcher(board.id);
  const onDragOver = (e: DragEvent) => {
    if (!dragStore.get()) return;
    /* Accept the drop over the WHOLE board, wherever the slot currently
     * is -- see board/dropCatcher.ts. Without this, releasing anywhere
     * that doesn't itself publish a target was silently refused by the
     * browser while the slot sat there promising otherwise. */
    catcher.onDragOver(e);
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = 72;
    const y = e.clientY;
    let dir = 0;
    if (y < rect.top + edge) dir = -Math.ceil((rect.top + edge - y) / 5);
    else if (y > rect.bottom - edge) dir = Math.ceil((y - (rect.bottom - edge)) / 5);
    speed.current = dir;
    if (dir !== 0 && raf.current === undefined) raf.current = requestAnimationFrame(tick);
  };
  const stop = () => {
    speed.current = 0;
  };

  useEffect(() => {
    const onEnd = () => (speed.current = 0);
    /* Escape-clears-selection moved to board/keyNav.ts, which yields to
     * open overlays, latched legend highlights and focused text fields.
     * The unconditional clear that lived here fired on ALL of those --
     * reverting an edit with Escape also silently dropped the selection. */
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="board-drag-wrap"
      onDragOver={onDragOver}
      onDragLeave={stop}
      onDrop={(e) => {
        stop();
        catcher.onDrop(e);
      }}
      onClick={() => selection.clear()}
    >
      {/* overscan: extra rows rendered beyond the viewport on BOTH sides.
          Stock virtua only buffers the leading edge while scrolling (trailing
          edge gets 0 until scroll settles ~150ms later), which flashed the
          bottom row blank when scrolling up; patches/virtua+0.39.3.patch makes
          overscan symmetric so both edges stay buffered mid-scroll. */}
      <VList ref={vlist} className="board-vlist" overscan={8} style={{ height: "100%" }}>
        {rows.map((row) => (
          <RowView key={row.key} row={row} board={board} query={query} />
        ))}
      </VList>
    </div>
  );
}
