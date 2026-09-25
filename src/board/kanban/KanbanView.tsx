import { memo, useLayoutEffect, useRef, useState } from "react";
import { isNested } from "../../state/nesting";
import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import type { Board, LevelDef, Node } from "../../state/types";
import { ops, useLegend, useTags } from "../../state/useBoard";
import { TagTabs, useBoxSize } from "../TagTabs";
import { resolveNodeColor, resolveNodeColorId, resolveNodeEntry, textColor } from "../../colors";
import { hit } from "../../state/counts";
import { matchesSearch, showsWholeSubtree } from "../flatten";
import { clampZoomFactor, useWheelZoom } from "../useWheelZoom";

import { searchTitle } from "../../state/nesting";
import { useBoardUI } from "../context";
import { Card } from "../Card";
import { Editable } from "../../ui/Editable";
import { dragStore, liftDragImage, useDropZone } from "../drag";
import { moveDropped } from "../dropMove";
import { dropCatcher } from "../dropCatcher";
import { dropTarget, useIsDropAt } from "../dropTarget";
import { addCard, editCard, openNew, useAutoEdit } from "../autoEdit";
import { cardMenu } from "../cardMenu";
import { select, useIsSelected } from "../selection";
import { BEAT_CARD_H } from "../cardSizing";
import { BoardFrame, useWall } from "../BoardFrame";
import { frameMargin, kanbanCardH } from "../frame";
import { targetFontSize } from "../../state/tierDefaults";
import { fontClass } from "../../fonts";
import { collectColumns } from "../overview/overviewLayout";
import { hasPicture } from "../cardImage";
import { ImageFrame } from "../ImageFrame";
import { cardText, plainText, shadowAttr } from "../cardText";

/* ------------------------------------------------------------------ *
 *  THE KANBAN BOARD TYPE (owner, 2026-08-15) -- the cut board's
 *  renderer TRANSPOSED. Lanes stand side by side as columns and their
 *  cards stack downward, where a cut board stacks its lanes down the
 *  page and runs its cards across.
 *
 *  IT IS THE SAME DATA. Board > Column > Card is a two-rung ladder the
 *  model already expresses (the roots ARE the columns), so nothing about
 *  the doc, the ops, drag, tags, notes, metadata or selection is
 *  special-cased here -- this file is a layout and nothing else. That is
 *  the whole point of board TYPES over per-tier layout switches: a new
 *  shape costs a renderer and no migration (see the DECISIONS section of
 *  docs/explorations/board-shapes.md).
 *
 *  NOT VIRTUALIZED, BY DESIGN AND NOT BY OMISSION. This type is for the
 *  shape of a thing -- five acts and their sections -- with the weight
 *  living in the boards nested off it. A cut board's scale is what
 *  `flatten` + virtua exist for, and `flatten` is deliberately untouched
 *  by any of this. If someone does pour thousands of cards in here it
 *  will be slow, and the known fix is the Overview's machinery (a shared
 *  IntersectionObserver plus a per-frame budget), not virtualizing a
 *  horizontal band.
 *
 *  DRAG USES THE SHARED MACHINERY, deliberately, so there is no second
 *  idiom to learn or to drift: a card PUBLISHES where it would land
 *  (board/dropTarget.ts), a slot between cards DRAWS that, and the
 *  surface's dropCatcher means releasing anywhere honours the preview.
 *  `Card` needed exactly one new thing for this -- `axis="y"`, since
 *  "before me" is above me in a column and to my left in a strip.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  THIS TYPE'S "OVERVIEW" IS ITS OWN LAYOUT, FIT TO THE SCREEN (owner,
 *  2026-08-15, after seeing the generic one: "the detail renders poorly
 *  ... maybe Kanban's distinction is just that. Detail lets you set
 *  whatever sizes you want for the cards, but then the overview is
 *  fitting it all on one screen").
 *
 *  The generic Overview is built for the CUT board -- it collects
 *  columns at a chosen tier, draws spines for the ancestors above them
 *  and cheap proxies below. Pointed at a two-rung kanban board it drew
 *  the column heads at their full card geometry beside tiny cells: not
 *  wrong exactly, just a picture of a different board.
 *
 *  So a type gets to answer "show me all of it" in its own terms, and
 *  for this one the honest answer is the board it already is, resized.
 *  Same renderer, one transform -- which also means drag, the card menu
 *  and the keyboard keep working here with nothing added.
 *
 *  IT EXPANDS AS WELL AS SHRINKS (owner, 2026-08-15, choosing between
 *  the two readings of "fit": "it blows everything up if it's smaller.
 *  it's just always as full as it can be ... essentially expand to
 *  fill"). So this is not a zoom you set, it is a STATE the mode is
 *  always in -- the board at whatever scale makes it exactly fill the
 *  pane. A first cut capped it at 1, which made a small board's
 *  Overview identical to its Detail and the toggle read as dead.
 *
 *  Still CONTAIN and never cover: the tighter of the two axes wins, so
 *  everything stays visible. Cropping would contradict the word
 *  Overview.
 * ------------------------------------------------------------------ */
/* FIXED, ZOOMED. Fit decides the scale for you; this is the same
 * transform with the number under your control (owner, 2026-08-24) --
 * the pane bar's slider, in the slot Furl/Unfurl used to sit in, since
 * folding means nothing on this type.
 *
 * The wrapper is only mounted when the zoom is NOT 1, so the ordinary
 * Fixed view is byte-identical to what it was: a transform makes a
 * containing block and scales every hairline inside it (the Overview's
 * own selection-ring trap), and none of that is worth paying for at
 * 100%.
 *
 * The SIZER is what keeps the scrollbars honest -- a transform does not
 * change layout size, so without a box scaled to match, zooming in would
 * clip instead of scroll. Straight out of the Overview (.ov-sizer). */
/* COLUMNS IS ONE SURFACE WITH A ZOOM LEVEL, like the grid (owner,
 * 2026-09-04: "apply the same logic to columns... no two views"): a
 * factor over the fit, 1.0x the whole board, always through the scaled
 * wrapper. The unscaled 100% path and the Fit view went with it. */
export function KanbanZoom({
  board,
  hasKeyboard,
  zoom,
  onZoom,
}: {
  board: Board;
  hasKeyboard: boolean;
  zoom: number;
  onZoom: (z: number) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useWheelZoom(viewport, zoom, onZoom, clampZoomFactor);
  const wall = useWall(board.id); // the frame and the wall, as the grid has them
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [fit, setFit] = useState(1);

  useLayoutEffect(() => {
    const ct = content.current;
    const vp = viewport.current;
    if (!ct || !vp) return;
    // offsetWidth/Height ignore the transform, so this stays clean
    // however far it is already scaled
    const measure = () => {
      const w = ct.offsetWidth;
      const h = ct.offsetHeight;
      setNatural({ w, h });
      if (w > 0 && h > 0) {
        /* NEVER ABOVE 1:1 (owner, 2026-09-04): a board smaller than the
         * pane sits at the sizes Options gave its cards, not blown up to
         * fill. So 1.0x is the whole board at natural size or smaller,
         * and the factor scales up from there. */
        const k = Math.min(1, (vp.clientWidth - 8) / w, (vp.clientHeight - 8) / h);
        setFit(k > 0 ? k : 1);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ct);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [board]);
  const scale = fit * zoom;

  return (
    <div className="kanban-zoom" ref={viewport} {...wall}>
      <div className="kanban-zoom-sizer" style={{ width: natural.w * scale, height: natural.h * scale }}>
        <div
          className="kanban-fit-inner"
          ref={content}
          style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <BoardFrame boardId={board.id} margin={frameMargin(kanbanCardH(board))}>
            <KanbanView board={board} hasKeyboard={hasKeyboard} fitted />
          </BoardFrame>
        </div>
      </div>
    </div>
  );
}

export function KanbanView({
  board,
  hasKeyboard,
  fitted,
  onZoom,
}: {
  board: Board;
  hasKeyboard: boolean;
  /* Only the UNSCALED view gets this -- see KanbanZoom. */
  onZoom?: (z: number) => void;
  /* laid out for KanbanOverview's scaler: content-sized instead of
     filling and scrolling its pane, so it can be measured and shrunk */
  fitted?: boolean;
}) {
  const { boardId, query, matchCase, nests } = useBoardUI();
  const surface = useRef<HTMLDivElement>(null);
  /* Only when this IS the scroller (see GridView / useWheelZoom). */
  useWheelZoom(surface, 1, onZoom ?? null, clampZoomFactor);
  const leaf = board.levels.length - 1;
  /* Columns are the LEAF-PARENT tier, which on the two-rung ladder this
   * type ships is the roots. Read generically so a board someone has
   * added a parent tier to still draws its columns (the ancestors go
   * unshown -- the Overview solves that with spines, and this type would
   * want the same if it ever earns it). */
  const colDepth = Math.max(0, leaf - 1);
  const colLevel = board.levels[colDepth];
  const cardLevel = board.levels[leaf];
  const columns = collectColumns(board.roots, colDepth).filter(
    (c) => !query || matchesSearch(c.node, colDepth, leaf, query, matchCase, nests),
  );

  /* THE COLUMN'S OWN GEOMETRY, computed once here rather than per column:
   * the head's height is also what centers the gap discs between columns,
   * so it is published to the CSS as `--head-h`. */
  const headH = colLevel?.height ?? 44;
  const cardH = cardLevel?.height ?? BEAT_CARD_H;
  const cardW = Math.round(cardH * (cardLevel?.aspect ?? 1.45));
  const colW = Math.max(Math.round(headH * (colLevel?.aspect ?? 3.7)), cardW + 12);

  /* The COLUMN tier's default fill, for the discs that add a column --
   * the strip's rule (you aim by tier identity, never by a neighbouring
   * card's own color, which is individually set). */
  const legend = useLegend(boardId);
  const colEntry = colLevel ? resolveNodeEntry(legend, undefined, colLevel.id) : undefined;
  const colFill = colEntry ? { bg: colEntry.bg, border: colEntry.border } : undefined;

  /* Insert a column AT a gap. On the ordinary two-rung board a column is
   * a root; if the ladder was deepened it joins whichever container the
   * neighbouring column belongs to, which needs no guess about where a
   * new column ought to live. Opens straight into edit, like every other
   * add in the app. */
  const addColumnAt = (parentId: string | null, index: number) => () =>
    openNew(parentId === null ? ops.addRootAt(board.id, index) : ops.addChildAt(parentId, index));

  // where the trailing gap appends: after the last column in the DOC
  const lastCol = columns[columns.length - 1];
  const tailParent = lastCol?.parentId ?? null;
  const tailIndex = tailParent === null ? board.roots.length : lastCol.index + 1;

  return (
    <div
      ref={surface}
      className={"kanban" + (fitted ? " kanban-fitted" : "")}
      /* the surface keyNav measures for its spatial arrows -- marked only
         while this panel holds the keyboard, so two kanban panes side by
         side can't be confused (OverviewView marks its viewport the same
         way, and keyNav's selector takes either) */
      data-kbd={hasKeyboard ? "on" : undefined}
      style={{ "--head-h": `${headH}px`, "--col-w": `${colW}px` } as CSSProperties}
      {...dropCatcher(board.id)}
    >
      {columns.map(({ node, parentId, index }) =>
        /* A COLUMNLESS CARD (owner-reported 2026-08-24: dragging a
           nesting card into the gap between two columns "creates a new
           column and the card disappears"). It did exactly that -- the
           drop is legal, a root on this type IS a column, so the card
           was drawn as a column head whose title is the node's own,
           which a nesting card deliberately leaves unread. A blank
           column, and the card nowhere.

           A nesting card can never take children, so a column is a
           promise it cannot keep -- the same argument that makes it a
           card rather than a BAND on a Beat Map (flatten.ts's "nested"
           row). It draws at the CARD tier's geometry, not the column
           tier's: on this type the column tier describes a HEADER, and
           the only card shape there is is the leaf's. */
        isNested(node) ? (
          <span className="kanban-loose" key={node.id}>
            <ColumnSlot
              boardId={boardId}
              parentId={parentId}
              index={index}
              colName={colLevel?.name ?? "column"}
              fill={colFill}
              onAdd={query ? undefined : addColumnAt(parentId, index)}
            />
            <Card
              card={node}
              depth={colDepth}
              leafLevel={cardLevel}
              parentId={parentId ?? ""}
              index={index}
              draggable={!query}
              axis="x"
              tier="leaf"
            />
          </span>
        ) : (
          <KanbanColumn
            key={node.id}
            node={node}
            parentId={parentId}
            index={index}
            depth={colDepth}
            leafDepth={leaf}
            level={colLevel}
            leafLevel={cardLevel}
            boardId={boardId}
            headH={headH}
            colW={colW}
            colFill={colFill}
            addHere={addColumnAt(parentId, index)}
          />
        ),
      )}
      {/* The TRAILING gap: draws a column dragged past the last one, and
          its + appends. That is the old labelled "+ Column" button's whole
          job, so the button is gone -- exactly how the strip's add-beat
          chip retired into its trailing slot. */}
      <ColumnSlot
        boardId={boardId}
        parentId={tailParent}
        index={tailIndex}
        colName={colLevel?.name ?? "column"}
        onAdd={query ? undefined : addColumnAt(tailParent, tailIndex)}
      />
      {/* ...with the empty board keeping a standing, labelled one: with no
          columns there are no gaps to hover, the same exception AddRootRow
          and the empty strip's lone disc carry. */}
      {columns.length === 0 && !query && (
        <button className="kanban-add-col" onClick={addColumnAt(null, 0)}>
          <Plus size={14} /> {colLevel?.name ?? "Column"}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  A column: a colored head, then its cards stacked under it.
 * ------------------------------------------------------------------ */

const KanbanColumn = memo(function KanbanColumn({
  node,
  parentId,
  index,
  depth,
  leafDepth,
  level,
  leafLevel,
  boardId,
  headH,
  colW,
  colFill,
  addHere,
}: {
  node: Node;
  parentId: string | null;
  index: number;
  depth: number;
  leafDepth: number;
  level: LevelDef;
  leafLevel: LevelDef;
  boardId: string;
  headH: number;
  colW: number;
  colFill?: { bg: string; border: string };
  /* insert a column in the gap BEFORE this one */
  addHere: () => void;
}) {
  const { query, matchCase, nests, settings } = useBoardUI();
  const { cardImages } = settings;
  const legend = useLegend(boardId);
  const fill = resolveNodeColor(legend, node.color, level.id);
  const colorId = resolveNodeColorId(legend, node.color, level.id); // legend hover
  /* the CARD tier's default fill for the add-card disc -- the tier it
   * adds, never a neighbouring card's own color (the strip's rule) */
  const leafEntry = resolveNodeEntry(legend, undefined, leafLevel.id);
  const leafFill = leafEntry ? { bg: leafEntry.bg, border: leafEntry.border } : undefined;
  const tierTxt = level.textColor ?? textColor(fill.bg);
  /* PLAIN WORDS by the one rule (board/cardText.ts plainText): with the
   * board's images switch off, the overrides written for type over a
   * photo no longer apply. The head had no form of this until 2026-09-11
   * and showed white shadowed type on a bare head. */
  const plain = plainText(node, cardImages);
  const ink = cardText(node, tierTxt, targetFontSize(level, false), plain);
  const txt = ink.color;
  const selected = useIsSelected(node.id);
  const autoEdit = useAutoEdit(node.id);
  /* Tag tabs on the HEAD. The head has been a tag/color DROP TARGET
   * since it was built (the useDropZone below carries node.id), but it
   * never RENDERED the tabs -- so a tag applied here landed in the doc
   * and drew nothing, which reads as "tags don't apply to column
   * headers" (owner-reported 2026-08-29). Measured like a band's
   * (LaneHeader): the head's width is the column's, not a card
   * geometry the tabs could derive. */
  const tags = useTags();
  const headRef = useRef<HTMLElement>(null);
  const headBox = useBoxSize(headRef, !node.tags?.length);

  /* flatten's own search rule, imported rather than restated: a column
   * that matched by NAME shows all of its cards, because you asked for
   * that column and a column IS its cards. */
  const whole = !query || showsWholeSubtree(node, query, matchCase, nests);
  const cards = whole
    ? node.children
    : node.children.filter((c) => hit(searchTitle(c, nests), query, matchCase));

  /* headH / colW come from KanbanView: the column tier's own geometry
   * drives them (owner-reported 2026-08-15, the tier controls "have no
   * effect" here), and the head's height also centers the discs in the
   * gaps between columns, so one computation serves both. */

  /* The head reorders columns: same shape as Card's own zone, one tier
   * up and on the other axis. It is also the tag/color drop target for
   * the column itself. */
  const drop = useDropZone(
    depth,
    (item, side) => {
      const to = side === "after" ? index + 1 : index;
      if (dragStore.isNoOp(parentId, to, item.boardId === boardId)) return;
      moveDropped(item, parentId, to, boardId);
    },
    "x",
    node.id,
  );

  /* Below the last card: publishes "append to this column". It is a
   * SEPARATE element rather than a zone wrapping the cards, because a
   * wrapper's dragover fires on the way up from every card inside it and
   * would overwrite the precise index the card had just published with
   * an append -- the last write wins, so every drop would land at the
   * end. A sibling below them cannot collide. */
  const tail = useDropZone(leafDepth, (item) => {
    /* only reached when nothing published -- dropCatcher owns the drop
     * whenever a target is showing (see useDropZone's onDrop) */
    moveDropped(item, node.id, node.children.length, boardId);
  });

  return (
    <>
      <ColumnSlot
        boardId={boardId}
        parentId={parentId}
        index={index}
        colName={level.name}
        fill={colFill}
        onAdd={query ? undefined : addHere}
      />
      <section className="kanban-col" style={{ width: colW + 12 } as CSSProperties}>
        {/* `data-node` and `data-color` live on the HEAD, not on the
            column, and that is load-bearing rather than tidy. A column's
            box CONTAINS its own cards, so a keyboard walk measuring it
            (spatialNav reads every [data-node] box in the surface) finds
            a container overlapping its own children -- Left from a card
            landed on the neighbouring column's whole body instead of on
            the card beside it. The Overview learned the same thing: its
            data-node hangs on the thin band, never on the .ov-block that
            holds a lane together. The head is also what the column's
            COLOR paints, which is what data-color has to name. */}
        <header
          ref={headRef}
          data-node={node.id}
          data-color={colorId}
          data-title-align={node.titleAlign}
          data-text-shadow={shadowAttr(node, plain)}
          className={
            "kanban-col-head" +
            (cardImages !== "off" && hasPicture(node) ? " has-image" : "") +
            (selected ? " sel" : "") +
            (drop.tagOver ? " tag-over" : "")
          }
          style={{ background: fill.bg, borderColor: fill.border, color: txt, height: headH }}
          /* not while searching -- a filtered board hides siblings, so a
             reorder would be aimed at a run you cannot see. The strip
             disables its cards' drag for the same reason. */
          draggable={!query}
          onDragStart={(e) => {
            dragStore.start({ id: node.id, depth, boardId, nested: isNested(node) }, e.currentTarget as HTMLElement);
            e.dataTransfer.effectAllowed = "copyMove";
            liftDragImage(e, e.currentTarget as HTMLElement);
          }}
          onDragEnd={() => dragStore.end()}
          onClick={(e) => {
            if (e.shiftKey) select(node.id, "range");
            else if (e.metaKey || e.ctrlKey) select(node.id, "toggle");
            else select(node.id, "single");
          }}
          onDoubleClick={(e) => {
            /* the board's own rule at every tier: double-click opens the
               title in place, with the word-select the dblclick made
               thrown away first */
            e.stopPropagation();
            window.getSelection?.()?.removeAllRanges();
            editCard(node.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!selected) select(node.id, "single");
            cardMenu.open(node, e.clientX, e.clientY, {
              boardId,
              parentId,
              index,
              depth,
              colorable: true,
              stackedIds: [],
            });
          }}
          {...drop.props}
          onDragOver={(e) => {
            drop.props.onDragOver(e);
            const item = dragStore.get();
            if (!item || !e.defaultPrevented) return;
            const r = e.currentTarget.getBoundingClientRect();
            const to = e.clientX < r.left + r.width / 2 ? index : index + 1;
            const sameBoard = item.boardId === boardId;
            if (dragStore.isNoOp(parentId, to, sameBoard)) return dropTarget.clearFrom(e);
            dropTarget.set(
              { boardId, parentId, index: to, beforeId: null, axis: "x", side: "before", scope: "node", room: 34, copy: !sameBoard },
              e,
            );
          }}
        >
          {/* A PICTURE ON A COLUMN HEAD (board/cardImage.ts). A head is a
              bounded card shape with an aspect its tier sets (44 x ~163
              by default), not a pane-spanning band, so it fills and
              captions like any other card. */}
          <ImageFrame node={node} />
          <div
            className={"kanban-col-title" + fontClass(node.font ?? level.defaultFont)}
            style={{ fontSize: ink.size, color: txt }}
          >
            <Editable
              value={node.title}
              placeholder={`New ${level.name.toLowerCase()}...`}
              multiline
              autoEdit={autoEdit}
              focusId={node.id}
              focusField="title"
              onCommit={(v) => ops.setNodeField(node.id, "title", v)}
            />
          </div>
          {/* NO COUNT CHIP (owner, 2026-08-16: "the number on those cards
              is just cluttery right now"). If a count comes back it should
              come back the way any other per-card value does -- a metadata
              category in a display SLOT (ADR 0003) -- rather than as a
              second thing this renderer hardcodes onto the head. */}
          <TagTabs
            ids={node.tags}
            tags={tags}
            nodeId={node.id}
            boardId={boardId}
            w={headBox.w}
            h={headBox.h}
          />
        </header>

        <div className="kanban-cards">
          {cards.map((card) => {
            const i = node.children.indexOf(card);
            return (
              <div className="kanban-card-wrap" key={card.id}>
                <CardSlot boardId={boardId} colId={node.id} index={i} />
                <Card
                  card={card}
                  depth={leafDepth}
                  leafLevel={leafLevel}
                  parentId={node.id}
                  index={i}
                  draggable={!query}
                  axis="y"
                />
              </div>
            );
          })}
          <CardSlot boardId={boardId} colId={node.id} index={node.children.length} />

          {/* The rest of the column: publishes append, and carries the
              add button. An EMPTY column's + STANDS AT REST for the same
              reason an empty strip's does (see .beat-insert-alone): the
              hover rule works because there is always a card to hover
              beside, and here there is none. */}
          <div
            className={"kanban-tail" + (node.children.length === 0 ? " kanban-tail-alone" : "")}
            {...tail.props}
            onDragOver={(e) => {
              tail.props.onDragOver(e);
              const item = dragStore.get();
              if (!item || !e.defaultPrevented) return;
              const to = node.children.length;
              const sameBoard = item.boardId === boardId;
              if (dragStore.isNoOp(node.id, to, sameBoard)) return dropTarget.clearFrom(e);
              dropTarget.set(
                { boardId, parentId: node.id, index: to, beforeId: null, axis: "y", side: "before", scope: "node", room: 34, copy: !sameBoard },
                e,
              );
            }}
          >
            <button
              className="kanban-add-card"
              data-tip={`Add ${leafLevel.name.toLowerCase()}`}
              aria-label={`Add ${leafLevel.name.toLowerCase()}`}
              style={
                leafFill
                  ? { background: leafFill.bg, borderColor: leafFill.border, color: textColor(leafFill.bg) }
                  : undefined
              }
              onClick={() => addCard(node.id)}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
});

/* ------------------------------------------------------------------ *
 *  The gaps. Both DRAW ONLY -- the target they show is published by the
 *  card or head the cursor is over, and the drop itself is the
 *  surface's (dropCatcher). One live insertion point, one drawer.
 * ------------------------------------------------------------------ */

function CardSlot({ boardId, colId, index }: { boardId: string; colId: string; index: number }) {
  const at = useIsDropAt(boardId, colId, index);
  return <div className={"kanban-slot" + (at !== "no" ? " open" : "") + (at === "copy" ? " copy" : "")} />;
}

/* THE GAP BETWEEN TWO COLUMNS IS AN INSERT POINT (owner, 2026-08-15:
 * "we need the + buttons between the columns, center justified with the
 * center of the Tier 2 cards. inserts/adds a new column").
 *
 * The strip's own grammar, stood on its end: hover-revealed, the gap
 * eases apart to make room, and the disc is centered on the HEAD rather
 * than on the column -- a column's height is whatever its cards come to,
 * so centering on the column would put the disc at a different height
 * beside every neighbour, and the row of them would wander. The heads
 * all start at the same y and are all `--head-h` tall, so centering there
 * is the one placement that lines them up.
 *
 * It stands down mid-drag: the drop preview owns the gap then, and a +
 * inside a dashed landing marker is two promises. */
function ColumnSlot({
  boardId,
  parentId,
  index,
  colName,
  onAdd,
  fill,
}: {
  boardId: string;
  parentId: string | null;
  index: number;
  colName: string;
  /* the COLUMN tier's default fill -- the disc wears the tier it adds */
  fill?: { bg: string; border: string };
  /* absent while searching -- a filtered board hides columns, so an
     insert would be aimed into a run you cannot see */
  onAdd?: () => void;
}) {
  const at = useIsDropAt(boardId, parentId, index);
  return (
    <div className={"kanban-col-slot" + (at !== "no" ? " open" : "") + (at === "copy" ? " copy" : "")}>
      {onAdd && (
        <button
          className="kanban-col-add"
          data-tip={`Add ${colName.toLowerCase()}`}
          aria-label={`Add ${colName.toLowerCase()}`}
          style={
            fill ? { background: fill.bg, borderColor: fill.border, color: textColor(fill.bg) } : undefined
          }
          onClick={onAdd}
        >
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}
