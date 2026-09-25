import { memo, useState } from "react";
import type { CSSProperties, PointerEvent as RPointerEvent } from "react";
import type { LevelDef, Node } from "../../state/types";
import { CELL, DEFAULT_SPAN, spanOf } from "../../state/gridBoard";
import { targetFontSize } from "../../state/tierDefaults";
import { ops, useFields, useLegend, useTags } from "../../state/useBoard";
import { resolveNodeColor, resolveNodeColorId, textColor } from "../../colors";
import { isNested } from "../../state/nesting";
import { useBoardUI } from "../context";
import { editCard, useAutoEdit } from "../autoEdit";
import { Editable } from "../../ui/Editable";
import { tilt } from "../tilt";
import { select, selection, useIsSelected } from "../selection";
import { useLegendDrop } from "../legendDrag";
import { useRemoteFocus } from "../../state/sync";
import { useFitText } from "../../ui/useFitText";
import { TagTabs, tagAttr } from "../TagTabs";
import { cardFill } from "../tagSplit";
import { NoteDot } from "../NoteDot";
import { CardSlots } from "../CardSlots";
import { hasPicture } from "../cardImage";
import { ImageFrame } from "../ImageFrame";
import { fontClass } from "../../fonts";
import { cardMenu } from "../cardMenu";
import { NestMark, nestFace } from "../NestedFace";
import { openNested } from "../openNested";
import { useGridOffset, useGridSpan } from "./gridDrag";
import { cardText, plainText, shadowAttr } from "../cardText";

/* ------------------------------------------------------------------ *
 *  ONE CARD ON THE FREE GRID.
 *
 *  Its own component rather than a mode of board/Card.tsx, and the split
 *  is where the two genuinely differ: a Card is sized by its TIER and
 *  dragged BETWEEN its siblings, while this one is sized by its own span
 *  and dragged to a POSITION. Everything a card carries -- tags, notes,
 *  metadata slots, the fitted title, the pushpin, the tilt, the legend
 *  color, nesting -- is the same machinery, imported rather than
 *  reimplemented, so a grid card is a Corko card and not a lookalike.
 *
 *  THE PIN IS NOT HERE. On this board a pushpin is a real element (yarn
 *  is tied to it) AND it has to paint above the string, which a child of
 *  this card can never do -- the card has a z-index, so it is a stacking
 *  context nothing inside can climb out of. The pins are their own layer
 *  above the yarn: board/grid/Pins.tsx.
 * ------------------------------------------------------------------ */

interface Props {
  card: Node;
  level: LevelDef;
  x: number; // cell
  y: number;
  onMoveStart: (e: RPointerEvent, id: string) => void;
  onResizeStart: (e: RPointerEvent, id: string) => void;
  /* Being aimed at by a length of yarn in flight -- the card lights up
   * so you can see what releasing would tie to. */
  yarnTarget: boolean;
}

export const GridCard = memo(function GridCard({
  card,
  level,
  x,
  y,
  onMoveStart,
  onResizeStart,
  yarnTarget,
}: Props) {
  const { boardId, settings, nests, slot } = useBoardUI();
  const { cardTilt, noteDots, cardImages } = settings;
  const autoEdit = useAutoEdit(card.id);
  const [editing, setEditing] = useState(false);
  const isSelected = useIsSelected(card.id);
  const legend = useLegend(boardId);
  const tags = useTags();
  const fields = useFields();
  const remote = useRemoteFocus().get(card.id);
  /* A LEGEND CHIP (tag or color) landing on this card. The grid's own
   * gestures are pointer events, so this surface had no HTML5 drop
   * handlers at all -- a chip dragged from the legend simply never
   * landed (owner-reported 2026-08-29). The hook is the legend half of
   * useDropZone and nothing else; a chip in flight suppresses no
   * pointer gesture because HTML5 drag already swallows the pointer. */
  const chip = useLegendDrop(card.id);

  const nested = isNested(card);
  const c = resolveNodeColor(legend, card.color, level.id, nested);
  const colorId = resolveNodeColorId(legend, card.color, level.id, nested);
  const tierTxt = level.textColor ?? textColor(c.bg);

  /* THE LIVE SPAN while this card is being resized, so it grows under
   * the cursor rather than jumping to its new size on release. Falls back
   * to the committed one, which is every card at rest and every card that
   * is not the one being resized. */
  const liveSpan = useGridSpan(card.id, slot);
  const span = liveSpan ?? spanOf(card);
  /* The LIVE position while this card is being dragged -- a delta in
   * cells, applied as a transform rather than by rewriting `cell`, so a
   * pointermove costs a repaint and not a doc write (gridDrag.ts). */
  const drag = useGridOffset(card.id, slot);
  const w = span.w * CELL;
  const h = span.h * CELL;

  const face = nestFace(card, nests);
  const shown = face ? face.title : card.title;
  /* THE TARGET SIZE SCALES WITH THE CARD, which it has to on this type
   * and on no other: a span runs from 2 cells to 22, so the same fixed
   * target that suits a beat card would leave a wall-sized card holding
   * a caption. The tier's own "Target font size" is still the number
   * being scaled -- the Options slider means exactly what it means
   * everywhere else -- and the DEFAULT span is the 1x point, so a card
   * at the size the board hands you reads at the tier's size. Then the
   * usual fit shrinks it if the words do not fit. */
  const tierFont = targetFontSize(level, true);
  // plain words (board/cardText.ts plainText): the one rule, not a copy
  const plain = plainText(card, cardImages);
  const ink = cardText(card, tierTxt, tierFont, plain);
  const txt = ink.color;
  const base = ink.size;
  const target = Math.max(9, Math.min(96, Math.round((base * h) / (DEFAULT_SPAN.h * CELL))));
  const fit = useFitText(shown, target, 7, {
    layoutKey: `${card.titleAlign ?? ""}|${card.imageFit ?? ""}`,
    fontKey: card.font ?? level.defaultFont,
    editing,
  });

  const style: CSSProperties = {
    left: x * CELL,
    top: y * CELL,
    width: w,
    height: h,
    background: undefined,
    ...cardFill(c.bg, card.tags, tags),
    borderColor: c.border,
    color: txt,
    ...(drag ? { transform: `translate(${drag.x * CELL}px, ${drag.y * CELL}px)` } : {}),
    ...(cardTilt && !drag ? { rotate: `${tilt(card.id)}deg` } : {}),
  };

  return (
    <div
      className={
        "grid-card" +
        (isSelected ? " selected" : "") +
        (drag ? " dragging" : "") +
        (liveSpan ? " resizing" : "") +
        (yarnTarget ? " yarn-target" : "") +
        (chip.over ? " tag-drop" : "") +
        (cardImages !== "off" && hasPicture(card) ? " has-image" : "")
      }
      {...chip.props}
      style={style}
      data-node={card.id}
      data-color={colorId}
      data-tags={tagAttr(card.tags)}
      data-title-align={card.titleAlign}
      data-text-shadow={shadowAttr(card, plain)}
      data-nested={face ? (face.missing ? "missing" : "on") : undefined}
      title={remote ? `${remote.name} is editing` : undefined}
      onPointerDown={(e) => {
        if (editing || e.button !== 0) return;
        onMoveStart(e, card.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.shiftKey) select(card.id, "range");
        else if (e.metaKey || e.ctrlKey) select(card.id, "toggle");
        else select(card.id, "single");
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.getSelection?.()?.removeAllRanges();
        if (card.boardRef) openNested.ask(card.boardRef, e.clientX, e.clientY);
        else editCard(card.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isSelected) select(card.id, "single");
        cardMenu.open(card, e.clientX, e.clientY, {
          boardId,
          parentId: null,
          index: 0,
          depth: 0,
          colorable: true,
        });
      }}
    >
      {/* The image fills or fits the card (board/CardImage.tsx).
          Not draggable: the browser's own image drag would fight the
          card's pointer gesture. */}
      <ImageFrame node={card} className="grid-photo" />

      <div
        className={"grid-card-text" + fontClass(card.font ?? level.defaultFont)}
        ref={fit.ref}
        onInput={fit.remeasure}
      >
        {face ? (
          <span className="nest-title" style={{ lineHeight: 1.25, color: txt }}>
            <NestMark face={face} />
            {face.title}
          </span>
        ) : (
          <Editable
            value={card.title}
            placeholder={card.image ? "" : "New card..."}
            multiline
            autoEdit={autoEdit}
            focusId={card.id}
            focusField="title"
            onEditing={setEditing}
            onCommit={(v) => ops.setNodeField(card.id, "title", v)}
            style={{ lineHeight: 1.25, color: txt }}
          />
        )}
      </div>

      <TagTabs ids={card.tags} tags={tags} nodeId={card.id} boardId={boardId} w={w} h={h} />
      <NoteDot notes={card.notes} on={noteDots} nodeId={card.id} />
      <CardSlots node={card} fields={fields} color={txt} />

      {/* Resize, in whole cells, from the corner the eye expects. */}
      <span
        className="grid-resize"
        aria-hidden
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizeStart(e, card.id);
        }}
      />
    </div>
  );
});

/* Which cards a drag from `id` carries: the whole selection when this
 * card is part of one, otherwise just itself.
 *
 * IT DOES NOT TOUCH THE SELECTION, and that is the fix for a real bug.
 * Every other surface clears the group in `onDragStart`, which HTML5 DnD
 * fires only once a drag is genuinely under way. Here the equivalent
 * moment is pointerdown -- which also precedes the CLICK -- so clearing
 * there wiped the group a Cmd-click was about to extend: the second card
 * lit up and the first went dark. The clearing happens when the drag is
 * CONFIRMED instead (GridView, on the first move past the slop), which
 * is the moment HTML5 DnD would have told us about anyway. */
export function dragSet(id: string): string[] {
  return selection.has(id) && selection.size() > 1 ? selection.ids() : [id];
}
