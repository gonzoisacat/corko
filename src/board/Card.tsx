import { memo, useState } from "react";
import type { CSSProperties } from "react";
import type { LevelDef, Node } from "../state/types";
import { ops, useFields, useLegend, useTags } from "../state/useBoard";
import { resolveNodeColor, resolveNodeColorId, textColor } from "../colors";
import { useBoardUI } from "./context";
import { editCard, useAutoEdit } from "./autoEdit";
import { Editable } from "../ui/Editable";
import { tilt, pinColor } from "./tilt";
import { dragStore, liftDragImage, useDropZone } from "./drag";
import { moveDropped } from "./dropMove";
import { dropTarget } from "./dropTarget";
import { select, selection, useIsSelected } from "./selection";
import { useRemoteFocus } from "../state/sync";
import { useFitText } from "../ui/useFitText";
import { TagTabs, tagAttr } from "./TagTabs";
import { cardFill } from "./tagSplit";
import { NoteDot } from "./NoteDot";
import { CardSlots } from "./CardSlots";
import { hasPicture } from "./cardImage";
import { ImageFrame } from "./ImageFrame";
import { fontClass } from "../fonts";
import { cardText, plainText, shadowAttr } from "./cardText";
import { cardMenu } from "./cardMenu";
import { BEAT_CARD_H, LANE_CARD_H } from "./cardSizing";
import { targetFontSize } from "../state/tierDefaults";
import { NestMark, nestFace } from "./NestedFace";
import { isNested } from "../state/nesting";
import { openNested } from "./openNested";

/* The card's hover tooltip when it carries notes: the newest one's text
 * (prefixed by its author, when it has one), plus how many more there are.
 * Reading a note shouldn't require opening anything. */
function noteTip(notes: Node["notes"]): string | undefined {
  if (!notes?.length) return undefined;
  const last = notes[notes.length - 1];
  const head = last.author ? `${last.author}: ${last.body}` : last.body;
  return notes.length > 1 ? `${head}\n(+${notes.length - 1} more)` : head;
}

interface Props {
  card: Node;
  depth: number; // leaf depth
  leafLevel: LevelDef; // the leaf tier (for default color + font)
  parentId: string; // owning lane (leaf-parent) id
  index: number; // index within the parent's children
  draggable: boolean;
  stack?: Node[]; // hidden cards tucked behind this one
  /* HOW THIS CARD'S CONTAINER STACKS, which is the only thing that
   * decides whether "before me" is to my left or above me. A cut board's
   * strip runs across, so the default is "x" and no caller passes this;
   * a kanban column stacks downward and passes "y" (board/kanban/).
   *
   * It has to reach three places at once or the drop lies: the drop
   * zone's own split, the index this card publishes (read off clientX or
   * clientY), and the axis it publishes with -- which is what the gap
   * uses to decide which way to open. */
  axis?: "x" | "y";
  /* A NESTING CARD renders through this component at EVERY tier, not
   * just the leaf (board/flatten.ts's "nested" row): it is a card
   * wherever it sits, because it can never take children and so must
   * not draw as a band promising a lane below it. `leafLevel` is then
   * that node's own tier, and these two say so -- the height default
   * and the target-size fallback are the only places the leaf differed. */
  tier?: "leaf" | "lane";
}

/* A leaf-tier sticky-note card. Drags to any position within its lane
 * or into another lane at the same tier (spec Sec 4); dropping on a
 * card inserts before it. Right-click opens the card context menu
 * (color / note / duplicate / delete). Memoized: structural-sharing
 * snapshots keep `card` identity stable across unrelated edits. */
export const Card = memo(function Card({ card, depth, leafLevel, parentId, index, draggable, stack, axis = "x", tier = "leaf" }: Props) {
  const { boardId, settings, nests } = useBoardUI();
  const autoEdit = useAutoEdit(card.id);
  /* Being dragged: the card hides but KEEPS ITS SPACE, so the row doesn't
   * close up until the drop actually moves it. Set a tick after dragstart
   * -- hiding the source synchronously cancels the drag in Chromium (the
   * same rule the add-tag menu learned the hard way). */
  const [lifted, setLifted] = useState(false);
  /* An open title field turns the card's own `draggable` off: an HTML5
   * drag starts from the nearest draggable ANCESTOR, so click-dragging
   * across a few words to select them was grabbing the card instead. */
  const [editing, setEditing] = useState(false);
  // the pane's look, not a global one: the two columns can show boards
  // with different backdrops (board/context.ts)
  const { cardTilt, pushpinColor, noteDots, cardImages } = settings;
  const isSelected = useIsSelected(card.id);
  const legend = useLegend(boardId);
  const c = resolveNodeColor(legend, card.color, leafLevel.id, isNested(card));
  // the entry that painted it, for the legend's hover-highlight
  const colorId = resolveNodeColorId(legend, card.color, leafLevel.id, isNested(card));
  const tierTxt = leafLevel.textColor ?? textColor(c.bg);
  /* NO SEARCH DIM HERE, on purpose (owner's call, 2026-08-03: "let's just
   * make it fish and fowl"). The two views do two different things with a
   * query and neither should do a bit of both:
   *
   *   DETAIL   filters -- if a card is drawn, it belongs on screen
   *   OVERVIEW dims    -- everything is drawn, matches stand out
   *
   * This dim could never actually fire until the lane-name rule landed
   * the same day: a strip only ever held cards that matched. Making a
   * name-matched scene bring all its beats woke it up, and half-faded
   * beats inside a scene you deliberately searched for is the blend
   * neither view wants. The matching WORDS are still marked inside the
   * title (ui/highlight) -- that is a highlight, not transparency. */

  // Split by cursor half: left of the card inserts before it, right inserts
  // after -- so the drop lands between cards, marked on the matching edge.
  /* A beat card no longer marks its own edge. It publishes WHICH GAP the
   * drop would land in, and the gap draws itself -- so there is one
   * preview, and the cards actually move apart to make the room (owner:
   * "it should just be the gap ... the cards should always move to show
   * you where the thing is going to land"). A slot the card already
   * occupies is refused outright, so no gap opens for a no-op. */
  const drop = useDropZone(
    depth,
    (item, side) => {
      const to = side === "after" ? index + 1 : index;
      if (dragStore.isNoOp(parentId, to, item.boardId === boardId)) return;
      moveDropped(item, parentId, to, boardId);
    },
    axis,
    card.id, // also a drop target for a tag dragged out of the legend
  );

  const tags = useTags();
  const fields = useFields();
  const remote = useRemoteFocus().get(card.id);
  // Per-tier height, aspect (width = height * aspect) and title size. The
  // title always shrinks to fit; "expand" raises the cap to the card height
  // so short titles grow to fill instead of sitting at the tier size.
  const isLeafTier = tier === "leaf";
  const beatH = leafLevel.height ?? (isLeafTier ? BEAT_CARD_H : LANE_CARD_H);
  const cardW = Math.round(beatH * (leafLevel.aspect ?? 1.45));
  // the tier's TARGET size (expandText retired 2026-08-14); useFitText
  // still shrinks a title that cannot fit at it
  const tierFont = targetFontSize(leafLevel, isLeafTier);
  /* The card's own text: the tier's answer plus any per-card override --
   * unless the words are PLAIN (board/cardText.ts plainText, the one
   * statement of when a picture's overrides stop applying). */
  const plain = plainText(card, cardImages);
  const ink = cardText(card, tierTxt, tierFont, plain);
  const txt = ink.color;
  const beatFont = ink.size;
  /* A NESTING CARD shows the board it stands in for, not its own title
   * (board/NestedFace.tsx). It has to reach the fit as well as the JSX:
   * the fit sizes whatever is RENDERED, so handing it `card.title` here
   * would size the card to a string nobody can see. */
  const face = nestFace(card, nests);
  const shown = face ? face.title : card.title;
  const fit = useFitText(shown, beatFont, 8, {
    fontKey: card.font ?? leafLevel.defaultFont, // re-fit when the typeface changes
    editing, // an empty card renders a blank FIELD but a placeholder SPAN
    layoutKey: `${card.titleAlign ?? ""}|${card.imageFit ?? ""}`,
  });

  return (
    <div
      className={
        "beat hoverable" +
        (cardImages !== "off" && hasPicture(card) ? " has-image" : "") +

        (drop.tagOver ? " tag-drop" : "") +
        (isSelected ? " selected" : "") +
        (lifted ? " drag-lifted" : "")
      }
      draggable={draggable && !editing}
      data-tags={tagAttr(card.tags)}
      data-title-align={card.titleAlign}
      data-text-shadow={shadowAttr(card, plain)}
      data-color={colorId}
      data-node={card.id}
      data-nested={face ? (face.missing ? "missing" : "on") : undefined}
      title={remote ? `${remote.name} is editing` : noteTip(card.notes)}
      onClick={(e) => {
        // A click ANYWHERE on the card -- text included -- selects it; the
        // title's Editable owns no click handlers (double-click edits).
        e.stopPropagation();
        if (e.shiftKey) {
          e.preventDefault();
          select(card.id, "range");
        } else if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          select(card.id, "toggle");
        } else {
          select(card.id, "single");
        }
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.getSelection?.()?.removeAllRanges(); // drop the dblclick word-select
        /* A nesting card has no title of its own to open, which is
         * exactly what frees the gesture: double-click OPENS the board
         * it stands in for (board/openNested.ts asks where). */
        if (card.boardRef) openNested.ask(card.boardRef, e.clientX, e.clientY);
        else editCard(card.id);
      }}
      onDragStart={(e) => {
        // dragging an unselected card is a single-card action -> drop any
        // group; dragging a selected card carries the whole selection.
        if (!isSelected) selection.clear();
        dragStore.start({ id: card.id, depth, boardId, nested: isNested(card) }, e.currentTarget as HTMLElement);
        // copyMove: a drop into another board copies (see dropMove.ts)
        e.dataTransfer.effectAllowed = "copyMove";
        liftDragImage(e, e.currentTarget as HTMLElement); // half-size ghost
        window.setTimeout(() => setLifted(true), 0); // hide AFTER capture
      }}
      onDragEnd={() => {
        dragStore.end();
        setLifted(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        /* Right-clicking a card OUTSIDE the current selection takes
         * the selection (owner's call): the menu acts on what you
         * clicked, so leaving another card lit says the wrong thing.
         * Inside a multi-selection it changes nothing -- that's how
         * "recolor these six" survives the right-click that starts
         * it. */
        if (!isSelected) select(card.id, "single");
        cardMenu.open(card, e.clientX, e.clientY, {
          boardId,
          parentId,
          index,
          depth,
          colorable: true,
          stackedIds: (stack ?? []).map((c) => c.id),
        });
      }}
      {...drop.props}
      onDragOver={(e) => {
        drop.props.onDragOver(e);
        const item = dragStore.get();
        /* `drop.over` is LAST render's state, so gating on it means a
         * single dragover never publishes -- and the first one is the
         * only one a careful cursor sends. The zone signals acceptance by
         * calling preventDefault, so ask the event instead. */
        if (!item || !e.defaultPrevented) return;
        const r = e.currentTarget.getBoundingClientRect();
        const before =
          axis === "y" ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
        const to = before ? index : index + 1;
        const sameBoard = item.boardId === boardId;
        if (dragStore.isNoOp(parentId, to, sameBoard)) return dropTarget.clearFrom(e);
        dropTarget.set({ boardId, parentId, index: to, beforeId: null, axis, side: "before", scope: "node", room: 34, copy: !sameBoard }, e);
      }}
      style={
        {
          ...cardFill(c.bg, card.tags, tags),
          borderColor: c.border,
          width: cardW,
          height: beatH,
          minHeight: beatH,
          transform: cardTilt ? `rotate(${tilt(card.id)}deg)` : undefined,
          outline: remote ? `2px solid ${remote.color}` : undefined,
          outlineOffset: remote ? 1 : undefined,
          ...(pushpinColor === "random" ? { "--pin-color": pinColor(card.id) } : {}),
        } as CSSProperties
      }
    >
      <TagTabs ids={card.tags} tags={tags} nodeId={card.id} boardId={boardId} w={cardW} h={beatH} />
      {/* A PICTURE ON THE CARD, on any board type (board/cardImage.ts).
          It fills the card and the title becomes a caption over the
          bottom of it -- a photo with a caption, which is what a
          corkboard photo IS. Not draggable: the browser's own image drag
          would fight the card's. */}
      <ImageFrame node={card} />
      <div
        className={"beat-text" + fontClass(card.font ?? leafLevel.defaultFont)}
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
            placeholder="New card..."
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
      <NoteDot notes={card.notes} on={noteDots} nodeId={card.id} />
      <CardSlots node={card} fields={fields} color={txt} />
      {/* STOWED content (a demoted lane's beats living on as below-leaf
          children) carries no on-card mark (owner's call): the card menu
          shows the count and an outline submenu instead. */}
      {/* No hover controls (owner's call, 2026-08-02 -- they lived where
          the mouse already was, and the trash can got hit by accident, so
          every tier's cluster went together). Delete lives in the
          right-click menu; the whole card drags, so the grip said nothing
          the cursor didn't. */}
    </div>
  );
});
